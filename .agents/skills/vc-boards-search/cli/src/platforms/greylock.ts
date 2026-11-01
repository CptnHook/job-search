// Greylock's own board (greylock.com/jobs/portfolio-jobs/; jobs.greylock.com
// 301-redirects here). Custom Next.js app-router site; the job list is
// server-rendered into the RSC flight stream twice: an unfiltered Suspense
// fallback, then the filtered `JobsList` props
//   {"jobs":[...],"totalCount":N,"page":P,"pageCount":C,"facets":{...},"filters":{...},"selectedJob":...}
// URL params (from the site's own parseFiltersFromParams):
//   search=<text>  seniorities=A|B  locations=A|B  remote=1
//   posted=week|month|quarter  page=<n>  job=<id> (selects one posting)
// 60 jobs per page; pagination is server-rendered, so --page works here.

import type { BoardConfig } from "../boards.js"
import {
  cleanText,
  extractFlight,
  findJsonObjects,
  findJsonValueAfterKey,
  httpGet,
  queryNamesSeniority,
  toIsoDate,
} from "../helpers.js"
import type { Job, JobDetail, PlatformAdapter, PlatformSearchResult, SearchParams } from "./types.js"

export const GREYLOCK_PAGE_SIZE = 60
export const GREYLOCK_EXEC_SENIORITIES = ["VP/SVP", "Director/Senior Director", "C-Level / Executive"]
export const GREYLOCK_BAY_AREA = [
  "San Francisco", "South San Francisco", "Mountain View", "Palo Alto", "Menlo Park", "San Mateo",
  "Redwood City", "Sunnyvale", "San Jose", "Santa Clara", "Oakland", "Foster City", "Burlingame",
  "Berkeley", "Cupertino", "Emeryville", "San Bruno", "Los Altos", "San Carlos", "Milpitas",
].map((c) => `${c}, United States`)

/**
 * Greylock tags seniority per posting, but tags many exec-adjacent roles low
 * (e.g. "Chief of Staff" as Mid/Senior). When the query already names a level
 * ("VP", "Chief", "Head of"...) the title match is the better signal, so the
 * server-side seniority filter is only sent for level-free queries.
 */
export function greylockUsesServerSeniority(p: SearchParams): boolean {
  return p.execServerSide && !queryNamesSeniority(p.query)
}

export function buildGreylockUrl(board: BoardConfig, p: SearchParams, jobId?: string): string {
  const params = new URLSearchParams()
  if (p.query) params.set("search", p.query.slice(0, 120))
  if (greylockUsesServerSeniority(p)) params.set("seniorities", GREYLOCK_EXEC_SENIORITIES.join("|"))
  const kinds = new Set(p.locationTerms.map((t) => t.kind))
  if (kinds.size === 1 && kinds.has("bay-area")) params.set("locations", GREYLOCK_BAY_AREA.join("|"))
  if (kinds.size === 1 && kinds.has("remote")) params.set("remote", "1")
  if (p.jobage) {
    if (p.jobage <= 7) params.set("posted", "week")
    else if (p.jobage <= 31) params.set("posted", "month")
    else if (p.jobage <= 92) params.set("posted", "quarter")
  }
  if (p.page > 1) params.set("page", String(p.page))
  if (jobId) params.set("job", jobId)
  const qs = params.toString()
  return `${board.base}${qs ? `?${qs}` : ""}`
}

export function greylockJobFromRaw(board: BoardConfig, x: any): Job | null {
  if (!x || typeof x !== "object") return null
  const id = typeof x.id === "string" && /^[0-9a-f]{16,}$/i.test(x.id) ? x.id : null
  const title = cleanText(x.title)
  if (!id || !title) return null
  const locs: string[] = Array.isArray(x.locations) ? x.locations.filter((l: unknown) => typeof l === "string") : []
  const wm = typeof x.workMode === "string" ? x.workMode : null
  const remote = wm === "remote" ? true : wm === "onsite" || wm === "hybrid" ? false : null
  const sen: string[] = Array.isArray(x.seniorities) ? x.seniorities.filter((s: unknown) => typeof s === "string") : []
  return {
    id: `${board.name}:${id}`,
    board: board.name,
    title,
    company: cleanText(x.companyName),
    location: locs.length ? locs.join(" · ") : remote ? "Remote" : null,
    date: toIsoDate(x.createdAt),
    url: `${board.base}?job=${id}`,
    applyUrl: typeof x.applyUrl === "string" && /^https?:\/\//.test(x.applyUrl) ? x.applyUrl : null,
    remote,
    seniority: sen.length ? sen.join(", ") : null,
  }
}

interface GreylockList {
  jobs: any[]
  totalCount: number | null
  pageCount: number | null
  page: number | null
}

/** Pick the filtered JobsList props; fall back to the unfiltered Suspense fallback when the list is a back-reference. */
export function pickGreylockList(flight: string): GreylockList | null {
  const holders = findJsonObjects(flight, '{"jobs":').filter((o) => o && ("totalCount" in o || "filters" in o))
  if (!holders.length) return null
  const fallback = holders.find((o) => Array.isArray(o.jobs))
  const main = holders.filter((o) => "filters" in o).pop() ?? fallback
  if (!main) return null
  const jobs = Array.isArray(main.jobs) ? main.jobs : fallback && Array.isArray(fallback.jobs) ? fallback.jobs : null
  if (!jobs) return null
  const num = (v: unknown, alt: unknown) => (typeof v === "number" ? v : typeof alt === "number" ? alt : null)
  return {
    jobs,
    totalCount: num(main.totalCount, fallback?.totalCount),
    pageCount: num(main.pageCount, fallback?.pageCount),
    page: num(main.page, null),
  }
}

export function parseGreylockSearch(
  board: BoardConfig,
  html: string,
): { jobs: Job[]; total: number | null; pageCount: number | null; page: number | null } {
  const list = pickGreylockList(extractFlight(html))
  if (!list) throw new Error(`${board.name}: page carried no job list in its flight data (markup may have changed)`)
  const jobs: Job[] = []
  for (const raw of list.jobs) {
    try {
      const j = greylockJobFromRaw(board, raw)
      if (j) jobs.push(j)
    } catch {
      /* skip malformed */
    }
  }
  return { jobs, total: list.totalCount, pageCount: list.pageCount, page: list.page }
}

export function parseGreylockDetail(board: BoardConfig, html: string, id: string): JobDetail | null {
  const flight = extractFlight(html)
  const x: any = findJsonValueAfterKey(flight, "selectedJob")
  if (!x || typeof x !== "object" || x.id !== id) return null
  const base = greylockJobFromRaw(board, x)
  if (!base) return null
  const s = x.salary
  const comp =
    s && typeof s === "object" && typeof s.min === "number"
      ? `${s.currency ?? ""} ${s.min.toLocaleString("en-US")}${typeof s.max === "number" ? `–${s.max.toLocaleString("en-US")}` : ""} / ${String(s.period ?? "year").toLowerCase()}`.trim()
      : null
  return {
    ...base,
    description: null,
    descriptionSource: null,
    employmentType: null,
    compensation: comp,
    notes: [],
  }
}

export const greylock: PlatformAdapter = {
  async search(board, p): Promise<PlatformSearchResult> {
    const url = buildGreylockUrl(board, p)
    const html = await httpGet(url)
    if (!html) throw new Error(`${board.name}: board page not found (404)`)
    const parsed = parseGreylockSearch(board, html)
    const { total, pageCount } = parsed
    const notes: string[] = []
    // The site clamps an out-of-range page to its last/first page; never
    // re-emit those jobs as if they were the page asked for.
    const servedPage = parsed.page ?? 1
    const jobs = servedPage === p.page ? parsed.jobs : []
    if (servedPage !== p.page) notes.push(`${board.name}: only ${pageCount ?? 1} page(s) for this query; page ${p.page} is empty.`)
    if (pageCount !== null && p.page < pageCount) notes.push(`${board.name}: page ${p.page} of ${pageCount} (use --page).`)
    if (p.query && greylockUsesServerSeniority(p) === false && p.execServerSide) {
      notes.push(`${board.name}: query names a level, so the board's own seniority tags were not applied (title filter only).`)
    }
    return { jobs, total, pageSize: GREYLOCK_PAGE_SIZE, notes, requestUrl: url }
  },

  async detail(board, nativeId) {
    if (!/^[0-9a-f]{16,}$/i.test(nativeId)) return null
    const html = await httpGet(`${board.base}?job=${nativeId}`)
    if (!html) return null
    return parseGreylockDetail(board, html, nativeId)
  },

  nativeIdFromUrl(_board, url) {
    const id = url.searchParams.get("job")
    return id && /^[0-9a-f]{16,}$/i.test(id) ? id : null
  },
}
