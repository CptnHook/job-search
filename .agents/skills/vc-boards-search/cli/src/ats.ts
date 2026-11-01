// Fetching an external applicant-tracking-system (ATS) posting page for
// `detail`, used when the VC board does not host the description itself.
//
// Rules: only hosts on the allowlist below are fetched, only after the host's
// robots.txt allows our UA for that path, and only with the honest UA. The
// page is parsed as data (JSON-LD JobPosting first, then meta description);
// nothing in it is followed or executed.

import { extractJsonLd, hostOf, htmlToText, httpGet, metaContent, robotsCheck } from "./helpers.js"

/** Known public ATS posting hosts. Exact names or suffixes (leading dot). */
export const KNOWN_ATS_HOSTS = [
  "boards.greenhouse.io",
  "job-boards.greenhouse.io",
  "job-boards.eu.greenhouse.io",
  "jobs.ashbyhq.com",
  "jobs.lever.co",
  "jobs.eu.lever.co",
  ".myworkdayjobs.com",
  "apply.workable.com",
  "jobs.smartrecruiters.com",
]

export function isKnownAtsHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  return KNOWN_ATS_HOSTS.some((k) => (k.startsWith(".") ? h.endsWith(k) && h.length > k.length : h === k))
}

/** Ashby's application sub-page has no description; the posting page does. */
export function normalizeAtsUrl(raw: string): string {
  const u = new URL(raw)
  if (u.hostname === "jobs.ashbyhq.com") u.pathname = u.pathname.replace(/\/application\/?$/, "")
  if (/lever\.co$/.test(u.hostname)) u.pathname = u.pathname.replace(/\/apply\/?$/, "")
  return u.toString()
}

export interface AtsResult {
  description: string | null
  source: string | null
  note: string | null
  datePosted: string | null
  employmentType: string | null
}

export function parseAtsPage(html: string): { description: string | null; datePosted: string | null; employmentType: string | null } {
  const posting = extractJsonLd(html).find((o) => {
    const t = o?.["@type"]
    return t === "JobPosting" || (Array.isArray(t) && t.includes("JobPosting"))
  })
  let description: string | null = null
  if (posting && typeof posting.description === "string" && posting.description.trim()) {
    description = htmlToText(posting.description)
  }
  if (!description) {
    const meta = metaContent(html, "og:description") ?? metaContent(html, "description")
    description = meta ? htmlToText(meta) : null
  }
  const et = posting?.employmentType
  return {
    description: description || null,
    datePosted: typeof posting?.datePosted === "string" ? posting.datePosted : null,
    employmentType: typeof et === "string" ? et : Array.isArray(et) ? et.join(", ") : null,
  }
}

export async function fetchAtsDescription(applyUrl: string): Promise<AtsResult> {
  const empty = { description: null, source: null, datePosted: null, employmentType: null }
  let url: string
  try {
    url = normalizeAtsUrl(applyUrl)
  } catch {
    return { ...empty, note: "applyUrl is not a valid URL; not fetched." }
  }
  const host = hostOf(url)
  if (!isKnownAtsHost(host)) {
    return { ...empty, note: `applyUrl host ${host} is not a known ATS host; not fetched. Open applyUrl to read the description.` }
  }
  const robots = await robotsCheck(url)
  if (!robots.allowed) return { ...empty, note: `Not fetched: ${robots.reason}. Open applyUrl to read the description.` }
  const html = await httpGet(url)
  if (!html) return { ...empty, note: `ATS page returned 404 (posting may be closed): ${url}` }
  const parsed = parseAtsPage(html)
  return {
    description: parsed.description,
    source: parsed.description ? `ats:${host}` : null,
    note: parsed.description ? null : `ATS page on ${host} carried no server-rendered description; open applyUrl.`,
    datePosted: parsed.datePosted,
    employmentType: parsed.employmentType,
  }
}
