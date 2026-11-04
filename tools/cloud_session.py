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
# A save that would delete more than this share of the data repo's files (and
# more than MASS_DELETE_MIN of them) almost always means the workspace was never
# restored, e.g. `start` ran against the wrong branch. Refuse it unless asked.
MASS_DELETE_SHARE = 0.25
MASS_DELETE_MIN = 10


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


def default_branch(data: Path) -> str:
    """The data repo's default branch on origin (usually main)."""
    ref = git(data, "symbolic-ref", "--short", "refs/remotes/origin/HEAD", check=False).strip()
    if ref.startswith("origin/"):
        return ref[len("origin/"):]
    out = git(data, "ls-remote", "--symref", "origin", "HEAD", check=False)
    for line in out.splitlines():
        if line.startswith("ref: refs/heads/"):
            return line.split()[1][len("refs/heads/"):]
    return "main"


def use_default_branch(data: Path) -> str | None:
    """Put the data repo on origin's default branch, up to date.

    Cloud sessions can clone a repo onto a fresh session branch; working from
    it restores nothing and makes the next save look like mass deletion.
    Returns an error message, or None when the repo is ready.
    """
    git(data, "fetch", "--quiet", "origin", check=False)
    branch = default_branch(data)
    remote_has_it = bool(git(data, "rev-parse", "--verify", "--quiet", f"origin/{branch}", check=False).strip())
    if not remote_has_it:
        return None  # a brand-new, empty data repo
    if git(data, "branch", "--show-current").strip() != branch:
        if git(data, "status", "--porcelain").strip():
            return (f"The data repo is on {git(data, 'branch', '--show-current').strip() or 'a detached HEAD'}, "
                    f"not {branch}, and has uncommitted changes. Commit or discard them, then retry.")
        git(data, "checkout", "--quiet", "-B", branch, f"origin/{branch}")
        print(f"Switched the data repo to {branch}.")
    else:
        git(data, "merge", "--ff-only", "--quiet", f"origin/{branch}")
    return None


def start(repo: Path, data: Path) -> int:
    if not (data / ".git").is_dir():
        print(f"Data repo not found at {data}. Clone it there or set JOB_SEARCH_DATA_DIR.")
        return 1
    problem = use_default_branch(data)
    if problem:
        print(problem)
        return 1
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


def save(repo: Path, data: Path, push: bool = True, allow_removals: bool = False) -> int:
    if not (data / ".git").is_dir():
        print(f"Data repo not found at {data}. Clone it there or set JOB_SEARCH_DATA_DIR.")
        return 1
    problem = use_default_branch(data)
    if problem:
        print(problem)
        return 1
    current = ignored_files(repo)
    # Files deleted in the workspace are deleted in the data repo too.
    existing = [rel for rel in data_files(data) if not excluded(rel)]
    removed = [rel for rel in existing if rel not in set(current)]
    if (not allow_removals and len(removed) > MASS_DELETE_MIN
            and len(removed) > MASS_DELETE_SHARE * len(existing)):
        print(f"Refusing to save: it would delete {len(removed)} of {len(existing)} files in the data repo. "
              "The workspace was probably never restored; run `start` first. "
              "If the deletions are intended, rerun with --allow-removals.")
        return 1
    for rel in current:
        copy(repo / rel, data / rel)
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
        branch = git(data, "branch", "--show-current").strip() or default_branch(data)
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
    parser.add_argument("--allow-removals", action="store_true",
                        help="save: allow deleting many data-repo files at once")
    args = parser.parse_args(argv)
    repo, data = REPO_ROOT, data_dir(REPO_ROOT)
    if args.command == "list":
        for rel in ignored_files(repo):
            print(rel)
        return 0
    if args.command == "start":
        return start(repo, data)
    return save(repo, data, push=not args.no_push, allow_removals=args.allow_removals)


if __name__ == "__main__":
    sys.exit(main())
