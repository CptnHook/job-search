"""Tests for tools/submitter/greenhouse.py - the submitter's form filler (PLAN B4).

Runs the real tool in headless Chromium against a synthetic Greenhouse-style
form served on localhost. Pins the safeguards: nothing is sent without
--submit, a changed or unplanned required question stops the run, a changed
document stops it, one attempt only, and "submitted" needs a confirmation page.
Skipped when Playwright or a Chromium build is unavailable.
"""
import hashlib
import json
import os
import subprocess
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory

REPO = Path(__file__).resolve().parent.parent
TOOL = REPO / "tools" / "submitter" / "greenhouse.py"
FORM = (REPO / "tests" / "fixtures" / "greenhouse_form.html").read_bytes()
CONFIRM = b"<!doctype html><html><body><h1>Thank you for applying.</h1></body></html>"

try:
    import playwright  # noqa: F401
    HAVE_PW = True
except ImportError:
    HAVE_PW = False


class Handler(BaseHTTPRequestHandler):
    posts = 0

    def do_GET(self):
        body = CONFIRM if self.path.startswith("/embed/job_app/confirmation") else FORM
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        Handler.posts += 1
        self.send_response(204)
        self.end_headers()

    def log_message(self, *a):
        pass


@unittest.skipUnless(HAVE_PW, "playwright not installed")
class SubmitterTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.origin = f"http://127.0.0.1:{cls.server.server_port}"
        cls.env = dict(os.environ, SUBMITTER_TEST_ORIGIN=cls.origin, SUBMITTER_NO_PROXY="1")
        out = cls.run_tool(cls, "inspect", "--url", cls.origin + "/embed/job_app")
        if out.returncode != 0:
            raise unittest.SkipTest("Chromium could not start: " + out.stderr[-300:])
        cls.form = json.loads(out.stdout)

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def run_tool(self, *args):
        return subprocess.run([sys.executable, str(TOOL), *args], capture_output=True, text=True,
                              env=self.env, timeout=180)

    def setUp(self):
        Handler.posts = 0
        self.tmp = TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.cv = self.dir / "cv_synthetic.pdf"
        self.cover = self.dir / "cover_synthetic.pdf"
        self.cv.write_bytes(b"%PDF-1.4 synthetic resume")
        self.cover.write_bytes(b"%PDF-1.4 synthetic cover")

    def tearDown(self):
        self.tmp.cleanup()

    def q(self, key):
        return next(q for q in self.form["questions"] if q["key"] == key)

    def plan(self, url_query="", drop=(), tweak=None):
        values = {"first_name": "Test", "last_name": "Person", "email": "test@example.com",
                  "phone": "555-010-0000", "question_1": "Yes", "gender": "Decline To Self Identify",
                  "question_2[]": ["None of the above"], "resume": "cv", "cover_letter": "cover"}
        answers = [{"key": k, "label": self.q(k)["label"], "type": self.q(k)["type"], "value": v,
                    "signature": self.q(k)["signature"], "source": "synthetic"}
                   for k, v in values.items() if k not in drop]
        if tweak:
            tweak(answers)
        plan = {"url": self.origin + "/embed/job_app" + url_query, "answers": answers,
                "files": {"cv": hashlib.sha256(self.cv.read_bytes()).hexdigest(),
                          "cover": hashlib.sha256(self.cover.read_bytes()).hexdigest()}}
        path = self.dir / "plan.json"
        path.write_text(json.dumps(plan))
        return path

    def plan_hash(self, plan):
        return self.run_tool("hash", "--plan", str(plan)).stdout.strip()

    def submit(self, plan, *extra):
        if "--submit" in extra and "--approved-hash" not in extra:
            extra = (*extra, "--approved-hash", self.plan_hash(plan))
        out = self.run_tool("submit", "--plan", str(plan), "--cv", str(self.cv), "--cover", str(self.cover),
                            "--evidence", str(self.dir / "evidence"), *extra)
        return json.loads(out.stdout), out

    def test_inspect_reads_questions_and_choices(self):
        self.assertEqual(self.q("question_1")["options"], ["Yes", "No"])
        self.assertTrue(self.q("question_1")["required"])
        self.assertEqual(self.q("question_2[]")["type"], "checkboxes")
        self.assertEqual(self.q("question_2[]")["options"], ["Option A", "None of the above"])
        self.assertEqual(self.q("resume")["label"], "Resume/CV")
        self.assertFalse(any(q["key"].startswith("security") for q in self.form["questions"]))

    def test_without_submit_flag_nothing_is_sent(self):
        res, _ = self.submit(self.plan())
        self.assertEqual(res["status"], "ready", res)
        self.assertEqual(Handler.posts, 0)
        self.assertFalse((self.dir / "evidence" / "attempt.json").exists())

    def test_submit_records_confirmation_and_allows_one_attempt(self):
        plan = self.plan()
        res, _ = self.submit(plan, "--submit")
        self.assertEqual(res["status"], "submitted", res)
        self.assertEqual(Handler.posts, 1)
        self.assertTrue((self.dir / "evidence" / "confirmation.png").exists())
        again, _ = self.submit(plan, "--submit")
        self.assertEqual(again["status"], "blocked")
        self.assertIn("one attempt", again["reasons"][0])
        self.assertEqual(Handler.posts, 1)

    def test_unapproved_plan_blocks(self):
        plan = self.plan()
        res, _ = self.submit(plan, "--submit", "--approved-hash", "not-the-approved-one")
        self.assertEqual(res["status"], "blocked")
        self.assertIn("doesn't match what was approved", res["reasons"][0])
        self.assertEqual(Handler.posts, 0)

    def test_changed_question_blocks(self):
        def tweak(answers):
            answers[4]["signature"] = "0" * 16
        res, _ = self.submit(self.plan(tweak=tweak), "--submit")
        self.assertEqual(res["status"], "blocked")
        self.assertIn("changed since approval", res["reasons"][0])
        self.assertEqual(Handler.posts, 0)

    def test_unplanned_required_question_blocks(self):
        res, _ = self.submit(self.plan(drop=("question_1",)), "--submit")
        self.assertEqual(res["status"], "blocked")
        self.assertIn("no approved answer", res["reasons"][0])
        self.assertEqual(Handler.posts, 0)

    def test_changed_document_blocks(self):
        plan = self.plan()
        self.cv.write_bytes(b"%PDF-1.4 edited after approval")
        res, _ = self.submit(plan, "--submit")
        self.assertEqual(res["status"], "blocked")
        self.assertIn("changed after approval", res["reasons"][0])
        self.assertEqual(Handler.posts, 0)

    def test_missing_choice_blocks(self):
        def tweak(answers):
            answers[4]["value"] = "Maybe"
        res, _ = self.submit(self.plan(tweak=tweak), "--submit")
        self.assertEqual(res["status"], "blocked")
        self.assertEqual(Handler.posts, 0)

    def test_security_code_step(self):
        code_file = self.dir / "code.txt"
        proc = subprocess.Popen([sys.executable, str(TOOL), "submit", "--plan", str(self.plan("?code=1")),
                                 "--cv", str(self.cv), "--cover", str(self.cover),
                                 "--evidence", str(self.dir / "evidence"), "--submit",
                                 "--approved-hash", self.plan_hash(self.dir / "plan.json"),
                                 "--code-file", str(code_file)],
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=self.env)
        line = proc.stderr.readline()
        self.assertIn("NEEDS_CODE", line)
        code_file.write_text("AB12CD34")
        out, _ = proc.communicate(timeout=120)
        self.assertEqual(json.loads(out)["status"], "submitted")
        self.assertEqual(Handler.posts, 1)


if __name__ == "__main__":
    unittest.main()
