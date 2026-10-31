import {
  BASE_URL,
  FetchError,
  buildSearchUrl,
  extractNextData,
  isExecTitle,
  locationSlugFor,
  pageFetch,
  parseSearchPage,
  roleSlugFor,
  slugify,
  withinDays,
  writeError,
  type JobCard,
} from "../helpers.js"
import { ROLE_SLUGS } from "../roles.js"

export interface SearchOpts {
  query?: string
  role?: string
  location?: string
  remote?: boolean
  seniority?: "exec"
  jobage?: number
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const header = `${"TITLE".padEnd(44)} ${"COMPANY".padEnd(22)} ${"LOCATION".padEnd(22)} ${"SALARY".padEnd(16)} ${"DATE".padEnd(10)} ID`
  const rows = cards.map((c) => {
    const title = c.title.slice(0, 44).padEnd(44)
    const company = (c.company || "—").slice(0, 22).padEnd(22)
    const loc = (c.location || "—").slice(0, 22).padEnd(22)
    const sal = (c.salary?.text || "—").slice(0, 16).padEnd(16)
    return `${title} ${company} ${loc} ${sal} ${(c.date ? c.date.slice(0, 10) : "—").padEnd(10)} ${c.id}`
  })
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

function renderPlain(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  return cards
    .map((c) => {
      const extra = [c.salary?.text, c.equity, c.companySize ? `${c.companySize} employees` : null].filter(Boolean).join(" · ")
      return `${c.title}\n  ${c.company || "—"} · ${c.location || "—"} · ${c.date ? c.date.slice(0, 10) : "—"}${extra ? `\n  ${extra}` : ""}\n  id: ${c.id}\n  ${c.url}`
    })
    .join("\n\n")
}

/** "New York City" matches a listing in "New York" and vice versa. */
export function matchesCity(location: string | null, city: string): boolean {
  const want = city.toLowerCase().trim()
  return (location || "")
    .toLowerCase()
    .replace(/\(remote ok\)/g, "")
    .split(",")
    .map((n) => n.trim())
    .some((n) => n && (n.includes(want) || want.includes(n)))
}

function suggestions(query: string): string[] {
  const words = slugify(query).split("-").filter((w) => w.length > 2 && w !== "of")
  return ROLE_SLUGS.filter((s) => words.some((w) => s.split("-").includes(w))).slice(0, 12)
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const warnings: string[] = []
    const locationRaw = opts.location?.trim() || undefined
    const remote = opts.remote === true || (locationRaw ? /^remote$/i.test(locationRaw) : false)
    const location = locationRaw && !/^remote$/i.test(locationRaw) ? locationSlugFor(locationRaw) : null

    let role: string | null = opts.role ? slugify(opts.role) : null
    let titleKeywords: string[] = []
    if (!role && opts.query) {
      role = roleSlugFor(opts.query)
      if (!role) {
        if (!location) {
          writeError(
            `"${opts.query}" does not match a Wellfound role page. Pass --location to search a city page with a client-side title filter, or pick a slug with --role. Close slugs: ${suggestions(opts.query).join(", ") || "(none)"}`,
            "NO_ROLE_MATCH",
          )
          return 1
        }
        titleKeywords = slugify(opts.query).split("-").filter((w) => w && w !== "of")
        warnings.push(
          `"${opts.query}" matches no Wellfound role slug; searched the location page and kept titles containing: ${titleKeywords.join(", ")}`,
        )
      }
    }
    if (remote && !role) {
      writeError("remote search needs a role (--query matching a role, or --role <slug>)", "NO_QUERY")
      return 1
    }
    if (role && !ROLE_SLUGS.includes(role)) {
      warnings.push(`role slug "${role}" is not in the built-in list; trying it anyway`)
    }

    let plan = buildSearchUrl(role, remote ? null : location, remote, opts.page)
    let page = await pageFetch(plan.url)
    let locationFilter: string | null = null

    if (page.redirect) {
      const target = new URL(page.redirect)
      const requested = new URL(plan.url)
      if (target.host !== new URL(BASE_URL).host || /\/(auth|login|join|signup)/i.test(target.pathname)) {
        writeError(`Wellfound redirected to ${page.redirect} (login or off-site). Login-gated listings are out of scope for this CLI.`, "LOGIN_REQUIRED")
        return 1
      }
      if (target.pathname === requested.pathname) {
        // Page past the end: Wellfound sends you back to page 1.
        return emit(opts, [], { pageCount: null, totalJobCount: null, source: plan.url, role, location, warnings: [...warnings, `page ${opts.page} is past the last page`] })
      }
      if (plan.kind === "roleLocation" && role && target.pathname === `/role/${role}`) {
        // Wellfound has no role+city page for this city; fall back to the
        // all-locations role page and filter by city name client-side.
        locationFilter = locationRaw!.split(",")[0].trim().toLowerCase()
        warnings.push(
          `Wellfound has no /role/l/${role}/${location} page (redirected to /role/${role}); filtered that page's results to locations containing "${locationFilter}"`,
        )
        plan = buildSearchUrl(role, null, false, opts.page)
        page = await pageFetch(plan.url)
        if (page.redirect) {
          return emit(opts, [], { pageCount: null, totalJobCount: null, source: plan.url, role, location, warnings: [...warnings, `page ${opts.page} is past the last page`] })
        }
      } else {
        writeError(`Unexpected redirect from ${plan.url} to ${page.redirect}`, "UNEXPECTED_REDIRECT")
        return 1
      }
    }

    if (!page.html) {
      writeError(
        `Wellfound has no page at ${plan.url} (404). Check the role slug (--role) or the location (city slug such as "san-francisco", "new-york").`,
        "NOT_FOUND",
      )
      return 1
    }
    const next = extractNextData(page.html)
    if (!next) {
      writeError("Could not find __NEXT_DATA__ in the page; Wellfound's markup may have changed (see url-reference.md)", "PARSE_FAILED")
      return 1
    }
    const parsed = parseSearchPage(next)
    let cards = parsed.results
    if (locationFilter) cards = cards.filter((c) => matchesCity(c.location, locationFilter!))
    if (titleKeywords.length) cards = cards.filter((c) => titleKeywords.every((w) => c.title.toLowerCase().includes(w)))
    if (opts.seniority === "exec") cards = cards.filter((c) => isExecTitle(c.title))
    if (opts.jobage !== undefined) cards = cards.filter((c) => withinDays(c.date, opts.jobage!))
    if (opts.limit !== undefined) cards = cards.slice(0, opts.limit)

    return emit(opts, cards, {
      pageCount: parsed.pageCount,
      totalJobCount: parsed.totalJobCount,
      source: plan.url,
      role,
      location: remote ? "remote" : location,
      warnings,
    })
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), e instanceof FetchError ? e.code : "SEARCH_FAILED")
    return 1
  }
}

interface MetaExtra {
  pageCount: number | null
  totalJobCount: number | null
  source: string
  role: string | null
  location: string | null
  warnings: string[]
}

function emit(opts: SearchOpts, cards: JobCard[], m: MetaExtra): number {
  if (opts.format === "table") {
    process.stdout.write(renderTable(cards) + "\n")
    for (const w of m.warnings) process.stderr.write(`note: ${w}\n`)
  } else if (opts.format === "plain") {
    process.stdout.write(renderPlain(cards) + "\n")
    for (const w of m.warnings) process.stderr.write(`note: ${w}\n`)
  } else {
    const meta = {
      count: cards.length,
      page: opts.page,
      pageCount: m.pageCount,
      totalJobCount: m.totalJobCount,
      role: m.role,
      location: m.location,
      seniority: opts.seniority ?? null,
      jobage: opts.jobage ?? null,
      source: m.source,
      warnings: m.warnings,
    }
    process.stdout.write(JSON.stringify({ meta, results: cards }, null, 2) + "\n")
  }
  return 0
}
