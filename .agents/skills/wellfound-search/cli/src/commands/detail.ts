import { FetchError, BASE_URL, pageFetch, parseJobDetail, writeError } from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

const WELLFOUND_HOST = /^(www\.)?wellfound\.com$/i

/**
 * Accept the `id` from search results ("4897467-staff-database-reliability-engineer")
 * or a wellfound.com/jobs/<id>-<slug> URL. A bare numeric ID is rejected because
 * Wellfound 404s /jobs/<id> without its slug. URLs on other hosts are rejected.
 */
export function normalizeJobKey(input: string): string | null {
  const trimmed = input.trim()
  if (/^\d+-[a-z0-9-]+$/i.test(trimmed)) return trimmed.toLowerCase()
  const hasScheme = /^https?:\/\//i.test(trimmed)
  if (hasScheme || /^[a-z0-9.-]+\.[a-z]{2,}\//i.test(trimmed)) {
    let parsed: URL
    try {
      parsed = new URL(hasScheme ? trimmed : `https://${trimmed}`)
    } catch {
      return null
    }
    if (!WELLFOUND_HOST.test(parsed.hostname)) return null
    const m = parsed.pathname.match(/^\/jobs\/(\d+-[a-z0-9-]+)\/?$/i)
    return m ? m[1].toLowerCase() : null
  }
  return null
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const key = normalizeJobKey(opts.id)
  if (!key) {
    const hint = /^\d+$/.test(opts.id.trim())
      ? " Wellfound needs the slug too: pass the full `id` from search results (e.g. 4897467-staff-database-reliability-engineer) or the job URL."
      : ""
    writeError(`Could not parse a Wellfound job id from "${opts.id}".${hint}`, "BAD_ID")
    return 1
  }
  try {
    const res = await pageFetch(`${BASE_URL}/jobs/${key}`)
    if (res.redirect) {
      writeError(`Job page redirected to ${res.redirect}; the posting may be closed or its slug changed`, "REDIRECTED")
      return 1
    }
    if (!res.html) {
      writeError("Job not found (it may be closed, or the slug is wrong)", "NOT_FOUND")
      return 1
    }
    const job = parseJobDetail(res.html, key)
    if (!job) {
      writeError("No JobPosting JSON-LD on the job page; Wellfound's markup may have changed", "PARSE_FAILED")
      return 1
    }
    if (opts.format === "plain") {
      const lines = [
        job.title,
        `${job.company || "—"} · ${job.location || "—"}`,
        "",
        job.salary ? `Salary: ${job.salary.text}` : "",
        job.employmentType ? `Employment: ${job.employmentType}` : "",
        job.date ? `Posted: ${job.date}` : "",
        job.validThrough ? `Valid through: ${job.validThrough}` : "",
        job.industry ? `Industry: ${job.industry}` : "",
        job.companyUrl ? `Company site: ${job.companyUrl}` : "",
        "",
        job.description || "(no description)",
        "",
        `URL: ${job.url}`,
      ].filter((l, i, a) => l !== "" || (i > 0 && a[i - 1] !== ""))
      process.stdout.write(lines.join("\n") + "\n")
    } else {
      process.stdout.write(JSON.stringify(job, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), e instanceof FetchError ? e.code : "DETAIL_FAILED")
    return 1
  }
}
