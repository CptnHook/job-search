# Command Center upgrade plan

Ideas adopted from a review of [career-ops](https://github.com/career-ops-hq/career-ops) (MIT; ideas and data contracts only, no code copied, name not used), fitted to the design in [AUTOMATION.md](AUTOMATION.md). Three phases. Each ships as its own PR with tests, and the dashboard republishes at the same link.

**Principle for all phases:** agents and reports *suggest*; Casey *decides*. Nothing changes a rule, sends a message, or submits outside the approval switch without his click.

## Rule tuning (built in Phase A, used by every later phase)

Every threshold and policy the agents follow lives as a **rule** on the dashboard, not in code. The coach agent proposes rule changes from evidence; a change takes effect only after Casey accepts it.

**Rules** (`rules/<id>`): `id`, `title`, `value` (number, list, or on/off), `locked`, `version`, `updatedAt`, `history[]` (every past value with date and who changed it).
Starting rules:

| Rule | Starting value | Tunable |
| --- | --- | --- |
| Fit score needed for auto-approve | 75 | Yes |
| Hold low-confidence fits | On | Yes |
| Follow-ups start only when a contact with an email reaches out | On | Yes |
| Follow-up after a response / after an interview | 3 / 1 days | Yes |
| Follow-ups before marking cold | 2 | Yes |
| Base salary floor / goal | $300K / $350K | Yes |
| Match signals, ranked | Access to leadership, high-growth, AI/dev tooling | Yes |
| Skip reasons that decline a listing outright | Onsite only, salary below floor, below VP | Yes |
| One application per role | On | **Locked** |
| One automatic submit attempt | On | **Locked** |
| Never automate CAPTCHA, Workday sign-up, LinkedIn Easy Apply | On | **Locked** |

Locked rules protect against duplicate applications, site terms, and anything that can't be undone. They show on the Rules tab but can't be proposed for change.

**Suggestions** (`ruleProposals/<id>`): `ruleId` (or `new`), `from`, `to`, `why` (plain sentence), `evidence` (counts, rates, example applications), `sampleSize`, `expectedEffect`, `status` (`proposed` / `accepted` / `rejected` / `snoozed`), `decidedAt`, `note`.

How it works:
1. The coach writes a proposal only with enough evidence: at least 5 closed applications behind any rate, and never from still-open ones.
2. The Rules tab shows a **Suggested changes** inbox. Each card shows the current rule, the proposed value, the evidence, and three buttons: **Accept**, **Accept with edit** (change the value first), **Reject** (with an optional reason).
3. Accept writes a new rule version and logs it in the rule's history. Agents read only `rules`, never proposals, so nothing changes until then.
4. Reject is remembered: the coach won't propose the same change again unless the evidence has grown by at least 5 more outcomes.
5. Any rule can be rolled back to an earlier version from its history.

## Phase A: dashboard upgrades

| # | Change | What you'll see |
| --- | --- | --- |
| A1 | **Stages** add Assessment, Offer (separate from Negotiations), and No response. | Stage bar: Applied → Recruiter called → Assessment → Interview cycle → Offer → Negotiations → Job achieved; closers Rejected, No response, Withdrew. |
| A2 | **Stage history** with the real event date and source (you, Gmail, agent). Back-dating allowed. | Days in each stage on the ticket; "stalled" flag when a stage runs long. |
| A3 | **Follow-up engine.** Casey's rule (2026-10-16): no follow-ups after a blind application, since many postings have no contact email. The first follow-up date is set only when a recruiter or other contact reaches out and the ticket has their email; later responses and interviews reset it. | "Follow-ups due" group in *Needs you* (urgent, overdue, upcoming); a "Draft follow-up" button. Drafts follow /outcome's rules: under 150 words, lead with value, never "just checking in". |
| A4 | **Interview debrief** entry type: round (recruiter, hiring manager, peer, panel), interviewer, questions asked each marked strong / solid / gap, process intel (comp mentioned, timeline, next steps, other candidates), verbatim feedback. | A question bank across companies; /interview prep reads past debriefs. |
| A5 | **Comp tracker** on each ticket: advertised, recruiter-stated, offer, and final figures, each tagged with its source (posting, recruiter verbal, offer letter, contract). | Checked against your floor and goal; warns if a later number contradicts an earlier one you gave. |
| A6 | **Fit confidence** (High / Medium / Low) next to the fit score, plus a **posting legitimacy** note (age, reposts, apply button live). | Low confidence holds auto-approval (rule above). Legitimacy is informational and doesn't change the score. |
| A7 | **Rules tab goes live** (done): current rules with history, the Suggested changes inbox (Accept, Accept with edit, Reject with a reason, Later), rollback. A suggestion made against an older value is flagged before you accept it. | As described in Rule tuning. |
| A8 | **Ask Claude button** on each ticket ("draft follow-up", "prep for this interview", "research this company"). Writes a request the agents pick up; results land on the ticket. | Requests listed with status; nothing outbound happens without you. |

Data model additions: `jobs` gets `nextFollowupAt`, `followupCount`, `fitConfidence`, `legitimacy`, `comp[]`, `archetype` (role family), `atsVendor`, `via` (direct or agency); new collections `transitions`, `rules`, `ruleProposals`, `requests`. Existing Rapid7 data carries over unchanged.

Done when: headless browser tests cover each change (stage moves write history, follow-up dates seed and reset, a debrief saves, a comp contradiction warns, accepting a proposal changes the rule and logs history, rejecting doesn't); the page republishes at the same link.

## Phase B: agents built with the new safeguards

| # | Agent | Safeguards adopted |
| --- | --- | --- |
| B1 | **Finder** (daily) | Reads Greenhouse, Lever, and Ashby public job feeds for target companies (Settings tab) plus Adzuna. **Liveness check**: an API call first, browser only as fallback; a posting is "closed" only on clear proof, otherwise "unknown". **Duplicates** keyed on job-board ID (provider + board + posting ID); a text-similarity check flags agency reposts. Every skipped listing gets a fixed skip reason in a log. |
| B2 | **Scorer** | Fit score plus confidence (each scoring dimension marked supported / partial / unknown; missing evidence never counts as neutral). Applies the match-signal and skip-reason rules. |
| B3 | **Drafter** | Copies your resume Google Doc and applies minimal listed edits; cover letter text to the ticket. **Fact check in code**: every number and tool name in a draft must appear in your profile or resume, or the draft is blocked. |
| B4 | **Submitter** (hourly) | Re-checks liveness first. Preflight: scan screening questions; any legal, EEO, salary, or visa question your profile can't answer becomes *needs your confirmation*; sweep required fields before each Next; per-site quirks list (e.g. Ashby may reject automated sessions, so it routes to *Needs you*). Saves the exact answers and document version submitted on the ticket. Locked rules always apply. |
| B5 | **Status sync** (daily) | Reads Gmail and Calendar; proposes timeline entries and stage moves with the quoted email as evidence; ambiguous matches show a short ranked list instead of a guess. Nothing changes until you accept. |
| B6 | **Network** | Matches your connections against every tracked company, not only the one being drafted; saves recruiters and interviewers you meet as contacts (recruiter, hiring manager, peer, interviewer, referral) for later roles. Outreach drafts for each callout. |

Done when: each agent runs on a schedule in Claude Code on the web, writes only through the dashboard's data store, and has tests for its safeguards (liveness never marks a timeout as closed; a duplicate job-board ID is blocked; a fact not in the profile blocks the draft; an unanswerable legal question routes to you).

## Phase C: learning and the coach

| # | Feature | Notes |
| --- | --- | --- |
| C1 | **Does fit predict results?** Interview and offer rates by fit band. | Verdict: separating / flat / inverted / not enough data. No percentage under 5 closed applications per band; open applications excluded. |
| C2 | **Where you get traction**: results by role family (eng-ops, PMO/TPM, customer success, product), company size, remote policy, and application channel. | Answers "where should I land" with your own data. Reports channel yield, never judgments about companies. |
| C3 | **Funnel and time-in-stage** from stage history. | Spots where applications stall. |
| C4 | **Coach agent** (weekly, and whenever a ticket closes) reads learnings, retrospectives, debriefs, C1–C3. | Writes marketability insights (what to emphasize, skills to build, roles to add or drop) and **rule proposals** to the Suggested changes inbox. Never edits a rule itself. |

Done when: C1–C3 show on the Learnings tab with honest sample-size handling; the coach's proposals appear in the inbox and take effect only on Accept.

## Not adopting

- Auto-tuning of any kind; disguising automation (browser-imitating user agents); automating LinkedIn, CAPTCHA, or Workday sign-ups.
- career-ops's scale (hundreds of scripts, a terminal UI, a local web app). We take the data contracts and rules, not the machinery.

## Order

Phase A first (one PR per two or three items, A7 Rules before A3 so follow-up timing reads from rules), then B1 → B2 → B3 → B5 → B4 → B6 (the submitter comes after status sync so confirmations are tracked before anything is sent automatically), then Phase C once about 10 applications have closed.
