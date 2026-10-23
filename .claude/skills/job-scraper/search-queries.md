# Search Queries for Job Scraper

<!-- SETUP: Customize these queries based on your skills, target roles, and location -->

## Installed portal CLIs (primary for `/scrape`)

`/scrape` discovers every portal skill under `.agents/skills/*/SKILL.md` and runs its CLI first. Shipped country-agnostic CLIs include `linkedin-search` and `freehire-search`; Danish demos and any skill you add with `/add-portal` are included the same way. You do **not** need a matching `site:` line below for those CLIs to run.

The `site:` query templates in this file are the **WebSearch fallback** — for portals without a CLI, company career pages, or when a CLI fails.

**Language scope:** write every query category in every language listed in your CLAUDE.md Languages table (typically 1-2, sometimes more). A posting requiring a language you have *not* declared, as a job condition, is excluded before scoring; a posting requiring a *higher level* than you declared in a language you *do* work in is flagged for your own judgment, not excluded — see `04-job-evaluation.md`'s Language Gate, the single source of truth for this rule. Translate each category's keywords rather than machine-translating word-for-word (e.g. "Frontend Developer" -> "Desarrollador Frontend", not a literal word-for-word translation) if you work in more than one language.

## Search Sites

Market: United States, San Francisco Bay Area. The Danish portal CLIs stay disabled.

Primary:
- **linkedin.com/jobs** - filter: United States / San Francisco Bay Area and Remote (US); also covered by the `linkedin-search` CLI
- **boards.greenhouse.io**, **jobs.lever.co**, **jobs.ashbyhq.com** - the applicant-tracking boards most high-growth tech companies post on
- **builtin.com/jobs** (Built In San Francisco) - tech roles in the Bay Area

Secondary (company career pages via Google):
- Direct Google searches with `site:` filters for target companies. No target list yet (Casey, 2026-10-17); search broadly. Companies added on the dashboard's Settings later feed the finder agent

## Query Categories

Target level (refined 2026-10-17): **VP and C-level** everywhere; **Director / Sr Director only at large companies** (public, 5,000+ employees, or $1B+ revenue). Casey is still narrowing the best fit, so keep every direction below in the search. All queries are English only.

Key skill terms to pair with titles: technical program management, engineering operations, PMO, AI enablement, cloud cost optimization, M&A integration.

### Priority 0: C-level (rare; most are filled through retained search firms)

```
site:linkedin.com/jobs ("Chief Operating Officer" OR "Chief Customer Officer" OR "Chief Transformation Officer") (SaaS OR "cloud" OR "fintech")
site:linkedin.com/jobs "Chief AI Officer" OR "Chief of Staff to the CEO" "San Francisco Bay Area"
site:boards.greenhouse.io ("Chief Operating Officer" OR "Chief Customer Officer" OR "Chief AI Officer")
site:jobs.ashbyhq.com ("Chief Operating Officer" OR "Chief Customer Officer")
```

### Priority 1: Program management / engineering operations (VP)

```
site:linkedin.com/jobs "VP, Program Management" OR "Vice President, Program Management Office" "San Francisco Bay Area"
site:linkedin.com/jobs "VP, Engineering Operations" OR "Head of Engineering Operations" United States
site:boards.greenhouse.io "VP" ("Technical Program Management" OR "PMO") (Remote OR "San Francisco")
site:jobs.lever.co "VP" "Engineering Operations"
site:jobs.ashbyhq.com "VP" ("Program Management" OR "Engineering Operations")
site:myworkdayjobs.com "Vice President" "Program Management" "San Francisco"
site:linkedin.com/jobs ("Head of Engineering Effectiveness" OR "VP, Developer Productivity" OR "VP, Engineering Effectiveness")
```

Large companies only (public, 5,000+ employees, or $1B+ revenue):

```
site:linkedin.com/jobs ("Senior Director" OR "Director") ("Technical Program Management" OR "Engineering Operations" OR "Program Management Office") "San Francisco Bay Area"
site:myworkdayjobs.com ("Senior Director" OR "Director") ("Technical Program Management" OR "Engineering Operations")
```

### Priority 2: Customer success / delivery (VP)

```
site:linkedin.com/jobs "VP, Customer Success" OR "VP, Professional Services" "San Francisco Bay Area"
site:boards.greenhouse.io "VP" ("Customer Success" OR "Implementation" OR "Delivery") (Remote OR "San Francisco")
site:jobs.lever.co "VP, Customer Success"
site:jobs.ashbyhq.com "VP" "Customer Success"
site:linkedin.com/jobs ("VP, Delivery" OR "VP, Professional Services" OR "VP, Implementation") (SaaS OR cloud)
```

### Priority 3: Strategy & operations / chief of staff (VP)

```
site:linkedin.com/jobs "VP, Strategy & Operations" OR "VP, Business Operations" "San Francisco Bay Area"
site:boards.greenhouse.io "Chief of Staff" (CTO OR "Chief Product") (Remote OR "San Francisco")
site:jobs.lever.co "VP" "Operations" "San Francisco"
site:linkedin.com/jobs "VP, Operations" (fintech OR payments) "San Francisco Bay Area"
```

### Priority 4: Product management and AI/platform operations (VP)

```
site:linkedin.com/jobs "VP, Product" platform "San Francisco Bay Area"
site:boards.greenhouse.io "VP" ("Product Operations" OR "AI Enablement" OR "Developer Productivity")
site:jobs.ashbyhq.com "VP" "Product Operations"
site:linkedin.com/jobs ("VP, AI Enablement" OR "Head of AI Operations" OR "VP, AI Operations" OR "Head of AI Enablement")
```

### Every run: Bay Area tech boards and VC portfolio boards (added 2026-10-23)

These run on every `/scrape`, on top of the priority categories. They catch roles at funded startups and scale-ups that often never reach LinkedIn.

**Built In SF.** Its robots.txt bars automated reading of the search pages, but allows individual job pages. Find postings through web search, then fetch only the `/job/...` pages:

```
site:builtinsf.com/job ("Vice President" OR "VP") ("Operations" OR "Program Management" OR "Customer Success" OR "Engineering Operations")
site:builtinsf.com/job ("Chief Operating Officer" OR "Chief of Staff" OR "Head of Engineering Operations" OR "Head of AI")
site:builtin.com/job ("Vice President" OR "VP") ("Program Management" OR "Engineering Operations") (Remote OR "San Francisco")
```

**VC portfolio job boards.** Each lists open roles across that firm's portfolio companies, which are mostly funded and growing, the 100-1,000 person range Casey likes. Their robots.txt allows reading (checked 2026-10-23):

```
site:jobs.a16z.com ("VP" OR "Vice President" OR "Head of" OR "Chief") (Operations OR "Program Management" OR "Customer Success")
site:jobs.accel.com ("VP" OR "Vice President" OR "Head of") (Operations OR "Program Management" OR "Customer Success")
site:jobs.sequoiacap.com ("VP" OR "Head of" OR "Chief") (Operations OR "Program Management")
site:ycombinator.com/companies ("VP" OR "Head of" OR "Chief of Staff") (Operations OR "Customer Success") jobs
site:wellfound.com/jobs ("VP" OR "Head of") (Operations OR "Program Management" OR "Customer Success") "San Francisco"
site:venturecapitalcareers.com ("VP" OR "Head of" OR "Chief of Staff") (Operations OR "Program Management") "San Francisco"
```

**Not scraped, by design.** Most VP and C-level hiring goes through retained search firms, VC talent partners, and executive networks such as ExecThread and BlueSteps. Those roles aren't posted publicly; you reach them through relationships, so they belong in the dashboard's Needs you tasks, not in `/scrape`.

## Location Filter

Home is Pacifica, CA; works in San Francisco today (~20-minute commute). Confirmed 2026-10-16:
- Hybrid anywhere in the SF Bay Area / Peninsula - ideal (he prefers some in-person time)
- Remote (US) - acceptable
- A few office days a week - fine
- 5-day / fully onsite - exclude
- Outside the Bay Area with no remote option - exclude (he doesn't target relocation; consider only if a recruiter brings it)
- Base salary range topping out under $300K - exclude when the posting states pay

## Language Filter

Your working languages and levels are in CLAUDE.md's Languages table. When filtering scraped results, apply `04-job-evaluation.md`'s Language Gate: a posting requiring a language you haven't declared at all is excluded; a posting requiring a higher level than you declared in a language you do work in is not excluded, flag it clearly instead (see `job-scraper/SKILL.md`'s Step 3 "Quick Fit Assessment" for how the flag surfaces in `/scrape` output). Postings simply *written* in a language you don't work in, that don't require it on the job, are fine.

## Date Filter

Only include jobs posted within the last 14 days, or with an application deadline that has not yet passed. If a posting date cannot be determined, include it but flag as "date unknown".

## Adapting Queries

If the user specifies a focus area, select queries from the matching category and also generate 2-3 custom queries for that focus. For example:
- "/scrape [focus_area]" -> relevant category queries + custom focus-specific queries
