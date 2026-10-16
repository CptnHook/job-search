#!/usr/bin/env python3
"""Keep this workspace's personal working files in a private data repo.

This framework git-ignores everything personal: documents/, the tracker,
application drafts, company research, Gmail sync state. On a laptop those
files simply stay on disk. In a cloud session (Claude Code on the web) the
container is reclaimed when the session ends, so they would be lost.

This script copies them to and from a separate private repository:

    python3 tools/cloud_session.py start   # at session start: restore files
    python3 tools/cloud_session.py save    # before ending: copy back, commit, push

What is synced: every file git ignores in this repo, except build output,
dependencies, local settings, and anything that looks like a secret (.env*).
The data repo defaults to a sibling folder named ``job-search-data`` and
can be overridden with JOB_SEARCH_DATA_DIR.

The data repo holds personal data. Keep it private.
"""
from __future__ import annotations

import argparse
import datetime
import fnmatch
import os
from pathlib import Path
import shutil
import subprocess
import sys

REPO_ROOT = Path(__file__).resolve().parent.parent

# Ignored files that are never copied: rebuildable output, dependencies,
# per-machine settings, and secrets. Matched against the repo-relative path.
EXCLUDE = [
    ".git/*",
    "*/node_modules/*", "node_modules/*",
    "*/__pycache__/*", "__pycache__/*", "*.pyc", "*.pyo",
    ".venv/*", "venv/*",
    "build/*", "*/build/*",
    "*.aux", "*.log", "*.out", "*.synctex.gz", "*.fls", "*.fdb_latexmk",
    "bun.lock", "*/bun.lock",
    ".DS_Store", "*/.DS_Store", "Thumbs.db",
    ".claude/projects/*", ".claude/settings.local.json",
    ".env", ".env.*", "*/.env", "*/.env.*",
    ".agents/usage/*", "*.log",
    ".vscode/*", ".idea/*", ".superpowers/*", "skills-lock.json",
]
DATA_REPO_FILES = {"README.md", ".gitignore"}


def git(cwd: Path, *args: str, check: bool = True) -> str:
    result = subprocess.run(["git", "-C", str(cwd), *args], capture_output=True, text=True)
    if check and result.returncode != 0:
        raise SystemExit(f"git {' '.join(args)} failed in {cwd}:\n{result.stderr.strip()}")
    return result.stdout


def excluded(rel: str) -> bool:
    return any(fnmatch.fnmatch(rel, pattern) for pattern in EXCLUDE)


def ignored_files(repo: Path) -> list[str]:
    """Every git-ignored file in the workspace that should be kept."""
    out = git(repo, "ls-files", "--others", "--ignored", "--exclude-standard", "-z")
    return sorted(p for p in out.split("\0") if p and not excluded(p) and (repo / p).is_file())


def data_files(data: Path) -> list[str]:
    files = []
    for path in data.rglob("*"):
        rel = path.relative_to(data).as_posix()
        if path.is_file() and not rel.startswith(".git/") and rel not in DATA_REPO_FILES:
            files.append(rel)
    return sorted(files)


def data_dir(repo: Path) -> Path:
    return Path(os.environ.get("JOB_SEARCH_DATA_DIR", repo.parent / "job-search-data"))


def copy(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)


def restorable(repo: Path, paths: list[str]) -> set[str]:
    """The subset of paths this repo ignores and doesn't track."""
    if not paths:
        return set()
    # check-ignore without --no-index never reports tracked files as ignored.
    result = subprocess.run(
        ["git", "-C", str(repo), "check-ignore", "-z", "--stdin"],
        input="\0".join(paths) + "\0", capture_output=True, text=True)
    if result.returncode not in (0, 1):
        raise SystemExit(f"git check-ignore failed in {repo}:\n{result.stderr.strip()}")
    return {p for p in result.stdout.split("\0") if p}


def start(repo: Path, data: Path) -> int:
    if not (data / ".git").is_dir():
        print(f"Data repo not found at {data}. Clone it there or set JOB_SEARCH_DATA_DIR.")
        return 1
    if git(data, "rev-parse", "--verify", "HEAD", check=False).strip():
        git(data, "pull", "--ff-only", "--quiet")
    candidates = [rel for rel in data_files(data) if not excluded(rel)]
    allowed = restorable(repo, candidates)
    skipped = [rel for rel in candidates if rel not in allowed]
    for rel in candidates:
        if rel in allowed:
            copy(data / rel, repo / rel)
    print(f"Restored {len(allowed)} file(s) from {data}.")
    if skipped:
        # Only ignored, untracked paths are restored, so working files can
        # never replace the profile, framework, or settings files git tracks.
        print(f"Skipped {len(skipped)} path(s) this repo tracks or doesn't ignore: {', '.join(skipped)}")
    return 0


def save(repo: Path, data: Path, push: bool = True) -> int:
    if not (data / ".git").is_dir():
        print(f"Data repo not found at {data}. Clone it there or set JOB_SEARCH_DATA_DIR.")
        return 1
    current = ignored_files(repo)
    for rel in current:
        copy(repo / rel, data / rel)
    # Files deleted in the workspace are deleted in the data repo too.
    removed = [rel for rel in data_files(data) if rel not in set(current) and not excluded(rel)]
    for rel in removed:
        (data / rel).unlink()
    git(data, "add", "-A")
    changed = bool(git(data, "status", "--porcelain").strip())
    if changed:
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        git(data, "commit", "--quiet", "-m", f"Save job-search working files ({stamp})")
    else:
        print("No file changes since the last save.")
    # Push even when nothing changed: an earlier --no-push save or a failed
    # push can leave commits that exist only in this container.
    has_commits = bool(git(data, "rev-parse", "--verify", "HEAD", check=False).strip())
    if push and has_commits:
        branch = git(data, "branch", "--show-current").strip() or "main"
        git(data, "push", "--quiet", "-u", "origin", branch)
    if changed:
        print(f"Saved {len(current)} file(s), removed {len(removed)}, to {data}{' and pushed' if push else ''}.")
    elif push and has_commits:
        print("Data repo is pushed and up to date.")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["start", "save", "list"])
    parser.add_argument("--no-push", action="store_true", help="save: commit but don't push")
    args = parser.parse_args(argv)
    repo, data = REPO_ROOT, data_dir(REPO_ROOT)
    if args.command == "list":
        for rel in ignored_files(repo):
            print(rel)
        return 0
    if args.command == "start":
        return start(repo, data)
    return save(repo, data, push=not args.no_push)


if __name__ == "__main__":
    sys.exit(main())
