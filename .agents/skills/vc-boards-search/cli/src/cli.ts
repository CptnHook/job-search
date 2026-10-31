#!/usr/bin/env bun
// Self-contained CLI for searching VC portfolio-company job boards (Getro
// boards such as Accel / General Catalyst / Insight / Redpoint / Khosla, plus
// a16z's and Greylock's own boards). US market (SF Bay Area and remote US),
// English. Zero runtime dependencies: plain bun + fetch.
//
// Data access: only server-rendered public board pages are read, with an
// honest User-Agent; no API keys, tokens or credentials are used, and hosts
// whose robots.txt disallows a path are not fetched. See url-reference.md.

import { BOARDS, findBoard, type BoardConfig } from "./boards.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"
import { runSearch, type SearchOpts } from "./commands/search.js"

interface Flags {
  _: string[]
  board: string[]
  [k: string]: string | boolean | string[]
}

const BOOLEAN_FLAGS = new Set(["help", "h", "no-ats"])

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [], board: [] }
  const alias: Record<string, string> = { q: "query", l: "location", n: "limit", b: "board" }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith("-") && a.length > 1) {
      let key = a.replace(/^-+/, "")
      let inline: string | undefined
      const eq = key.indexOf("=")
      if (eq !== -1) {
        inline = key.slice(eq + 1)
        key = key.slice(0, eq)
      }
      key = alias[key] ?? key
      let value: string | boolean
      if (inline !== undefined) value = inline
      else if (BOOLEAN_FLAGS.has(key)) value = true
      else {
        const next = argv[i + 1]
        if (next === undefined || (next.startsWith("-") && next.length > 1)) value = true
        else {
          value = next
          i++
        }
      }
      if (key === "board") {
        if (typeof value === "string") flags.board.push(value)
        else flags.board.push("")
      } else flags[key] = value
    } else {
      flags._.push(a)
    }
  }
  return flags
}

const ENABLED = BOARDS.filter((b) => b.enabled)

const HELP = `vc-boards-cli — search VC portfolio-company job boards (US: SF Bay Area + remote)

USAGE
  bun run src/cli.ts search [flags]
  bun run src/cli.ts detail <id|url> [--format json|plain] [--no-ats]
  bun run src/cli.ts boards [--format json|table]

SEARCH FLAGS
  --query, -q <text>      Keywords (title/role), e.g. "VP Operations", "Chief of Staff".
  --board, -b <names>     Boards to search; repeatable or comma list. Default: all enabled
                          (${ENABLED.map((b) => b.name).join(", ")}).
  --seniority <level>     exec (VP/Vice President/SVP/EVP/Head of/Chief/C-level/President/
                          Director/Sr Director/General Manager titles; also sends the board's
                          own seniority filter where offered) | any. Default: any.
  --location, -l <terms>  Comma list. Presets: bay-area, remote. Other text matches the
                          location string (e.g. "New York"). OR-ed.
  --jobage <days>         Posted within N days.
  --page <n>              1-indexed. Getro and a16z serve page 1 only; Greylock paginates.
  --limit, -n <n>         Cap results emitted (client-side, after merge/sort).
  --format <fmt>          json (default) | table | plain.

DETAIL
  <id>  as printed by search (e.g. accel:opower-2/98511200, a16z:ambient/<uuid>,
        greylock:<hex>), or a posting URL on a configured board or known ATS host.
  --no-ats  Do not fetch the external ATS page when the board has no description.

EXAMPLES
  bun run src/cli.ts search -q "VP Operations" --seniority exec -l bay-area,remote --format table
  bun run src/cli.ts search -q "Chief of Staff" --seniority exec --board a16z,greylock --format table
  bun run src/cli.ts search -q "operations" --seniority exec --board accel --jobage 30
  bun run src/cli.ts detail accel:opower-2/98511200 --format plain
`

const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set(["query", "board", "seniority", "location", "jobage", "page", "limit", "format", "help", "h"]),
  detail: new Set(["format", "no-ats", "help", "h"]),
  boards: new Set(["format", "help", "h"]),
}

function err(error: string, code: string): number {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
  return 1
}

function parseIntFlag(name: string, raw: string | boolean | string[]): number | null {
  const val = typeof raw === "string" ? Number(raw.trim()) : NaN
  if (!Number.isInteger(val) || val < 1) {
    err(`--${name} must be a whole number of at least 1, got "${raw}"`, "BAD_ARG")
    return null
  }
  return val
}

/** Resolve --board values (repeatable, comma lists). Empty → all enabled boards. */
function resolveBoards(values: string[]): { boards?: BoardConfig[]; error?: string; code?: string } {
  if (values.some((v) => v.trim() === "")) return { error: "--board needs a value (e.g. --board accel,a16z)", code: "BAD_ARG" }
  const names = values.flatMap((v) => v.split(",")).map((s) => s.trim()).filter(Boolean)
  if (names.length === 0 || names.some((n) => n.toLowerCase() === "all")) return { boards: ENABLED }
  const out: BoardConfig[] = []
  for (const n of names) {
    const b = findBoard(n)
    if (!b) return { error: `unknown board "${n}" (known: ${BOARDS.map((x) => x.name).join(", ")})`, code: "UNKNOWN_BOARD" }
    if (!b.enabled) return { error: `${b.name}: ${b.skipReason}`, code: "UNSUPPORTED_BOARD" }
    if (!out.includes(b)) out.push(b)
  }
  return { boards: out }
}

async function main(): Promise<number> {
  const flags = parseFlags(process.argv.slice(2))
  const cmd = flags._[0]

  if (!cmd || flags.help || flags.h) {
    process.stdout.write(HELP)
    return cmd ? 0 : 1
  }

  const known = KNOWN_FLAGS[cmd]
  if (!known) return err(`Unknown command "${cmd}"`, "BAD_CMD")
  for (const key of Object.keys(flags)) {
    if (key === "_" || (key === "board" && flags.board.length === 0)) continue
    if (!known.has(key)) {
      return err(
        `unknown flag --${key} for '${cmd}' - flags are never silently ignored, because a discarded filter changes what the search returns; see --help`,
        "UNKNOWN_FLAG",
      )
    }
  }

  if (cmd === "boards") {
    const fmt = flags.format !== undefined ? String(flags.format) : "json"
    if (!["json", "table"].includes(fmt)) return err(`--format must be one of json|table, got "${fmt}"`, "BAD_ARG")
    if (fmt === "table") {
      const rows = BOARDS.map(
        (b) => `${b.name.padEnd(18)} ${b.firm.padEnd(28)} ${b.platform.padEnd(9)} ${b.enabled ? "yes" : "no "}  ${b.base}`,
      )
      process.stdout.write([`${"BOARD".padEnd(18)} ${"FIRM".padEnd(28)} ${"PLATFORM".padEnd(9)} ON   URL`, ...rows].join("\n") + "\n")
    } else {
      process.stdout.write(JSON.stringify({ meta: { count: BOARDS.length }, results: BOARDS }, null, 2) + "\n")
    }
    return 0
  }

  if (cmd === "search") {
    const fmt = flags.format !== undefined ? String(flags.format) : "json"
    if (!["json", "table", "plain"].includes(fmt)) return err(`--format must be one of json|table|plain, got "${fmt}"`, "BAD_ARG")
    const sen = flags.seniority !== undefined ? String(flags.seniority).toLowerCase() : "any"
    if (!["exec", "any"].includes(sen)) return err(`--seniority must be exec or any, got "${flags.seniority}"`, "BAD_ARG")
    if (flags.query !== undefined && typeof flags.query !== "string") return err("--query needs a value", "BAD_ARG")
    if (flags.location !== undefined && typeof flags.location !== "string") return err("--location needs a value", "BAD_ARG")

    const nums: Record<string, number | undefined> = {}
    for (const name of ["jobage", "page", "limit"]) {
      if (flags[name] !== undefined) {
        const v = parseIntFlag(name, flags[name])
        if (v === null) return 1
        nums[name] = v
      }
    }

    const rb = resolveBoards(flags.board)
    if (!rb.boards) return err(rb.error!, rb.code!)

    const opts: SearchOpts = {
      query: typeof flags.query === "string" ? flags.query.trim() || undefined : undefined,
      boards: rb.boards,
      page: nums.page ?? 1,
      limit: nums.limit,
      jobage: nums.jobage,
      location: typeof flags.location === "string" ? flags.location : undefined,
      seniority: sen as SearchOpts["seniority"],
      format: fmt as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  // detail
  const id = flags._[1]
  if (!id) return err("detail requires an <id|url>", "NO_ID")
  const fmt = flags.format !== undefined ? String(flags.format) : "json"
  if (!["json", "plain"].includes(fmt)) return err(`--format must be one of json|plain, got "${fmt}"`, "BAD_ARG")
  const opts: DetailOpts = { id, format: fmt as DetailOpts["format"], noAts: flags["no-ats"] === true }
  return runDetail(opts)
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    process.stderr.write(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e), code: "INTERNAL_ERROR" }) + "\n",
    )
    process.exit(1)
  })
