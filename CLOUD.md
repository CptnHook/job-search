# Cloud sessions

This workspace runs in Claude Code on the web, so no laptop is needed. Personal working files live in the private `CptnHook/job-search-data` repo, because a cloud container is wiped when the session ends.

## Every session

1. Make sure `job-search-data` is attached to the session and cloned next to this repo (`../job-search-data`).
2. At the start: `python3 tools/cloud_session.py start`. This restores `documents/`, the tracker, application drafts, and other ignored state.
3. Before ending, or after any `/apply`, `/outcome`, or `/setup`: `python3 tools/cloud_session.py save`. This copies everything git ignores here (except build output, dependencies, and `.env*` secrets) into the data repo, commits, and pushes.

`python3 tools/cloud_session.py list` shows what would be saved.

## Environment setup script

Paste this into the cloud environment's setup script (environment menu in the session title bar → Edit → Setup script) so every session has LaTeX and the job-board CLIs:

```sh
apt-get update -qq && apt-get install -y -qq texlive-luatex texlive-xetex texlive-latex-extra texlive-fonts-recommended texlive-fonts-extra poppler-utils
cd /home/user/job-search 2>/dev/null && python3 tools/install_portal_clis.py || true
```

## Where things live

| What | Where |
| --- | --- |
| Profile files (`CLAUDE.md`, `.claude/skills/...`) | This repo (private) |
| Resumes, letters, drafts, tracker, research | `job-search-data` (private) |
| Originals and the candidate profile JSON | Google Drive, `PersonalCommandCenter` folder |
| Application status and networking | Notion, Life Command Center |
