// Offline contract tests: every case here exits before any network request.
import { describe, expect, test } from "bun:test"
import { runCLI } from "./helpers"

function stderrJson(stderr: string): { error?: string; code?: string } {
  try {
    return JSON.parse(stderr)
  } catch {
    return {}
  }
}

async function expectError(args: string[], code: string) {
  const r = await runCLI(args)
  expect(r.exitCode).toBe(1)
  expect(r.stdout).toBe("")
  const e = stderrJson(r.stderr)
  expect(e.code).toBe(code)
  expect(typeof e.error).toBe("string")
}

describe("vc-boards CLI contract (offline)", () => {
  test("no command prints help and exits 1", async () => {
    const r = await runCLI([])
    expect(r.exitCode).toBe(1)
    expect(r.stdout).toContain("USAGE")
  })

  test("--help exits 0", async () => {
    const r = await runCLI(["search", "--help"])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain("--seniority")
  })

  test("bogus flag exits 1 with JSON error on stderr", () => expectError(["search", "-q", "VP", "--bogus", "x"], "UNKNOWN_FLAG"))
  test("unknown command", () => expectError(["frobnicate"], "BAD_CMD"))
  test("bad --format", () => expectError(["search", "--format", "xml"], "BAD_ARG"))
  test("bad --seniority", () => expectError(["search", "--seniority", "junior"], "BAD_ARG"))
  test("fractional --jobage", () => expectError(["search", "--jobage", "0.5"], "BAD_ARG"))
  test("zero --page", () => expectError(["search", "--page", "0"], "BAD_ARG"))
  test("non-numeric --limit", () => expectError(["search", "--limit", "many"], "BAD_ARG"))
  test("--board with no value", () => expectError(["search", "--board"], "BAD_ARG"))
  test("unknown board", () => expectError(["search", "--board", "accel,nope"], "UNKNOWN_BOARD"))
  test("disabled (Consider) board explains itself", async () => {
    const r = await runCLI(["search", "--board", "sequoia"])
    expect(r.exitCode).toBe(1)
    const e = stderrJson(r.stderr)
    expect(e.code).toBe("UNSUPPORTED_BOARD")
    expect(e.error).toMatch(/CSRF/)
  })
  test("disabled Index board", () => expectError(["search", "--board", "index"], "UNSUPPORTED_BOARD"))
  test("detail without id", () => expectError(["detail"], "NO_ID"))
  test("detail refuses non-board, non-ATS hosts", () => expectError(["detail", "https://example.com/jobs/1"], "BAD_ID"))
  test("detail refuses look-alike board host", () =>
    expectError(["detail", "https://jobs.accel.com.evil.io/companies/x/jobs/1"], "BAD_ID"))
  test("detail on disabled board", () => expectError(["detail", "lightspeed:abc"], "UNSUPPORTED_BOARD"))
  test("detail bad format", () => expectError(["detail", "accel:x/1", "--format", "table"], "BAD_ARG"))

  test("boards lists the config map", async () => {
    const r = await runCLI(["boards"])
    expect(r.exitCode).toBe(0)
    const d = JSON.parse(r.stdout)
    const names = d.results.map((b: { name: string }) => b.name)
    for (const n of ["accel", "general-catalyst", "insight", "a16z", "greylock", "sequoia", "index"]) expect(names).toContain(n)
  })
})
