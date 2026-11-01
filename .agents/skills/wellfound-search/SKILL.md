---
name: wellfound-search
version: 1.0.0
description: >
  Use this skill to search startup and scale-up jobs on Wellfound (formerly
  AngelList Talent), the US-centric startup job board, by role and city or
  remote, including VP, Head of, Chief, and Director roles with salary ranges.
  Invoke for startup jobs, venture-backed company openings, and executive or
  leadership roles at startups (VP Operations, COO, Chief of Staff, VP
  Engineering, Head of Customer Success). Trigger phrases: Wellfound,
  AngelList jobs, startup jobs, search startup jobs, VP roles at startups,
  executive startup openings, "find VP Operations jobs in San Francisco on
  Wellfound", look up this Wellfound job.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/wellfound-search/cli/src/cli.ts *)
---

# Wellfound Search Skill

Search live startup job listings from Wellfound's public role and location landing pages
(US-centric; English). No login, no API key, and **zero runtime dependencies**: it runs
with just `bun`. Results include the company, company size, location, posting date, and
the **salary range and equity** whenever the employer published them.

## ⚠️ Personal use only

Wellfound's Terms of Service forbid copying or "scraping" its content (automated or not)
except as expressly permitted, and forbid automated access that puts more load on its
servers than a person using a browser could. This skill reads only public pages that
`robots.txt` allows, with an honest User-Agent and one request per search. Still,
**keep volume low (a few searches at a time), don't use it commercially or for bulk
data collection, and don't redistribute what it returns.** Run it on your own
responsibility. If Wellfound starts returning a 403 or a challenge page, the CLI stops
with a `BLOCKED` error; don't work around it.

## When to use this skill

- Find startup roles by role and city (e.g. VP Operations in San Francisco) or remote
- Narrow to VP / C-level / Head / Director titles with `--seniority exec`
- See published salary ranges and equity at a glance
- Get the full description of a specific Wellfound job

## Commands

### Search job listings

```bash
bun run .agents/skills/wellfound-search/cli/src/cli.ts search -q "<role>" [-l "<city>"] [flags]
```

Key flags:
- `--query <text>` / `-q <text>`: a role. It is mapped to one of Wellfound's ~500 role pages by
  exact word match ("VP Operations" -> `vp-of-operations`, "Chief of Staff", "COO",
  "Technical Program Manager"). If no role page matches and `--location` is set, the city
  page is searched and titles are filtered by the query words; with no location it exits 1
  with suggested slugs.
- `--role <slug>`: use a Wellfound role slug directly (`vp-of-operations`,
  `chief-operating-officer`, `chief-of-staff`, `director-of-operations`, `vp-of-engineering`,
  `technical-program-manager`, `head-of-product`, `it-director`).
- `--location <city>` / `-l <city>`: a city such as `"San Francisco"` or `"New York"`, or `"Remote"`.
  Only some cities have a role+city page; for the rest the CLI uses the all-locations role page
  and filters by city name, noting this in `meta.warnings`.
- `--remote`: remote-friendly listings for the role.
- `--seniority exec`: keep only titles containing VP, Vice President, Head of, Chief, SVP, EVP,
  Director, or General Manager (client-side).
- `--jobage <days>`: keep listings that went live within N days. **Client-side**: Wellfound's
  landing pages have no date parameter, so this filters the fetched page only.
- `--page <n>`: page number (1-indexed; 20 companies per page, each with up to ~3 listings).
- `--limit <n>` / `-n <n>`: cap total results emitted (client-side).
- `--format json|table|plain`: default `json`.

### Fetch full job detail

```bash
bun run .agents/skills/wellfound-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is the `id` from search results, which includes the slug
(e.g. `4940450-vp-business-development-and-earned-revenue`). A full
`https://wellfound.com/jobs/...` URL also works. A bare number does not: Wellfound needs the
slug. Returns the full description, salary, employment type, location, posting date, industry,
and company website.

## Usage examples

```bash
# VP Operations roles in San Francisco, exec titles only
bun run .agents/skills/wellfound-search/cli/src/cli.ts search -q "VP Operations" -l "San Francisco" --seniority exec --format table

# Chief of Staff roles in San Francisco, posted in the last 14 days
bun run .agents/skills/wellfound-search/cli/src/cli.ts search -q "Chief of Staff" -l "San Francisco" --jobage 14 --format table

# Remote COO roles
bun run .agents/skills/wellfound-search/cli/src/cli.ts search -q "COO" --remote --format table

# Technical program manager roles in New York, page 2
bun run .agents/skills/wellfound-search/cli/src/cli.ts search -q "Technical Program Manager" -l "New York" --page 2 --format table

# Full details for one job
bun run .agents/skills/wellfound-search/cli/src/cli.ts detail 4940450-vp-business-development-and-earned-revenue --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default: programmatic use, passing `id`s to `detail` |
| `table` | Quick human-readable scanning (title, company, location, salary, date, id) |
| `plain` | Reading a single job's full detail (`detail` command) |

JSON search output is `{ "meta": {count, page, pageCount, totalJobCount, role, location, seniority, jobage, source, warnings}, "results": [...] }`.
Each result has `id`, `jobId`, `title`, `company`, `companySize`, `location`, `remote`, `date`,
`salary` (`{text, min, max, currency}` or `null`), `equity`, `jobType`, `url`.

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the process exits with code `1`.

## Notes

- Role pages match loosely. `/role/l/vp-of-operations/san-francisco` also lists "Deployment
  Engineer" and "Strategic Fixer". Use `--seniority exec` for an executive search.
- Results are grouped by company: each page shows 20 companies and their highlighted listings,
  so one page holds roughly 20-35 jobs.
- `companySize` comes from Wellfound's own bucket (e.g. `201-500`) and can be stale. Check it
  before applying a "Director only at large companies" rule.
- Wellfound 303-redirects an unsupported role+city combination to the all-locations role page
  and an out-of-range page to page 1. The CLI detects both (it never follows redirects blindly)
  and reports them in `meta.warnings`.
- Per-listing location lists are short ("San Francisco", "Denver"); `(remote OK)` marks
  listings that also accept remote.
- Applying requires a Wellfound login; this skill only reads public listings.
- Endpoint and parsing details are in `url-reference.md`.
