#!/usr/bin/env python3
"""Write the dashboard notes log to a Markdown file (docs/NOTES.md, step 4).

Input is the directory ArtifactData writes with `action: "list", collection: "notes",
out_dir: <dir>`: one JSON file per note under <dir>/notes/. Output is newest first.

    python3 tools/export_notes.py <out_dir> [--out documents/notes/notes_log.md]
"""
import argparse
import json
from pathlib import Path


def one_line(s):
    return " ".join(str(s or "").split())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dump_dir")
    ap.add_argument("--out", default="documents/notes/notes_log.md")
    args = ap.parse_args()

    notes = [json.loads(p.read_text()) for p in sorted(Path(args.dump_dir, "notes").glob("*.json"))]
    notes.sort(key=lambda n: str(n.get("createdAt") or n.get("date") or ""), reverse=True)

    lines = ["# Notes log", "", f"Exported from the dashboard's Notes & learnings tab. {len(notes)} notes, newest first.", ""]
    for n in notes:
        tags = [n.get("kind") or "Learning"] + ([n["company"]] if n.get("company") else [])
        line = f"- **{n.get('date') or str(n.get('createdAt', ''))[:10]}** ({', '.join(tags)}): {one_line(n.get('text'))}"
        if n.get("forClaude"):
            line += f" *[For Claude: {n.get('status') or 'open'}]*"
        if n.get("claudeNote"):
            line += f" Claude: {one_line(n['claudeNote'])}"
        lines.append(line)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(lines) + "\n")
    print(f"Wrote {len(notes)} notes to {out}")


if __name__ == "__main__":
    main()
