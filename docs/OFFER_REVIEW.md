# Offer review runbook

Casey asks for this from an application ticket (**Review the offer and plan the negotiation**, or the `offer-review` kind in Ask Claude). It arrives as a `requests` doc and is answered by the Dashboard requests routine ([REQUESTS.md](REQUESTS.md)). It is preparation only: Claude never contacts the employer, and this is not legal advice.

## Inputs

- The job doc: `comp[]` (every figure with its source, `statedTo` and `round`), `offerChecklist` (what Casey has ticked as in writing), the timeline `entries` (debrief pay intel, stated priorities, corrections) and `contacts`.
- The offer letter or contract, if Casey has put it in the application folder in `job-search-data` (`documents/applications/<folder>/offer/`). Offer documents stay there; never copy them into `job-search` or the dashboard.
- His floor and goal from the `salaryFloor` and `salaryGoal` rules, and his profile (CLAUDE.md, `01-candidate-profile.md`).

## What to write (in `result`, under about 500 words)

1. **Where the numbers stand.** The offer against his floor and goal, his stated ask, and every earlier figure the company gave. Flag a drop from an earlier figure, an offer below his ask, and any figure that is only verbal. Trust order: contract, then offer letter, then a recruiter in writing, then a recruiter verbally.
2. **Terms walk.** For each item on the dashboard's offer checklist (base; bonus target and how it's paid; equity amount and type; vesting and cliff; acceleration on a sale; severance; title and reporting line; start date; sign-on or make-whole for unvested equity; clawbacks; non-compete, non-solicit and IP assignment; benefits; office days; comp review timing): what the offer says, or "not in writing yet".
3. **Questions for his lawyer.** Clauses an employment lawyer should read: restrictive covenants, clawbacks, acceleration, severance conditions, equity plan terms.
4. **What to ask the employer for.** Ranked, each with the reason. Typical exec items: base to goal, sign-on to cover equity he leaves at SingleStore, single- or double-trigger acceleration, severance, title and reporting line in the letter.
5. **Talking points.** Three to five, built only from verified achievements in his profile ($30M+ ARR unlocked, 50% cloud cost cut, 5x engineering velocity, 800+ implementations, eight months to eight weeks delivery), tied to what the company's leaders said the role needs (`statedPriorities`). Run them through `tools/verify_facts.py`; a number it blocks doesn't go in.
6. **Consistency.** What he told whom (`comp[]` entries of kind `ask`, with `statedTo`), so his number stays the same with every person.

## Rules

- Never invent market data. A pay benchmark is labeled with its source, or left out.
- Never send, reply or accept anything. Never change the job's stage or `comp[]`.
- Offer documents and figures stay in the dashboard and `job-search-data`; never in `job-search`.
