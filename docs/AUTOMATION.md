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
| Network | Alongside the drafter | Casey's LinkedIn connections, converted to the Google Sheet "Connections" in Drive folder `1yTxny0rrxNQy9kjCBXv8yIbCHL9qxqYc` (current employer only; never copied into a repo) | `network` docs: VP-level (or other useful) people Casey knows at the company |
| Status sync | Daily | Gmail (`/gmail-sync`), Google Calendar | Proposes `entries` (recruiter emails, interview invites) and stage moves; Casey confirms on the dashboard |
| Coach | Weekly, and when a ticket closes | `entries` learnings and `jobs/*.retro` | `insights/main`: patterns across applications, what to build or reframe to be more marketable, profile and resume updates to propose |

Every threshold and policy an agent applies comes from the `rules` collection, read at the start of each run. Agents never write `rules`; the coach writes suggestions to `ruleProposals`, and only Casey's Accept on the Rules tab changes a rule (see [PLAN.md](PLAN.md#rule-tuning-built-in-phase-a-used-by-every-later-phase)). Locked rules can't be changed from a suggestion.

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
6. **Low or unclear fit.** Fit below the `minFitAuto` rule (75 to start), or an open question such as unconfirmed office days, adds a hold.
7. **Proof.** Every submission saves a confirmation screenshot to `job-search-data`, updates `job_search_tracker.csv` to `applied`, and sets `submittedAt`.

## Dashboard data model

| Path | Fields |
| --- | --- |
| `settings/main` | `autoApprove`, `updatedAt` (older `minFitAuto` and `salaryFloor` fields are fallbacks only; the values now live in `rules`) |
| `rules/<id>` | `id`, `title`, `group`, `type` (`number`/`money`/`bool`/`list`), `unit`, `help`, `value`, `locked`, `order`, `version`, `updatedAt`, `updatedBy`, `history[]{version,value,at,by,note,proposalId}` |
| `ruleProposals/<id>` | `ruleId` (or `new` with `newRule{id,title,type,unit,group,help}`), `from`, `to`, `why`, `evidence[]`, `sampleSize`, `expectedEffect`, `status` (`proposed`/`accepted`/`rejected`/`snoozed`), `createdAt`, `decidedAt`, `acceptedValue`, `edited`, `note` |
| `jobs/<id>` | `company`, `role`, `stage`, `fit`, `summary`, `holds[]`, `location`, `workMode`, `salaryMin`, `salaryMax`, `currency`, `ats`, `url`, `cvUrl`, `coverUrl`, `requisitionKey`, `approval{by,at}`, `coverDraft`, `coverText`, `coverEditedByCasey`, `coverEditedAt`, `cvDocUrl`, `cvChanges[]{where,before,after,why,status}`, `attempts`, `lastError`, `submittedAt`, `stageSince`, `lastContactAt`, `contactEmail`, `nextFollowupAt`, `followupCount`, `lastFollowupAt`, `comp[]{kind (advertised/ask/recruiter/offer/final),base,bonus,equity,source,date,note,at}`, `retro{why,marketable,differently,savedAt}`, `note`, `source`, `content` (pasted listings), `context`, `createdAt`, `updatedAt` |
| `transitions/<id>` | `jobId`, `company`, `role`, `from`, `to`, `at` (the date it happened, which can be earlier than when it was logged), `source` (`you`, `gmail`, `agent`, or `backfill` for the stage a ticket was in before history started), `createdAt` |
| `requests/<id>` | `kind` (`draft-followup` for now), `jobId`, `company`, `role`, `status` (`open`/`done`), `result`, `createdAt`, `doneAt`. Agents pick these up; nothing outbound happens without Casey |
| `actions/<id>` | `kind`, `title`, `detail`, `url`, `company`, `jobId`, `status` (`open`/`done`), `createdAt`, `doneAt` |
| `entries/<id>` | `jobId`, `company`, `role`, `kind` (`Call`/`Email`/`Interview`/`Feedback`/`Offer`/`Note`/`Stage`), `date`, `who`, `notes`, `learning`, `stage` (ticket stage when logged), `createdAt`; interview debriefs add `round`, `questions[]{q,rating (strong/solid/gap)}`, `intel{comp,timeline,next,others}`, `feedback` (verbatim) |
| `network/<id>` | `company`, `forRole`, `jobId`, `name`, `title`, `how` (how Casey knows them), `suggestion`, `profileUrl`, `status` (`new`/`contacted`/`dismissed`) |

Stages: `new` → `review` → `queued` → `drafting` → `awaiting_approval` → `approved` → `submitting` → `submitted` (Applied) → `recruiter` (Recruiter called) → `assessment` (Assessment) → `interviewing` (Interview cycle) → `offer` (Offer) → `negotiating` (Negotiations) → `hired` (Job achieved). Closers: `rejected`, `noresponse` (No response), `withdrawn`. Side exits: `backlog`, `declined`, `needs_me`, `failed`. An older `interview` value reads as Interview cycle.

Every stage move writes a `transitions` doc with the date it happened, so the ticket shows days in each stage. An open application that sits in one stage longer than the `stalledAfterDays` rule is flagged as stalled.

**Follow-ups** (Casey's rule, 2026-10-16): no reminders after a blind application. The first follow-up date is set only when a contact reaches out and the ticket has their email (`followupNeedsContactEmail`). After that, each call, email, interview, feedback, or offer logged resets the date (`followupAfterResponseDays`, or `followupAfterInterviewDays` after an interview) and the count. Each "Follow-up I sent" adds one; at `followupsBeforeCold` the reminder stops and the ticket shows as gone quiet with a "Mark no response" button. Closing a ticket clears the reminder. Due and overdue follow-ups appear in *Needs you*, with "Draft follow-up" (writes a `requests` doc) and "I sent it".

## Reviewing documents before approval

Every application at `awaiting_approval` or `approved` has a **Review and edit documents** panel on the dashboard:
- **Cover letter:** the drafter writes plain text to both `coverDraft` (its version, never overwritten by Casey) and `coverText` (what gets submitted). Casey edits `coverText` in place; `coverEditedByCasey` marks his version. The dashboard won't approve while he has unsaved edits. At submit time the submitter lays `coverText` out in his letter format; it never regenerates or "improves" text Casey edited.
- **Resume:** the drafter copies his resume Google Doc per application (`cvDocUrl`) and lists each change in `cvChanges` (`status`: `suggested` or `applied`). Casey can edit the copy directly in Google Docs. At submit time the submitter exports that Doc to PDF as it stands, so Casey's edits win.
- Approved-but-not-submitted applications stay editable, and Casey can undo the approval until the submitter moves them to `submitting`.

Applying suggested resume changes needs the **Google Docs** connector (Drive alone can copy and export but not edit a Doc). Until it's on, changes stay `suggested` and Casey applies them himself.

## Tracking an application after it's sent

Each application in the Pipeline tab opens as a ticket:
- **Where you are:** a step bar (Applied, Recruiter called, Assessment, Interview cycle, Offer, Negotiations, Job achieved, plus Rejected, No response, and Withdrew), with a date for moves that happened earlier. Each move is logged as a `Stage` entry and a `transitions` doc.
- **Timeline:** Casey logs calls, emails, interviews, feedback, and notes as `entries`, each with an optional "What I learned". Recruiter emails and interview invites found by the status-sync agent are proposed the same way.
- **Interview debrief:** logging an Interview opens a debrief: the round, each question asked marked strong / solid / gap, what they said about pay, timeline, next steps, and other candidates, and their feedback word for word. Every question collects in the Learnings tab's question bank, gaps first, for interview prep.
- **Pay:** each figure (advertised, my ask, recruiter stated, offer, final) with base, bonus, equity, and its source. Figures are marked against the salary floor and goal rules, with a warning when the company's number drops from its last one, when an offer comes in under your ask, or when your own ask changes.
- **Retrospective:** when a ticket closes, why he did or didn't get it, what would make him more marketable, and what he'd do differently.
- **Learnings tab:** every lesson and retrospective across applications. The coach agent reads it and proposes concrete changes: profile facts, resume framing, skills to build, target roles to add or drop.

Listings added by hand carry only the text, apply link, and Casey's context; the scorer reads salary, location, work mode, and company from the listing.

## Resume format

Casey prefers his own resume layout. The drafter copies his resume Google Doc per application and changes only what helps for that role (keywords for applicant-tracking systems, one or two reordered or reworded bullets), lists every change, and exports the PDF. With no useful changes, it submits his resume as is.

## Build order

Superseded by the phased plan in [PLAN.md](PLAN.md), which also adds rule tuning: agents propose rule changes, Casey accepts them before they take effect. Original order:


1. Dashboard (done; source in `dashboard/index.html`)
2. Resume from his Google Doc
3. Finder and scorer on a daily schedule
4. Drafter hand-off
5. Submitter: Greenhouse and Lever, then Ashby
6. Network agent (needs the LinkedIn export)
