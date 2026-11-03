#!/usr/bin/env python3
"""Cheap weekly change detection and connection matching for Target companies.

docs/COMPANY_RESEARCH.md runs this before any AI research, so a week where
nothing changed costs a few HTTP requests and no model work.

  fingerprint   hash each Target company's public job board (Ashby, Greenhouse,
                Lever posting APIs) and the visible text of its homepage and
                /news, /blog, /newsroom pages; compare with the last run's
                state file and say what changed and what is due a full refresh
  connections   match Casey's LinkedIn Connections export to companies by
                normalized company name, and report which named people
                (founders) are 1st-degree connections

Fetching rules: one honest User-Agent, robots.txt respected for every host
(RFC 9309: a 4xx robots.txt means no policy, 5xx or an unreadable body means
don't fetch),
short timeouts, one backoff on 429/5xx and no other retries. A DNS failure,
a network-policy block, a timeout or a 403 is recorded as `unreachable`, never
bypassed and never an error. Email addresses from the export are never output.

Usage:
  python3 tools/company_watch.py fingerprint --companies docs.json --state STATE.json [--out OUT.json] [--write-state]
  python3 tools/company_watch.py connections --csv Connections.csv [--companies docs.json] [--people "A B;C D"]

--companies is a JSON list of company docs, a {id: doc} object, or a directory
of <id>.json files (an ArtifactData list with out_dir; a companies/ subfolder
is read too). Output is JSON on stdout (and --out). Exit 0 unless the inputs
can't be read.
"""

import argparse
import csv
import hashlib
import io
import json
import re
import socket
import sys
import time
import unicodedata
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))
from robots_check import allowed, has_undecodable_rule, is_robots_body  # noqa: E402

UA = "Mozilla/5.0 (compatible; job-search-watch/1.0)"
ROBOTS_AGENT = "job-search-watch"
TIMEOUT = 8
BACKOFF_SECONDS = 3
FULL_EVERY_DAYS = 90
SITE_PATHS = ("/", "/news", "/blog", "/newsroom")
ATS_HOSTS = ("ashbyhq.com", "greenhouse.io", "lever.co", "myworkdayjobs.com", "workable.com",
             "smartrecruiters.com", "bamboohr.com", "rippling.com", "linkedin.com")
ATS_API = {
    "ashby": "https://api.ashbyhq.com/posting-api/job-board/{token}",
    "greenhouse": "https://boards-api.greenhouse.io/v1/boards/{token}/jobs",
    "lever": "https://api.lever.co/v0/postings/{token}?mode=json",
}


class Unreachable(Exception):
    """The host can't be reached or declined us. Recorded, never retried around."""


# ---------- fetching ----------

def http_get(url):
    """(status, text) for a 2xx/4xx/5xx answer; Unreachable for no answer at all."""
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,application/json,*/*"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return r.status, r.read(2_000_000).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, ""
    except urllib.error.URLError as e:
        reason = e.reason
        if isinstance(reason, socket.gaierror):
            raise Unreachable("DNS lookup failed")
        if "403" in str(reason) or "407" in str(reason):
            raise Unreachable("blocked by network policy")
        raise Unreachable(type(reason).__name__ if not isinstance(reason, str) else reason)
    except (socket.timeout, TimeoutError):
        raise Unreachable("timed out")
    except (ConnectionError, OSError) as e:
        raise Unreachable(type(e).__name__)


class Fetcher:
    """GET with robots.txt checks and a single backoff. `get` is injectable for tests."""

    def __init__(self, get=http_get, sleep=time.sleep):
        self._get, self._sleep, self._robots = get, sleep, {}

    def _robots_ok(self, url):
        p = urlsplit(url)
        host = f"{p.scheme}://{p.netloc}"
        if host not in self._robots:
            status, body = self._get(host + "/robots.txt")   # Unreachable propagates
            if status == 200:                                # unreadable soft-200: don't fetch
                ok = is_robots_body(body) and not has_undecodable_rule(body)
                self._robots[host] = body if ok else None
            elif 400 <= status < 500:
                self._robots[host] = ""   # RFC 9309 2.3.1.3: unavailable, access allowed (API hosts answer 401/404)
            else:
                self._robots[host] = None                    # 5xx: RFC 9309 says assume complete disallow
        body = self._robots[host]
        if body is None:
            return False
        path = p.path or "/"
        if p.query:
            path += "?" + p.query
        return allowed(body, ROBOTS_AGENT, path)

    def get(self, url):
        if not self._robots_ok(url):
            raise Unreachable("robots.txt disallows or is unreadable")
        status, body = self._get(url)
        if status == 429 or status >= 500:
            self._sleep(BACKOFF_SECONDS)
            status, body = self._get(url)
        if status in (401, 403):
            raise Unreachable(f"HTTP {status} (declined)")
        if status == 429 or status >= 500:
            raise Unreachable(f"HTTP {status}")
        return status, body


# ---------- parsing ----------

def parse_jobs(system, body):
    """Sorted [{id, title, url}] from an Ashby, Greenhouse or Lever posting API."""
    data = json.loads(body)
    if system == "lever":
        rows = [(j.get("id"), j.get("text"), j.get("hostedUrl")) for j in data]
    elif system == "greenhouse":
        rows = [(j.get("id"), j.get("title"), j.get("absolute_url")) for j in data.get("jobs", [])]
    else:  # ashby
        rows = [(j.get("id"), j.get("title"), j.get("jobUrl")) for j in data.get("jobs", [])
                if j.get("isListed", True)]
    jobs = [{"id": str(i), "title": " ".join(str(t or "").split()), "url": u or ""} for i, t, u in rows if i]
    return sorted(jobs, key=lambda j: (j["id"], j["title"]))


def jobs_hash(jobs):
    pairs = sorted((j["id"], j["title"]) for j in jobs)
    return sha(json.dumps(pairs, separators=(",", ":")))


class _Text(HTMLParser):
    SKIP = {"script", "style", "noscript", "template", "svg", "head"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.depth, self.parts = 0, []

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self.depth += 1

    def handle_endtag(self, tag):
        if tag in self.SKIP and self.depth:
            self.depth -= 1

    def handle_data(self, data):
        if not self.depth:
            self.parts.append(data)


def visible_text(html):
    """Lowercased visible text with whitespace collapsed: markup-only changes don't count."""
    p = _Text()
    p.feed(html)
    p.close()
    return " ".join(" ".join(p.parts).split()).lower()


def sha(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def detect_system(c):
    ats = c.get("ats") or {}
    system = str(ats.get("system") or "").lower()
    url = ats.get("apiUrl") or ""
    for name, host in (("ashby", "ashbyhq.com"), ("greenhouse", "greenhouse.io"), ("lever", "lever.co")):
        if name in system or host in url:
            return name, url or (ATS_API[name].format(token=ats["token"]) if ats.get("token") else "")
    return "", ""


def site_root(c):
    """https://<host> for the company's own site, or "" when only an ATS page is known."""
    url = c.get("website") or c.get("careersUrl") or ""
    host = urlsplit(url if "//" in url else "https://" + url).hostname or ""
    if not host:
        return ""
    if c.get("website"):
        return f"https://{host}"
    if any(host == h or host.endswith("." + h) for h in ATS_HOSTS):
        return ""   # a hosted job board says nothing about the company's own domain
    labels = host.split(".")
    while len(labels) > 2 and labels[0] in ("careers", "jobs", "job", "apply", "boards"):
        labels = labels[1:]
    return "https://" + ".".join(labels)


# ---------- fingerprint ----------

def _when(s):
    try:
        d = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def due_full(c, now):
    prof = c.get("profile") or {}
    if c.get("needsResearch") or not prof:
        return True
    at = _when(prof.get("fullAt") or "")
    return at is None or now - at > timedelta(days=FULL_EVERY_DAYS)


def fingerprint_company(c, prev, fetch, now):
    prev = prev or {}
    out = {"id": c["id"], "name": c.get("name", ""), "changed": {"jobs": False, "site": False},
           "newJobs": [], "removedJobs": [], "unreachable": [], "dueFull": due_full(c, now),
           "firstSeen": not prev}
    state = {"checkedAt": now.isoformat(timespec="seconds")}

    system, api = detect_system(c)
    if api:
        try:
            status, body = fetch.get(api)
            if status != 200:
                raise Unreachable(f"HTTP {status}")
            jobs = parse_jobs(system, body)
            state.update(jobsHash=jobs_hash(jobs), jobs=jobs)
            if prev.get("jobsHash"):
                old = {j["id"]: j for j in prev.get("jobs", [])}
                cur = {j["id"]: j for j in jobs}
                out["changed"]["jobs"] = state["jobsHash"] != prev["jobsHash"]
                out["newJobs"] = [cur[i] for i in sorted(cur) if i not in old]
                out["removedJobs"] = [old[i] for i in sorted(old) if i not in cur]
            out["openJobs"] = len(jobs)
        except Unreachable as e:
            out["unreachable"].append({"url": api, "reason": str(e)})
        except (ValueError, AttributeError, TypeError):
            out["unreachable"].append({"url": api, "reason": "unexpected response format"})
        if "jobsHash" not in state and prev.get("jobsHash"):
            state.update(jobsHash=prev["jobsHash"], jobs=prev.get("jobs", []))   # keep, don't flag

    root = site_root(c)
    pages, prev_pages = {}, prev.get("pages") or {}
    if root:
        for path in SITE_PATHS:
            url = root + path
            try:
                status, body = fetch.get(url)
                if status == 200:
                    h = sha(visible_text(body))
                    if h not in pages.values():          # /newsroom redirecting to /news counts once
                        pages[path] = h
            except Unreachable as e:
                out["unreachable"].append({"url": url, "reason": str(e)})
                if path in prev_pages:
                    pages[path] = prev_pages[path]
                if path == "/":
                    for rest in SITE_PATHS[1:]:          # host is down or declined: stop here
                        if rest in prev_pages:
                            pages[rest] = prev_pages[rest]
                    break
    if pages:
        state["pages"] = pages
        state["siteHash"] = sha(json.dumps(sorted(pages.items())))
        if prev.get("siteHash"):
            out["changed"]["site"] = state["siteHash"] != prev["siteHash"]
            out["changedPages"] = sorted(p for p in set(pages) | set(prev_pages) if pages.get(p) != prev_pages.get(p))
    return out, state


def load_companies(path):
    p = Path(path)
    if p.is_dir():
        files = sorted(p.glob("*.json")) + sorted(p.glob("companies/*.json"))
        docs = []
        for f in files:
            d = json.loads(f.read_text(encoding="utf-8"))
            docs.append({"id": f.stem, **d} if isinstance(d, dict) else d)
        return docs
    data = json.loads(p.read_text(encoding="utf-8"))
    if isinstance(data, dict):
        return [{"id": k, **v} for k, v in data.items()]
    return data


def cmd_fingerprint(args, fetch=None, now=None):
    now = now or datetime.now(timezone.utc)
    fetch = fetch or Fetcher()
    state_path = Path(args.state)
    state = json.loads(state_path.read_text(encoding="utf-8")) if state_path.exists() else {}
    known = state.setdefault("companies", {})
    results = []
    for c in load_companies(args.companies):
        if c.get("status") != "target" or not c.get("id"):
            continue
        res, new = fingerprint_company(c, known.get(c["id"]), fetch, now)
        results.append(res)
        known[c["id"]] = new
    emit(results, args.out)
    if args.write_state:
        state["version"], state["updatedAt"] = 1, now.isoformat(timespec="seconds")
        state_path.parent.mkdir(parents=True, exist_ok=True)
        state_path.write_text(json.dumps(state, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    return results


# ---------- connections ----------

SUFFIXES = {"inc", "incorporated", "llc", "ltd", "limited", "corp", "corporation", "co", "ai",
            "technologies", "technology", "plc", "gmbh"}


def norm_company(name):
    s = unicodedata.normalize("NFKD", str(name or "")).encode("ascii", "ignore").decode().lower()
    s = s.replace("&", " and ")
    s = re.sub(r"\.(com|io|ai|dev|co)\b", " ", s)          # fireworks.ai -> fireworks
    words = re.sub(r"[^a-z0-9]+", " ", s).split()
    while len(words) > 1 and words[-1] in SUFFIXES:
        words.pop()
    while len(words) > 1 and words[0] == "the":
        words.pop(0)
    return " ".join(words)


def norm_person(name):
    s = unicodedata.normalize("NFKD", str(name or "")).encode("ascii", "ignore").decode().lower()
    return " ".join(re.sub(r"[^a-z0-9 ]+", " ", s).split())


def read_connections(text):
    """Rows of the LinkedIn export, skipping its "Notes:" preamble. Email is dropped here."""
    lines = text.lstrip("﻿").splitlines()
    start = next((i for i, l in enumerate(lines) if l.replace('"', "").startswith("First Name,Last Name")), None)
    if start is None:
        raise ValueError("no 'First Name,Last Name,...' header row found")
    rows = []
    for r in csv.DictReader(io.StringIO("\n".join(lines[start:]))):
        name = " ".join(f"{r.get('First Name') or ''} {r.get('Last Name') or ''}".split())
        if name:
            rows.append({"name": name, "position": (r.get("Position") or "").strip(),
                         "url": (r.get("URL") or "").strip(), "connectedOn": (r.get("Connected On") or "").strip(),
                         "company": (r.get("Company") or "").strip()})
    return rows


def company_keys(c):
    names = [c.get("name"), c.get("portfolioCompany")] + list(c.get("aliases") or [])
    return {k for k in (norm_company(n) for n in names if n) if k}


def match_connections(rows, companies):
    by_key = {}
    for r in rows:
        by_key.setdefault(norm_company(r["company"]), []).append(r)
    out = []
    for c in companies:
        people = []
        for k in sorted(company_keys(c)):
            people += by_key.get(k, [])
        seen, uniq = set(), []
        for p in sorted(people, key=lambda p: (p["name"].lower(), p["url"])):
            if (p["name"], p["url"]) not in seen:
                seen.add((p["name"], p["url"]))
                uniq.append({k: p[k] for k in ("name", "position", "url", "connectedOn")})
        out.append({"id": c.get("id", ""), "company": c.get("name", ""), "count": len(uniq), "people": uniq})
    return out


def match_people(rows, names):
    idx = {}
    for r in rows:
        idx.setdefault(norm_person(r["name"]), []).append(r)
    out = []
    for n in names:
        hits = idx.get(norm_person(n), [])
        out.append({"name": n, "connected": bool(hits),
                    "matches": [{k: h[k] for k in ("name", "position", "company", "url")} for h in hits]})
    return out


def cmd_connections(args):
    rows = read_connections(Path(args.csv).read_text(encoding="utf-8-sig", errors="replace"))
    result = {}
    if args.companies:
        result["companies"] = match_connections(rows, load_companies(args.companies))
    if args.people:
        result["people"] = match_people(rows, [n.strip() for n in args.people.split(";") if n.strip()])
    emit(result, args.out)
    return result


def emit(obj, out):
    text = json.dumps(obj, indent=1, ensure_ascii=False)
    if out:
        Path(out).write_text(text + "\n", encoding="utf-8")
    sys.stdout.write(text + "\n")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("fingerprint")
    f.add_argument("--companies", required=True)
    f.add_argument("--state", required=True)
    f.add_argument("--out")
    f.add_argument("--write-state", action="store_true")
    c = sub.add_parser("connections")
    c.add_argument("--csv", required=True)
    c.add_argument("--companies")
    c.add_argument("--people")
    c.add_argument("--out")
    args = ap.parse_args(argv)
    try:
        if args.cmd == "fingerprint":
            cmd_fingerprint(args)
        else:
            if not args.companies and not args.people:
                ap.error("connections needs --companies, --people, or both")
            cmd_connections(args)
    except (OSError, ValueError) as e:
        print(f"company_watch: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
