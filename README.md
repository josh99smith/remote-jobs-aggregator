Get **fresh remote job listings from five public job boards in one normalized dataset**. Remote Jobs Aggregator pulls the latest openings from [RemoteOK](https://remoteok.com), [Remotive](https://remotive.com), [Himalayas](https://himalayas.app), [Jobicy](https://jobicy.com) and [We Work Remotely](https://weworkremotely.com), maps every listing to the same fields (title, company, region, salary, tags, description, apply link) and removes duplicates across boards. It only uses the boards' **official public APIs and RSS feeds**. It is **not** a scraper of LinkedIn, Indeed or any site that forbids automated access.

## What can you do with Remote Jobs Aggregator?

- **Run a remote job board or niche job site**: refresh "remote Python jobs in Europe" every few hours and link candidates to the original posting.
- **Job alert newsletters and Slack / Discord digests**: schedule a daily run filtered by keywords and pipe new records to Zapier, Make, Gmail or Slack through Apify integrations.
- **Market research and salary benchmarking**: track how many remote roles mention a technology, where companies hire and which salary ranges they publish.
- **Feed AI agents and RAG pipelines**: `descriptionText` is ready for embeddings, and the Actor is callable as a tool through the Apify MCP server.
- **Recruiting intelligence**: see which companies are hiring remotely right now and for what roles.

## How it works

For each selected board the Actor calls its public JSON API (RemoteOK, Remotive, Himalayas, Jobicy) or parses its RSS feeds (We Work Remotely, main plus ten category feeds). Every listing becomes one common record: salary strings such as "$170k - $200k" are parsed into numbers, location rules such as "Northern America, LATAM, Europe" become a compact `remoteRegion`, employment types are unified and HTML descriptions get a plain-text version. Listings are then filtered by age, keywords and categories, and each title + company pair is kept once across boards.

Boards expose only their most recent listings (roughly 100 to 1,000 each; Remotive delays its public feed by 24 hours), so this is a source of current openings, not a historical archive.

## How to use it

1. Open the Actor and keep all five **Job boards** selected, or untick the ones you do not need.
2. Optionally add **Keywords** (whole-word match against title, company and tags) and **Categories** (fuzzy match against each board's categories and tags).
3. Set **Posted within (days)** and **Max jobs per source** to control freshness and volume.
4. Click **Start**. Results appear in the **Output** tab within a minute; download JSON, CSV, Excel or XML, or connect an integration.
5. Add a **Schedule** to keep the data fresh. Every 3 to 6 hours is plenty; the boards update a few times a day.

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
    "fetchedAt": "2026-09-18T19:46:35.436Z"
}
```

A board that cannot be reached produces a free record instead of stopping the run:

```json
{ "success": false, "source": "Remotive", "errorType": "rate-limited", "error": "HTTP 429 Too Many Requests for https://remotive.com/api/remote-jobs?limit=200", "fetchedAt": "..." }
```

### Fields

| Field | Description |
| --- | --- |
| `id`, `source` | Board-prefixed identifier (`remoteok:1137400`) and board name (`RemoteOK`, `Remotive`, `Himalayas`, `Jobicy`, `We Work Remotely`). |
| `title`, `company`, `companyLogo` | Job title, employer and logo URL when available. |
| `location` | The board's own location text. |
| `remoteRegion` | Normalized hiring region: `Worldwide`, `US`, `Canada`, `LATAM`, `UK`, `EU`, `APAC`, `Africa`, `Middle East` (comma-separated when several apply, `null` when unknown). |
| `category`, `tags[]` | Primary category and the board's tags, skills or industries. |
| `employmentType` | `Full-Time`, `Part-Time`, `Contract`, `Freelance`, `Internship`, `Temporary` or `null`. |
| `salaryMin`, `salaryMax`, `salaryCurrency`, `salaryPeriod`, `salaryRaw` | Parsed salary range plus the original text; `null` when the board publishes none. |
| `descriptionHtml`, `descriptionText` | Full HTML (max 20,000 characters, optional) and a plain-text excerpt (first 2,000). |
| `url`, `applyUrl`, `publishedAt`, `fetchedAt` | Listing URL, apply link and ISO 8601 timestamps. |
| `raw` | Only with **Include raw source record**: the untouched item from the board. |
| `errorType`, `error` | Failure records only: `dns`, `timeout`, `blocked`, `http-error`, `network`, `not-found`, `rate-limited` or `other`. |

The `SUMMARY` record in the key-value store shows, per board, how many jobs were fetched, filtered, de-duplicated and billed.

## Pricing: how much does it cost to aggregate remote jobs?

You pay a **flat price per job record** written to the dataset (shown next to the Start button; at $0.001 per job, 1,000 jobs cost $1). Start-up, filtering, de-duplication and boards that fail to load are free. The Actor stops on its own when a run reaches the maximum cost you set, so a wide search never produces a surprise bill. A default run (five boards, 200 jobs each, last 30 days) typically yields 500 to 700 unique listings.

## Attribution: what you must do with the data

The boards publish these feeds so that others can share their jobs and each asks for credit in return. When you display or republish records, honour the requirement of the board in `source`:

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

**Is it legal to use this data?**
The Actor only reads endpoints the boards publish for this purpose, at low request rates, and stores no personal data. Following each board's attribution conditions and the laws that apply to your use is your responsibility.

**Why does a board return fewer jobs than I asked for?**
Boards expose only their newest listings (RemoteOK about 100, Remotive a small public sample, Jobicy up to 200, Himalayas and We Work Remotely a few hundred), and `postedWithinDays` removes older ones.

**Can it search LinkedIn, Indeed or Glassdoor?**
No. Those sites prohibit automated access and offer no public feed, so they are out of scope by design.

## Support and feedback

Missing a board with a public feed, or found a mapping that looks wrong? Open a ticket in the **Issues** tab. The Actor is open source under the MIT licence.
