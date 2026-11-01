// Data source: Wellfound's public SEO landing pages (/role/<role>, /location/<city>,
// /role/l/<role>/<city>, /role/r/<role>) and public job pages (/jobs/<id>-<slug>).
// No authentication. Landing pages are Next.js pages whose __NEXT_DATA__ script
// carries an Apollo cache with StartupResult + JobListingSearchResult objects; job
// pages carry a schema.org JobPosting JSON-LD block. Both are parsed with plain
// regex + JSON.parse, so the CLI has zero runtime dependencies.
//
// robots.txt (checked 2026-10-31) disallows /_jobs/, /search, /auth/, /cdn-cgi/
// and the ?role= / ?jobId= / ?jobSlug= / ?preview= / ?inFrame= / ?after_sign_in=
// query parameters. This CLI only requests the path shapes above plus ?page=<n>,
// none of which are disallowed. Do not add requests to the disallowed paths.

import { ROLE_SLUGS } from "./roles.js"

export const BASE_URL = "https://wellfound.com"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

/** Honest UA naming the tool, per the portal-skill contract. Never a browser string. */
export const UA = "Mozilla/5.0 (compatible; wellfound-cli/1.0)"

export class FetchError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message)
  }
}

export interface PageResponse {
  status: number
  html: string
  /** Absolute redirect target for a 3xx, else null. */
  redirect: string | null
}

/**
 * Fetch a page with exponential backoff + jitter on 429/5xx (max 6 retries).
 * Redirects are NOT followed: Wellfound 303s an unsupported role/location
 * combination to a broader page and an out-of-range page back to page 1, and
 * following that silently would return results that do not match the request.
 * A 404 yields html "" rather than an exception. A 403 (or a bot-challenge page)
 * is reported as BLOCKED and never worked around.
 */
export async function pageFetch(url: string, sleep = defaultSleep): Promise<PageResponse> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(20000),
    })
    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new FetchError(`Request failed: ${response.status} ${response.statusText}`, "HTTP_ERROR")
      }
      const jitter = Math.floor(Math.random() * 500)
      await sleep(delay + jitter)
      delay = Math.min(delay * 2, 8000)
      continue
    }
    if (response.status >= 300 && response.status < 400) {
      const loc = response.headers.get("location")
      return { status: response.status, html: "", redirect: loc ? new URL(loc, url).toString() : null }
    }
    if (response.status === 404) return { status: 404, html: "", redirect: null }
    if (response.status === 401 || response.status === 403) {
      throw new FetchError(
        `Wellfound refused the request (${response.status}). This CLI does not work around blocks or logins; stop and use the website instead.`,
        "BLOCKED",
      )
    }
    if (!response.ok) {
      throw new FetchError(`Request failed: ${response.status} ${response.statusText}`, "HTTP_ERROR")
    }
    const html = await response.text()
    if (isChallengePage(html)) {
      throw new FetchError(
        "Wellfound served a bot-challenge page instead of content. This CLI does not bypass challenges; stop and use the website instead.",
        "BLOCKED",
      )
    }
    return { status: response.status, html, redirect: null }
  }
  throw new FetchError("Request failed after max retries", "HTTP_ERROR")
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * A real challenge page (Cloudflare interstitial, DataDome, captcha) has no page
 * data. Normal pages also embed Cloudflare's passive /cdn-cgi/challenge-platform
 * beacon script, so that string alone is NOT a challenge.
 */
export function isChallengePage(html: string): boolean {
  if (html.includes('id="__NEXT_DATA__"') || html.includes("application/ld+json")) return false
  return /<title>\s*Just a moment|cf-chl-|captcha-delivery|datadome|Attention Required/i.test(html)
}

// ---------------------------------------------------------------------------
// Query -> URL mapping
// ---------------------------------------------------------------------------

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

const ACRONYMS: Record<string, string> = {
  ceo: "ceo",
  cfo: "chief-financial-officer",
  coo: "chief-operating-officer",
  cto: "chief-technical-officer",
  cio: "chief-information-officer",
  ciso: "chief-information-security-officer",
  cmo: "chief-marketing-officer",
  tpm: "technical-program-manager",
}

const STOP = new Set(["of", "the", "and", "a", "an", "for"])

function tokens(text: string): string[] {
  return slugify(
    text
      .toLowerCase()
      .replace(/\bvice[\s-]+president\b/g, "vp")
      .replace(/\bv\.p\.?/g, "vp")
      .replace(/\bcto\b/g, "chief technical officer"),
  )
    .split("-")
    .filter((t) => t && !STOP.has(t))
}

/**
 * Map a free-text query to one of Wellfound's role slugs. Exact token-set match
 * only (ignoring "of"/"the"/"and"), so "VP Operations" -> vp-of-operations and
 * "Chief of Staff" -> chief-of-staff. Returns null when nothing matches exactly:
 * a fuzzy guess would silently search a different role.
 */
export function roleSlugFor(query: string, slugs: readonly string[] = ROLE_SLUGS): string | null {
  const q = query.trim().toLowerCase()
  if (ACRONYMS[q]) return ACRONYMS[q]
  if (slugs.includes(slugify(q))) return slugify(q)
  const want = [...new Set(tokens(q))].sort().join(" ")
  if (!want) return null
  for (const slug of slugs) {
    const have = [...new Set(tokens(slug.replace(/_/g, "-")))].sort().join(" ")
    if (have === want) return slug
  }
  return null
}

/** "San Francisco, CA" -> "san-francisco". */
export function locationSlugFor(location: string): string {
  return slugify(location.split(",")[0])
}

export interface UrlPlan {
  url: string
  kind: "roleLocation" | "role" | "roleRemote" | "location"
}

export function buildSearchUrl(role: string | null, location: string | null, remote: boolean, page: number): UrlPlan {
  const pageQs = page > 1 ? `?page=${page}` : ""
  if (role && remote) return { url: `${BASE_URL}/role/r/${role}${pageQs}`, kind: "roleRemote" }
  if (role && location) return { url: `${BASE_URL}/role/l/${role}/${location}${pageQs}`, kind: "roleLocation" }
  if (role) return { url: `${BASE_URL}/role/${role}${pageQs}`, kind: "role" }
  if (location) return { url: `${BASE_URL}/location/${location}${pageQs}`, kind: "location" }
  throw new FetchError("search needs a role (--query/--role) or a --location", "NO_QUERY")
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export function extractNextData(html: string): any | null {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)
  if (!m) return null
  try {
    return JSON.parse(m[1])
  } catch {
    return null
  }
}

export interface Salary {
  /** Display string as Wellfound shows it, e.g. "$195k – $229k". */
  text: string
  min: number | null
  max: number | null
  currency: string | null
}

export interface JobCard {
  id: string
  jobId: string
  title: string
  company: string | null
  companySize: string | null
  location: string | null
  remote: boolean
  date: string | null
  salary: Salary | null
  equity: string | null
  jobType: string | null
  url: string
}

export interface SearchPage {
  totalJobCount: number | null
  pageCount: number | null
  perPage: number | null
  results: JobCard[]
}

const CURRENCY: Record<string, string> = { $: "USD", "€": "EUR", "£": "GBP", "₹": "INR", "C$": "CAD", "A$": "AUD" }

function moneyValue(raw: string): number | null {
  const m = raw.replace(/,/g, "").match(/([\d.]+)\s*([kKmM]?)/)
  if (!m) return null
  const n = parseFloat(m[1])
  if (!Number.isFinite(n)) return null
  const mult = /k/i.test(m[2]) ? 1_000 : /m/i.test(m[2]) ? 1_000_000 : 1
  return Math.round(n * mult)
}

/**
 * Split Wellfound's compensation string ("$150k – $185k • 0.1% – 0.3%",
 * "$173k – $212k • No equity", "") into salary and equity parts.
 */
export function parseCompensation(raw: string | null | undefined): { salary: Salary | null; equity: string | null } {
  if (!raw || !raw.trim()) return { salary: null, equity: null }
  const parts = raw.split("•").map((p) => p.trim()).filter(Boolean)
  let salaryText: string | null = null
  let equity: string | null = null
  for (const p of parts) {
    if (/%|equity/i.test(p)) equity = p
    else if (/\d/.test(p) && salaryText === null) salaryText = p
  }
  if (!salaryText) return { salary: null, equity }
  const cur = salaryText.match(/^(C\$|A\$|[$€£₹])/)
  const [lo, hi] = salaryText.split(/[–-]/)
  const min = lo ? moneyValue(lo) : null
  const max = hi ? moneyValue(hi) : min
  return {
    salary: { text: salaryText, min, max, currency: cur ? CURRENCY[cur[1]] ?? null : null },
    equity,
  }
}

function deref(data: Record<string, any>, ref: any): any {
  return ref && typeof ref === "object" && typeof ref.__ref === "string" ? data[ref.__ref] : ref
}

/**
 * Parse a landing page's __NEXT_DATA__. Results are grouped by startup (20
 * startups per page, each with up to a few highlighted listings); each listing
 * is parsed independently so one malformed object cannot break the rest.
 */
export function parseSearchPage(nextData: any): SearchPage {
  const data: Record<string, any> = nextData?.props?.pageProps?.apolloState?.data ?? {}
  const talent = data.ROOT_QUERY?.talent ?? {}
  const key = Object.keys(talent).find((k) => k.startsWith("seoLandingPageJobSearchResults"))
  const res = key ? talent[key] : null
  const out: SearchPage = {
    totalJobCount: typeof res?.totalJobCount === "number" ? res.totalJobCount : null,
    pageCount: typeof res?.pageCount === "number" ? res.pageCount : null,
    perPage: typeof res?.perPage === "number" ? res.perPage : null,
    results: [],
  }
  const seen = new Set<string>()
  for (const sRef of Array.isArray(res?.startups) ? res.startups : []) {
    const startup = deref(data, sRef)
    if (!startup) continue
    for (const jRef of Array.isArray(startup.highlightedJobListings) ? startup.highlightedJobListings : []) {
      try {
        const card = parseListing(deref(data, jRef), startup)
        if (card && !seen.has(card.jobId)) {
          seen.add(card.jobId)
          out.results.push(card)
        }
      } catch {
        // skip one malformed listing, keep the rest
      }
    }
  }
  return out
}

const SIZE_LABEL: Record<string, string> = {
  SIZE_1_10: "1-10",
  SIZE_11_50: "11-50",
  SIZE_51_200: "51-200",
  SIZE_201_500: "201-500",
  SIZE_501_1000: "501-1000",
  SIZE_1001_5000: "1001-5000",
  SIZE_5000_PLUS: "5000+",
  SIZE_5001_PLUS: "5000+",
}

function parseListing(j: any, startup: any): JobCard | null {
  if (!j || j.id == null || !j.title) return null
  const jobId = String(j.id)
  const slug = typeof j.slug === "string" && j.slug ? j.slug : slugify(String(j.title))
  const names: string[] = Array.isArray(j.locationNames) ? j.locationNames.filter((x: unknown) => typeof x === "string") : []
  const remote = j.remote === true
  let location: string | null = names.length ? names.join(", ") : null
  if (remote) location = location ? `${location} (remote OK)` : "Remote"
  const { salary, equity } = parseCompensation(j.compensation)
  const date = typeof j.liveStartAt === "number" ? new Date(j.liveStartAt * 1000).toISOString() : null
  const size = typeof startup?.companySize === "string" ? SIZE_LABEL[startup.companySize] ?? startup.companySize : null
  return {
    id: `${jobId}-${slug}`,
    jobId,
    title: String(j.title).replace(/\s+/g, " ").trim(),
    company: typeof startup?.name === "string" ? startup.name : null,
    companySize: size,
    location,
    remote,
    date,
    salary,
    equity,
    jobType: typeof j.jobType === "string" ? j.jobType : null,
    url: `${BASE_URL}/jobs/${jobId}-${slug}`,
  }
}

// ---------------------------------------------------------------------------
// Client-side filters
// ---------------------------------------------------------------------------

/** Titles that read as VP / C-level / Head / Director / GM. */
export const EXEC_TITLE_RE =
  /\b(VP|V\.P\.|Vice[\s-]+President|Head\s+of|Chief|SVP|EVP|Director|General\s+Manager)\b/i

export function isExecTitle(title: string): boolean {
  return EXEC_TITLE_RE.test(title)
}

export function withinDays(date: string | null, days: number, now = Date.now()): boolean {
  if (!date) return false
  const t = Date.parse(date)
  return Number.isFinite(t) && now - t <= days * 86_400_000
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

export interface JobDetail {
  id: string
  jobId: string
  title: string
  company: string | null
  companyUrl: string | null
  location: string | null
  remote: boolean
  date: string | null
  validThrough: string | null
  employmentType: string | null
  salary: Salary | null
  industry: string | null
  description: string | null
  url: string
}

function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, dec) => numericEntity(parseInt(dec, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, hex) => numericEntity(parseInt(hex, 16)))
    .replace(/&amp;/g, "&")
}

/** HTML description -> readable text, keeping paragraph and list breaks. */
export function htmlToText(html: string): string {
  const withBreaks = html
    .replace(/<li[^>]*>\s*<p[^>]*>/gi, "<li>")
    .replace(/<\/p>\s*<\/li>/gi, "</li>")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/(p|li|ul|ol|div|h\d)>/gi, "\n")
  return decodeHtmlEntities(withBreaks.replace(/<[^>]+>/g, ""))
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}- /g, "\n- ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function placeName(p: any): string | null {
  const a = p?.address
  if (!a) return null
  const parts = [a.addressLocality, a.addressRegion, a.addressCountry].filter((x) => typeof x === "string" && x)
  return parts.length ? parts.join(", ") : null
}

export function parseJobDetail(html: string, jobKey: string): JobDetail | null {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
  let posting: any = null
  for (const b of blocks) {
    try {
      const obj = JSON.parse(b[1])
      const list = Array.isArray(obj) ? obj : [obj]
      posting = list.find((o) => o && o["@type"] === "JobPosting") ?? posting
    } catch {
      // ignore a malformed block
    }
    if (posting) break
  }
  if (!posting) return null
  const jobId = String(posting.identifier?.value ?? jobKey.split("-")[0])
  const locs: any[] = Array.isArray(posting.jobLocation) ? posting.jobLocation : posting.jobLocation ? [posting.jobLocation] : []
  const names = locs.map(placeName).filter((x): x is string => !!x)
  const remote = posting.jobLocationType === "TELECOMMUTE"
  let location: string | null = names.length ? names.join(" | ") : null
  if (remote) location = location ? `${location} (remote OK)` : "Remote"

  let salary: Salary | null = null
  const v = posting.baseSalary?.value
  if (v && (typeof v.minValue === "number" || typeof v.maxValue === "number")) {
    const min = typeof v.minValue === "number" ? Math.round(v.minValue) : null
    const max = typeof v.maxValue === "number" ? Math.round(v.maxValue) : min
    const currency = typeof posting.baseSalary.currency === "string" ? posting.baseSalary.currency : null
    const unit = typeof v.unitText === "string" ? `/${v.unitText.toLowerCase()}` : ""
    const fmt = (n: number | null) => (n === null ? "?" : n.toLocaleString("en-US"))
    salary = { text: `${currency ?? ""} ${fmt(min)} – ${fmt(max)}${unit}`.trim(), min, max, currency }
  }

  return {
    id: jobKey,
    jobId,
    title: typeof posting.title === "string" ? decodeHtmlEntities(posting.title).trim() : "(untitled)",
    company: typeof posting.hiringOrganization?.name === "string" ? posting.hiringOrganization.name : null,
    companyUrl: typeof posting.hiringOrganization?.sameAs === "string" ? posting.hiringOrganization.sameAs : null,
    location,
    remote,
    date: typeof posting.datePosted === "string" ? posting.datePosted : null,
    validThrough: typeof posting.validThrough === "string" ? posting.validThrough : null,
    employmentType: Array.isArray(posting.employmentType)
      ? posting.employmentType.join(", ")
      : typeof posting.employmentType === "string"
        ? posting.employmentType
        : null,
    salary,
    industry: typeof posting.industry === "string" ? posting.industry : null,
    description: typeof posting.description === "string" ? htmlToText(posting.description) || null : null,
    url: `${BASE_URL}/jobs/${jobKey}`,
  }
}
