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
- Direct Google searches with `site:` filters for target companies *(target company list to confirm)*

## Query Categories

Target level is VP (confirmed 2026-10-16) across engineering operations, customer success, program management, and product management. Casey is still narrowing the best fit, so keep all four directions in the search. All queries are English only.

### Priority 1: Program management / engineering operations (VP)

```
site:linkedin.com/jobs "VP, Program Management" OR "Vice President, Program Management Office" "San Francisco Bay Area"
site:linkedin.com/jobs "VP, Engineering Operations" OR "Head of Engineering Operations" United States
site:boards.greenhouse.io "VP" ("Technical Program Management" OR "PMO") (Remote OR "San Francisco")
site:jobs.lever.co "VP" "Engineering Operations"
site:jobs.ashbyhq.com "VP" ("Program Management" OR "Engineering Operations")
site:myworkdayjobs.com "Vice President" "Program Management" "San Francisco"
```

### Priority 2: Customer success / delivery (VP)

```
site:linkedin.com/jobs "VP, Customer Success" OR "VP, Professional Services" "San Francisco Bay Area"
site:boards.greenhouse.io "VP" ("Customer Success" OR "Implementation" OR "Delivery") (Remote OR "San Francisco")
site:jobs.lever.co "VP, Customer Success"
site:jobs.ashbyhq.com "VP" "Customer Success"
```

### Priority 3: Strategy & operations / chief of staff (VP)

```
site:linkedin.com/jobs "VP, Strategy & Operations" OR "VP, Business Operations" "San Francisco Bay Area"
site:boards.greenhouse.io "Chief of Staff" (CTO OR "Chief Product") (Remote OR "San Francisco")
site:jobs.lever.co "VP" "Operations" "San Francisco"
```

### Priority 4: Product management and AI/platform operations (VP)

```
site:linkedin.com/jobs "VP, Product" platform "San Francisco Bay Area"
site:boards.greenhouse.io "VP" ("Product Operations" OR "AI Enablement" OR "Developer Productivity")
site:jobs.ashbyhq.com "VP" "Product Operations"
```

## Location Filter

Home is Pacifica, CA; works in San Francisco today (~20-minute commute). Confirmed 2026-10-16:
- Remote (US), or hybrid anywhere in the SF Bay Area / Peninsula - ideal
- A few office days a week - fine
- 5-day / fully onsite - exclude
- Outside the Bay Area with no remote option - exclude
- Base salary range topping out under $300K - exclude when the posting states pay

## Language Filter

Your working languages and levels are in CLAUDE.md's Languages table. When filtering scraped results, apply `04-job-evaluation.md`'s Language Gate: a posting requiring a language you haven't declared at all is excluded; a posting requiring a higher level than you declared in a language you do work in is not excluded, flag it clearly instead (see `job-scraper/SKILL.md`'s Step 3 "Quick Fit Assessment" for how the flag surfaces in `/scrape` output). Postings simply *written* in a language you don't work in, that don't require it on the job, are fine.

## Date Filter

Only include jobs posted within the last 14 days, or with an application deadline that has not yet passed. If a posting date cannot be determined, include it but flag as "date unknown".

## Adapting Queries

If the user specifies a focus area, select queries from the matching category and also generate 2-3 custom queries for that focus. For example:
- "/scrape [focus_area]" -> relevant category queries + custom focus-specific queries
