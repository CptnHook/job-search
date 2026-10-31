# Wellfound URL Reference

Public, unauthenticated pages used by this skill (investigated 2026-10-31 with the honest UA
`Mozilla/5.0 (compatible; wellfound-cli/1.0)`; every page below returned 200 with content and
no challenge).

> Personal use only. Wellfound's Terms of Service (wellfound.com/terms) forbid copying content
> "through the use of automated or non-automated harvesting, collection or 'scraping'" except as
> expressly permitted, and forbid automated access producing more load than a person using a
> browser could. Keep volume low.

## robots.txt (2026-10-31)

`User-agent: *` disallows, among others: `/_jobs/`, `/search`, `/auth/`, `/cdn-cgi/`, `/embed/`,
`/u/`, `/jobs/applications`, `/jobs/signup`, and the query parameters `?role=`, `?jobId=`,
`?jobSlug=`, `?preview=`, `?inFrame=`, `?after_sign_in=` (and `&` variants). This skill uses
only the shapes below plus `?page=<n>`, none of which are disallowed. **Do not** switch to
`/search`, `/_jobs/`, or `?role=` URLs.

## Search (SEO landing pages)

| Shape | Next.js page | Example |
|-------|--------------|---------|
| `/role/l/<role>/<city>` | `/seoLanding/roleLocationSearch` | `/role/l/vp-of-operations/san-francisco` |
| `/role/<role>` | `/seoLanding/roleSearch` | `/role/vp-of-operations` |
| `/role/r/<role>` | `/seoLanding/roleRemoteSearch` | `/role/r/chief-operating-officer` |
| `/location/<city>` | `/seoLanding/locationSearch` | `/location/san-francisco` |

- `?page=<n>`: 1-indexed; 20 startups per page.
- `<role>` must be one of Wellfound's role slugs (list in `cli/src/roles.ts`, harvested from
  `/browse/tech-jobs`). An unknown slug returns 404 (e.g. `/role/vp-operations`; the real slug is
  `vp-of-operations`).
- An unsupported role+city pair returns **303 to `/role/<role>`** (e.g. `new-york-city`). The
  task brief's `/role/l/vp-operations/san-francisco` 303'd to `/location/san-francisco`, which is
  the redirect for an unknown role slug, not a login.
- A page past the end returns **303 to the same path without `?page`**.
- No date, salary, or seniority parameters exist; the CLI filters those client-side.

### Response structure

`<script id="__NEXT_DATA__" type="application/json">` holds
`props.pageProps.apolloState.data`, a normalized Apollo cache:

- `ROOT_QUERY.talent["seoLandingPageJobSearchResults({...})"]`: `{totalJobCount, totalStartupCount, perPage, pageCount, startups: [{__ref}]}`
- `StartupResult:<id>`: `name`, `slug`, `companySize` (`SIZE_201_500` ...), `highConcept`, `highlightedJobListings: [{__ref}]`
- `JobListingSearchResult:<id>`: `id`, `slug`, `title`, `locationNames[]`, `remote`, `compensation`
  (display string such as `"$150k – $185k • 0.1% – 0.3%"`, `"$173k – $212k • No equity"`, or `""`),
  `liveStartAt` (unix seconds), `jobType`, `primaryRoleTitle`, `description` (markdown), `atsSource`.

Pages also embed Cloudflare's passive `/cdn-cgi/challenge-platform/scripts/jsd/main.js` beacon.
That is not a challenge; the CLI treats a page as blocked only when it lacks page data and looks
like an interstitial.

## Detail

```
GET https://wellfound.com/jobs/<id>-<slug>
```

`/jobs/<id>` without the slug returns 404, so result `id`s carry the slug. The page has a
schema.org `<script type="application/ld+json">` `JobPosting`: `title`, `identifier.value` (job id),
`hiringOrganization.{name,sameAs}`, `jobLocation[].address.{addressLocality,addressRegion,addressCountry}`,
`employmentType`, `datePosted`, `baseSalary.{currency,value.{minValue,maxValue,unitText}}`,
`industry`, `description` (HTML), `directApply`.

## Not used

- `/jobs` (the main board): 200 with a different Apollo shape (`JobListing`/`Startup`), not role-filterable without the disallowed `?role=`.
- `/search`, `/_jobs/`: disallowed by robots.txt.
- Applying, saved jobs, and full search filters require login.
