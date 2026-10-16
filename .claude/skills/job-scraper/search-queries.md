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

Proposed from the resume; Casey still needs to confirm the target titles. All queries are English only.

### Priority 1: Engineering operations and technical program leadership

```
site:linkedin.com/jobs "Head of Engineering Operations" "San Francisco Bay Area"
site:linkedin.com/jobs "Senior Director, Technical Program Management" United States
site:boards.greenhouse.io "Director of Technical Program Management" (Remote OR "San Francisco")
site:jobs.lever.co "Head of TPM" OR "VP, Technical Program Management"
site:jobs.ashbyhq.com "Engineering Operations" Director
```

### Priority 2: Strategy & operations / chief of staff

```
site:linkedin.com/jobs "Chief of Staff to the CTO" United States
site:boards.greenhouse.io "VP, Strategy & Operations" (Remote OR "San Francisco")
site:jobs.lever.co "Head of Business Operations" "San Francisco"
site:jobs.ashbyhq.com "Chief of Staff" Engineering
```

### Priority 3: AI enablement, FinOps, and platform operations

```
site:linkedin.com/jobs "Head of AI Enablement" United States
site:boards.greenhouse.io "AI Operations" Director
site:linkedin.com/jobs "FinOps" Director "San Francisco Bay Area"
site:jobs.lever.co "Director, Internal Tools" OR "Developer Productivity" Director
```

### Priority 4: Global delivery and customer success leadership

```
site:linkedin.com/jobs "VP, Professional Services" fintech United States
site:boards.greenhouse.io "Head of Implementation" OR "VP, Customer Success" payments
site:jobs.lever.co "Global Head of Delivery" "San Francisco"
```

## Location Filter

Home is Pacifica, CA. Until Casey sets his commute and remote preferences, sort results like this:
- Remote (US) or San Francisco / Peninsula hybrid - ideal
- South Bay (Palo Alto, Mountain View, San Jose) hybrid - acceptable
- East Bay or anything needing more than about 3 office days a week - borderline, flag it
- Outside the Bay Area with no remote option - too far (relocation not confirmed)

## Language Filter

Your working languages and levels are in CLAUDE.md's Languages table. When filtering scraped results, apply `04-job-evaluation.md`'s Language Gate: a posting requiring a language you haven't declared at all is excluded; a posting requiring a higher level than you declared in a language you do work in is not excluded, flag it clearly instead (see `job-scraper/SKILL.md`'s Step 3 "Quick Fit Assessment" for how the flag surfaces in `/scrape` output). Postings simply *written* in a language you don't work in, that don't require it on the job, are fine.

## Date Filter

Only include jobs posted within the last 14 days, or with an application deadline that has not yet passed. If a posting date cannot be determined, include it but flag as "date unknown".

## Adapting Queries

If the user specifies a focus area, select queries from the matching category and also generate 2-3 custom queries for that focus. For example:
- "/scrape [focus_area]" -> relevant category queries + custom focus-specific queries
