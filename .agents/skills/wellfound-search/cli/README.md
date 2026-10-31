# wellfound-cli

CLI for searching startup jobs on Wellfound's public role and location landing pages.

**Data source**: `__NEXT_DATA__` on `/role/l/<role>/<city>`, `/role/<role>`, `/role/r/<role>`,
`/location/<city>`; JSON-LD `JobPosting` on `/jobs/<id>-<slug>`.
**Authentication**: None required.
**Dependencies**: None (plain `bun` + `fetch`). `bun install` is optional and only pulls dev type defs.

> **Personal use only.** Wellfound's Terms of Service forbid scraping or harvesting its content
> and automated access beyond what a person in a browser would generate. Keep volume low, don't
> use it commercially or for bulk data collection, and run it on your own responsibility.

## Installation

```bash
cd .agents/skills/wellfound-search/cli
bun install   # optional, only installs TypeScript dev types
```

## Commands

| Command | Description |
|---------|-------------|
| `search` | Search listings by role (`-q`/`--role`) and/or city (`-l`), with `--seniority exec`, `--jobage`, `--remote` |
| `detail` | Fetch full detail for one listing (`<id-slug>` or job URL) |

`search` accepts `--format json|table|plain` (default `json`); `detail` accepts `--format json|plain`.
All errors are written to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`.
Codes include `NO_QUERY`, `NO_ROLE_MATCH`, `UNKNOWN_FLAG`, `BAD_ARG`, `BAD_ID`, `NOT_FOUND`,
`BLOCKED` (403 or challenge: stop, don't work around it), and `LOGIN_REQUIRED`.

## Quick examples

```bash
bun run src/cli.ts search -q "VP Operations" -l "San Francisco" --seniority exec --format table
bun run src/cli.ts search --role chief-of-staff -l "San Francisco" --jobage 14
bun run src/cli.ts detail 4940450-vp-business-development-and-earned-revenue --format plain
```

## Tests

```bash
bun run typecheck
bun run test   # offline parser/flag tests plus one live search request
```

If Wellfound changes its markup, see `../url-reference.md` for the parsing anchors.
