#!/usr/bin/env bun
// Self-contained CLI for searching startup jobs on Wellfound's public role and
// location landing pages. Zero runtime dependencies; runs anywhere `bun` runs.
//
// Personal use only. Wellfound's Terms of Service forbid harvesting or
// "scraping" its content except as expressly permitted, and forbid automated
// access that puts more load on its servers than a person using a browser
// could. Keep volume low (a few searches at a time), never use it commercially
// or for bulk collection, and run it on your own responsibility.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

const BOOLEAN_FLAGS = new Set(["remote", "help", "h"])

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  const alias: Record<string, string> = { q: "query", l: "location", n: "limit" }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith("-")) {
      const key = alias[a.replace(/^-+/, "")] ?? a.replace(/^-+/, "")
      const next = argv[i + 1]
      if (BOOLEAN_FLAGS.has(key) || next === undefined || next.startsWith("-")) {
        flags[key] = true
      } else {
        flags[key] = next
        i++
      }
    } else {
      ;(flags._ as string[]).push(a)
    }
  }
  return flags
}

const HELP = `wellfound-cli — search startup jobs on Wellfound's public role/location pages

USAGE
  bun run src/cli.ts search -q "<role>" [-l "<city>"] [flags]
  bun run src/cli.ts detail <id|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>      Role to search, mapped to a Wellfound role page
                          ("VP Operations" -> vp-of-operations, "Chief of Staff",
                          "COO", "Technical Program Manager"). If no role page
                          matches and --location is set, the city page is searched
                          and titles are filtered by the query words.
  --role <slug>           Use a Wellfound role slug directly (e.g. vp-of-operations).
  --location, -l <city>   City, e.g. "San Francisco", "New York", or "Remote".
  --remote                Remote-friendly listings for the role (/role/r/<role>).
  --seniority exec        Keep only VP / Vice President / Head of / Chief / SVP /
                          EVP / Director / General Manager titles (client-side).
  --jobage <days>         Keep listings that went live within N days (client-side,
                          applied to the fetched page only).
  --page <n>              1-indexed page (20 companies per page). Default 1.
  --limit, -n <n>         Cap results emitted (client-side).
  --format <fmt>          json (default) | table | plain.

EXAMPLES
  bun run src/cli.ts search -q "VP Operations" -l "San Francisco" --format table
  bun run src/cli.ts search -q "Chief of Staff" -l "San Francisco" --seniority exec
  bun run src/cli.ts search --role chief-operating-officer --remote --format table
  bun run src/cli.ts detail 4897467-staff-database-reliability-engineer --format plain

Personal use only — Wellfound's Terms forbid scraping; keep volume low.
`

const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set(["query", "role", "location", "remote", "seniority", "jobage", "page", "limit", "format", "help", "h"]),
  detail: new Set(["format", "help", "h"]),
}

function err(error: string, code: string): number {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
  return 1
}

async function main(): Promise<number> {
  const flags = parseFlags(process.argv.slice(2))
  const cmd = (flags._ as string[])[0]

  if (!cmd || flags.help || flags.h) {
    process.stdout.write(HELP)
    return cmd ? 0 : 1
  }

  const known = KNOWN_FLAGS[cmd]
  if (known) {
    for (const key of Object.keys(flags)) {
      if (key === "_" || known.has(key)) continue
      return err(
        `unknown flag --${key} for '${cmd}' - flags are never silently ignored, because a discarded filter changes what the search returns; see --help`,
        "UNKNOWN_FLAG",
      )
    }
  }

  const intFlag = (name: string): number | null | undefined => {
    const raw = flags[name]
    if (raw === undefined) return undefined
    const val = typeof raw === "string" ? Number(raw.trim()) : NaN
    if (!Number.isInteger(val) || val < 1) {
      err(`--${name} must be a whole number of at least 1, got "${raw}"`, "BAD_ARG")
      return null
    }
    return val
  }

  if (cmd === "search") {
    const fmt = flags.format !== undefined ? String(flags.format) : "json"
    if (!["json", "table", "plain"].includes(fmt)) return err(`--format must be one of json|table|plain, got "${fmt}"`, "BAD_ARG")

    for (const name of ["query", "role", "location", "seniority"]) {
      if (flags[name] === true) return err(`--${name} needs a value`, "BAD_ARG")
    }
    const query = typeof flags.query === "string" ? flags.query : undefined
    const role = typeof flags.role === "string" ? flags.role : undefined
    const location = typeof flags.location === "string" ? flags.location : undefined
    if (!query && !role && !location) {
      return err('search needs --query/-q (a role such as "VP Operations"), --role <slug>, or --location/-l', "NO_QUERY")
    }
    let seniority: SearchOpts["seniority"]
    if (flags.seniority !== undefined) {
      if (String(flags.seniority).toLowerCase() !== "exec") return err(`--seniority supports only "exec", got "${flags.seniority}"`, "BAD_ARG")
      seniority = "exec"
    }
    const jobage = intFlag("jobage")
    const page = intFlag("page")
    const limit = intFlag("limit")
    if (jobage === null || page === null || limit === null) return 1

    const opts: SearchOpts = {
      query,
      role,
      location,
      remote: flags.remote === true,
      seniority,
      jobage,
      page: page ?? 1,
      limit,
      format: fmt as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  if (cmd === "detail") {
    const id = (flags._ as string[])[1]
    if (!id) return err("detail requires an <id|url>", "NO_ID")
    const fmt = flags.format !== undefined ? String(flags.format) : "json"
    if (!["json", "plain"].includes(fmt)) return err(`--format must be one of json|plain, got "${fmt}"`, "BAD_ARG")
    const opts: DetailOpts = { id, format: fmt as DetailOpts["format"] }
    return runDetail(opts)
  }

  return err(`Unknown command "${cmd}"`, "BAD_CMD")
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    process.stderr.write(JSON.stringify({ error: e instanceof Error ? e.message : String(e), code: "INTERNAL_ERROR" }) + "\n")
    process.exit(1)
  })
