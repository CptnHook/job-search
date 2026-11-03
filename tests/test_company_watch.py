"""Offline tests for tools/company_watch.py (docs/COMPANY_RESEARCH.md).

No network: every fetch goes through a fake `get` holding canned answers, so
the tests pin the parsing, change detection, robots.txt handling and the
unreachable-is-not-an-error rule without touching a real board. Connection
matching runs on a made-up LinkedIn export with the real preamble shape.
"""

import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "tools"))

import company_watch as cw  # noqa: E402

NOW = datetime(2026, 11, 3, 12, 0, tzinfo=timezone.utc)

ASHBY = {"jobs": [
    {"id": "a2", "title": "VP, Engineering Operations", "jobUrl": "https://jobs.ashbyhq.com/acme/a2", "isListed": True},
    {"id": "a1", "title": "Staff Engineer", "jobUrl": "https://jobs.ashbyhq.com/acme/a1"},
    {"id": "a9", "title": "Unlisted", "jobUrl": "x", "isListed": False},
]}
GREENHOUSE = {"jobs": [{"id": 11, "title": "Chief of Staff  to the CTO", "absolute_url": "https://boards.greenhouse.io/g/jobs/11"}]}
LEVER = [{"id": "l1", "text": "Head of Delivery", "hostedUrl": "https://jobs.lever.co/l/l1"}]

HOME = "<html><head><title>Acme</title><script>var t=Date.now()</script></head><body><h1>Acme</h1> <p>Durable  execution</p></body></html>"

CSV = """Notes:
"When exporting your connection data, you may notice that some of the email addresses are missing."

First Name,Last Name,URL,Email Address,Company,Position,Connected On
Pat,Lee,https://www.linkedin.com/in/patlee,pat@example.com,"Acme Technologies, Inc.",VP Engineering,01 Mar 2024
Sam,Ortiz,https://www.linkedin.com/in/samortiz,,ACME,Recruiter,12 Jan 2023
Jo,Park,https://www.linkedin.com/in/jopark,jo@example.com,Fireworks.ai,Director,05 May 2025
Ana,Núñez,https://www.linkedin.com/in/ananunez,,Beta Labs LLC,CEO,02 Feb 2022
Kim,Ray,https://www.linkedin.com/in/kimray,,Acme Foods,Chef,02 Feb 2022
"""


class FakeGet:
    """url -> (status, body) or an Exception to raise; unknown URLs 404."""

    def __init__(self, answers):
        self.answers, self.calls = dict(answers), []

    def __call__(self, url):
        self.calls.append(url)
        a = self.answers.get(url, (404, ""))
        if isinstance(a, list):          # a sequence of answers for retries
            a = a.pop(0) if len(a) > 1 else a[0]
        if isinstance(a, Exception):
            raise a
        return a


def company(**over):
    c = {"id": "acme", "name": "Acme", "status": "target", "careersUrl": "https://careers.acme.com/jobs",
         "ats": {"system": "Ashby", "token": "acme", "apiUrl": "https://api.ashbyhq.com/posting-api/job-board/acme"},
         "profile": {"fullAt": "2026-10-20T00:00:00Z"}}
    c.update(over)
    return c


def fetcher(answers):
    get = FakeGet(answers)
    return cw.Fetcher(get=get, sleep=lambda s: None), get


BASE = {
    "https://api.ashbyhq.com/robots.txt": (401, "Unauthorized"),
    "https://api.ashbyhq.com/posting-api/job-board/acme": (200, json.dumps(ASHBY)),
    "https://acme.com/robots.txt": (200, "User-agent: *\nDisallow: /private\n"),
    "https://acme.com/": (200, HOME),
    "https://acme.com/news": (200, "<p>News one</p>"),
}


class TestParsing(unittest.TestCase):
    def test_ashby_skips_unlisted_and_sorts(self):
        jobs = cw.parse_jobs("ashby", json.dumps(ASHBY))
        self.assertEqual([j["id"] for j in jobs], ["a1", "a2"])

    def test_greenhouse_and_lever(self):
        g = cw.parse_jobs("greenhouse", json.dumps(GREENHOUSE))
        self.assertEqual(g, [{"id": "11", "title": "Chief of Staff to the CTO", "url": "https://boards.greenhouse.io/g/jobs/11"}])
        self.assertEqual(cw.parse_jobs("lever", json.dumps(LEVER))[0]["title"], "Head of Delivery")

    def test_jobs_hash_ignores_url_and_order(self):
        a = [{"id": "1", "title": "A", "url": "x"}, {"id": "2", "title": "B", "url": "y"}]
        b = [{"id": "2", "title": "B", "url": "z"}, {"id": "1", "title": "A", "url": "w"}]
        self.assertEqual(cw.jobs_hash(a), cw.jobs_hash(b))

    def test_visible_text_drops_scripts_and_markup(self):
        self.assertEqual(cw.visible_text(HOME), "acme durable execution")
        self.assertEqual(cw.visible_text(HOME.replace("<h1>", "<h1 class='x'>")), cw.visible_text(HOME))

    def test_api_url_derived_from_system_and_token(self):
        self.assertEqual(cw.detect_system({"ats": {"system": "Lever", "token": "l"}}),
                         ("lever", "https://api.lever.co/v0/postings/l?mode=json"))
        self.assertEqual(cw.detect_system({"ats": {"system": "Workday"}}), ("", ""))

    def test_site_root(self):
        self.assertEqual(cw.site_root({"careersUrl": "https://careers.acme.com/jobs"}), "https://acme.com")
        self.assertEqual(cw.site_root({"careersUrl": "https://jobs.ashbyhq.com/acme"}), "")
        self.assertEqual(cw.site_root({"careersUrl": "https://jobs.ashbyhq.com/acme", "website": "acme.io"}), "https://acme.io")


class TestDueFull(unittest.TestCase):
    def test_rules(self):
        self.assertTrue(cw.due_full({}, NOW))
        self.assertTrue(cw.due_full({"profile": {"fullAt": "2026-07-01T00:00:00Z"}}, NOW))
        self.assertTrue(cw.due_full({"needsResearch": True, "profile": {"fullAt": "2026-11-01"}}, NOW))
        self.assertFalse(cw.due_full({"profile": {"fullAt": "2026-11-01"}}, NOW))


class TestFingerprint(unittest.TestCase):
    def test_first_run_is_a_baseline_not_a_change(self):
        f, _ = fetcher(BASE)
        res, state = cw.fingerprint_company(company(), None, f, NOW)
        self.assertTrue(res["firstSeen"])
        self.assertEqual(res["changed"], {"jobs": False, "site": False})
        self.assertEqual(res["newJobs"], [])
        self.assertEqual(res["openJobs"], 2)
        self.assertEqual(set(state["pages"]), {"/", "/news"})   # /blog and /newsroom 404: skipped

    def test_new_and_removed_jobs_and_site_change(self):
        f, _ = fetcher(BASE)
        _, prev = cw.fingerprint_company(company(), None, f, NOW)
        changed = dict(BASE)
        changed["https://api.ashbyhq.com/posting-api/job-board/acme"] = (200, json.dumps({"jobs": [
            ASHBY["jobs"][0], {"id": "a3", "title": "COO", "jobUrl": "u3"}]}))
        changed["https://acme.com/news"] = (200, "<p>News two</p>")
        f, _ = fetcher(changed)
        res, _ = cw.fingerprint_company(company(), prev, f, NOW)
        self.assertEqual(res["changed"], {"jobs": True, "site": True})
        self.assertEqual([j["title"] for j in res["newJobs"]], ["COO"])
        self.assertEqual([j["title"] for j in res["removedJobs"]], ["Staff Engineer"])
        self.assertEqual(res["changedPages"], ["/news"])

    def test_unchanged_run(self):
        f, _ = fetcher(BASE)
        _, prev = cw.fingerprint_company(company(), None, f, NOW)
        f, _ = fetcher(BASE)
        res, _ = cw.fingerprint_company(company(), prev, f, NOW)
        self.assertEqual(res["changed"], {"jobs": False, "site": False})
        self.assertFalse(res["dueFull"])

    def test_dns_failure_is_unreachable_and_keeps_old_fingerprint(self):
        f, _ = fetcher(BASE)
        _, prev = cw.fingerprint_company(company(), None, f, NOW)
        down = dict(BASE)
        down["https://acme.com/robots.txt"] = cw.Unreachable("DNS lookup failed")
        down["https://api.ashbyhq.com/robots.txt"] = cw.Unreachable("blocked by network policy")
        f, get = fetcher(down)
        res, state = cw.fingerprint_company(company(), prev, f, NOW)
        self.assertEqual(res["changed"], {"jobs": False, "site": False})
        self.assertEqual({u["reason"] for u in res["unreachable"]}, {"DNS lookup failed", "blocked by network policy"})
        self.assertEqual(state["jobsHash"], prev["jobsHash"])
        self.assertEqual(state["siteHash"], prev["siteHash"])
        self.assertNotIn("https://acme.com/news", get.calls)   # host down: no further pages tried

    def test_robots_disallow_is_respected(self):
        ans = dict(BASE)
        ans["https://acme.com/robots.txt"] = (200, "User-agent: job-search-watch\nDisallow: /\n")
        f, get = fetcher(ans)
        res, state = cw.fingerprint_company(company(), None, f, NOW)
        self.assertNotIn("https://acme.com/", get.calls)
        self.assertNotIn("pages", state)
        self.assertTrue(any("robots" in u["reason"] for u in res["unreachable"]))

    def test_robots_5xx_means_do_not_fetch(self):
        ans = dict(BASE)
        ans["https://acme.com/robots.txt"] = (503, "")
        f, get = fetcher(ans)
        cw.fingerprint_company(company(), None, f, NOW)
        self.assertNotIn("https://acme.com/", get.calls)

    def test_one_backoff_on_429_then_give_up(self):
        ans = dict(BASE)
        ans["https://api.ashbyhq.com/posting-api/job-board/acme"] = [(429, ""), (429, ""), (200, "{}")]
        get = FakeGet(ans)
        sleeps = []
        f = cw.Fetcher(get=get, sleep=sleeps.append)
        res, _ = cw.fingerprint_company(company(), None, f, NOW)
        self.assertEqual(get.calls.count("https://api.ashbyhq.com/posting-api/job-board/acme"), 2)
        self.assertEqual(len(sleeps), 1)
        self.assertEqual(res["unreachable"][0]["reason"], "HTTP 429")

    def test_backoff_recovers_on_second_try(self):
        ans = dict(BASE)
        ans["https://api.ashbyhq.com/posting-api/job-board/acme"] = [(502, ""), (200, json.dumps(ASHBY))]
        f, _ = fetcher(ans)
        res, _ = cw.fingerprint_company(company(), None, f, NOW)
        self.assertEqual(res["openJobs"], 2)

    def test_403_is_unreachable_not_bypassed(self):
        ans = dict(BASE)
        ans["https://acme.com/"] = (403, "")
        f, get = fetcher(ans)
        res, _ = cw.fingerprint_company(company(), None, f, NOW)
        self.assertIn("HTTP 403 (declined)", [u["reason"] for u in res["unreachable"]])
        self.assertEqual(get.calls.count("https://acme.com/"), 1)

    def test_command_only_targets_and_writes_state(self):
        with tempfile.TemporaryDirectory() as d:
            docs = Path(d, "docs.json")
            docs.write_text(json.dumps([company(), company(id="m", name="Maybe Co", status="maybe")]))
            state = Path(d, "notes", "state.json")
            args = SimpleNamespace(companies=str(docs), state=str(state), out=None, write_state=True)
            f, _ = fetcher(BASE)
            with redirect_stdout(io.StringIO()) as out:
                cw.cmd_fingerprint(args, fetch=f, now=NOW)
            self.assertEqual([r["id"] for r in json.loads(out.getvalue())], ["acme"])
            self.assertEqual(list(json.loads(state.read_text())["companies"]), ["acme"])

    def test_companies_from_artifactdata_dump_dir(self):
        with tempfile.TemporaryDirectory() as d:
            Path(d, "companies").mkdir()
            Path(d, "companies", "acme.json").write_text(json.dumps({"name": "Acme", "status": "target"}))
            self.assertEqual(cw.load_companies(d), [{"id": "acme", "name": "Acme", "status": "target"}])


class TestConnections(unittest.TestCase):
    def setUp(self):
        self.rows = cw.read_connections(CSV)

    def test_preamble_skipped_and_email_dropped(self):
        self.assertEqual(len(self.rows), 5)
        self.assertFalse(any("email" in k.lower() for r in self.rows for k in r))
        self.assertFalse(any("@example.com" in json.dumps(r) for r in self.rows))

    def test_norm_company(self):
        self.assertEqual(cw.norm_company("Acme Technologies, Inc."), "acme")
        self.assertEqual(cw.norm_company("Fireworks.ai"), "fireworks")
        self.assertEqual(cw.norm_company("Fireworks AI"), "fireworks")
        self.assertEqual(cw.norm_company("AI"), "ai")

    def test_match_by_name_alias_and_portfolio(self):
        cos = [{"id": "acme", "name": "Acme"},
               {"id": "fw", "name": "Fireworks AI"},
               {"id": "b", "name": "Beta", "aliases": ["Beta Labs"]},
               {"id": "p", "name": "Gamma Holdings", "portfolioCompany": "Acme Foods"}]
        got = {c["id"]: c for c in cw.match_connections(self.rows, cos)}
        self.assertEqual([p["name"] for p in got["acme"]["people"]], ["Pat Lee", "Sam Ortiz"])   # not Acme Foods
        self.assertEqual(got["fw"]["count"], 1)
        self.assertEqual(got["b"]["people"][0]["name"], "Ana Núñez")
        self.assertEqual(got["p"]["people"][0]["name"], "Kim Ray")
        self.assertEqual(set(got["acme"]["people"][0]), {"name", "position", "url", "connectedOn"})

    def test_people_full_name_match(self):
        got = cw.match_people(self.rows, ["ana nunez", "Pat  Lee", "Pat Leeson"])
        self.assertEqual([g["connected"] for g in got], [True, True, False])
        self.assertNotIn("@", json.dumps(got))

    def test_missing_header_is_an_error(self):
        with self.assertRaises(ValueError):
            cw.read_connections("Notes:\nnothing here\n")


if __name__ == "__main__":
    unittest.main()
