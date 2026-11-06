"""Offline tests for tools/verify_facts.py (docs/AUTOMATION.md, Fact check)."""

import json
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "tools"))

import verify_facts as vf  # noqa: E402

RULES = json.loads((REPO_ROOT / "tools" / "fact_rules.json").read_text(encoding="utf-8"))
SOURCE = """Unlocked $30M+ recurring ARR; cut internal cloud spend 50%; increased engineering velocity 5x.
Delivered 800+ global implementations; 32 people (28 FTEs + 4 contractors). Ripple 2016 - 2020.
Software: Jira, Confluence, Looker, Claude Code, Cursor (not Smartsheet, Asana, or Monday).
Never list Workday or NetSuite."""


def run(text, company="", allowed=""):
    return vf.check(text, SOURCE, RULES, company, allowed)


class MetricTests(unittest.TestCase):
    def test_profile_numbers_pass(self):
        r = run("I unlocked $30M+ in ARR, cut cloud spend 50%, raised velocity 5x and led 800+ implementations with 32 people.")
        self.assertTrue(r["ok"], r)

    def test_invented_numbers_block(self):
        r = run("I grew revenue 40% and saved $12M.")
        self.assertEqual({b["what"] for b in r["blocked"]}, {"40%", "$12M"})

    def test_unit_matters(self):
        self.assertFalse(run("I cut spend 30%.")["ok"])  # 30M is in the profile, 30% is not

    def test_small_bare_numbers_are_ignored(self):
        self.assertTrue(run("I can start in 4 weeks and have 2 references.")["ok"])

    def test_posting_numbers_are_allowed(self):
        self.assertFalse(run("Re: requisition 349125.")["ok"])
        self.assertTrue(run("Re: requisition 349125.", allowed="Req ID 349125")["ok"])


class PhraseTests(unittest.TestCase):
    def test_pnl_blocks(self):
        for t in ("I own the P&L for engineering.", "He owns a P & L.", "Full P&L ownership"):
            self.assertFalse(run(t)["ok"], t)

    def test_budget_wording_passes(self):
        self.assertTrue(run("I manage the engineering budget with Finance.")["ok"])

    def test_banned_tools_and_certs_block(self):
        for t in ("Built trackers in Smartsheet.", "Ran NetSuite reports.", "Rolled out FinOps tooling.",
                  "Scrum Master Certified.", "Completed Cornell AI coursework."):
            self.assertFalse(run(t)["ok"], t)

    def test_workday_allowed_as_employer(self):
        self.assertFalse(run("I configured Workday.")["ok"])
        self.assertTrue(run("I'd bring this to Workday.", company="Workday")["ok"])

    def test_em_dash_blocks(self):
        self.assertFalse(run("I built it — fast.")["ok"])
        self.assertTrue(run("Pacifica-based, cross-functional.")["ok"])

    def test_cliches_warn_only(self):
        r = run("I'm passionate about building teams.")
        self.assertTrue(r["ok"])
        self.assertTrue(r["warnings"])

    def test_ai_tooling_without_claude_code_warns(self):
        self.assertTrue(run("I led agentic coding adoption.")["warnings"])
        self.assertFalse(run("I led agentic coding adoption with Claude Code.")["warnings"])


class ToolTests(unittest.TestCase):
    def test_profile_tools_pass(self):
        self.assertTrue(run("I run delivery in Jira and Looker.")["ok"])

    def test_negated_mentions_do_not_count(self):
        r = run("I run delivery in Asana.")
        self.assertEqual([b["what"] for b in r["blocked"]], ["Asana"])

    def test_unknown_tool_blocks_unless_company_or_posting(self):
        self.assertFalse(run("I built dashboards in Tableau.")["ok"])
        self.assertTrue(run("Your Snowflake platform.", company="Snowflake")["ok"])
        self.assertTrue(run("Experience with Tableau.", allowed="Nice to have: Tableau")["ok"])


class CliTests(unittest.TestCase):
    def test_exit_codes_and_json(self):
        with tempfile.TemporaryDirectory() as d:
            src = Path(d, "src.md"); src.write_text(SOURCE)
            good = Path(d, "good.txt"); good.write_text("Cut spend 50%.")
            bad = Path(d, "bad.txt"); bad.write_text("Cut spend 60%.")
            self.assertEqual(vf.main(["--text", str(good), "--source", str(src)]), 0)
            self.assertEqual(vf.main(["--text", str(bad), "--source", str(src), "--json"]), 1)
            self.assertEqual(vf.main(["--text", str(Path(d, "missing.txt"))]), 2)

    def test_profile_json_is_flattened(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d, "profile.json"); p.write_text(json.dumps({"wins": [{"metric": "$45M pipeline"}]}))
            self.assertIn("$45M", vf.read_sources([p]))

    def test_default_sources_cover_real_profile(self):
        src = vf.read_sources(vf.DEFAULT_SOURCES)
        r = vf.check("Unlocked $30M+ ARR, cut cloud spend 50%, velocity 5x, 800+ implementations.", src, RULES)
        self.assertTrue(r["ok"], r)


if __name__ == "__main__":
    unittest.main()
