A **remote jobs API** that collects remote job listings from five public job boards into one normalized, de-duplicated dataset: [RemoteOK](https://remoteok.com), [Remotive](https://remotive.com), [Himalayas](https://himalayas.app), [Jobicy](https://jobicy.com) and [We Work Remotely](https://weworkremotely.com). Every listing gets the same fields (title, company, region, salary, tags, description, apply link). It uses only the boards' **official public APIs and RSS feeds** and is **not** a scraper of LinkedIn, Indeed or any site that forbids automated access.

## Features

- Remote developer jobs as JSON from all five boards
- Keyword, category and hiring region filters (US, EU, UK, LATAM, APAC, Worldwide)
- Salary ranges parsed into numbers and currency
- Export to CSV, Excel or Google Sheets
- Cross-board deduplication
- Scheduled daily feeds for job boards, newsletters or Slack digests
- Monitor mode: only jobs new since the last run, so alerts never repeat

## What can you do with Remote Jobs Aggregator?

- **Job boards and niche job sites**: refresh "remote Python jobs in Europe" every few hours, linking to the original posting.
- **Alert newsletters and Slack / Discord digests**: a daily keyword-filtered run piped to Zapier, Make, Gmail or Slack.
- **Market research and salary benchmarking**: which technologies, hiring regions and salary ranges remote roles mention.
- **AI agents and RAG pipelines**: `descriptionText` is ready for embeddings.
- **Recruiting intelligence**: which companies are hiring remotely right now, and for what.

## How it works

For each selected board the Actor calls its public JSON API (RemoteOK, Remotive, Himalayas, Jobicy) or parses its RSS feeds (We Work Remotely: main plus ten category feeds). Salaries such as "$170k - $200k" become numbers, location rules such as "Northern America, LATAM, Europe" become a compact `remoteRegion`, employment types are unified and HTML descriptions get a plain-text version. Listings are filtered by age, keywords and categories, and each title + company pair is kept once across boards.

## How to use it

1. Keep all five **Job boards** selected, or untick some.
2. Optionally add **Keywords** (matched on title, company and tags) and **Categories**.
3. Set **Posted within (days)** and **Max jobs per source**.
4. Click **Start**; results appear in the **Output** tab within a minute as JSON, CSV, Excel or XML.
5. Add a **Schedule** (every 3 to 6 hours; boards update a few times a day) and turn on **Only new items since the last run** (see Monitor mode).

```json
{
    "sources": ["remoteok", "remotive", "himalayas", "jobicy", "weworkremotely"],
    "keywords": ["python", "typescript", "product manager"],
    "categories": ["programming", "product"],
    "maxJobsPerSource": 200,
    "postedWithinDays": 14,
    "dedupe": true,
    "includeDescription": true
}
```

## Use it from the API, Python, JavaScript or an AI agent

One HTTP call:

```bash
curl -X POST "https://api.apify.com/v2/acts/josh99smith~remote-jobs-aggregator/run-sync-get-dataset-items?token=<YOUR_API_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"keywords": ["python"], "postedWithinDays": 7}'
```

Python (`apify-client`):

```python
from apify_client import ApifyClient

client = ApifyClient("<YOUR_API_TOKEN>")
run = client.actor("josh99smith/remote-jobs-aggregator").call(
    run_input={"sources": ["remoteok", "remotive", "jobicy"], "keywords": ["python", "django"], "postedWithinDays": 7}
)
for job in client.dataset(run["defaultDatasetId"]).iterate_items():
    print(job["title"], "-", job["company"], job["url"])
```

JavaScript or TypeScript (`apify-client`):

```javascript
import { ApifyClient } from "apify-client";

const client = new ApifyClient({ token: "<YOUR_API_TOKEN>" });
const run = await client.actor("josh99smith/remote-jobs-aggregator").call({
    keywords: ["react", "typescript"],
    categories: ["programming"],
    postedWithinDays: 7,
    includeDescription: false,
});
const { items } = await client.dataset(run.defaultDatasetId).listItems();
console.log(items);
```

It is also a tool in the Apify MCP server for AI agents and connects to Zapier, Make, n8n and Google Sheets in the **Integrations** tab.

## Output

One record per job (description trimmed):

```json
{
    "id": "jobicy:153610",
    "source": "Jobicy",
    "success": true,
    "title": "Manager, Clinical Review and Quality Assurance",
    "company": "SmithRx",
    "companyLogo": "https://jobicy.com/data/server-nyc0409/galaxy/mercury/2025/07/fa1482ea-221.jpeg",
    "location": "USA",
    "remoteRegion": "US",
    "category": "Healthcare & Medical",
    "tags": ["Healthcare & Medical", "Senior"],
    "employmentType": "Full-Time",
    "salaryMin": 136000,
    "salaryMax": 192000,
    "salaryCurrency": "USD",
    "salaryPeriod": "yearly",
    "salaryRaw": "USD 136000 - 192000 yearly",
    "descriptionHtml": "<p><strong>Who We Are:</strong></p><p>SmithRx is a rapidly growing, venture-backed Health-Tech company...</p>",
    "descriptionText": "Who We Are:\n\nSmithRx is a rapidly growing, venture-backed Health-Tech company...",
    "url": "https://jobicy.com/jobs/153610-manager-clinical-review-and-quality-assurance-2",
    "applyUrl": "https://jobicy.com/jobs/153610-manager-clinical-review-and-quality-assurance-2",
    "publishedAt": "2026-09-18T14:43:04.000Z",
    "fetchedAt": "2026-09-18T19:46:35.436Z",
    "isNew": true
}
```

An unreachable board produces a free record instead of stopping the run:

```json
{ "success": false, "source": "Remotive", "errorType": "rate-limited", "error": "HTTP 429 Too Many Requests for https://remotive.com/api/remote-jobs?limit=200", "fetchedAt": "..." }
```

## Output fields

| Field | Description |
| --- | --- |
| `id`, `source` | Board-prefixed id (`remoteok:1137400`) and board name (`RemoteOK`, `Remotive`, `Himalayas`, `Jobicy`, `We Work Remotely`). |
| `title`, `company`, `companyLogo` | Title, employer, logo URL. |
| `location` | Board's own location text. |
| `remoteRegion` | `Worldwide`, `US`, `Canada`, `LATAM`, `UK`, `EU`, `APAC`, `Africa` or `Middle East`; comma-separated when several apply, `null` when unknown. |
| `category`, `tags[]` | Primary category; board tags, skills or industries. |
| `employmentType` | `Full-Time`, `Part-Time`, `Contract`, `Freelance`, `Internship`, `Temporary` or `null`. |
| `salaryMin`, `salaryMax`, `salaryCurrency`, `salaryPeriod`, `salaryRaw` | Parsed range plus original text; `null` when unpublished. |
| `descriptionHtml`, `descriptionText` | Full HTML (max 20,000 characters, optional); plain-text excerpt (first 2,000). |
| `url`, `applyUrl`, `publishedAt`, `fetchedAt` | Listing URL, apply link, ISO 8601 timestamps. |
| `isNew` | `true` unless an earlier run with the same state store delivered the job; always present. |
| `raw` | With **Include raw source record** only: the untouched board item. |
| `errorType`, `error` | Failures only: `dns`, `timeout`, `blocked`, `http-error`, `network`, `not-found`, `rate-limited` or `other`. |

The `SUMMARY` key-value record gives per-board counts (fetched, filtered, de-duplicated, billed) plus `newItems`, `alreadySeen` and `stateStoreName`.

## Monitor mode: only new jobs since the last run

With **Only new items since the last run** on, the Actor stores the `id` of every delivered job in a named key-value store (`remote-jobs-aggregator-seen` by default). The first run returns everything matching your filters; later runs return **only listings not seen in an earlier run**. Skipped jobs are never billed.

For alerts, schedule hourly runs and connect the dataset to Slack, email, Discord, Google Sheets or a webhook in the **Integrations** tab. The store is shared by all runs in your account, so give each keyword set you track its own **State store name** (for example `python-eu` and `design-worldwide`).

Ids absent for **Forget seen items after (days)** (default 90) are dropped and count as new if they return; the store holds at most 100,000 ids. With monitor mode off, `isNew` still marks previously seen jobs.

## Pricing: how much does it cost to aggregate remote jobs?

You pay a **flat price per job record** (shown next to the Start button; at $0.001 per job, 1,000 jobs cost $1). Start-up, filtering, de-duplication, jobs skipped by monitor mode and boards that fail to load are free, and the Actor stops when a run reaches the maximum cost you set. A default run (five boards, 200 jobs each, last 30 days) yields 500 to 700 unique listings.

**How it compares (September 2026).** Other multi-board aggregators on Apify Store charge $0.002 per unique job, or $0.015 per job plus $0.01 for salary data; single-board scrapers charge $0.001 for one board. This Actor covers five boards for $0.001 per job, adds monitor mode so scheduled runs only return new listings, and never bills jobs removed by your keyword, category or date filters.

## Attribution: what you must do with the data

Each board asks for credit in return for its feed. When you display or republish records, honour the requirement of the board in `source`:

- **RemoteOK**: link to the job's `url` on Remote OK with a normal (follow) link and name Remote OK as the source. Do not use their logo without permission.
- **Remotive**: link to the job `url` and name Remotive as the source. Do not submit their jobs to other aggregators (Jooble, Google Jobs, LinkedIn Jobs, ...) and do not gate listings behind a sign-up form.
- **Jobicy**: credit Jobicy with a direct link and point apply buttons to the job `url` from the feed.
- **Himalayas** and **We Work Remotely**: link to the original listing and name the board as the source.

Always send applicants to the original posting rather than re-hosting the application.

## Tips

- **Categories are fuzzy**: `programming` matches "Full-Stack Programming" and "Software Development"; tags count too, so `python` works as a category.
- **Keywords are whole-word**: `go` does not match "Django"; `c++` and `node.js` work.
- Switch off **Include HTML description** to shrink the dataset by roughly 80 %.

## FAQ

### Is it legal to use this remote jobs data?

The Actor reads only endpoints the boards publish for this purpose, at low request rates, and stores no personal data. Complying with each board's attribution conditions and applicable law is your responsibility.

### How many remote jobs can I get per run?

Boards expose only their newest listings (RemoteOK about 100, Remotive a small public sample, Jobicy up to 200, Himalayas and We Work Remotely a few hundred), so **Max jobs per source** tops out at 1,000 per board and `postedWithinDays` removes older ones.

### How fresh are the listings?

Each run fetches the boards live; Remotive delays its public feed by about 24 hours.

### How do I reset the seen list?

Delete the store named in **State store name** (`remote-jobs-aggregator-seen` unless you changed it) under **Storage > Key-value stores** in Apify Console; the next run returns everything again. To keep the old watchlist, set a new **State store name** instead.

### Can it search LinkedIn, Indeed or Glassdoor?

No. Those sites prohibit automated access and offer no public feed.

### Will the output fields change between runs?

No. Existing fields are never renamed or removed without a major version bump announced in the changelog; new fields are only ever added.

## Related Actors by the same developer

- [Tech Stack Detector](https://apify.com/josh99smith/tech-stack-detector): find out what a website is built with.
- [Website Screenshot API](https://apify.com/josh99smith/website-screenshot-api): full-page screenshots and PDFs of any URL.
- [Google Autocomplete Scraper](https://apify.com/josh99smith/google-autocomplete-scraper): keyword suggestions from Google search.
- [App Reviews Scraper](https://apify.com/josh99smith/app-reviews-scraper): App Store and Google Play reviews as JSON.
- [PageSpeed Insights Audit](https://apify.com/josh99smith/pagespeed-insights-audit): Core Web Vitals and Lighthouse scores via Google's API.
- [PDF Text Extractor](https://apify.com/josh99smith/pdf-text-extractor): text and metadata from PDF files.
- [Sitemap URL Extractor](https://apify.com/josh99smith/sitemap-url-extractor): all URLs from XML sitemaps.
- [RSS Feed to JSON](https://apify.com/josh99smith/rss-feed-to-json): RSS and Atom feeds as JSON.

## Support and feedback

Missing a board with a public feed, or found a wrong mapping? Open a ticket in the **Issues** tab. The Actor is open source under the MIT licence.
