# Submitter runbook (PLAN B4)

The submitter sends an application only after Casey clicks **Approve and send** on the dashboard for that application. It replaces the old local Greenhouse adapter, which the PersonalCommandCenter rebuild did not carry over. It runs in Claude Code on the web, not on a laptop.

Dashboard: https://claude.ai/artifact/Ls27uvPHvxqwyKuhEjoPy3 (data through the `ArtifactData` tool). Tool: `tools/submitter/greenhouse.py`. Locked rules from [AUTOMATION.md](AUTOMATION.md) always apply.

## 1. Preparing the answers (when drafting, before Casey approves)

1. Only Greenhouse forms are sent automatically for now. For Workday, Ashby, LinkedIn Easy Apply, or anything needing an account or CAPTCHA, set `formAnswers.mode = "manual"` with a one-line `manualReason`, still list the answers, and skip to step 6.
2. Read the form: `python3 tools/submitter/greenhouse.py inspect --url <posting URL> [--board <token>] [--search <key>=<text>] --out documents/applications/<folder>/form.json`. The board token is needed only for an employer-hosted link with `?gh_jid=`. `--search` lists what a search-as-you-type field (city) offers for that text.
3. Answer every question from the Drive profile JSON (`PersonalCommandCenter/casey-caster-profile.json`), by meaning, never by guess. Voluntary self-identification questions use Casey's saved answers (his choice, 2026-10-22). A required question the profile can't answer goes to Casey as a question; it never gets a made-up answer. Optional questions without a profile answer stay blank.
4. Write the plan to `documents/applications/<folder>/form_answers.json`:
   `{url, board, files:{cv:<sha256>, cover:<sha256>}, cvPath, coverPath, answers:[{key, label, type, value, query?, signature, source, required, group?}]}`. Copy `key`, `type`, and `signature` from `form.json`. File answers use the value `"cv"` or `"cover"`. `group: "eeo"` marks voluntary self-identification. `query` is what to type into a search box (e.g. the city). A question that appears only after another answer (e.g. race after the Hispanic/Latino question) gets `conditional: true`; it is filled once it appears, and the run stops if it never does. Name the PDFs `Casey_Caster_Resume.pdf` and `Casey_Caster_Cover_Letter.pdf` in `<folder>/send/`, since employers see the file names.
5. Check the plan without sending: `python3 tools/submitter/greenhouse.py submit --plan <plan> --cv <pdf> --cover <pdf> --evidence <folder>/dryrun`. It must end `ready`. Then get the hash: `python3 tools/submitter/greenhouse.py hash --plan <plan>`.
6. Write `formAnswers` on the job doc: `{mode, manualReason?, ats, inspectedAt, hash, answers:[{key, label, value, source, required, group}], leftBlank:[labels]}`. Also set `coverBuiltAt` to when the cover letter PDF was built. Save with `python3 tools/cloud_session.py save`.

Approve is disabled until `formAnswers` is there. If Casey edits the letter text after the PDF was built, rebuild the PDF from his text exactly (layout only, no rewording), then redo steps 4 to 6.

## 2. Sending (the "Job search sender" routine)

The routine starts a fresh session each time Approve fires it, and on a schedule as a safety net. Its trigger id is stored in `settings/main.submitTriggerId`, so the dashboard can fire it.

1. **Set up.** If `/home/user/job-search` is missing, attach `CptnHook/job-search` and `CptnHook/job-search-data` and clone them. Then run `python3 tools/cloud_session.py start`, and `pip install playwright` if it isn't installed.
2. **Pick the work.** List `jobs` at stage `approved`. If the firing text names `jobs/<id>`, do that one first. Otherwise do every approved job.
3. **Checks before anything is typed.** Any failure sets stage `needs_me` with `lastError` and an `actions` doc, and nothing is sent.
   - `approval.answersHash` equals `formAnswers.hash`.
   - `formAnswers.mode` is not `manual`.
   - When `approval.by` is `auto`: `settings/main.autoApprove` is on and `holds` is empty.
   - One application per role: no tracker row or other job doc with the same `requisitionKey` is applied or sending.
   - `attempts` is 0 and there is no `submission/attempt.json` in the application folder.
   - The posting is still live: `https://boards-api.greenhouse.io/v1/boards/<board>/jobs/<id>` returns it. A 404 means it closed. A timeout means unknown, so don't send this run.
   - The PDFs' SHA-256 values match the plan.
4. **Claim it.** Set stage `submitting`, `attempts: 1`, and `updatedAt` on the job doc before running the tool. This is the one automatic attempt.
5. **Send.** Run this in the background:
   `python3 tools/submitter/greenhouse.py submit --plan <plan> --cv <pdf> --cover <pdf> --evidence documents/applications/<folder>/submission --submit --approved-hash <approval.answersHash> --code-file <scratch>/code.txt`
   If stderr prints `NEEDS_CODE`, Greenhouse has emailed Casey a security code. Find that email in Gmail (from Greenhouse, about this company, received in the last 15 minutes) and write only the code to the code file. Don't guess, and don't reuse an older code.
6. **Record the result.**
   - `submitted`: stage `submitted` and `submittedAt`. Add a `transitions` doc (source `agent`) and an `entries` Stage note quoting the confirmation text. Set the tracker row to `applied`. The evidence screenshots stay in the application folder.
   - `blocked`: stage `needs_me`, `lastError` set to the first reason, and an `actions` doc. Nothing was sent. Casey fixes it or approves again after Claude re-prepares the answers (`attempts` goes back to 0 only when nothing was clicked, meaning no `attempt.json`).
   - `uncertain`: stage `failed` with `lastError` set to "may have gone through; check email before any retry", plus an `actions` doc. Never retry automatically.
7. **Save.** Run `python3 tools/cloud_session.py save`.

Never: a second automatic attempt, CAPTCHA solving, Workday sign-up, LinkedIn Easy Apply, a browser user agent that pretends not to be automated, or an answer Casey didn't approve.
