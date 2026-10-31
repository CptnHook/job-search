import type { BoardConfig } from "../boards.js"
import { isExecTitle, matchesLocation, parseLocationTerms, withinDays, writeError } from "../helpers.js"
import { ADAPTERS } from "../platforms/index.js"
import type { Job, SearchParams } from "../platforms/types.js"

export interface SearchOpts {
  query?: string
  boards: BoardConfig[]
  page: number
  limit?: number
  jobage?: number
  location?: string
  seniority: "exec" | "any"
  format: "json" | "table" | "plain"
}

interface BoardMeta {
  board: string
  firm: string
  platform: string
  status: "ok" | "error"
  fetched: number
  kept: number
  serverTotal: number | null
  error?: string
}

/** Dedupe key: the external apply URL without query string, else title+company. */
function dedupeKey(j: Job): string {
  if (j.applyUrl) {
    try {
      const u = new URL(j.applyUrl)
      return `${u.hostname}${u.pathname}`.toLowerCase().replace(/\/(application|apply)\/?$/, "").replace(/\/$/, "")
    } catch {
      /* fall through */
    }
  }
  return `${j.title}|${j.company ?? ""}`.toLowerCase().replace(/\s+/g, " ")
}

async function mapLimit<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  })
  await Promise.all(workers)
  return out
}

export function applyClientFilters(jobs: Job[], opts: Pick<SearchOpts, "seniority" | "location" | "jobage">): Job[] {
  const terms = parseLocationTerms(opts.location)
  return jobs.filter(
    (j) =>
      (opts.seniority === "any" || isExecTitle(j.title)) &&
      matchesLocation(terms, j) &&
      withinDays(j.date, opts.jobage),
  )
}

function renderTable(jobs: Job[]): string {
  if (jobs.length === 0) return "No results."
  const cut = (s: string | null, n: number) => {
    const v = (s ?? "—").replace(/\s+/g, " ")
    return (v.length > n ? v.slice(0, n - 1) + "…" : v).padEnd(n)
  }
  const header = `${"BOARD".padEnd(16)} ${"TITLE".padEnd(48)} ${"COMPANY".padEnd(22)} ${"LOCATION".padEnd(30)} DATE        ID`
  const rows = jobs.map(
    (j) =>
      `${cut(j.board, 16)} ${cut(j.title, 48)} ${cut(j.company, 22)} ${cut(j.location, 30)} ${(j.date ?? "—").slice(0, 10).padEnd(11)} ${j.id}`,
  )
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  const params: SearchParams = {
    query: opts.query,
    page: opts.page,
    jobage: opts.jobage,
    locationTerms: parseLocationTerms(opts.location),
    execServerSide: opts.seniority === "exec",
  }

  const notes: string[] = []
  const boardMeta: BoardMeta[] = []
  const perBoard = await mapLimit(opts.boards, 3, async (b) => {
    const adapter = ADAPTERS[b.platform]
    const meta: BoardMeta = { board: b.name, firm: b.firm, platform: b.platform, status: "ok", fetched: 0, kept: 0, serverTotal: null }
    if (!adapter) {
      meta.status = "error"
      meta.error = `no adapter for platform ${b.platform}`
      return { meta, jobs: [] as Job[] }
    }
    try {
      const r = await adapter.search(b, params)
      notes.push(...r.notes)
      meta.fetched = r.jobs.length
      meta.serverTotal = r.total
      const kept = applyClientFilters(r.jobs, opts)
      meta.kept = kept.length
      return { meta, jobs: kept }
    } catch (e) {
      meta.status = "error"
      meta.error = e instanceof Error ? e.message : String(e)
      return { meta, jobs: [] as Job[] }
    }
  })

  const seen = new Map<string, Job & { alsoOn?: string[] }>()
  for (const { meta, jobs } of perBoard) {
    boardMeta.push(meta)
    for (const j of jobs) {
      const k = dedupeKey(j)
      const prev = seen.get(k)
      if (prev) {
        if (prev.board !== j.board) prev.alsoOn = Array.from(new Set([...(prev.alsoOn ?? []), j.board]))
      } else {
        seen.set(k, { ...j })
      }
    }
  }

  const failed = boardMeta.filter((m) => m.status === "error")
  if (failed.length === boardMeta.length && boardMeta.length > 0) {
    writeError(`all boards failed: ${failed.map((m) => `${m.board}: ${m.error}`).join("; ")}`, "SEARCH_FAILED")
    return 1
  }
  for (const f of failed) notes.push(`${f.board}: request failed (${f.error}); other boards still returned results.`)

  let results = Array.from(seen.values()).map((j) => ({ ...j, alsoOn: j.alsoOn ?? [] }))
  results.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
  if (opts.limit !== undefined) results = results.slice(0, opts.limit)

  if (opts.format === "table") {
    process.stdout.write(renderTable(results) + "\n")
    if (failed.length) process.stdout.write(`\n(failed boards: ${failed.map((f) => f.board).join(", ")})\n`)
  } else if (opts.format === "plain") {
    process.stdout.write(
      (results.length
        ? results
            .map(
              (j) =>
                `${j.title}\n  ${j.company ?? "—"} · ${j.location ?? "—"} · ${j.date ? j.date.slice(0, 10) : "—"}\n  board: ${j.board}${
                  j.alsoOn.length ? ` (also: ${j.alsoOn.join(", ")})` : ""
                } · id: ${j.id}\n  ${j.url}${j.applyUrl ? `\n  apply: ${j.applyUrl}` : ""}`,
            )
            .join("\n\n")
        : "No results.") + "\n",
    )
  } else {
    process.stdout.write(
      JSON.stringify(
        {
          meta: {
            count: results.length,
            page: opts.page,
            query: opts.query ?? null,
            seniority: opts.seniority,
            location: opts.location ?? null,
            jobage: opts.jobage ?? null,
            boards: boardMeta,
            notes,
          },
          results,
        },
        null,
        2,
      ) + "\n",
    )
  }
  return 0
}
