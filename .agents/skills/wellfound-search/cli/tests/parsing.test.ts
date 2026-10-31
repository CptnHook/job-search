import { describe, expect, test } from "bun:test"
import {
  buildSearchUrl,
  extractNextData,
  isChallengePage,
  isExecTitle,
  locationSlugFor,
  parseCompensation,
  parseJobDetail,
  parseSearchPage,
  roleSlugFor,
} from "../src/helpers"
import { normalizeJobKey } from "../src/commands/detail"
import { matchesCity } from "../src/commands/search"

// Synthetic fixture shaped like a /role/l/<role>/<city> page's __NEXT_DATA__.
function landingPage(): string {
  const data = {
    ROOT_QUERY: {
      talent: {
        'seoLandingPageJobSearchResults({"location":"san-francisco","page":1,"role":"vp-of-operations"})': {
          totalJobCount: 3,
          pageCount: 1,
          perPage: 20,
          startups: [{ __ref: "StartupResult:1" }, { __ref: "StartupResult:2" }],
        },
      },
    },
    "StartupResult:1": {
      name: "Acme AI",
      companySize: "SIZE_201_500",
      highlightedJobListings: [{ __ref: "JobListingSearchResult:11" }, { __ref: "JobListingSearchResult:12" }],
    },
    "StartupResult:2": {
      name: "Beta Pay",
      companySize: "SIZE_1001_5000",
      highlightedJobListings: [{ __ref: "JobListingSearchResult:21" }, { __ref: "JobListingSearchResult:99" }],
    },
    "JobListingSearchResult:11": {
      id: "11",
      slug: "vp-of-operations",
      title: "VP of Operations",
      locationNames: ["San Francisco"],
      remote: false,
      compensation: "$250k – $320k • 0.1% – 0.5%",
      liveStartAt: 1793000000,
      jobType: "full-time",
    },
    "JobListingSearchResult:12": {
      id: "12",
      slug: "operations-associate",
      title: "Operations Associate",
      locationNames: [],
      remote: true,
      compensation: "",
      liveStartAt: 1793000000,
    },
    // Malformed listing (no title) must be skipped without breaking the rest.
    "JobListingSearchResult:21": { id: "21" },
  }
  const next = { props: { pageProps: { apolloState: { data } } } }
  return `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(next)}</script></html>`
}

describe("parseSearchPage", () => {
  test("extracts listings with company, salary, equity, date, url", () => {
    const page = parseSearchPage(extractNextData(landingPage()))
    expect(page.totalJobCount).toBe(3)
    expect(page.pageCount).toBe(1)
    expect(page.results).toHaveLength(2)
    const vp = page.results[0]
    expect(vp.id).toBe("11-vp-of-operations")
    expect(vp.company).toBe("Acme AI")
    expect(vp.companySize).toBe("201-500")
    expect(vp.location).toBe("San Francisco")
    expect(vp.salary).toEqual({ text: "$250k – $320k", min: 250000, max: 320000, currency: "USD" })
    expect(vp.equity).toBe("0.1% – 0.5%")
    expect(vp.date).toBe(new Date(1793000000 * 1000).toISOString())
    expect(vp.url).toBe("https://wellfound.com/jobs/11-vp-of-operations")
    const assoc = page.results[1]
    expect(assoc.location).toBe("Remote")
    expect(assoc.salary).toBeNull()
    for (const r of page.results) {
      for (const k of ["id", "title", "company", "location", "date", "url"]) expect(k in r).toBe(true)
    }
  })

  test("missing __NEXT_DATA__ yields null", () => {
    expect(extractNextData("<html></html>")).toBeNull()
  })
})

describe("parseCompensation", () => {
  test("salary with no equity", () => {
    expect(parseCompensation("$173k – $212k • No equity")).toEqual({
      salary: { text: "$173k – $212k", min: 173000, max: 212000, currency: "USD" },
      equity: "No equity",
    })
  })
  test("empty string", () => {
    expect(parseCompensation("")).toEqual({ salary: null, equity: null })
  })
})

describe("roleSlugFor", () => {
  test.each([
    ["VP Operations", "vp-of-operations"],
    ["Vice President of Operations", "vp-of-operations"],
    ["Chief of Staff", "chief-of-staff"],
    ["COO", "chief-operating-officer"],
    ["technical program manager", "technical-program-manager"],
  ])("%s -> %s", (q, slug) => {
    expect(roleSlugFor(q)).toBe(slug)
  })
  test("no fuzzy guess for an unknown role", () => {
    expect(roleSlugFor("engineering operations")).toBeNull()
  })
})

describe("URL building stays on robots-allowed shapes", () => {
  test("role + city", () => {
    expect(buildSearchUrl("vp-of-operations", locationSlugFor("San Francisco, CA"), false, 1).url).toBe(
      "https://wellfound.com/role/l/vp-of-operations/san-francisco",
    )
  })
  test("pagination uses ?page=, never ?role=", () => {
    const { url } = buildSearchUrl("vp-of-operations", null, true, 2)
    expect(url).toBe("https://wellfound.com/role/r/vp-of-operations?page=2")
    expect(url).not.toMatch(/[?&](role|jobId|jobSlug|preview|inFrame|after_sign_in)=/)
    expect(url).not.toMatch(/\/(_jobs|search|auth|cdn-cgi)\b/)
  })
})

describe("filters", () => {
  test("exec titles", () => {
    for (const t of ["VP of Operations", "Vice President, Product", "Head of Customer Success", "Chief of Staff", "SVP Engineering", "EVP Ops", "Senior Director, TPM", "General Manager, Payments"]) {
      expect(isExecTitle(t)).toBe(true)
    }
    for (const t of ["Operations Associate", "Senior Software Engineer", "Program Manager", "Headcount Analyst"]) {
      expect(isExecTitle(t)).toBe(false)
    }
  })
  test("city match tolerates 'New York City' vs 'New York'", () => {
    expect(matchesCity("New York", "new york city")).toBe(true)
    expect(matchesCity("Boston, Denver", "new york")).toBe(false)
  })
})

describe("challenge detection", () => {
  test("passive Cloudflare beacon on a real page is not a challenge", () => {
    expect(isChallengePage(`${landingPage()}<script>/cdn-cgi/challenge-platform/scripts/jsd/main.js</script>`)).toBe(false)
  })
  test("interstitial is a challenge", () => {
    expect(isChallengePage("<html><title>Just a moment...</title></html>")).toBe(true)
  })
})

describe("detail", () => {
  test("normalizeJobKey", () => {
    expect(normalizeJobKey("4897467-staff-database-reliability-engineer")).toBe("4897467-staff-database-reliability-engineer")
    expect(normalizeJobKey("https://wellfound.com/jobs/4897467-staff-dbre")).toBe("4897467-staff-dbre")
    expect(normalizeJobKey("4897467")).toBeNull()
    expect(normalizeJobKey("https://wellfound.com.evil.io/jobs/1-x")).toBeNull()
    expect(normalizeJobKey("https://boards.greenhouse.io/jobs/4897467-x")).toBeNull()
  })

  test("parseJobDetail reads JSON-LD", () => {
    const ld = {
      "@type": "JobPosting",
      title: "VP of Operations",
      identifier: { value: "11" },
      hiringOrganization: { name: "Acme AI", sameAs: "https://acme.example" },
      jobLocation: [{ address: { addressLocality: "San Francisco", addressRegion: "California", addressCountry: "United States" } }],
      employmentType: "FULL_TIME",
      datePosted: "2026-10-30T10:00:00Z",
      baseSalary: { currency: "USD", value: { unitText: "YEAR", minValue: 250000, maxValue: 320000 } },
      description: "<h3>About</h3><p>Lead ops &amp; strategy.</p><ul><li><p>Own the plan</p></li><li><p>Build the team</p></li></ul>",
    }
    const html = `<script type="application/ld+json">${JSON.stringify(ld)}</script>`
    const job = parseJobDetail(html, "11-vp-of-operations")!
    expect(job.company).toBe("Acme AI")
    expect(job.location).toBe("San Francisco, California, United States")
    expect(job.salary?.min).toBe(250000)
    expect(job.salary?.text).toBe("USD 250,000 – 320,000/year")
    expect(job.description).toBe("About\nLead ops & strategy.\n- Own the plan\n- Build the team")
    expect(job.url).toBe("https://wellfound.com/jobs/11-vp-of-operations")
  })
})
