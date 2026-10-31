// a16z's own board (jobs.a16z.com): Next.js app router. The search page
// server-renders its first 25 matches into the RSC flight stream
// (`self.__next_f.push(...)`) as `{"initialData":{"jobs":[...],"total":N,...}}`.
// "Load more" runs over a live-query websocket backend, so this adapter reads
// page 1 only. URL params the page itself understands:
//   q=<text>  locations=metro:san-francisco-bay-area  remoteOnly=1  posted=<days>
// There is no seniority facet; executive filtering is client-side only.

import type { BoardConfig } from "../boards.js"
import { cleanText, extractFlight, findJsonObjects, httpGet, slugify, toIsoDate } from "../helpers.js"
import type { Job, JobDetail, PlatformAdapter, PlatformSearchResult, SearchParams } from "./types.js"

export const A16Z_PAGE_SIZE = 25

export function buildA16zUrl(board: BoardConfig, p: SearchParams): string {
  const params = new URLSearchParams()
  if (p.query) params.set("q", p.query)
  const kinds = new Set(p.locationTerms.map((t) => t.kind))
  if (kinds.size === 1 && kinds.has("bay-area")) params.set("locations", "metro:san-francisco-bay-area")
  if (kinds.size === 1 && kinds.has("remote")) params.set("remoteOnly", "1")
  if (p.jobage) params.set("posted", String(p.jobage))
  const qs = params.toString()
  return `${board.base}/jobs${qs ? `?${qs}` : ""}`
}

function a16zUrl(board: BoardConfig, companySlug: string, postingId: string, title: string): string {
  const s = slugify(title)
  return `${board.base}/jobs/${encodeURIComponent(companySlug)}/${encodeURIComponent(postingId)}${s ? `--${s}` : ""}`
}

export function a16zJobFromRaw(board: BoardConfig, x: any): Job | null {
  if (!x || typeof x !== "object") return null
  const title = cleanText(x.title)
  const company = typeof x.company_slug === "string" ? x.company_slug : null
  const posting = typeof x.ats_posting_id === "string" && x.ats_posting_id ? x.ats_posting_id : null
  if (!title || !company || !posting) return null
  const remote = x.remote === true ? true : x.remote === false ? false : null
  return {
    id: `${board.name}:${company}/${posting}`,
    board: board.name,
    title,
    company: cleanText(x.company_name),
    location: cleanText(x.location),
    date: toIsoDate(x.posted_at),
    url: a16zUrl(board, company, posting, title),
    applyUrl: typeof x.apply_url === "string" && /^https?:\/\//.test(x.apply_url) ? x.apply_url : null,
    remote,
    seniority: null,
  }
}

export function parseA16zSearch(board: BoardConfig, html: string): { jobs: Job[]; total: number | null } {
  const flight = extractFlight(html)
  const holder = findJsonObjects(flight, '{"initialData":').find((o) => Array.isArray(o?.initialData?.jobs))
  if (!holder) throw new Error(`${board.name}: page carried no initialData job list (markup may have changed)`)
  const d = holder.initialData
  const jobs: Job[] = []
  for (const raw of d.jobs) {
    try {
      const j = a16zJobFromRaw(board, raw)
      if (j) jobs.push(j)
    } catch {
      /* skip malformed */
    }
  }
  return { jobs, total: typeof d.total === "number" ? d.total : null }
}

export function parseA16zDetail(board: BoardConfig, html: string): JobDetail | null {
  const flight = extractFlight(html)
  const holder = findJsonObjects(flight, '{"job":{').find((o) => typeof o?.job?.ats_posting_id === "string")
  const x = holder?.job
  if (!x) return null
  const base = a16zJobFromRaw(board, x)
  if (!base) return null
  const desc = typeof x.description_html === "string" && x.description_html.trim() ? x.description_html : null
  return {
    ...base,
    description: desc,
    descriptionSource: desc ? "board" : null,
    employmentType: typeof x.employment_type === "string" ? x.employment_type : null,
    compensation: typeof x.compensation_summary === "string" ? cleanText(x.compensation_summary.replace(/^\$\$/, "$")) : null,
    notes: x.active === false ? ["Board marks this posting as inactive."] : [],
  }
}

/** The page's own canonical posting URL, when it is on this board's host under /jobs/. */
export function canonicalJobUrl(board: BoardConfig, html: string): string | null {
  const m = html.match(/<link[^>]*rel="canonical"[^>]*href="([^"]+)"/i)
  if (!m) return null
  try {
    const u = new URL(m[1], board.base)
    return u.hostname === new URL(board.base).hostname && /^\/jobs\/[^/]+\/[^/]+$/.test(u.pathname) ? u.toString() : null
  } catch {
    return null
  }
}

export const a16z: PlatformAdapter = {
  async search(board, p): Promise<PlatformSearchResult> {
    if (p.page > 1) {
      return {
        jobs: [],
        total: null,
        pageSize: A16Z_PAGE_SIZE,
        requestUrl: null,
        notes: [
          `${board.name}: only the first ${A16Z_PAGE_SIZE} matches are server-rendered; deeper pages load over a websocket backend this CLI does not use. Narrow --query/--location instead.`,
        ],
      }
    }
    const url = buildA16zUrl(board, p)
    const html = await httpGet(url)
    if (!html) throw new Error(`${board.name}: board page not found (404)`)
    const { jobs, total } = parseA16zSearch(board, html)
    const notes: string[] = []
    if (total !== null && total > jobs.length) {
      notes.push(`${board.name}: ${total} server matches (loose keyword match), first ${jobs.length} available.`)
    }
    return { jobs, total, pageSize: A16Z_PAGE_SIZE, notes, requestUrl: url }
  },

  async detail(board, nativeId) {
    const m = nativeId.match(/^([^/]+)\/([^/]+)$/)
    if (!m) return null
    // The page needs the "<posting>--<title-slug>" path; a slugless path only
    // client-redirects. Use the slug when given, else follow the page's
    // canonical link (same host, /jobs/ path only).
    let html = await httpGet(`${board.base}/jobs/${encodeURIComponent(m[1])}/${encodeURIComponent(m[2])}`)
    if (!html) return null
    let d = parseA16zDetail(board, html)
    if (!d) {
      const canon = canonicalJobUrl(board, html)
      if (canon) {
        html = await httpGet(canon)
        d = html ? parseA16zDetail(board, html) : null
      }
    }
    return d
  },

  nativeIdFromUrl(_board, url) {
    const m = url.pathname.match(/^\/jobs\/([^/]+)\/([^/]+?)\/?$/)
    if (!m) return null
    return `${decodeURIComponent(m[1])}/${decodeURIComponent(m[2])}`
  },
}
