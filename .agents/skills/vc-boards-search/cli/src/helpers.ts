// Shared plumbing for vc-boards-cli: honest fetch with backoff, error writer,
// HTML/entity helpers, embedded-JSON extraction (Next.js __NEXT_DATA__ and
// React Server Component "flight" payloads), the executive-title filter, the
// location filter, and a minimal robots.txt check used before fetching an
// external ATS page in `detail`.
//
// Zero runtime dependencies: plain bun + fetch + regex/scan parsing.
//
// Everything fetched here is third-party, untrusted content. It is parsed as
// data and printed as data; nothing in it is ever interpreted as instructions.

export const UA = "Mozilla/5.0 (compatible; vc-boards-cli/1.0)"
/** Product token matched against robots.txt `User-agent:` lines. */
export const UA_TOKEN = "vc-boards-cli"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

export interface FetchOpts {
  accept?: string
  timeoutMs?: number
  maxRetries?: number
  /** Base delay for backoff; tests shrink it. */
  baseDelayMs?: number
}

/**
 * GET a URL with the honest UA, retrying 429/5xx with exponential backoff and
 * jitter (max ~6 retries). Returns "" on 404 / 410 instead of throwing.
 */
export async function httpGet(url: string, opts: FetchOpts = {}): Promise<string> {
  const maxRetries = opts.maxRetries ?? 6
  let delay = opts.baseDelayMs ?? 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: opts.accept ?? "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(opts.timeoutMs ?? 20000),
    })
    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new Error(`Request failed: ${response.status} ${response.statusText} (${hostOf(url)})`)
      }
      const retryAfter = Number(response.headers.get("retry-after"))
      const jitter = Math.floor(Math.random() * 500)
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 15000) : delay + jitter
      await new Promise((r) => setTimeout(r, wait))
      delay = Math.min(delay * 2, 8000)
      continue
    }
    if (response.status === 404 || response.status === 410) return ""
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} ${response.statusText} (${hostOf(url)})`)
    }
    return response.text()
  }
  throw new Error("Request failed after max retries")
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

// ---------------------------------------------------------------------------
// HTML / text
// ---------------------------------------------------------------------------

function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, dec) => numericEntity(parseInt(dec, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, hex) => numericEntity(parseInt(hex, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&rsquo;|&lsquo;/g, "'")
    .replace(/&rdquo;|&ldquo;/g, '"')
    .replace(/&ndash;/g, "–")
    .replace(/&mdash;/g, "—")
    .replace(/&bull;/g, "•")
    .replace(/&amp;/g, "&")
}

/**
 * Convert an HTML fragment to readable plain text: block-level closers and
 * <br> become newlines, list items get a bullet, tags are stripped, entities
 * decoded, control characters dropped, blank lines collapsed.
 */
export function htmlToText(html: string): string {
  // Some sources (Greenhouse JSON-LD) double-encode the markup.
  let s = /&lt;\/?[a-z]/i.test(html) && !/<\/?[a-z][^>]*>/i.test(html) ? decodeHtmlEntities(html) : html
  s = s
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<\/(p|li|ul|ol|div|h\d|tr|section|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
  s = decodeHtmlEntities(s)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
  return s.trim()
}

/** Collapse whitespace in a short field (title, company). */
export function cleanText(s: unknown): string | null {
  if (typeof s !== "string") return null
  const t = decodeHtmlEntities(s).replace(/\s+/g, " ").trim()
  return t || null
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

// ---------------------------------------------------------------------------
// Embedded JSON extraction
// ---------------------------------------------------------------------------

/**
 * Return the JSON value (object or array) that starts at `start` in `s`, by
 * scanning for the balanced closing bracket while respecting string literals,
 * then JSON.parse-ing just that slice. Returns undefined if unbalanced/invalid.
 */
export function decodeJsonAt(s: string, start: number): unknown {
  const open = s[start]
  if (open !== "{" && open !== "[") return undefined
  let depth = 0
  let inStr = false
  for (let i = start; i < s.length; i++) {
    const c = s[i]
    if (inStr) {
      if (c === "\\") i++
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === "{" || c === "[") depth++
    else if (c === "}" || c === "]") {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(s.slice(start, i + 1))
        } catch {
          return undefined
        }
      }
    }
  }
  return undefined
}

/** Parse a Next.js pages-router `<script id="__NEXT_DATA__">` blob. */
export function extractNextData(html: string): any | null {
  const m = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i)
  if (!m) return null
  try {
    return JSON.parse(m[1])
  } catch {
    return null
  }
}

/**
 * Concatenate the string payloads of a Next.js app-router page's
 * `self.__next_f.push([1,"..."])` scripts (the RSC flight stream). Each push
 * is parsed on its own, so one malformed chunk cannot break the rest.
 */
export function extractFlight(html: string): string {
  const re = /self\.__next_f\.push\((\[[\s\S]*?\])\)<\/script>/g
  let out = ""
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    try {
      const arr = JSON.parse(m[1])
      if (Array.isArray(arr) && typeof arr[1] === "string") out += arr[1]
    } catch {
      /* skip malformed chunk */
    }
  }
  return out
}

/** Every JSON object in `s` that begins with the literal `prefix` (e.g. `{"jobs":[`). */
export function findJsonObjects(s: string, prefix: string): any[] {
  const found: any[] = []
  let i = s.indexOf(prefix)
  while (i !== -1) {
    const v = decodeJsonAt(s, i)
    if (v && typeof v === "object") found.push(v)
    i = s.indexOf(prefix, i + prefix.length)
  }
  return found
}

/** The JSON value following `"key":` (first occurrence), or undefined. */
export function findJsonValueAfterKey(s: string, key: string): unknown {
  const marker = `"${key}":`
  const i = s.indexOf(marker)
  if (i === -1) return undefined
  return decodeJsonAt(s, i + marker.length)
}

export function extractJsonLd(html: string): any[] {
  const out: any[] = []
  const re = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    try {
      const v = JSON.parse(m[1].trim())
      if (Array.isArray(v)) out.push(...v)
      else if (v && Array.isArray(v["@graph"])) out.push(...v["@graph"])
      else out.push(v)
    } catch {
      /* ignore */
    }
  }
  return out
}

export function metaContent(html: string, name: string): string | null {
  const re = new RegExp(
    `<meta[^>]*(?:name|property)="${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*content="([^"]*)"`,
    "i",
  )
  const m = html.match(re)
  return m ? decodeHtmlEntities(m[1]) : null
}

// ---------------------------------------------------------------------------
// Seniority (executive) filter
// ---------------------------------------------------------------------------

/**
 * Executive-level title test. Matches VP / Vice President / SVP / EVP,
 * Head of, Chief ..., C-level acronyms (CEO, COO, CTO, CIO, CAIO, ...),
 * President, Director / Senior Director, General Manager / GM.
 * Excludes assistant/EA/coordinator titles and "Associate Director" and bare
 * "AVP" (assistant VP), which sit below the target level.
 */
const EXEC_RE =
  /\b(?:S?VP|EVP|Vice[\s-]+President|President|Head\s+of|Chief|C(?:EO|OO|FO|TO|IO|MO|PO|RO|CO|SO|DO|AO|HRO|ISO|AIO|XO)|Director|General\s+Manager|GM)\b/i
const EXEC_EXCLUDE_RE =
  /\b(?:Assistant|Executive\s+Assistant|EA\b|Coordinator|Associate\s+Director|AVP|Intern|Internship)\b/i

export function isExecTitle(title: string | null | undefined): boolean {
  if (!title) return false
  if (EXEC_EXCLUDE_RE.test(title)) return false
  return EXEC_RE.test(title)
}

/** True when a query already names an executive level (so the title text, not a board tag, carries it). */
export function queryNamesSeniority(q: string | undefined): boolean {
  return !!q && EXEC_RE.test(q)
}

// ---------------------------------------------------------------------------
// Location filter
// ---------------------------------------------------------------------------

/** SF Bay Area / Peninsula / South Bay / East Bay place names. */
export const BAY_AREA_PLACES = [
  "San Francisco", "South San Francisco", "Bay Area", "SF Bay", "Oakland", "Berkeley", "Emeryville",
  "Alameda", "San Leandro", "Hayward", "Fremont", "Newark, CA", "Union City", "Pleasanton", "Dublin, CA",
  "Livermore", "San Ramon", "Walnut Creek", "Concord, CA", "Richmond, CA", "San Jose", "Santa Clara",
  "Sunnyvale", "Mountain View", "Palo Alto", "Menlo Park", "Redwood City", "Redwood Shores", "San Mateo",
  "Foster City", "Burlingame", "San Bruno", "Millbrae", "Belmont", "San Carlos", "Pacifica", "Daly City",
  "Brisbane, CA", "Cupertino", "Milpitas", "Los Gatos", "Campbell", "Los Altos", "Saratoga", "Half Moon Bay",
  "Sausalito", "San Rafael", "Novato", "Mill Valley", "Larkspur", "Silicon Valley", "Peninsula",
]

export type LocationTerm = { kind: "bay-area" } | { kind: "remote" } | { kind: "text"; text: string }

/** Parse `--location` (comma or pipe separated) into terms. `bay-area`/`sf-bay-area` and `remote` are presets. */
export function parseLocationTerms(raw: string | undefined): LocationTerm[] {
  if (!raw) return []
  return raw
    .split(/[|;]|,(?![^()]*\))/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t): LocationTerm => {
      const k = t.toLowerCase().replace(/[\s_]+/g, "-")
      if (["bay-area", "sf-bay-area", "san-francisco-bay-area", "sfba"].includes(k)) return { kind: "bay-area" }
      if (["remote", "remote-us", "us-remote", "remote-usa"].includes(k)) return { kind: "remote" }
      return { kind: "text", text: t }
    })
}

const BAY_RE = new RegExp(
  `\\b(?:${BAY_AREA_PLACES.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")).join("|")})\\b`,
  "i",
)

export function matchesLocation(
  terms: LocationTerm[],
  job: { location: string | null; remote: boolean | null },
): boolean {
  if (terms.length === 0) return true
  const loc = job.location ?? ""
  return terms.some((t) => {
    if (t.kind === "bay-area") return BAY_RE.test(loc)
    if (t.kind === "remote") return job.remote === true || /\bremote\b/i.test(loc)
    return loc.toLowerCase().includes(t.text.toLowerCase())
  })
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** Normalise a unix-seconds / unix-ms / ISO value to an ISO-8601 string, or null. */
export function toIsoDate(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) {
    const ms = v < 1e12 ? v * 1000 : v
    return new Date(ms).toISOString()
  }
  if (typeof v === "string" && v.trim()) {
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }
  return null
}

export function withinDays(iso: string | null, days: number | undefined, now = Date.now()): boolean {
  if (!days) return true
  if (!iso) return false
  const t = new Date(iso).getTime()
  return Number.isFinite(t) && now - t <= days * 86400000
}

// ---------------------------------------------------------------------------
// robots.txt
// ---------------------------------------------------------------------------

interface RobotsGroup {
  agents: string[]
  rules: { allow: boolean; path: string }[]
}

export function parseRobots(txt: string): RobotsGroup[] {
  const groups: RobotsGroup[] = []
  let cur: RobotsGroup | null = null
  let lastWasAgent = false
  for (const rawLine of txt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim()
    if (!line) continue
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/)
    if (!m) continue
    const field = m[1].toLowerCase()
    const value = m[2].trim()
    if (field === "user-agent") {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], rules: [] }
        groups.push(cur)
      }
      cur.agents.push(value.toLowerCase())
      lastWasAgent = true
    } else {
      lastWasAgent = false
      if (!cur) continue
      if (field === "allow" || field === "disallow") {
        // An empty Disallow means "allow everything" and adds no rule.
        if (value) cur.rules.push({ allow: field === "allow", path: value })
      }
    }
  }
  return groups
}

function ruleMatches(rulePath: string, path: string): number {
  // Supports * wildcards and a trailing $ anchor. Returns match length or -1.
  const anchored = rulePath.endsWith("$")
  const body = anchored ? rulePath.slice(0, -1) : rulePath
  const re = new RegExp(
    "^" + body.split("*").map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + (anchored ? "$" : ""),
  )
  return re.test(path) ? body.length : -1
}

/** Is `pathWithQuery` allowed for our UA token under these robots rules? (longest match wins; ties go to Allow) */
export function robotsAllows(txt: string, pathWithQuery: string, token = UA_TOKEN): boolean {
  const groups = parseRobots(txt)
  const t = token.toLowerCase()
  let group = groups.find((g) => g.agents.some((a) => a !== "*" && t.includes(a)))
  if (!group) group = groups.find((g) => g.agents.includes("*"))
  if (!group) return true
  let best = -1
  let allowed = true
  for (const r of group.rules) {
    const len = ruleMatches(r.path, pathWithQuery)
    if (len > best || (len === best && r.allow)) {
      if (len >= 0) {
        best = len
        allowed = r.allow
      }
    }
  }
  return allowed
}

/** Fetch robots.txt for a URL's origin and check it. Missing robots (404) = allowed; fetch errors = not allowed. */
export async function robotsCheck(url: string): Promise<{ allowed: boolean; reason?: string }> {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return { allowed: false, reason: "invalid URL" }
  }
  try {
    const txt = await httpGet(`${u.origin}/robots.txt`, { accept: "text/plain,*/*", maxRetries: 2, timeoutMs: 10000 })
    if (!txt) return { allowed: true }
    const ok = robotsAllows(txt, u.pathname + u.search)
    return ok ? { allowed: true } : { allowed: false, reason: `robots.txt on ${u.hostname} disallows ${u.pathname}` }
  } catch (e) {
    return { allowed: false, reason: `could not read robots.txt on ${u.hostname}: ${e instanceof Error ? e.message : e}` }
  }
}
