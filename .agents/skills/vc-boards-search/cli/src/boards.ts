// The one place VC portfolio job boards are configured. To add a firm, add an
// entry here: pick its platform (see url-reference.md for how to recognise
// one), its board origin, and a short CLI name. Platforms that cannot be
// read under the data-access rules are kept here as `enabled: false` with the
// reason, so `--board <name>` explains itself instead of failing silently.

export type Platform = "getro" | "a16z" | "greylock" | "consider" | "index"

export interface BoardConfig {
  /** CLI name used with --board and in each result's `board` field. */
  name: string
  firm: string
  platform: Platform
  /** Board origin (Getro/Consider) or full board URL (custom boards). */
  base: string
  enabled: boolean
  /** Why a board is disabled (shown on --board <name> and in `boards`). */
  skipReason?: string
  aliases?: string[]
  /** Extra hostnames that serve or redirect to this board (for `detail <url>`). */
  hosts?: string[]
}

const CONSIDER_SKIP =
  "Consider-powered board: the page is client-rendered (no jobs in the HTML) and its /api-boards/search-jobs endpoint " +
  "rejects requests without a CSRF token copied from page source (HTTP 412 INVALID_CSRF), which the data-access rules forbid."

export const BOARDS: BoardConfig[] = [
  // --- Getro (Next.js pages router; jobs in __NEXT_DATA__) ---
  { name: "accel", firm: "Accel", platform: "getro", base: "https://jobs.accel.com", enabled: true },
  {
    name: "general-catalyst",
    firm: "General Catalyst",
    platform: "getro",
    base: "https://jobs.generalcatalyst.com",
    enabled: true,
    aliases: ["gc", "generalcatalyst"],
  },
  {
    name: "insight",
    firm: "Insight Partners",
    platform: "getro",
    base: "https://jobs.insightpartners.com",
    enabled: true,
    aliases: ["insight-partners"],
  },
  { name: "redpoint", firm: "Redpoint Ventures", platform: "getro", base: "https://careers.redpoint.com", enabled: true },
  {
    name: "khosla",
    firm: "Khosla Ventures",
    platform: "getro",
    base: "https://jobs.khoslaventures.com",
    enabled: true,
    aliases: ["khosla-ventures"],
  },

  // --- Custom boards ---
  {
    name: "a16z",
    firm: "Andreessen Horowitz",
    platform: "a16z",
    base: "https://jobs.a16z.com",
    enabled: true,
    aliases: ["andreessen", "andreessen-horowitz"],
  },
  {
    name: "greylock",
    firm: "Greylock",
    platform: "greylock",
    base: "https://greylock.com/jobs/portfolio-jobs/",
    enabled: true,
    hosts: ["jobs.greylock.com"],
  },

  // --- Present but not readable under the rules ---
  { name: "sequoia", firm: "Sequoia Capital", platform: "consider", base: "https://jobs.sequoiacap.com", enabled: false, skipReason: CONSIDER_SKIP },
  {
    name: "lightspeed",
    firm: "Lightspeed Venture Partners",
    platform: "consider",
    base: "https://jobs.lsvp.com",
    enabled: false,
    skipReason: CONSIDER_SKIP,
    aliases: ["lsvp"],
  },
  {
    name: "kleiner",
    firm: "Kleiner Perkins",
    platform: "consider",
    base: "https://jobs.kleinerperkins.com",
    enabled: false,
    skipReason: CONSIDER_SKIP,
    aliases: ["kleiner-perkins", "kp"],
  },
  {
    name: "bessemer",
    firm: "Bessemer Venture Partners",
    platform: "consider",
    base: "https://jobs.bvp.com",
    enabled: false,
    skipReason: CONSIDER_SKIP,
    aliases: ["bvp"],
  },
  {
    name: "index",
    firm: "Index Ventures",
    platform: "index",
    base: "https://www.indexventures.com/startup-jobs",
    enabled: false,
    skipReason:
      "Index Ventures' board is a client-side Vue app that queries an Elasticsearch cluster using basic-auth credentials " +
      "embedded in the page source; using them is forbidden by the data-access rules, and the HTML carries no job data.",
    aliases: ["index-ventures"],
  },
]

export function findBoard(name: string): BoardConfig | undefined {
  const k = name.trim().toLowerCase()
  return BOARDS.find((b) => b.name === k || (b.aliases ?? []).includes(k))
}

export function boardHosts(b: BoardConfig): string[] {
  return [new URL(b.base).hostname, ...(b.hosts ?? [])]
}

/** Board whose origin serves this URL's host, if any. */
export function boardForHost(hostname: string): BoardConfig | undefined {
  const h = hostname.toLowerCase().replace(/^www\./, "")
  return BOARDS.find((b) => boardHosts(b).some((bh) => bh.replace(/^www\./, "") === h))
}
