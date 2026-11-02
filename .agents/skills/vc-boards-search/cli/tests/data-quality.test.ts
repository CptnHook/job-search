// Offline fixture tests for two data-quality fixes:
//  1. employer resolution for acquired Getro portfolio orgs (company = employer,
//     portfolioCompany = the board's org), including cross-name dedupe;
//  2. the `remote` location preset keeping only US / country-unspecified remote jobs.
// Fixtures are shaped like live Getro __NEXT_DATA__ jobs recorded 2026-11-02.
import { describe, expect, test } from "bun:test"
import { findBoard } from "../src/boards"
import { applyClientFilters, mergeJobs } from "../src/commands/search"
import { atsTenant, cleanOrgName, resolveEmployer } from "../src/employer"
import { isUsOrUnspecifiedLocation, matchesLocation, parseLocationTerms, serverLocationKind } from "../src/helpers"
import { buildA16zUrl } from "../src/platforms/a16z"
import { buildGetroUrl, parseGetroSearch } from "../src/platforms/getro"
import type { Job } from "../src/platforms/types"

const accel = findBoard("accel")!
const gc = findBoard("general-catalyst")!

const org = (name: string, slug: string, stage: string) => ({ id: 1, name, slug, stage, headCount: 1, industryTags: [], topics: [] })

function getroHtml(found: unknown[]): string {
  const nd = { props: { pageProps: { initialState: { jobs: { total: found.length, found } } } } }
  return `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nd)}</script></html>`
}

const SF_VP = "https://www.salesforce.com/company/careers/jobs/JR363278/vice-president-customer-success-ai-labs/"
const found = [
  {
    id: 101, title: "Vice President, Customer Success - AI Labs", slug: "101-vp-cs",
    organization: org("Airkit", "airkit-2", "acquisition"),
    locations: ["San Francisco, CA, USA"], createdAt: 1793364124, url: SF_VP, workMode: "on_site", seniority: "vice_president",
  },
  {
    id: 102, title: "Vice President, Customer Success - AI Labs", slug: "102-vp-cs",
    organization: org("Spindle Ai (spindle.ai)", "spindle-ai-spindle-ai-2", "acquisition"),
    locations: ["San Francisco, CA, USA"], createdAt: 1793364124, url: SF_VP, workMode: "on_site", seniority: "vice_president",
  },
  {
    id: 103, title: "Director, Strategy & Business Operations", slug: "103-dir",
    organization: org("Pismo", "pismo", "acquisition"),
    locations: ["San Francisco, CA, USA", "Foster City, CA, USA"], createdAt: 1793300000,
    url: "https://visa.wd5.myworkdayjobs.com/Visa/job/US---Foster-City-CA/Director--Strategy---Business-Operations_REF1", workMode: "on_site",
  },
  {
    id: 104, title: "Senior Director, F&I", slug: "104-sd",
    organization: org("Dealer.com", "dealer-com", "acquisition"),
    locations: ["United States", "Remote"], createdAt: 1793200000,
    url: "https://cox.wd1.myworkdayjobs.com/Cox_External_Career_Site_1/job/REMOTE---USA/Senior-Director_R1", workMode: "remote",
  },
  {
    id: 105, title: "VP, Technical Programs", slug: "105-vp",
    organization: org("OPOWER", "opower-2", "acquisition"),
    locations: ["United States"], createdAt: 1793100000,
    url: "https://eeho.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/jobearch/jobs/349125", workMode: "on_site",
  },
  {
    id: 106, title: "Director, Customer Success", slug: "106-dir",
    organization: org("Forgerock", "forgerock", "acquisition"),
    locations: ["United States", "Remote"], createdAt: 1793000000,
    url: "https://job-boards.greenhouse.io/pingidentity/jobs/8912223002", workMode: "remote",
  },
  {
    // Non-acquired org whose Greenhouse tenant differs from its name: keep the board's name.
    id: 107, title: "VP, Customer Success", slug: "107-vp",
    organization: org("Tenable", "tenable", "ipo"),
    locations: ["Maryland, USA", "Remote"], createdAt: 1792900000,
    url: "https://boards.greenhouse.io/tenableinc/jobs/5467527008", workMode: "remote",
  },
  {
    // Acquired org that still posts under its own name.
    id: 108, title: "Director of Sales, East", slug: "108-dir",
    organization: org("Checkmarx", "checkmarx", "acquisition"),
    locations: ["New York, NY, USA"], createdAt: 1792800000,
    url: "https://www.comeet.com/jobs/checkmarx/C0.008/director-of-sales---east/46.474", workMode: "on_site",
  },
  {
    // Getro's "Remote" org is Remote.com's job board listing other employers.
    id: 109, title: "Vice President, Operations", slug: "109-vp",
    organization: org("Remote", "remote", "series_c"),
    locations: [], createdAt: 1792700000,
    url: "https://remote.com/jobs/clover-health-c15nkz2c/vice-president-operations-j17asmwc", workMode: "on_site",
  },
  {
    // Acquired org, unmapped tenant: humanized tenant name.
    id: 110, title: "Head of Revenue Operations", slug: "110-head",
    organization: org("Slintel, a 6sense Company", "slintel", "acquisition"),
    locations: ["United States", "Remote"], createdAt: 1792600000,
    url: "https://boards.greenhouse.io/acme-holdings/jobs/1", workMode: "remote",
  },
]

describe("employer resolution (Getro acquired orgs)", () => {
  const { jobs } = parseGetroSearch(accel, getroHtml(found))
  const by = (id: number) => jobs.find((j) => j.id.endsWith(`/${id}`))!

  test("Salesforce careers URL: Airkit and Spindle AI rows say Salesforce", () => {
    expect(by(101)).toMatchObject({ company: "Salesforce", portfolioCompany: "Airkit" })
    expect(by(102)).toMatchObject({ company: "Salesforce", portfolioCompany: "Spindle AI" })
  })
  test("Workday tenants map to the employer", () => {
    expect(by(103)).toMatchObject({ company: "Visa", portfolioCompany: "Pismo" })
    expect(by(104)).toMatchObject({ company: "Cox Enterprises", portfolioCompany: "Dealer.com" })
  })
  test("Oracle's own Oracle Cloud HCM tenant", () => expect(by(105)).toMatchObject({ company: "Oracle", portfolioCompany: "OPOWER" }))
  test("Greenhouse tenant: Forgerock posting is Ping Identity", () =>
    expect(by(106)).toMatchObject({ company: "Ping Identity", portfolioCompany: "Forgerock" }))
  test("non-acquired org with a different tenant keeps its name", () =>
    expect(by(107)).toMatchObject({ company: "Tenable", portfolioCompany: null }))
  test("acquired org posting under its own tenant keeps its name", () =>
    expect(by(108)).toMatchObject({ company: "Checkmarx", portfolioCompany: null }))
  test("remote.com job board rows name the listed employer", () =>
    expect(by(109)).toMatchObject({ company: "Clover Health", portfolioCompany: "Remote" }))
  test("acquired org with an unmapped tenant gets the humanized tenant", () =>
    expect(by(110)).toMatchObject({ company: "Acme Holdings", portfolioCompany: "Slintel, a 6sense Company" }))

  test("same posting under two acquired orgs merges into one Salesforce row", () => {
    const merged = mergeJobs([jobs])
    const sf = merged.filter((j) => j.applyUrl === SF_VP)
    expect(sf.length).toBe(1)
    expect(sf[0]).toMatchObject({ company: "Salesforce", portfolioCompany: "Airkit, Spindle AI" })
  })

  test("cross-board merge prefers the row whose org is the employer", () => {
    // gc lists the posting under Ping Identity itself; accel under Forgerock.
    const ping = parseGetroSearch(gc, getroHtml([{ ...found[5], id: 900, organization: org("Ping Identity", "ping-identity", "acquisition") }])).jobs
    const merged = mergeJobs([jobs, ping])
    const row = merged.find((j) => j.applyUrl === found[5].url)!
    expect(row).toMatchObject({ board: "accel", company: "Ping Identity", portfolioCompany: null, alsoOn: ["general-catalyst"] })
  })
})

describe("employer helpers", () => {
  test("cleanOrgName strips domain parentheticals and taglines", () => {
    expect(cleanOrgName("Spindle Ai (spindle.ai)")).toBe("Spindle AI")
    expect(cleanOrgName("Nuitée | Enabling All Companies to Sell Travel")).toBe("Nuitée")
    expect(cleanOrgName("Frame.io")).toBe("Frame.io")
  })
  test("explicit hosts: Adobe, HPE, PayPal, Microsoft", () => {
    expect(resolveEmployer("Frame.io", "https://careers.adobe.com/us/en/job/R123/Director", { acquired: true })).toEqual({
      company: "Adobe", portfolioCompany: "Frame.io",
    })
    expect(resolveEmployer("Nimble Storage", "https://careers.hpe.com/us/en/job/1186/VP", { acquired: true }).company).toBe(
      "Hewlett Packard Enterprise",
    )
    expect(resolveEmployer("Nimble Storage", "https://hpe.wd5.myworkdayjobs.com/Jobsathpe/job/US/VP_1186", {}).company).toBe(
      "Hewlett Packard Enterprise",
    )
    expect(resolveEmployer("Venmo", "https://paypal.eightfold.ai/careers/job/274922905603", { acquired: true }).company).toBe("PayPal")
    expect(resolveEmployer("Swiftkey", "https://apply.careers.microsoft.com/careers/job/1970393557043765", {}).company).toBe("Microsoft")
  })
  test("org that IS the employer is unchanged", () => {
    expect(resolveEmployer("Salesforce", SF_VP, {})).toEqual({ company: "Salesforce", portfolioCompany: null })
    expect(resolveEmployer("CrowdStrike", "https://crowdstrike.wd5.myworkdayjobs.com/crowdstrikecareers/job/x", {})).toEqual({
      company: "CrowdStrike", portfolioCompany: null,
    })
    expect(resolveEmployer("SentinelOne", "https://boards.greenhouse.io/sentinellabs/jobs/1", {})).toEqual({
      company: "SentinelOne", portfolioCompany: null,
    })
  })
  test("unknown hosts and UUID tenants keep the board's name", () => {
    expect(resolveEmployer("Alma", "https://jobs.ashbyhq.com/deaa6ad2-d184-436b-b69e-17f761da1d94/93aa276b", { acquired: true }).company).toBe("Alma")
    expect(resolveEmployer("Elements", "https://example-ats.invalid/jobs/1", { acquired: true }).company).toBe("Elements")
    expect(resolveEmployer("Miro", null, {}).company).toBe("Miro")
  })
  test("atsTenant reads Workday / Greenhouse / Ashby / Lever / iCIMS tenants", () => {
    expect(atsTenant(new URL("https://visa.wd5.myworkdayjobs.com/Visa/job/x"))).toBe("visa")
    expect(atsTenant(new URL("https://job-boards.greenhouse.io/pingidentity/jobs/1"))).toBe("pingidentity")
    expect(atsTenant(new URL("https://boards.greenhouse.io/embed/job_app?for=acme&token=1"))).toBe("acme")
    expect(atsTenant(new URL("https://jobs.ashbyhq.com/webflow/ee79"))).toBe("webflow")
    expect(atsTenant(new URL("https://jobs.lever.co/sysdig/8ecc"))).toBe("sysdig")
    expect(atsTenant(new URL("https://uscareers-cvent.icims.com/jobs/10552/login"))).toBe("cvent")
  })
})

describe("remote preset is US / country-unspecified only", () => {
  const remote = parseLocationTerms("remote")
  const any = parseLocationTerms("remote-any")
  const keep: [string | null, boolean | null][] = [
    ["Remote", true],
    [null, true],
    ["United States · Remote", true],
    ["Remote - US", null],
    ["Remote (USA)", null],
    ["United States; Canada; Remote", true],
    ["Maryland, USA · Virginia, USA · Colombia · Remote", true],
    ["Remote · Europe · Washington, DC, USA", true],
    ["Austin, TX · Remote", null],
    ["San Francisco, CA, USA", true],
    ["New Mexico · Remote", null],
    ["Remote, Anywhere", null],
  ]
  const drop: [string | null, boolean | null][] = [
    ["London, UK", true],
    ["São Paulo, State of São Paulo, Brazil", true],
    ["Dubai, United Arab Emirates", true],
    ["Remote, UK", null],
    ["Remote - Europe", null],
    ["Remote · United Kingdom", true],
    ["Remote (EMEA)", null],
    ["Remote - APAC", null],
    ["Remote, LATAM", null],
    ["Toronto, ON, Canada · Remote", true],
    ["Bengaluru, Karnataka, India", true],
    ["Remote, UAE", null],
    ["Dublin, Ireland", true],
    ["Remote - Germany", null],
  ]
  for (const [location, flag] of keep) {
    test(`keeps ${JSON.stringify(location)}`, () => expect(matchesLocation(remote, { location, remote: flag })).toBe(true))
  }
  for (const [location, flag] of drop) {
    test(`drops ${JSON.stringify(location)}`, () => expect(matchesLocation(remote, { location, remote: flag })).toBe(false))
    test(`remote-any keeps ${JSON.stringify(location)}`, () =>
      expect(matchesLocation(any, { location, remote: true })).toBe(true))
  }
  test("non-remote jobs still need a remote marker", () => {
    expect(matchesLocation(remote, { location: "New York, NY", remote: false })).toBe(false)
    expect(matchesLocation(any, { location: "New York, NY", remote: false })).toBe(false)
  })
  test("Dublin, CA stays US", () => expect(isUsOrUnspecifiedLocation("Dublin, CA · Remote")).toBe(true))
  test("bay-area,remote combined via client filters", () => {
    const mk = (location: string, remoteFlag: boolean | null): Job => ({
      id: "x:" + location, board: "x", title: "VP Operations", company: null, location, date: null, url: "https://x", applyUrl: null,
      remote: remoteFlag, seniority: null,
    })
    const kept = applyClientFilters(
      [mk("San Mateo, CA, USA", false), mk("Remote - US", null), mk("London, UK", true), mk("Remote - Europe", null)],
      { seniority: "exec", location: "bay-area,remote" },
    )
    expect(kept.map((j) => j.location)).toEqual(["San Mateo, CA, USA", "Remote - US"])
  })
  test("presets parse, and both remote kinds push the board's remote filter", () => {
    expect(parseLocationTerms("remote-any, remote")).toEqual([{ kind: "remote-any" }, { kind: "remote" }])
    expect(serverLocationKind(parseLocationTerms("remote-any"))).toBe("remote")
    expect(serverLocationKind(parseLocationTerms("bay-area,remote"))).toBeNull()
    const f = new URL(buildGetroUrl(accel, { page: 1, execServerSide: false, locationTerms: any })).searchParams.get("filter")!
    expect(JSON.parse(Buffer.from(f, "base64").toString()).work_mode).toEqual(["remote"])
    expect(new URL(buildA16zUrl(findBoard("a16z")!, { page: 1, execServerSide: false, locationTerms: remote })).searchParams.get("remoteOnly")).toBe("1")
  })
})
