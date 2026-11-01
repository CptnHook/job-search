import type { BoardConfig } from "../boards.js"
import type { LocationTerm } from "../helpers.js"

export interface Job {
  /** `<board>:<native id>` - pass as-is to `detail`. */
  id: string
  board: string
  title: string
  company: string | null
  location: string | null
  /** ISO-8601 posting date, or null. */
  date: string | null
  /** The posting's page on the VC board. */
  url: string
  /** External ATS / career-site link the board points to, or null. */
  applyUrl: string | null
  remote: boolean | null
  /** The board's own seniority tag(s), when it has them. */
  seniority: string | null
}

export interface JobDetail extends Job {
  description: string | null
  /** "board" | "ats:<host>" | null */
  descriptionSource: string | null
  employmentType: string | null
  compensation: string | null
  notes: string[]
}

export interface SearchParams {
  query?: string
  page: number
  jobage?: number
  locationTerms: LocationTerm[]
  /** Ask the platform for exec levels server-side (where offered). */
  execServerSide: boolean
}

export interface PlatformSearchResult {
  jobs: Job[]
  /** Server-reported total for this query, when exposed. */
  total: number | null
  /** Platform page size. */
  pageSize: number
  notes: string[]
  requestUrl: string | null
}

export interface PlatformAdapter {
  search(board: BoardConfig, p: SearchParams): Promise<PlatformSearchResult>
  /** Fetch a posting by its native id (the part after `<board>:`). */
  detail(board: BoardConfig, nativeId: string): Promise<JobDetail | null>
  /** Map a board URL to its native id, or null if the URL isn't a posting on this board. */
  nativeIdFromUrl(board: BoardConfig, url: URL): string | null
}
