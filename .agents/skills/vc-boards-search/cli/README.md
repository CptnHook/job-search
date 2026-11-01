# vc-boards-cli

CLI for searching VC portfolio-company job boards (US: SF Bay Area and remote US) in one call:
Getro boards (Accel, General Catalyst, Insight Partners, Redpoint, Khosla), a16z, and Greylock.

**Data source**: server-rendered public board pages (Getro `__NEXT_DATA__`; a16z and Greylock
Next.js RSC flight data), plus allowlisted ATS posting pages for `detail`. See `../url-reference.md`.
**Authentication**: none; no API keys, tokens or credentials are used.
**Dependencies**: none (plain `bun` + `fetch`). `bun install` only pulls dev type defs.

## Installation

```bash
cd .agents/skills/vc-boards-search/cli
bun install   # optional - only installs TypeScript dev types
```

## Commands

| Command | Description |
|---------|-------------|
| `search` | Search all (or `--board`-selected) boards, merge, dedupe, sort newest first |
| `detail` | Fetch one posting by search `id` or URL; falls back to the ATS page for the description |
| `boards` | List the board config (including disabled boards and why) |

`search` accepts `--format json|table|plain` (default `json`); `detail` accepts `--format json|plain`.
All errors are written to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`.

## Quick examples

```bash
bun run src/cli.ts search -q "VP Operations" --seniority exec -l bay-area,remote --format table
bun run src/cli.ts search -q "Chief of Staff" --seniority exec --board a16z,greylock --format table
bun run src/cli.ts detail accel:opower-2/98511200 --format plain
bun run src/cli.ts boards --format table
```

## Layout

| File | Purpose |
|---|---|
| `src/boards.ts` | The board config map - add firms here |
| `src/platforms/{getro,a16z,greylock}.ts` | Per-platform URL building and parsing |
| `src/ats.ts` | ATS host allowlist, robots check, JSON-LD description parsing |
| `src/helpers.ts` | Fetch with backoff, embedded-JSON extraction, exec-title and location filters, robots parser |
| `src/commands/{search,detail}.ts` | Command implementations |

## Tests

```bash
bun run typecheck
bun run test   # offline contract + parser tests, plus one live search (3 page requests)
```
