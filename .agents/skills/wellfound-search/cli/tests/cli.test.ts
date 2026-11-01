import { afterEach, describe, expect, test } from "bun:test"
import { runCLI, parseJSON } from "./helpers"
import { pageFetch } from "../src/helpers"

interface SearchOut {
  meta: { count: number; page: number }
  results: Array<{ id: string | null; title: string | null; url: string | null }>
}

describe("flag validation (offline)", () => {
  test("unknown flag exits 1 with JSON error on stderr", async () => {
    const r = await runCLI(["search", "-q", "VP Operations", "--bogus", "x"])
    expect(r.exitCode).toBe(1)
    expect(r.stdout).toBe("")
    expect(JSON.parse(r.stderr).code).toBe("UNKNOWN_FLAG")
  })
  test("search with no query/role/location exits 1", async () => {
    const r = await runCLI(["search"])
    expect(r.exitCode).toBe(1)
    expect(JSON.parse(r.stderr).code).toBe("NO_QUERY")
  })
  test("detail without id exits 1", async () => {
    const r = await runCLI(["detail"])
    expect(r.exitCode).toBe(1)
    expect(JSON.parse(r.stderr).code).toBe("NO_ID")
  })
  test("bad --seniority and --page values exit 1", async () => {
    expect(JSON.parse((await runCLI(["search", "-q", "COO", "--seniority", "junior"])).stderr).code).toBe("BAD_ARG")
    expect(JSON.parse((await runCLI(["search", "-q", "COO", "--page", "0"])).stderr).code).toBe("BAD_ARG")
  })
  test("bare numeric detail id is rejected without a request", async () => {
    const r = await runCLI(["detail", "4897467"])
    expect(r.exitCode).toBe(1)
    expect(JSON.parse(r.stderr).code).toBe("BAD_ID")
  })
})

describe("pageFetch", () => {
  const originalFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test("sends the honest UA, retries 429, does not follow redirects", async () => {
    const seen: Array<{ ua: string | null; redirect?: string }> = []
    let n = 0
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ ua: new Headers(init?.headers).get("User-Agent"), redirect: init?.redirect })
      n++
      if (n === 1) return new Response("", { status: 429 })
      return new Response("", { status: 303, headers: { location: "/location/san-francisco" } })
    }) as typeof fetch
    const res = await pageFetch("https://wellfound.com/role/l/x/san-francisco", async () => {})
    expect(res.redirect).toBe("https://wellfound.com/location/san-francisco")
    expect(seen).toHaveLength(2)
    expect(seen[0].ua).toBe("Mozilla/5.0 (compatible; wellfound-cli/1.0)")
    expect(seen[0].redirect).toBe("manual")
  })

  test("403 is reported as BLOCKED, never retried around", async () => {
    globalThis.fetch = (async () => new Response("", { status: 403 })) as typeof fetch
    await expect(pageFetch("https://wellfound.com/jobs/1-x", async () => {})).rejects.toMatchObject({ code: "BLOCKED" })
  })
})

// Live smoke test: one request to a public, robots-allowed landing page.
describe("live search", () => {
  test('search "VP Operations" in San Francisco returns real results', async () => {
    const out = parseJSON<SearchOut>(await runCLI(["search", "-q", "VP Operations", "-l", "San Francisco", "--limit", "5"]))
    expect(out.results.length).toBeGreaterThanOrEqual(1)
    for (const r of out.results) {
      expect(r.id).toBeTruthy()
      expect(r.title).toBeTruthy()
      expect(r.url).toMatch(/^https:\/\/wellfound\.com\/jobs\/\d+-/)
    }
  })
})
