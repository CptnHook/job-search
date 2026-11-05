#!/usr/bin/env python3
"""Fact check a drafted cover letter or resume change against Casey's own sources.

Every number with a unit or of size >= metric_min (30M, 50%, 5x, 800+, 32), and every
named tool from the known-tools list, must appear in a source file (CLAUDE.md, the
candidate profile, the Drive profile JSON or his resume text). Phrases his rules forbid
("owns a P&L", Smartsheet, NetSuite, Workday, FinOps tools, the lapsed SMC, the Cornell AI
coursework, em-dashes) block the draft; cliches are warnings. Rules: tools/fact_rules.json.

    python3 tools/verify_facts.py --text draft.txt [--text cv_changes.txt]
        [--source profile.json --source resume.txt] [--allow-from posting.txt]
        [--company "Acme"] [--json]

--allow-from takes the posting text or verified company facts, whose own numbers (a
requisition ID, the company's headcount) and tool names may appear in the letter.

With no --source, CLAUDE.md and the candidate profile are used. Exit 0 when nothing is
blocked, 1 when something is, 2 on bad input. Output is JSON with --json, else a summary.
It reads only local files: no network, and nothing it reads is executed.
"""
import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
RULES = REPO / "tools" / "fact_rules.json"
DEFAULT_SOURCES = [REPO / "CLAUDE.md", REPO / ".claude/skills/job-application-assistant/01-candidate-profile.md"]

# $30M+, 50%, 5x, 800+, 28 FTEs, 10,000+, $2.5M, 2021. Units: k/m/b (and words), %, x.
NUM = re.compile(r"(?<![\w.])\$?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?(%|x\b|k\b|m\b|b\b|bn\b|mm\b|thousand\b|million\b|billion\b)?(\+)?", re.I)
UNIT = {"%": "%", "x": "x", "k": "k", "thousand": "k", "m": "m", "mm": "m", "million": "m", "b": "b", "bn": "b", "billion": "b"}


def metrics(text, minimum):
    """Canonical metric tokens in text: '30m', '50%', '5x', '800', '10000'."""
    out = []
    for m in NUM.finditer(text):
        raw, unit = m.group(1), (m.group(2) or "").lower()
        value = raw.replace(",", "")
        try:
            n = float(value)
        except ValueError:
            continue
        if not unit and n < minimum:
            continue
        canon = (value.rstrip("0").rstrip(".") if "." in value else value) + UNIT.get(unit, "")
        out.append((m.group(0).strip(), canon))
    return out


def read_sources(paths):
    parts = []
    for p in paths:
        p = Path(p)
        if not p.is_file():
            raise FileNotFoundError(f"source not found: {p}")
        text = p.read_text(encoding="utf-8", errors="replace")
        if p.suffix == ".json":  # flatten the Drive profile JSON to its values
            try:
                text = " ".join(_strings(json.loads(text)))
            except json.JSONDecodeError:
                pass
        parts.append(text)
    return "\n".join(parts)


def _strings(obj):
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield str(k)
            yield from _strings(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _strings(v)
    elif obj is not None:
        yield str(obj)


def _affirmed(text):
    """Source text without the places it names tools he does NOT use: "(not Smartsheet, ...)"
    asides and "Never list ..." sentences."""
    text = re.sub(r"\((?:not|never|no)\b[^)]*\)", " ", text, flags=re.I)
    return re.sub(r"[^.\n]*\b(never list|do not list|don't list|not listed)\b[^.\n]*", " ", text, flags=re.I)


def check(text, source_text, rules, company="", allowed_text=""):
    blocked, warnings = [], []
    company_l = company.strip().lower()

    for r in rules.get("block_phrases", []):
        for m in re.finditer(r["pattern"], text, re.I):
            if r.get("skip_if_company") and company_l and m.group(0).lower() in company_l:
                continue
            blocked.append({"what": m.group(0), "why": r["why"]})
            break
    for r in rules.get("warn_phrases", []):
        m = re.search(r["pattern"], text, re.I)
        if m:
            warnings.append({"what": m.group(0), "why": r["why"]})

    have = {c for _, c in metrics(source_text + "\n" + allowed_text, 0)}
    seen = set()
    for shown, canon in metrics(text, rules.get("metric_min", 10)):
        if canon in have or canon in seen:
            continue
        seen.add(canon)
        blocked.append({"what": shown, "why": "Number not found in his profile or resume"})

    src_l = _affirmed(source_text).lower()
    for tool in rules.get("known_tools", []):
        if not re.search(r"(?<![\w])" + re.escape(tool) + r"(?![\w])", text):
            continue
        if re.search(r"(?<![\w])" + re.escape(tool.lower()) + r"(?![\w])", src_l) or (company_l and tool.lower() in company_l) \
                or re.search(r"(?<![\w])" + re.escape(tool) + r"(?![\w])", allowed_text):
            continue
        blocked.append({"what": tool, "why": "Tool not in his profile or resume"})

    ai = rules.get("ai_tool_terms")
    if ai and re.search(ai, text, re.I) and "claude code" not in text.lower():
        warnings.append({"what": re.search(ai, text, re.I).group(0), "why": "Mentions AI tooling without naming Claude Code"})

    return {"ok": not blocked, "blocked": blocked, "warnings": warnings,
            "checkedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--text", action="append", required=True, help="draft text file (repeatable)")
    ap.add_argument("--source", action="append", help="source file: profile JSON, resume text, CLAUDE.md (repeatable)")
    ap.add_argument("--allow-from", action="append", default=[],
                    help="posting text or verified company facts: numbers and tool names here are allowed (repeatable)")
    ap.add_argument("--company", default="", help="employer name, so its own name and products aren't flagged")
    ap.add_argument("--rules", default=str(RULES))
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    try:
        rules = json.loads(Path(a.rules).read_text(encoding="utf-8"))
        text = "\n".join(Path(t).read_text(encoding="utf-8") for t in a.text)
        source = read_sources(a.source or DEFAULT_SOURCES)
        allowed = read_sources(a.allow_from) if a.allow_from else ""
    except (OSError, json.JSONDecodeError) as e:
        print(f"verify_facts: {e}", file=sys.stderr)
        return 2
    res = check(text, source, rules, a.company, allowed)
    if a.json:
        print(json.dumps(res, indent=2, ensure_ascii=False))
    else:
        print("PASS" if res["ok"] else "BLOCKED")
        for b in res["blocked"]:
            print(f"  block: {b['what']!r} - {b['why']}")
        for w in res["warnings"]:
            print(f"  warn:  {w['what']!r} - {w['why']}")
    return 0 if res["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
