#!/usr/bin/env python3
"""Greenhouse form filler for the submitter (PLAN B4).

Two subcommands, both driven by Playwright:

  inspect   open a posting's application form read-only and print its
            questions (label, type, required, choices). Nothing is typed.
  submit    fill the form from an answer plan Casey approved, upload the
            approved resume and cover letter, check every value the form
            shows, and (only with --submit) click "Submit application" once.

Answer plans are built by Claude when the application is drafted, shown on the
dashboard ticket, and approved there. This tool never decides an answer: it
replays the plan exactly and stops when the live form no longer matches it.

Stops without submitting (status `blocked`) when:
  - the plan's hash isn't the one Casey approved (--approved-hash)
  - a planned question changed (label, type, required, or choices)
  - a required question has no planned answer
  - a planned value doesn't stick, or an upload doesn't show
  - a password, account sign-up, or visible CAPTCHA challenge appears
  - an attempt marker already exists in the evidence folder (one attempt only)

After clicking submit, `submitted` needs proof: Greenhouse's confirmation page
or a "thank you for applying" heading. Greenhouse may ask for a security code
it emails to the applicant; the tool prints NEEDS_CODE and waits for the code
in --code-file. Anything else after the click is `uncertain`, never retried.

Usage:
  python3 tools/submitter/greenhouse.py inspect --url URL [--board B] [--out form.json]
  python3 tools/submitter/greenhouse.py hash --plan form_answers.json
  python3 tools/submitter/greenhouse.py submit --plan form_answers.json \
      --cv cv.pdf --cover cover.pdf --evidence DIR \
      [--submit --approved-hash H] [--code-file F]

Prints one JSON object on stdout. Exit 0 when the run did what was asked
(including a clean `blocked` stop), 1 on usage errors or `uncertain`.
"""

import argparse
import hashlib
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

HOSTS = {"boards.greenhouse.io", "job-boards.greenhouse.io",
         "boards.eu.greenhouse.io", "job-boards.eu.greenhouse.io"}
CODE = re.compile(r"security-input|one.time.code|verification.code|security.code", re.I)
CONFIRMED = re.compile(r"thank you for applying|application (received|submitted)|task complete", re.I)


class Stop(Exception):
    """A clean stop: the form or the plan needs Casey."""


def now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def sha(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def embed_url(url, board=None, test_origin=None):
    """Return the Greenhouse embed form URL for a posting link.

    Accepts job-boards/boards links, embed links, or an employer page with
    ?gh_jid= plus the board token. Loading the embed form directly avoids
    employer redirects and keeps the browser on Greenhouse.
    """
    parts = urlsplit(url)
    query = parse_qs(parts.query)
    host = parts.hostname or ""
    if test_origin and url.startswith(test_origin):
        return url
    if host in HOSTS:
        if parts.path.rstrip("/") == "/embed/job_app":
            board, job = query.get("for", [None])[0], query.get("token", [None])[0]
        else:
            m = re.fullmatch(r"/([^/]+)/jobs/(\d+)/?", parts.path)
            if not m:
                raise SystemExit(f"Not a Greenhouse posting link: {url}")
            board, job = m.groups()
    else:
        job = query.get("gh_jid", [None])[0]
        if not job or not board:
            raise SystemExit("An employer-hosted link needs ?gh_jid= and --board.")
    if not (board and re.fullmatch(r"[A-Za-z0-9_-]+", board) and job and job.isdigit()):
        raise SystemExit("Could not read the board and job id from the link.")
    base = "https://job-boards.eu.greenhouse.io" if ".eu." in host else "https://job-boards.greenhouse.io"
    return f"{base}/embed/job_app?for={board}&token={job}"


# Reads the visible controls only. Choices of a checkbox or radio group become
# one question keyed by the group's name.
FIELDS_JS = r"""() => {
 const vis = e => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
 const txt = e => e ? e.innerText.trim() : '';
 const byIds = (e, a) => (e.getAttribute(a)||'').split(/\s+/).filter(Boolean).map(i=>document.getElementById(i)).filter(Boolean);
 const group = e => { const g = e.closest('fieldset,[role="group"],[role="radiogroup"]'); if(!g) return '';
   return byIds(g,'aria-labelledby').map(txt).join(' ') || g.getAttribute('aria-label') || txt(g.querySelector(':scope > legend')); };
 const own = e => [...(e.labels||[])].map(txt).filter(Boolean).join(' ') || e.getAttribute('aria-label') || byIds(e,'aria-labelledby').map(txt).join(' ');
 const out = [];
 for (const e of document.querySelectorAll('input,textarea,select')) {
   if (e.type === 'hidden' || e.disabled) continue;
   if (!e.id && !e.name) continue;  // react-select's hidden required mirror
   const shown = vis(e) || (e.type === 'file' && (vis(e.closest('fieldset,[role="group"],.field,div')) || [...(e.labels||[])].some(vis)))
     || (['checkbox','radio'].includes(e.type) && [...(e.labels||[])].some(vis));
   if (!shown) continue;
   const box = e.closest('.select__container,.field') || e.parentElement;
   const role = e.getAttribute('role');
   out.push({id: e.id, name: e.name || '', tag: e.tagName.toLowerCase(),
     type: e.tagName === 'SELECT' ? 'select' : role === 'combobox' ? 'combobox' : (e.type || 'text'),
     group: group(e), label: own(e),
     required: !!e.required || e.getAttribute('aria-required') === 'true' || /\*\s*$/.test(group(e) || own(e)),
     multiple: !!e.multiple, accept: e.accept || '', autocomplete: e.autocomplete || '',
     value: e.type === 'file' ? [...e.files].map(f=>f.name).join(',') : (e.value || ''),
     checked: !!e.checked,
     selected: [...box.querySelectorAll('[class*="single-value"],[class*="singleValue"],[class*="multi-value__label"]')].map(txt).filter(Boolean),
     options: e.tagName === 'SELECT' ? [...e.options].map(o=>o.text.trim()).filter(Boolean) : []});
 }
 const alerts = [...document.querySelectorAll('[role="alert"],.error,.helper-text--error')].filter(vis).map(txt).filter(Boolean);
 const headings = [...document.querySelectorAll('h1,h2,h3,[role="heading"]')].filter(vis).map(txt);
 return {controls: out, alerts, headings};
}"""


def strip_star(label):
    return re.sub(r"\s*\*\s*$", "", (label or "").strip())


def questions_from(raw):
    """Collapse raw controls into questions keyed by id (or group name)."""
    qs, groups = [], {}
    for c in raw["controls"]:
        kind = c["type"]
        if CODE.search(" ".join([c["id"], c["name"], c["autocomplete"], c["label"]])):
            continue
        if kind in ("checkbox", "radio") and c["name"]:
            key = c["name"]
            q = groups.get(key)
            if q is None:
                q = {"key": key, "label": strip_star(c["group"] or c["label"]),
                     "type": "checkboxes" if kind == "checkbox" else "radio",
                     "required": c["required"], "options": [], "controls": [], "answered": []}
                groups[key] = q
                qs.append(q)
            q["options"].append(strip_star(c["label"]))
            q["controls"].append(c["id"])
            q["required"] = q["required"] or c["required"]
            if c["checked"]:
                q["answered"].append(strip_star(c["label"]))
            continue
        if kind == "checkbox":  # a lone consent-style box
            qs.append({"key": c["id"], "label": strip_star(c["label"] or c["group"]), "type": "checkbox",
                       "required": c["required"], "options": [], "controls": [c["id"]],
                       "answered": [True] if c["checked"] else []})
            continue
        label = strip_star((c["group"] or c["label"]) if kind == "file" else (c["label"] or c["group"]))
        kind = {"email": "text", "url": "text", "number": "text", "date": "text"}.get(kind, kind)
        answered = c["selected"] if kind == "combobox" else ([c["value"]] if c["value"] else [])
        qs.append({"key": c["id"], "label": label, "type": kind, "required": c["required"],
                   "multiple": c["multiple"], "accept": c["accept"], "options": c["options"],
                   "controls": [c["id"]], "answered": answered})
    for q in qs:
        q["signature"] = signature(q)
    return qs


def signature(q):
    # Dropdown (combobox) choices load lazily and unreliably, so they stay out of the
    # signature; a planned choice that no longer exists still stops the run at fill time.
    keys = ("key", "label", "type", "required") + (() if q.get("type") == "combobox" else ("options",))
    return sha({k: q.get(k) for k in keys})[:16]


class Form:
    def __init__(self, page, url, timeout_ms=15000):
        self.page, self.url = page, url
        page.set_default_timeout(timeout_ms)

    def open(self):
        self.page.goto(self.url, wait_until="domcontentloaded", timeout=45000)
        self.page.locator("input,textarea,select").first.wait_for(state="attached", timeout=20000)
        # Let the page finish loading; text typed before the form's scripts start gets wiped.
        try:
            self.page.wait_for_load_state("networkidle", timeout=15000)
        except Exception:
            pass
        self.page.wait_for_timeout(1500)

    def loc(self, control_id):
        return self.page.locator('[id="%s"]' % control_id.replace('"', '\\"'))

    def snapshot(self, choices=True):
        raw = self.page.evaluate(FIELDS_JS)
        qs = questions_from(raw)
        if choices:
            for q in qs:
                if q["type"] == "combobox" and not q["options"]:
                    q["options"] = self.combobox_options(q["controls"][0])
                    q["signature"] = signature(q)
        codes = [c for c in raw["controls"] if CODE.search(" ".join([c["id"], c["name"], c["autocomplete"], c["label"]]))]
        return {"questions": qs, "alerts": raw["alerts"], "headings": raw["headings"],
                "code_inputs": [c["id"] for c in codes],
                "password": any(c["type"] == "password" for c in raw["controls"]),
                "challenge": self.captcha_challenge(),
                "confirmed": self.confirmed(raw)}

    def combobox_options(self, control_id):
        loc = self.loc(control_id)
        try:
            opts = []
            for open_menu in (loc.click, lambda: loc.press("ArrowDown")):
                open_menu()
                try:
                    self.page.get_by_role("option").first.wait_for(state="visible", timeout=3000)
                except Exception:
                    continue
                opts = [o.inner_text().strip() for o in self.page.get_by_role("option").all()]
                break
        finally:
            loc.press("Escape")
        # Async-search fields (city) list nothing until typed; keep them empty.
        return [o for o in opts if o and not re.fullmatch(r"(no options|loading\.*)", o, re.I)]

    def search_options(self, control_id, query):
        """Choices a search-as-you-type field (e.g. city) offers for `query`. Clears the field after."""
        loc = self.loc(control_id)
        try:
            loc.click()
            loc.fill(query)
            try:
                self.page.get_by_role("option").first.wait_for(state="visible", timeout=8000)
            except Exception:
                pass
            opts = [o.inner_text().strip() for o in self.page.get_by_role("option").all()]
        finally:
            loc.fill("")
            loc.press("Escape")
        return [o for o in opts if o and not re.fullmatch(r"(no options|loading\.*)", o, re.I)]

    def captcha_challenge(self):
        for f in self.page.frames:
            if "recaptcha" in f.url and "bframe" in f.url:
                el = f.frame_element()
                if el.is_visible() and (el.bounding_box() or {}).get("height", 0) > 100:
                    return True
        return False

    def confirmed(self, raw):
        if urlsplit(self.page.url).path.rstrip("/").endswith("/confirmation"):
            return True
        return any(CONFIRMED.search(h) for h in raw["headings"])

    # --- filling -----------------------------------------------------------
    def fill(self, q, answer, files):
        kind, value = q["type"], answer["value"]
        if kind in ("text", "tel", "textarea"):
            loc = self.loc(q["controls"][0])
            loc.fill(value)
            got = loc.input_value()
            same = got == value or (kind == "tel" and re.sub(r"\D", "", got) == re.sub(r"\D", "", value))
            if not same:
                raise Stop(f"'{q['label']}' did not keep the planned text.")
        elif kind == "select":
            self.loc(q["controls"][0]).select_option(label=value)
        elif kind == "combobox":
            values = value if isinstance(value, list) else [value]
            loc = self.loc(q["controls"][0])
            for text in values:
                self.choose(loc, text, answer.get("query"), q["label"])
        elif kind in ("checkboxes", "radio"):
            values = value if isinstance(value, list) else [value]
            for text in values:
                if text not in q["options"]:
                    raise Stop(f"'{q['label']}' has no choice '{text}'.")
                self.loc(q["controls"][q["options"].index(text)]).check()
        elif kind == "checkbox":
            if value is not True:
                raise Stop(f"'{q['label']}' needs an explicit true in the plan.")
            self.loc(q["controls"][0]).check()
        elif kind == "file":
            path = files.get(value)
            if not path:
                raise Stop(f"No file for '{q['label']}' (plan says '{value}').")
            self.loc(q["controls"][0]).set_input_files(str(path))
            try:
                self.page.get_by_text(Path(path).name, exact=False).first.wait_for(state="visible", timeout=15000)
            except Exception:
                raise Stop(f"'{q['label']}' didn't show the uploaded file.")
        else:
            raise Stop(f"'{q['label']}' is a {kind} control the submitter can't fill.")

    def choose(self, loc, text, query, label):
        """Open a dropdown and click the choice whose visible text is exactly `text`."""
        options = self.page.get_by_role("option")
        for attempt in range(2):
            loc.click()
            if query:
                loc.fill(query)
            elif attempt:
                loc.fill(text.split(" +")[0])  # long lists (country) filter as you type
            try:
                options.first.wait_for(state="visible", timeout=4000)
            except Exception:
                loc.press("ArrowDown")  # some menus open only from the keyboard
                try:
                    options.first.wait_for(state="visible", timeout=8000)
                except Exception:
                    loc.press("Escape")
                    continue
            for o in options.all():
                if o.inner_text().strip() == text:
                    o.click()
                    return
            loc.press("Escape")
        raise Stop(f"'{label}' has no choice '{text}'.")

    def kept(self, q, answer, files):
        """True when the live form shows the planned value."""
        kind, value = q["type"], answer["value"]
        got = q["answered"]
        if kind == "file":
            return bool(got) and Path(files[value]).name in got[0]
        if kind == "checkbox":
            return got == [True]
        if kind in ("text", "tel", "textarea"):
            if kind == "tel":
                return bool(got) and re.sub(r"\D", "", got[0]) == re.sub(r"\D", "", value)
            return got == [value]
        want = value if isinstance(value, list) else [value]
        if kind == "combobox":
            return all(any(w == g or g in w or w in g for g in got) for w in want) and bool(got)
        return sorted(got) == sorted(want)

    def click_submit(self, verify=False):
        name = re.compile(r"^(verify and )?submit( application)?$" if verify else r"^submit application$", re.I)
        button = self.page.get_by_role("button", name=name)
        if button.count() != 1:
            raise Stop("No single 'Submit application' button found.")
        button.click()


def launch(pw):
    kwargs = {"headless": True}
    exe = os.environ.get("PW_CHROMIUM") or ("/opt/pw-browsers/chromium" if Path("/opt/pw-browsers/chromium").exists() else None)
    if exe:
        kwargs["executable_path"] = exe
    proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
    if proxy and not os.environ.get("SUBMITTER_NO_PROXY"):
        kwargs["proxy"] = {"server": proxy}
    return pw.chromium.launch(**kwargs)


def plan_hash(plan):
    """The hash shown on the dashboard and recorded by Approve: what gets typed and uploaded."""
    return sha({"url": plan.get("url"), "files": plan.get("files") or {},
                "answers": [{k: a.get(k) for k in ("key", "value", "query", "signature")} for a in plan["answers"]]})[:20]


def check_plan(snap, plan):
    """Compare the live form with the approved plan. Returns (pairs, problems)."""
    live = {q["key"]: q for q in snap["questions"]}
    planned = {a["key"]: a for a in plan["answers"]}
    problems, pairs = [], []
    for key, a in planned.items():
        q = live.get(key)
        if q is None and a.get("conditional"):
            continue  # appears only after an earlier answer; filled in the second pass
        if q is None:
            problems.append(f"Planned question is gone: '{a.get('label', key)}'.")
        elif a.get("signature") and a["signature"] != q["signature"]:
            problems.append(f"Question changed since approval: '{q['label']}'.")
        else:
            pairs.append((q, a))
    for q in snap["questions"]:
        if q["required"] and q["key"] not in planned and not q["answered"]:
            problems.append(f"Required question has no approved answer: '{q['label']}'.")
    return pairs, problems


def evidence_shot(page, folder, name):
    try:
        page.screenshot(path=str(folder / name), full_page=True)
        return name
    except Exception:
        return None


def run_submit(args):
    plan = json.loads(Path(args.plan).read_text(encoding="utf-8"))
    if args.submit and args.approved_hash != plan_hash(plan):
        Path(args.evidence).mkdir(parents=True, exist_ok=True)
        return {"status": "blocked", "reasons": ["The answer plan doesn't match what was approved on the dashboard."]}
    files = {"cv": Path(args.cv).resolve() if args.cv else None,
             "cover": Path(args.cover).resolve() if args.cover else None}
    files = {k: v for k, v in files.items() if v}
    for k, p in files.items():
        if not p.exists():
            raise SystemExit(f"Missing {k} file: {p}")
    folder = Path(args.evidence)
    folder.mkdir(parents=True, exist_ok=True)
    for k, digest in (plan.get("files") or {}).items():
        if k not in files or hashlib.sha256(files[k].read_bytes()).hexdigest() != digest:
            return {"status": "blocked", "reasons": [f"The {k} file is missing or changed after approval."]}
    marker = folder / "attempt.json"
    if args.submit and marker.exists():
        return {"status": "blocked", "reasons": ["An earlier submit attempt exists for this application; one attempt only."]}

    from playwright.sync_api import sync_playwright
    result = {"status": "blocked", "reasons": [], "url": plan["url"], "at": now()}
    with sync_playwright() as pw:
        browser = launch(pw)
        page = browser.new_page()
        form = Form(page, embed_url(plan["url"], plan.get("board"), os.environ.get("SUBMITTER_TEST_ORIGIN")))
        try:
            form.open()
            snap = form.snapshot(choices=False)
            if snap["password"]:
                raise Stop("The form asks for a password or account; that stays manual.")
            if snap["challenge"]:
                raise Stop("A CAPTCHA challenge is showing; that stays manual.")
            pairs, problems = check_plan(snap, plan)
            if problems:
                result["reasons"] = problems
                raise Stop(problems[0])
            for q, a in pairs:
                form.fill(q, a, files)
            snap = form.snapshot(choices=False)
            live = {q["key"]: q for q in snap["questions"]}
            for a in plan["answers"]:
                if not a.get("conditional") or any(q["key"] == a["key"] for q, _ in pairs):
                    continue
                q = live.get(a["key"])
                if q is None:
                    raise Stop(f"Planned follow-up question never appeared: '{a.get('label', a['key'])}'.")
                if a.get("signature") and a["signature"] != q["signature"]:
                    raise Stop(f"Question changed since approval: '{q['label']}'.")
                form.fill(q, a, files)
                pairs.append((q, a))
            snap = form.snapshot(choices=False)
            live = {q["key"]: q for q in snap["questions"]}
            def kept(q, a):
                if q["key"] in live:
                    return form.kept(live[q["key"]], a, files)
                # Greenhouse swaps an upload field for the attached file's name and a remove button.
                return q["type"] == "file" and form.page.get_by_text(Path(files[a["value"]]).name).count() > 0
            off = [q["label"] for q, a in pairs if not kept(q, a)]
            if off:
                result["reasons"] = [f"Form didn't keep: '{x}'." for x in off]
                raise Stop(result["reasons"][0])
            missing = [q["label"] for q in snap["questions"] if q["required"] and not q["answered"]]
            if missing:
                result["reasons"] = [f"Still empty: '{x}'." for x in missing]
                raise Stop(result["reasons"][0])
            result["filled"] = evidence_shot(page, folder, "filled.png")
            if not args.submit:
                result["status"] = "ready"
                return result
            marker.write_text(json.dumps({"at": now(), "plan": sha(plan)}), encoding="utf-8")
            form.click_submit()
            result.update(wait_result(form, page, args, folder))
            return result
        except Stop as stop:
            result["status"] = "blocked"
            if str(stop) not in result["reasons"]:
                result["reasons"].insert(0, str(stop))
            result["screenshot"] = evidence_shot(page, folder, "blocked.png")
            return result
        finally:
            browser.close()


def wait_result(form, page, args, folder, timeout=60):
    """After the one submit click: confirmation, security code, or uncertain."""
    deadline, asked = time.monotonic() + timeout, False
    while time.monotonic() < deadline:
        try:
            snap = form.snapshot(choices=False)
        except Exception:
            page.wait_for_timeout(300)  # a navigation can land mid-read; only re-read
            continue
        if snap["confirmed"]:
            return {"status": "submitted", "confirmation_url": page.url.split("?")[0],
                    "confirmation": "\n".join(h for h in snap["headings"] if h)[:500],
                    "screenshot": evidence_shot(page, folder, "confirmation.png")}
        if snap["challenge"]:
            return {"status": "uncertain", "reasons": ["A CAPTCHA challenge appeared after submitting."],
                    "screenshot": evidence_shot(page, folder, "challenge.png")}
        if snap["code_inputs"] and not asked:
            code = wait_for_code(args.code_file)
            if not code:
                return {"status": "uncertain", "reasons": ["Greenhouse asked for the emailed security code and none arrived."],
                        "screenshot": evidence_shot(page, folder, "code.png")}
            ids = snap["code_inputs"]
            if len(ids) == 1:
                form.loc(ids[0]).fill(code)
            elif len(ids) == len(code):
                for i, ch in zip(ids, code):
                    form.loc(i).fill(ch)
            else:
                return {"status": "uncertain", "reasons": ["The security code didn't fit the boxes shown."]}
            form.click_submit(verify=True)
            asked, deadline = True, time.monotonic() + timeout
            continue
        if snap["alerts"] and not snap["code_inputs"]:
            return {"status": "uncertain", "reasons": snap["alerts"][:5],
                    "screenshot": evidence_shot(page, folder, "after-submit.png")}
        page.wait_for_timeout(300)
    return {"status": "uncertain", "reasons": ["No confirmation page within a minute."],
            "screenshot": evidence_shot(page, folder, "after-submit.png")}


def wait_for_code(code_file, minutes=10):
    if not code_file:
        return None
    print(json.dumps({"event": "NEEDS_CODE", "code_file": code_file}), file=sys.stderr, flush=True)
    path, end = Path(code_file), time.monotonic() + minutes * 60
    while time.monotonic() < end:
        if path.exists():
            code = path.read_text(encoding="utf-8").strip()
            path.unlink()
            if re.fullmatch(r"[A-Za-z0-9]{4,12}", code):
                return code
        time.sleep(2)
    return None


def run_inspect(args):
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        browser = launch(pw)
        try:
            form = Form(browser.new_page(), embed_url(args.url, args.board, os.environ.get("SUBMITTER_TEST_ORIGIN")))
            form.open()
            snap = form.snapshot()
            searched = {}
            for item in args.search or []:
                key, _, query = item.partition("=")
                searched[key] = form.search_options(key, query)
        finally:
            browser.close()
    out = {"url": args.url, "board": args.board, "form_url": form.url, "inspected_at": now(),
           "password": snap["password"], "challenge": snap["challenge"], "searched": searched,
           "questions": [{k: q.get(k) for k in ("key", "label", "type", "required", "multiple", "accept", "options", "signature")}
                         for q in snap["questions"]]}
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    i = sub.add_parser("inspect")
    i.add_argument("--url", required=True)
    i.add_argument("--board")
    i.add_argument("--out")
    i.add_argument("--search", action="append", metavar="KEY=QUERY",
                   help="list a search-as-you-type field's choices for QUERY (read-only)")
    s = sub.add_parser("submit")
    s.add_argument("--plan", required=True)
    s.add_argument("--cv")
    s.add_argument("--cover")
    s.add_argument("--evidence", required=True)
    s.add_argument("--submit", action="store_true", help="click Submit (otherwise fill and check only)")
    s.add_argument("--code-file")
    s.add_argument("--approved-hash", help="formAnswers.hash Casey approved; required with --submit")
    h = sub.add_parser("hash", help="print the plan hash to put on the dashboard ticket")
    h.add_argument("--plan", required=True)
    args = ap.parse_args(argv)
    if args.cmd == "hash":
        print(plan_hash(json.loads(Path(args.plan).read_text(encoding="utf-8"))))
        return 0
    if args.cmd == "inspect":
        out = run_inspect(args)
        text = json.dumps(out, indent=1, ensure_ascii=False)
        if args.out:
            Path(args.out).write_text(text, encoding="utf-8")
        print(text)
        return 0
    out = run_submit(args)
    (Path(args.evidence) / "result.json").write_text(json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(out, indent=1, ensure_ascii=False))
    return 1 if out["status"] == "uncertain" else 0


if __name__ == "__main__":
    sys.exit(main())
