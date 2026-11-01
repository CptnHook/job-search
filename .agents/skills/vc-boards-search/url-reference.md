# VC Portfolio Job Boards - URL Reference

Recon done 2026-10-31 with the honest UA `Mozilla/5.0 (compatible; vc-boards-cli/1.0)`.
Every board host below served HTTP 200 to that UA with no bot challenge, and its robots.txt
allows `/` for `*`. Rule applied throughout: read the server-rendered board page; call a JSON
endpoint only if it needs no key/token/secret, its host's robots.txt allows it, and it works
with the honest UA. Board config lives in `cli/src/boards.ts`.

## Getro boards (accel, general-catalyst, insight, redpoint, khosla)

Recognise one by `__NEXT_DATA__` plus assets from `cdn.getro.com`.

```
GET https://<board-host>/jobs?q=<text>&filter=<base64(JSON)>
```

| Param | Meaning |
|---|---|
| `q` | keywords (loose, any-word match) |
| `filter` | base64 of a JSON object, the same encoding the site writes to its URL |
| `filter.seniority` | `["vice_president","cxo","director"]` (also seen: `mid_senior`, `associate`) |
| `filter.searchable_locations` | exact Getro place names, OR-ed: `"San Francisco, CA, USA"`, `"San Jose, CA, USA"`, ... (`"San Francisco Bay Area"` matches nothing) |
| `filter.work_mode` | `["remote"]` |

Filter keys are AND-ed with each other. `page=` is ignored server-side.

Response: `<script id="__NEXT_DATA__">` → `props.pageProps.initialState.jobs` with `total` and
`found[]` (first 20). Per job: `id`, `title`, `slug`, `organization.{name,slug}`, `locations[]`,
`createdAt` (unix s), `url` (external ATS link), `workMode` (`on_site`|`remote`|`hybrid`),
`seniority`.

Not used: the page's load-more calls `POST https://api.getro.com/api/v2/collections/<id>/search/jobs`;
`api.getro.com/robots.txt` is `User-agent: * / Disallow: /`. Hence page 1 only.

Detail: `GET https://<board-host>/companies/<org-slug>/jobs/<job-id>[-<slug>]` →
`initialState.jobs.currentJob` with `description` (HTML), `postedAt`, `url`, `employmentTypes`,
`compensationAmountMin/MaxCents`, `status`. The slug suffix is optional.

## a16z (jobs.a16z.com)

Next.js app router. The page streams RSC flight data in `self.__next_f.push([1,"..."])` scripts.

```
GET https://jobs.a16z.com/jobs?q=<text>&locations=metro:san-francisco-bay-area&remoteOnly=1&posted=<days>
```

Params come from the page's own `useSearchParams` parser: `q` (or `titlePrefix`), `locations`
(`metro:san-francisco-bay-area`, `country:us`, ...), `remoteOnly` / `hybridOnly` /
`hybridOrRemoteOnly`, `posted` (days, or `P<n>D`), `jobTypes`, `markets`, `stages`. There is no
seniority facet (`seniorities` on a job is really the department).

Response: flight object `{"initialData":{"jobs":[...],"total":N,"page":0,"perPage":25,...}}`.
Per job: `title`, `company_name`, `company_slug`, `ats_posting_id`, `apply_url`, `location`,
`remote`, `hybrid`, `posted_at`, `compensation_summary`; `description_html` is `null`.
Load-more runs over a websocket live-query backend (not used), and `?page=2` renders no list,
so page 1 only.

Detail: `GET /jobs/<company_slug>/<ats_posting_id>--<title-slug>` → flight `{"job":{...}}`
(no description). A slugless path only client-redirects; its `<link rel="canonical">` gives the
full path, which the CLI follows once. Description comes from the ATS (`apply_url`).

## Greylock (greylock.com/jobs/portfolio-jobs/)

`jobs.greylock.com` 301-redirects here. Custom Next.js app-router site (`greylock` Sentry app key,
Sanity-backed CMS for the rest of the site); the job data's upstream source is not exposed (64-hex
job ids, signed CloudFront logos). The list is in the RSC flight twice: an unfiltered Suspense
fallback, then the filtered `JobsList` props
`{"jobs":[...],"totalCount":N,"page":P,"pageCount":C,"facets":{},"filters":{},"selectedJob":...}`.
When nothing is filtered, `jobs` is a back-reference string (`"$23:props:fallback:props:jobs"`)
to the fallback array.

```
GET https://greylock.com/jobs/portfolio-jobs/?search=<text>&seniorities=A|B&locations=A|B&remote=1&posted=week|month|quarter&page=<n>
```

| Param | Values |
|---|---|
| `search` | strict, all-words match, max 120 chars |
| `seniorities` | pipe list: `VP/SVP`, `Director/Senior Director`, `C-Level / Executive` (also `Manager/Senior Manager`, `Senior`, `Mid`, `Junior`, `Expert`) |
| `locations` | pipe list of normalized names: `San Francisco, United States`, `Mountain View, United States`, `United States`, ... |
| `remote` | `1` |
| `posted` | `week`, `month`, `quarter` |
| `page` | 1-indexed, 60 per page; out-of-range pages are clamped (the CLI returns empty instead) |
| `job` | a job id: fills `selectedJob` (metadata + `applyUrl`, no description) |

Per job: `id`, `title`, `companyName`, `applyUrl`, `createdAt`, `locations[]`,
`normalizedLocations[]`, `workMode` (`remote`|`onsite`|`hybrid`|`unknown`), `seniorities[]`, `salary`.

## Skipped boards

| Board | Host | Why skipped |
|---|---|---|
| Sequoia, Lightspeed, Kleiner Perkins, Bessemer (also seen: Felicis, GV) | `jobs.sequoiacap.com`, `jobs.lsvp.com`, `jobs.kleinerperkins.com`, `jobs.bvp.com` | Consider platform (`window.serverInitialData.fixedBoard`). HTML has no jobs (client-rendered). `POST /api-boards/search-jobs` returns `412 {"error":"INVALID_CSRF"}` without the `csrfToken` embedded in page source; copying it is forbidden. |
| Index Ventures | `www.indexventures.com/startup-jobs` | Vue app; the bundle POSTs to `<ES_GLOBALS.url>/wagtail__startup_jobs_jobmodel/_search`, an AWS Elasticsearch host whose URL embeds basic-auth credentials in page source. Forbidden; HTML has only templates. |
| Ribbit Capital, Founders Fund | - | No public portfolio job board found (`ribbitcap.com/jobs` and `foundersfund.com/jobs/` 404; `jobs.` subdomains do not resolve). |

## ATS pages fetched by `detail`

Only when the board has no description, only for allowlisted hosts (`cli/src/ats.ts`), and
only after that host's robots.txt allows the path for `vc-boards-cli` / `*`.
Description source: JSON-LD `JobPosting.description` (Ashby, Lever, Greenhouse), else
`og:description`. Checked 2026-10-31: `jobs.ashbyhq.com` (disallows `/api/`, `/b/`, `/meeting/`
only), `jobs.lever.co` (`*` allowed), `boards.greenhouse.io` (disallows `/embed/`),
`job-boards.greenhouse.io` (no rules). Ashby `/application` and Lever `/apply` suffixes are
stripped to reach the posting page.
