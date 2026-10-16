# Job-search automation

The goal: listings come in, the good ones get drafted and submitted, and Casey only steps in when a rule or a site needs him. The **Job Hunt Command Center** dashboard is where he approves, tracks, and clears tasks:
https://claude.ai/artifact/Ls27uvPHvxqwyKuhEjoPy3 (private to Casey).

## Agents

| Agent | Runs | Reads | Writes |
| --- | --- | --- | --- |
| Finder | Daily (scheduled Claude Code session) | Target companies' public Greenhouse/Lever/Ashby job feeds, `/scrape` sources | `jobs` docs at stage `new` |
| Scorer | After the finder; also picks up listings Casey adds on the dashboard | `jobs` at `new`, the profile files | Fit score, summary, holds; stage `review` (or `declined` when a deal-breaker fails) |
| Drafter | After scoring | `jobs` at `queued` (Casey said yes) | Runs `/apply`; stage `awaiting_approval`, or `approved` when auto-approve is on and no rule holds it |
| Submitter | Hourly | `jobs` at `approved` | Submits; stage `submitted`, or `needs_me` / `failed` plus an `actions` doc |
| Network | Alongside the drafter | Casey's LinkedIn `Connections.csv` export in Drive | `network` docs: VP-level (or other useful) people Casey knows at the company |

Agents write to the dashboard with the `ArtifactData` tool as Casey. The page's data rules allow only the owner to write; anyone it's shared with can only view.

## Approval switch and rules

`settings/main.autoApprove`:
- **Off:** every drafted application waits at `awaiting_approval` for Casey's Approve click.
- **On:** a drafted application is approved automatically (`approval.by = "auto"`) **unless any rule below puts a reason in `holds`**. A held application waits for Casey whatever the switch says.

Rules the drafter and submitter enforce:
1. **One application per role.** Before submitting, check the tracker and every `jobs` doc for the same `requisitionKey` (lowercase `company|role`, or the employer's requisition ID when known). A match blocks the submission outright; it is never queued or retried.
2. **Company application limits.** If a company caps applications (stated on its careers site or found in research), every application there gets a hold so Casey picks which roles to spend them on.
3. **Manual-only sites.** CAPTCHA, a required account sign-up (Workday), or LinkedIn Easy Apply (automating it breaks LinkedIn's terms): don't attempt. Set stage `needs_me` and add an `actions` doc with the apply link and the prepared resume, cover letter, and form answers.
4. **One automatic attempt.** A submission that errors is not retried. Set stage `failed`, record `lastError` and `attempts`, and add an `actions` doc. Anything that might have gone through (timeout after clicking Submit) is treated as possibly submitted: Casey checks before any retry.
5. **Deal-breakers.** Fully onsite, a posted top salary under $300K, or below VP level: never auto-approved; usually declined at scoring.
6. **Low or unclear fit.** Fit below `settings/main.minFitAuto` (75), or an open question such as unconfirmed office days, adds a hold.
7. **Proof.** Every submission saves a confirmation screenshot to `job-search-data`, updates `job_search_tracker.csv` to `applied`, and sets `submittedAt`.

## Dashboard data model

| Path | Fields |
| --- | --- |
| `settings/main` | `autoApprove`, `minFitAuto`, `salaryFloor`, `updatedAt` |
| `jobs/<id>` | `company`, `role`, `stage`, `fit`, `summary`, `holds[]`, `location`, `workMode`, `salaryMin`, `salaryMax`, `currency`, `ats`, `url`, `cvUrl`, `coverUrl`, `requisitionKey`, `approval{by,at}`, `attempts`, `lastError`, `submittedAt`, `note`, `source`, `content` (pasted listings), `context`, `createdAt`, `updatedAt` |
| `actions/<id>` | `kind`, `title`, `detail`, `url`, `company`, `jobId`, `status` (`open`/`done`), `createdAt`, `doneAt` |
| `network/<id>` | `company`, `forRole`, `jobId`, `name`, `title`, `how` (how Casey knows them), `suggestion`, `profileUrl`, `status` (`new`/`contacted`/`dismissed`) |

Stages: `new` → `review` → `queued` → `drafting` → `awaiting_approval` → `approved` → `submitting` → `submitted` → `interview` / `offer` / `rejected`. Side exits: `backlog`, `declined`, `needs_me`, `failed`, `withdrawn`.

## Resume format

Casey prefers his own resume layout. The drafter copies his resume Google Doc per application and changes only what helps for that role (keywords for applicant-tracking systems, one or two reordered or reworded bullets), lists every change, and exports the PDF. With no useful changes, it submits his resume as is.

## Build order

1. Dashboard (done; source in `dashboard/index.html`)
2. Resume from his Google Doc
3. Finder and scorer on a daily schedule
4. Drafter hand-off
5. Submitter: Greenhouse and Lever, then Ashby
6. Network agent (needs the LinkedIn export)
