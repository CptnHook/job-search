// Getro-powered boards (jobs.accel.com, jobs.generalcatalyst.com, ...).
//
// The board page is Next.js (pages router) and server-renders the first 20
// matching jobs into <script id="__NEXT_DATA__">. The page's own "load more"
// calls api.getro.com, whose robots.txt is `Disallow: /`, so this adapter
// reads ONLY the server-rendered board page. Consequence: page 1 only.
//
// Server-side filters ride in the board URL exactly as the site builds them:
//   /jobs?q=<text>&filter=<base64(JSON)>
// with JSON keys `seniority` (["vice_president","cxo","director"]),
// `searchable_locations` (["San Francisco, CA, USA", ...], OR-ed) and
// `work_mode` (["remote"]).

import type { BoardConfig } from "../boards.js"
import { cleanText, extractNextData, htmlToText, httpGet, toIsoDate } from "../helpers.js"
import type { Job, JobDetail, PlatformAdapter, PlatformSearchResult, SearchParams } from "./types.js"

export const GETRO_PAGE_SIZE = 20
export const GETRO_EXEC_SENIORITIES = ["vice_president", "cxo", "director"]
export const GETRO_BAY_AREA = [
  "San Francisco, CA, USA", "South San Francisco, CA, USA", "Oakland, CA, USA", "Berkeley, CA, USA",
  "Emeryville, CA, USA", "San Jose, CA, USA", "Santa Clara, CA, USA", "Sunnyvale, CA, USA",
  "Mountain View, CA, USA", "Palo Alto, CA, USA", "Menlo Park, CA, USA", "Redwood City, CA, USA",
  "San Mateo, CA, USA", "Foster City, CA, USA", "Burlingame, CA, USA", "San Bruno, CA, USA",
  "San Carlos, CA, USA", "Cupertino, CA, USA", "Milpitas, CA, USA", "Fremont, CA, USA",
  "Pleasanton, CA, USA", "Los Altos, CA, USA", "Los Gatos, CA, USA", "Walnut Creek, CA, USA",
]

export function buildGetroUrl(board: BoardConfig, p: SearchParams): string {
  const params = new URLSearchParams()
  if (p.query) params.set("q", p.query)
  const filter: Record<string, string[]> = {}
  if (p.execServerSide) filter.seniority = GETRO_EXEC_SENIORITIES
  // Getro ANDs filter keys, so only a single-kind location request is pushed
  // server-side; mixed requests (e.g. bay-area,remote) are filtered client-side.
  const kinds = new Set(p.locationTerms.map((t) => t.kind))
  if (kinds.size === 1 && kinds.has("bay-area")) filter.searchable_locations = GETRO_BAY_AREA
  if (kinds.size === 1 && kinds.has("remote")) filter.work_mode = ["remote"]
  if (Object.keys(filter).length) params.set("filter", Buffer.from(JSON.stringify(filter)).toString("base64"))
  const qs = params.toString()
  return `${board.base}/jobs${qs ? `?${qs}` : ""}`
}

export function getroJobFromRaw(board: BoardConfig, x: any): Job | null {
  if (!x || typeof x !== "object") return null
  const id = x.id != null ? String(x.id) : null
  const title = cleanText(x.title)
  const org = x.organization ?? {}
  const orgSlug = typeof org.slug === "string" ? org.slug : null
  if (!id || !title || !orgSlug) return null
  const locs: string[] = Array.isArray(x.locations) ? x.locations.filter((l: unknown) => typeof l === "string") : []
  const workMode = typeof x.workMode === "string" ? x.workMode : null
  const remote = workMode === "remote" ? true : workMode === "hybrid" || workMode === "on_site" ? false : null
  const location = locs.length ? locs.join(" · ") : remote ? "Remote" : null
  const slug = typeof x.slug === "string" && x.slug ? x.slug : id
  return {
    id: `${board.name}:${orgSlug}/${id}`,
    board: board.name,
    title,
    company: cleanText(org.name),
    location,
    date: toIsoDate(x.createdAt),
    url: `${board.base}/companies/${encodeURIComponent(orgSlug)}/jobs/${encodeURIComponent(slug)}`,
    applyUrl: typeof x.url === "string" && /^https?:\/\//.test(x.url) ? x.url : null,
    remote,
    seniority: typeof x.seniority === "string" ? x.seniority : null,
  }
}

/** Parse a Getro board page's __NEXT_DATA__ into jobs. Each job is parsed independently. */
export function parseGetroSearch(board: BoardConfig, html: string): { jobs: Job[]; total: number | null } {
  const nd = extractNextData(html)
  const state = nd?.props?.pageProps?.initialState?.jobs
  if (!state || !Array.isArray(state.found)) {
    throw new Error(`${board.name}: Getro page carried no __NEXT_DATA__ job list (markup may have changed)`)
  }
  const jobs: Job[] = []
  for (const raw of state.found) {
    try {
      const j = getroJobFromRaw(board, raw)
      if (j) jobs.push(j)
    } catch {
      /* one malformed job cannot break the rest */
    }
  }
  return { jobs, total: typeof state.total === "number" ? state.total : null }
}

export function parseGetroDetail(board: BoardConfig, html: string): JobDetail | null {
  const nd = extractNextData(html)
  const cj = nd?.props?.pageProps?.initialState?.jobs?.currentJob
  if (!cj || typeof cj !== "object") return null
  const org = cj.organization ?? {}
  const locs: string[] = Array.isArray(cj.locations)
    ? cj.locations.map((l: any) => (typeof l === "string" ? l : l?.name)).filter((l: unknown) => typeof l === "string")
    : []
  const orgSlug = typeof org.slug === "string" ? org.slug : "company"
  const id = String(cj.id ?? "")
  const min = Number(cj.compensationAmountMinCents)
  const max = Number(cj.compensationAmountMaxCents)
  const comp =
    cj.compensationPublic && Number.isFinite(min) && min > 0
      ? `${cj.compensationCurrency ?? ""} ${Math.round(min / 100).toLocaleString("en-US")}${
          Number.isFinite(max) && max > 0 ? `–${Math.round(max / 100).toLocaleString("en-US")}` : ""
        } / ${cj.compensationPeriod ?? "year"}${cj.compensationOffersEquity ? " + equity" : ""}`.trim()
      : null
  const description = typeof cj.description === "string" && cj.description.trim() ? htmlToText(cj.description) : null
  const status = typeof cj.status === "string" ? cj.status : null
  const notes: string[] = []
  if (status && status !== "active") notes.push(`Board marks this posting as "${status}".`)
  return {
    id: `${board.name}:${orgSlug}/${id}`,
    board: board.name,
    title: cleanText(cj.title) ?? "(untitled)",
    company: cleanText(org.name),
    location: locs.length ? locs.join(" · ") : null,
    date: toIsoDate(cj.postedAt ?? cj.createdAt),
    url: `${board.base}/companies/${encodeURIComponent(orgSlug)}/jobs/${encodeURIComponent(cj.slug ?? id)}`,
    applyUrl: typeof cj.url === "string" && /^https?:\/\//.test(cj.url) ? cj.url : null,
    remote: null,
    seniority: typeof cj.seniority === "string" ? cj.seniority : null,
    description,
    descriptionSource: description ? "board" : null,
    employmentType: Array.isArray(cj.employmentTypes) ? cj.employmentTypes.join(", ") || null : null,
    compensation: comp,
    notes,
  }
}

export const getro: PlatformAdapter = {
  async search(board, p): Promise<PlatformSearchResult> {
    if (p.page > 1) {
      return {
        jobs: [],
        total: null,
        pageSize: GETRO_PAGE_SIZE,
        requestUrl: null,
        notes: [
          `${board.name}: Getro boards server-render only the first ${GETRO_PAGE_SIZE} matches; deeper pages load from api.getro.com, whose robots.txt disallows all paths. Narrow --query/--location instead.`,
        ],
      }
    }
    const url = buildGetroUrl(board, p)
    const html = await httpGet(url)
    if (!html) throw new Error(`${board.name}: board page not found (404)`)
    const { jobs, total } = parseGetroSearch(board, html)
    const notes: string[] = []
    if (total !== null && total > jobs.length) {
      notes.push(`${board.name}: ${total} server matches, first ${jobs.length} available (Getro page-1 limit).`)
    }
    return { jobs, total, pageSize: GETRO_PAGE_SIZE, notes, requestUrl: url }
  },

  async detail(board, nativeId) {
    const m = nativeId.match(/^([^/]+)\/(\d+)(?:-[^/]*)?$/)
    if (!m) return null
    const html = await httpGet(`${board.base}/companies/${encodeURIComponent(m[1])}/jobs/${m[2]}`)
    if (!html) return null
    return parseGetroDetail(board, html)
  },

  nativeIdFromUrl(_board, url) {
    const m = url.pathname.match(/^\/companies\/([^/]+)\/jobs\/(\d+)(?:-[^/]*)?\/?$/)
    return m ? `${decodeURIComponent(m[1])}/${m[2]}` : null
  },
}
