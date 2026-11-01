// Live smoke test: one search across one board per platform type (3 page
// requests total). Keep it to this - the suite must stay low-volume.
import { describe, expect, test } from "bun:test"
import { parseJSON, runCLI } from "./helpers"

interface Result {
  id: string | null
  board: string | null
  title: string | null
  company: string | null
  location: string | null
  date: string | null
  url: string | null
}

describe("vc-boards live search", () => {
  test(
    'search "VP Operations" --seniority exec returns real results with the contract shape',
    async () => {
      const r = await runCLI(["search", "-q", "VP Operations", "--seniority", "exec", "--board", "accel,a16z,greylock", "--limit", "10"])
      expect(r.exitCode).toBe(0)
      const d = parseJSON<{ meta: { count: number; page: number; boards: { status: string }[] }; results: Result[] }>(r)
      expect(d.meta.page).toBe(1)
      expect(d.meta.boards.length).toBe(3)
      expect(d.meta.boards.some((b) => b.status === "ok")).toBe(true)
      expect(d.results.length).toBeGreaterThanOrEqual(1)
      expect(d.meta.count).toBe(d.results.length)
      for (const j of d.results) {
        for (const k of ["id", "title", "company", "location", "date", "url", "board"]) expect(k in j).toBe(true)
        expect(j.id).toBeTruthy()
        expect(j.title).toBeTruthy()
        expect(j.url).toMatch(/^https:\/\//)
        expect(["accel", "a16z", "greylock"]).toContain(j.board!)
      }
    },
    60000,
  )
})
