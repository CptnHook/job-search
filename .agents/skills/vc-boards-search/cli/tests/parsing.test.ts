// Offline unit tests for parsers and filters, using small synthetic fixtures
// shaped like the live pages recorded in url-reference.md.
import { describe, expect, test } from "bun:test"
import { parseAtsPage, isKnownAtsHost, normalizeAtsUrl } from "../src/ats"
import { findBoard } from "../src/boards"
import { resolveTarget } from "../src/commands/detail"
import { applyClientFilters } from "../src/commands/search"
import {
  decodeJsonAt,
  extractFlight,
  htmlToText,
  isExecTitle,
  matchesLocation,
  parseLocationTerms,
  robotsAllows,
  withinDays,
} from "../src/helpers"
import { buildA16zUrl, parseA16zSearch } from "../src/platforms/a16z"
import { buildGetroUrl, parseGetroSearch } from "../src/platforms/getro"
import { buildGreylockUrl, parseGreylockSearch } from "../src/platforms/greylock"
import type { Job, SearchParams } from "../src/platforms/types"

const accel = findBoard("accel")!
const a16zBoard = findBoard("a16z")!
const grey = findBoard("greylock")!

function params(over: Partial<SearchParams> = {}): SearchParams {
  return { page: 1, locationTerms: [], execServerSide: false, ...over }
}

function flightHtml(payload: string): string {
  // Split across two pushes, as Next.js does.
  const mid = Math.floor(payload.length / 2)
  return [payload.slice(0, mid), payload.slice(mid)]
    .map((p) => `<script>self.__next_f.push(${JSON.stringify([1, p])})</script>`)
    .join("")
}

describe("executive title filter", () => {
  const yes = [
    "VP, Operations", "Vice President, Global Accounting", "SVP & Chief Operating Officer", "EVP Strategy",
    "Head of Business Operations", "Chief of Staff", "COO", "Chief AI Officer", "Director, EPD Operations",
    "Senior Director, Product Strategy & Operations", "General Manager, Payments", "President, North America",
    "CISO",
  ]
  const no = [
    "Operations Manager", "Senior Software Engineer", "Executive Assistant to the CEO", "Associate Director, Ops",
    "AVP - Business Strategy", "Program Coordinator, Office of the Chief of Staff", "Strategy & Operations Lead",
  ]
  for (const t of yes) test(`keeps "${t}"`, () => expect(isExecTitle(t)).toBe(true))
  for (const t of no) test(`drops "${t}"`, () => expect(isExecTitle(t)).toBe(false))
})

describe("location filter", () => {
  test("presets parse", () => {
    expect(parseLocationTerms("bay-area, Remote, New York")).toEqual([
      { kind: "bay-area" },
      { kind: "remote" },
      { kind: "text", text: "New York" },
    ])
  })
  const bay = parseLocationTerms("bay-area")
  test("bay-area matches peninsula / south bay cities", () => {
    expect(matchesLocation(bay, { location: "Foster City, CA, USA", remote: null })).toBe(true)
    expect(matchesLocation(bay, { location: "Redwood City · Redwood City, CA, United States", remote: false })).toBe(true)
    expect(matchesLocation(bay, { location: "Austin, TX, USA", remote: false })).toBe(false)
  })
  test("remote matches flag or text", () => {
    const r = parseLocationTerms("remote")
    expect(matchesLocation(r, { location: null, remote: true })).toBe(true)
    expect(matchesLocation(r, { location: "United States - Remote", remote: null })).toBe(true)
    expect(matchesLocation(r, { location: "New York, NY", remote: false })).toBe(false)
  })
  test("no terms matches everything", () => expect(matchesLocation([], { location: null, remote: null })).toBe(true))
})

describe("embedded JSON", () => {
  test("decodeJsonAt respects strings containing brackets", () => {
    const s = 'xx{"a":"}{]","b":[1,{"c":2}]}yy'
    expect(decodeJsonAt(s, 2)).toEqual({ a: "}{]", b: [1, { c: 2 }] })
  })
  test("decodeJsonAt returns undefined on truncation", () => expect(decodeJsonAt('{"a":[1,2', 0)).toBeUndefined())
  test("extractFlight joins pushes and skips malformed ones", () => {
    const html = flightHtml("hello world") + "<script>self.__next_f.push([1,\"bad)</script>"
    expect(extractFlight(html)).toBe("hello world")
  })
})

describe("Getro", () => {
  const nd = {
    props: {
      pageProps: {
        initialState: {
          jobs: {
            total: 44,
            found: [
              {
                id: 98511200,
                title: "VP, Technical Programs and Business Operations",
                organization: { name: "OPOWER", slug: "opower-2" },
                locations: ["United States"],
                createdAt: 1793364124,
                url: "https://example-ats.invalid/jobs/349125",
                slug: "98511200-vp-technical-programs-and-business-operations",
                workMode: "on_site",
                seniority: "vice_president",
              },
              { id: 1, title: null, organization: {} },
              { id: 2, title: "VP, People Operations", organization: { name: "Remote", slug: "remote" }, locations: [], workMode: "remote", createdAt: 1793105111 },
            ],
          },
        },
      },
    },
  }
  const html = `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nd)}</script></html>`

  test("parses jobs and skips malformed ones", () => {
    const { jobs, total } = parseGetroSearch(accel, html)
    expect(total).toBe(44)
    expect(jobs.length).toBe(2)
    expect(jobs[0]).toMatchObject({
      id: "accel:opower-2/98511200",
      board: "accel",
      company: "OPOWER",
      location: "United States",
      url: "https://jobs.accel.com/companies/opower-2/jobs/98511200-vp-technical-programs-and-business-operations",
      seniority: "vice_president",
    })
    expect(jobs[0].date).toMatch(/^2026-/)
    expect(jobs[1]).toMatchObject({ location: "Remote", remote: true })
  })

  test("throws a clear error when __NEXT_DATA__ is missing", () => {
    expect(() => parseGetroSearch(accel, "<html></html>")).toThrow(/__NEXT_DATA__/)
  })

  test("filter param carries seniority + bay-area as base64 JSON", () => {
    const u = new URL(buildGetroUrl(accel, params({ query: "VP Operations", execServerSide: true, locationTerms: [{ kind: "bay-area" }] })))
    expect(u.searchParams.get("q")).toBe("VP Operations")
    const f = JSON.parse(Buffer.from(u.searchParams.get("filter")!, "base64").toString())
    expect(f.seniority).toEqual(["vice_president", "cxo", "director"])
    expect(f.searchable_locations).toContain("San Francisco, CA, USA")
  })

  test("mixed location kinds stay client-side", () => {
    const u = new URL(buildGetroUrl(accel, params({ locationTerms: [{ kind: "bay-area" }, { kind: "remote" }] })))
    expect(u.searchParams.get("filter")).toBeNull()
  })
})

describe("a16z", () => {
  const payload =
    '0:["$","$L19","{}",{"initialData":{"jobs":[' +
    JSON.stringify({
      title: "VP, Revenue Operations ",
      company_slug: "ambient",
      company_name: "Ambient.ai",
      ats_posting_id: "d16514cf-40b2-4d95-86cc-52b1f4fd5b0b",
      apply_url: "https://jobs.ashbyhq.com/ambient.ai/d16514cf/application",
      location: "Redwood City · Redwood City, CA, United States",
      remote: false,
      posted_at: "2026-06-17T02:52:44.066Z",
    }) +
    ',{"title":"no slug"}],"total":1552,"perPage":25}}]'

  test("parses initialData from flight", () => {
    const { jobs, total } = parseA16zSearch(a16zBoard, flightHtml(payload))
    expect(total).toBe(1552)
    expect(jobs.length).toBe(1)
    expect(jobs[0]).toMatchObject({
      id: "a16z:ambient/d16514cf-40b2-4d95-86cc-52b1f4fd5b0b",
      title: "VP, Revenue Operations",
      url: "https://jobs.a16z.com/jobs/ambient/d16514cf-40b2-4d95-86cc-52b1f4fd5b0b--vp-revenue-operations",
      remote: false,
    })
  })

  test("URL params", () => {
    const u = new URL(buildA16zUrl(a16zBoard, params({ query: "Chief of Staff", jobage: 7, locationTerms: [{ kind: "bay-area" }] })))
    expect(u.searchParams.get("locations")).toBe("metro:san-francisco-bay-area")
    expect(u.searchParams.get("posted")).toBe("7")
  })
})

describe("Greylock", () => {
  const job = (id: string, title: string) => ({
    id: id.repeat(64).slice(0, 64),
    title,
    companyName: "Lyra Health",
    applyUrl: "https://jobs.lever.co/x/1",
    createdAt: "2026-10-12T00:00:00Z",
    locations: ["United States"],
    workMode: "remote",
    seniorities: ["VP/SVP"],
  })

  test("prefers the filtered JobsList over the unfiltered fallback", () => {
    const fallback = { jobs: [job("a", "Unfiltered Role")], totalCount: 1940, pageCount: 33, facets: {} }
    const filtered = { jobs: [job("b", "Vice President, Global Accounting")], totalCount: 1, page: 1, pageCount: 1, facets: {}, filters: {} }
    const html = flightHtml(`22:${JSON.stringify(fallback)}\n103:["$","$L105",null,${JSON.stringify(filtered)}]`)
    const r = parseGreylockSearch(grey, html)
    expect(r.jobs.map((j) => j.title)).toEqual(["Vice President, Global Accounting"])
    expect(r.jobs[0]).toMatchObject({ remote: true, seniority: "VP/SVP", board: "greylock" })
    expect(r.jobs[0].url).toStartWith("https://greylock.com/jobs/portfolio-jobs/?job=")
  })

  test("resolves a back-referenced job list to the fallback array", () => {
    const fallback = { jobs: [job("c", "Head of Growth")], totalCount: 1940, pageCount: 33, facets: {} }
    const filtered = { jobs: "$23:props:fallback:props:jobs", totalCount: 1940, page: 1, pageCount: 33, facets: {}, filters: {} }
    const html = flightHtml(`22:${JSON.stringify(fallback)}\n103:${JSON.stringify(filtered)}`)
    expect(parseGreylockSearch(grey, html).jobs[0].title).toBe("Head of Growth")
  })

  test("server seniority only for level-free queries", () => {
    const withLevel = new URL(buildGreylockUrl(grey, params({ query: "Chief of Staff", execServerSide: true })))
    expect(withLevel.searchParams.get("seniorities")).toBeNull()
    const levelFree = new URL(buildGreylockUrl(grey, params({ query: "operations", execServerSide: true, jobage: 30, page: 2 })))
    expect(levelFree.searchParams.get("seniorities")).toBe("VP/SVP|Director/Senior Director|C-Level / Executive")
    expect(levelFree.searchParams.get("posted")).toBe("month")
    expect(levelFree.searchParams.get("page")).toBe("2")
  })
})

describe("client filters", () => {
  const mk = (title: string, location: string | null, date: string | null): Job => ({
    id: "x:" + title, board: "x", title, company: null, location, date, url: "https://x", applyUrl: null, remote: null, seniority: null,
  })
  test("seniority + location + jobage combine", () => {
    const now = new Date().toISOString()
    const jobs = [
      mk("VP Operations", "San Francisco, CA", now),
      mk("Operations Manager", "San Francisco, CA", now),
      mk("VP Operations", "Austin, TX", now),
      mk("VP Operations", "San Mateo, CA", "2020-01-01T00:00:00Z"),
    ]
    const kept = applyClientFilters(jobs, { seniority: "exec", location: "bay-area", jobage: 30 })
    expect(kept.length).toBe(1)
    expect(kept[0].location).toBe("San Francisco, CA")
  })
  test("withinDays with missing date is excluded only when jobage is set", () => {
    expect(withinDays(null, undefined)).toBe(true)
    expect(withinDays(null, 7)).toBe(false)
  })
})

describe("robots.txt", () => {
  const txt = "User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nDisallow: /api/\nDisallow: /b/\nAllow: /api/public$\n"
  test("star group applies to our UA", () => {
    expect(robotsAllows(txt, "/ambient/123")).toBe(true)
    expect(robotsAllows(txt, "/api/jobs")).toBe(false)
    expect(robotsAllows(txt, "/api/public")).toBe(true)
  })
  test("Disallow: / for everyone blocks", () => expect(robotsAllows("User-agent: *\nDisallow: /\n", "/x")).toBe(false))
  test("empty Disallow allows", () => expect(robotsAllows("User-agent: *\nDisallow:\n", "/x")).toBe(true))
  test("a group naming our token wins over *", () =>
    expect(robotsAllows("User-agent: *\nAllow: /\n\nUser-agent: vc-boards-cli\nDisallow: /\n", "/x")).toBe(false))
})

describe("ATS + detail resolution", () => {
  test("known ATS hosts", () => {
    expect(isKnownAtsHost("jobs.ashbyhq.com")).toBe(true)
    expect(isKnownAtsHost("acme.wd5.myworkdayjobs.com")).toBe(true)
    expect(isKnownAtsHost("myworkdayjobs.com.evil.io")).toBe(false)
    expect(isKnownAtsHost("example.com")).toBe(false)
  })
  test("Ashby application URL normalises to the posting page", () => {
    expect(normalizeAtsUrl("https://jobs.ashbyhq.com/acme/abc/application")).toBe("https://jobs.ashbyhq.com/acme/abc")
  })
  test("JSON-LD JobPosting description becomes plain text", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@type": "JobPosting",
      description: "<p>About &amp; us</p><ul><li>Lead ops</li></ul>",
      datePosted: "2026-10-01",
    })}</script>`
    const r = parseAtsPage(html)
    expect(r.description).toBe("About & us\n\n• Lead ops")
    expect(r.datePosted).toBe("2026-10-01")
  })
  test("double-encoded HTML is decoded", () => expect(htmlToText("&lt;p&gt;Hi&lt;/p&gt;")).toBe("Hi"))
  test("resolveTarget handles ids and URLs", () => {
    expect(resolveTarget("accel:opower-2/98511200")).toMatchObject({ kind: "board", nativeId: "opower-2/98511200" })
    expect(resolveTarget("https://jobs.accel.com/companies/opower-2/jobs/98511200-vp-x")).toMatchObject({
      kind: "board",
      nativeId: "opower-2/98511200",
    })
    expect(resolveTarget("https://jobs.greylock.com/jobs/portfolio-jobs/?job=" + "a".repeat(64))).toMatchObject({ kind: "board" })
    expect(resolveTarget("https://jobs.lever.co/acme/123")).toMatchObject({ kind: "ats" })
    expect(resolveTarget("https://jobs.accel.com.evil.io/companies/x/jobs/1")).toMatchObject({ kind: "error" })
  })
})
