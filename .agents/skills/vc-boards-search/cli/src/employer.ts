// Employer resolution for board rows whose organization is not the employer.
//
// Getro boards list jobs under the portfolio company's Getro organization. When
// that company was acquired, Getro keeps the old org and attaches the acquirer's
// jobs to it, so a Salesforce posting shows up as "Airkit" or "Spindle Ai
// (spindle.ai)", an Oracle posting as "OPOWER", a Visa posting as "Pismo".
// Getro's __NEXT_DATA__ has no parent/acquirer field (recon 2026-11-02: the job
// organization carries only id, name, slug, stage, headCount, logoUrl,
// industryTags, topics); the one hint is `organization.stage === "acquisition"`.
//
// So the employer is read from the posting's apply URL, conservatively:
//   1. EMPLOYER_HOSTS: an explicit host (+ optional path) -> employer map for
//      careers sites that belong to exactly one company. Always applied.
//   2. ATS tenant (Workday subdomain, Greenhouse / Ashby / Lever / SmartRecruiters
//      / Comeet board slug, iCIMS and Eightfold subdomain). If the tenant names the
//      board's org, nothing changes. Otherwise an explicit TENANT_NAMES entry wins;
//      failing that, a humanized tenant is used ONLY when the org is marked
//      acquired. Non-acquired orgs often post under an older or longer tenant
//      (SentinelOne -> "sentinellabs", Tenable -> "tenableinc"), so their name is kept.
//   3. remote.com/jobs/<employer-slug>-<id>/...: the "Remote" org on Getro is
//      Remote.com's job board, which lists other companies' jobs; the employer is
//      the slug in the path.
// When none of these applies, the board's (cleaned) name is kept.

export interface EmployerResolution {
  /** The employer to show as `company`. */
  company: string | null
  /** The board's organization name, set only when it differs from `company`. */
  portfolioCompany: string | null
}

/**
 * Careers sites owned by a single employer. `host` matches the hostname exactly or as a
 * suffix (".salesforce.com"); `path`, when given, must prefix the URL path.
 */
export const EMPLOYER_HOSTS: { host: string; path?: string; employer: string }[] = [
  { host: "salesforce.com", path: "/company/careers", employer: "Salesforce" },
  { host: "careers.salesforce.com", employer: "Salesforce" },
  { host: "careers.adobe.com", employer: "Adobe" },
  { host: "adobe.com", path: "/careers", employer: "Adobe" },
  { host: "careers.oracle.com", employer: "Oracle" },
  // Oracle's own Oracle Cloud HCM tenant ("eeho"); other companies use other tenants.
  { host: "eeho.fa.us2.oraclecloud.com", employer: "Oracle" },
  { host: "eeho.fa.us6.oraclecloud.com", employer: "Oracle" },
  { host: "careers.hpe.com", employer: "Hewlett Packard Enterprise" },
  { host: "paypal.eightfold.ai", employer: "PayPal" },
  { host: "careers.pypl.com", employer: "PayPal" },
  { host: "careers.microsoft.com", employer: "Microsoft" },
  { host: "careers.circle.com", employer: "Circle" },
  { host: "google.com", path: "/about/careers", employer: "Google" },
  { host: "careers.google.com", employer: "Google" },
  { host: "jobs.cisco.com", employer: "Cisco" },
  { host: "careers.cisco.com", employer: "Cisco" },
  { host: "careers.servicenow.com", employer: "ServiceNow" },
  { host: "careers.ibm.com", employer: "IBM" },
  { host: "amazon.jobs", employer: "Amazon" },
  { host: "metacareers.com", employer: "Meta" },
  { host: "jobs.apple.com", employer: "Apple" },
  { host: "careers.snowflake.com", employer: "Snowflake" },
  { host: "careers.datadoghq.com", employer: "Datadog" },
  { host: "jobs.intuit.com", employer: "Intuit" },
]

/** ATS tenant slug (lowercase) -> employer name, for tenants a humanizer would get wrong or that differ from the org. */
export const TENANT_NAMES: Record<string, string> = {
  salesforce: "Salesforce",
  adobe: "Adobe",
  hpe: "Hewlett Packard Enterprise",
  oracle: "Oracle",
  visa: "Visa",
  cox: "Cox Enterprises",
  paypal: "PayPal",
  pingidentity: "Ping Identity",
  sentinellabs: "SentinelOne",
  crowdstrike: "CrowdStrike",
  nvidia: "NVIDIA",
  intel: "Intel",
  cisco: "Cisco",
  workday: "Workday",
  broadcom: "Broadcom",
  dell: "Dell Technologies",
  vmware: "VMware",
  servicenow: "ServiceNow",
  snowflake: "Snowflake",
  databricks: "Databricks",
  cvent: "Cvent",
  docusign: "DocuSign",
  "6sense": "6sense",
  mastercard: "Mastercard",
  fiserv: "Fiserv",
  thomsonreuters: "Thomson Reuters",
  autodesk: "Autodesk",
  intuit: "Intuit",
  okta: "Okta",
  twilio: "Twilio",
  zendesk: "Zendesk",
  hubspot: "HubSpot",
  atlassian: "Atlassian",
}

/** Strip board-name noise: a trailing "(domain.tld)" and a " | tagline". */
export function cleanOrgName(name: string | null | undefined): string | null {
  if (!name) return null
  let s = name.replace(/\s+\|\s+.*$/, "")
  s = s.replace(/\s*\((?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+\)\s*$/i, "")
  // "Spindle Ai" -> "Spindle AI": a standalone "Ai" word is the AI acronym.
  s = s.replace(/\bAi\b/g, "AI").replace(/\s+/g, " ").trim()
  return s || null
}

const NAME_SUFFIX_RE = /(?:inc|llc|ltd|corp|hq|careers|jobs|external)$/

/** Comparable form of a company name or tenant: lowercase alphanumerics, common suffixes removed. */
export function normName(s: string): string {
  let n = s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "")
  for (let i = 0; i < 2; i++) {
    const m = n.replace(NAME_SUFFIX_RE, "")
    if (m.length >= 3) n = m
  }
  return n
}

function sameCompany(tenant: string, org: string, orgSlug?: string | null): boolean {
  const t = normName(tenant)
  if (!t) return false
  const candidates = [org, orgSlug?.replace(/-\d+$/, "") ?? ""].map(normName).filter(Boolean)
  return candidates.some((o) => o === t || (t.length >= 4 && (o.startsWith(t) || t.startsWith(o)) && o.length >= 4))
}

/** "clover-health" -> "Clover Health"; leaves mixed-case tenants ("Perplexity") alone. */
export function humanizeSlug(slug: string): string {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => (w === w.toLowerCase() ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ")
}

const UUIDISH_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-|^\d+$/i

/** The ATS tenant an apply URL names, or null. */
export function atsTenant(u: URL): string | null {
  const host = u.hostname.toLowerCase()
  const seg = u.pathname.split("/").filter(Boolean)
  let t: string | null = null
  let m: RegExpMatchArray | null
  if ((m = host.match(/^([a-z0-9-]+)\.wd\d+\.myworkday(?:jobs|site)\.com$/))) t = m[1]
  else if (/^(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io$/.test(host)) t = seg[0] === "embed" ? u.searchParams.get("for") : (seg[0] ?? null)
  else if (host === "jobs.ashbyhq.com" || host === "jobs.lever.co" || host === "jobs.eu.lever.co") t = seg[0] ?? null
  else if (host === "jobs.smartrecruiters.com" || host === "careers.smartrecruiters.com") t = seg[0] ?? null
  else if (host === "www.comeet.com" || host === "comeet.com") t = seg[0] === "jobs" ? (seg[1] ?? null) : null
  else if ((m = host.match(/^(?:[a-z]+-)?([a-z0-9]+)\.icims\.com$/))) t = m[1]
  else if ((m = host.match(/^([a-z0-9-]+)\.eightfold\.ai$/))) t = m[1]
  if (!t) return null
  t = decodeURIComponent(t)
  if (UUIDISH_RE.test(t) || t.length < 2) return null
  return t
}

function hostRule(u: URL): string | null {
  const host = u.hostname.toLowerCase().replace(/^www\./, "")
  const path = u.pathname.toLowerCase()
  for (const r of EMPLOYER_HOSTS) {
    if ((host === r.host || host.endsWith(`.${r.host}`)) && (!r.path || path.startsWith(r.path))) return r.employer
  }
  return null
}

/** remote.com/jobs/<employer-slug>-<8-char id>/<job-slug>: Remote.com's job board listing other companies. */
function remoteComEmployer(u: URL): string | null {
  if (!/^(?:www\.)?remote\.com$/i.test(u.hostname)) return null
  const m = u.pathname.match(/^\/jobs\/([a-z0-9-]+)-c[a-z0-9]{6,10}\//i)
  return m ? humanizeSlug(m[1]) : null
}

export interface ResolveOpts {
  /** The board marks the org as acquired (Getro `organization.stage === "acquisition"`). */
  acquired?: boolean
  orgSlug?: string | null
}

export function resolveEmployer(orgName: string | null, applyUrl: string | null, opts: ResolveOpts = {}): EmployerResolution {
  const org = cleanOrgName(orgName)
  const keep: EmployerResolution = { company: org, portfolioCompany: null }
  if (!applyUrl) return keep
  let u: URL
  try {
    u = new URL(applyUrl)
  } catch {
    return keep
  }
  const pick = (employer: string | null): EmployerResolution | null => {
    if (!employer) return null
    if (org && normName(employer) === normName(org)) return keep
    return { company: employer, portfolioCompany: org }
  }

  const byHost = pick(hostRule(u)) ?? pick(remoteComEmployer(u))
  if (byHost) return byHost

  const tenant = atsTenant(u)
  if (!tenant) return keep
  if (org && sameCompany(tenant, org, opts.orgSlug)) return keep
  const mapped = TENANT_NAMES[tenant.toLowerCase()]
  if (mapped) return pick(mapped) ?? keep
  if (opts.acquired || !org) return pick(humanizeSlug(tenant)) ?? keep
  return keep
}
