# Changelog

## 0.2.2 (2026-09-23)

- Listing: joined the Best Damn series. New title "Best Damn Remote Jobs Aggregator", new description, icon and README banner. No change to inputs, output or pricing.
- README: new "Integrate and automate your workflow" section (Make, Zapier, n8n, Slack, Airbyte, GitHub, Google Drive, webhooks).
- Listing: "Best Damn" in the SEO title, refreshed banner, link to the new Best Damn YouTube Comments Scraper.

## 0.2.1 (2026-09-20)

- The remaining run budget is now also tracked from the Actor's own charge count, so a batch can never overshoot the cost cap.

## 0.2.0 (2026-09-19)

- Monitor mode: `onlyNew` remembers delivered job ids in a named key-value store (`stateStoreName`, default `remote-jobs-aggregator-seen`) and later runs return only listings not seen before. Skipped jobs are never billed.
- Every job record now carries `isNew`; `SUMMARY` reports `newItems`, `alreadySeen` and `stateStoreName`.
- `seenTtlDays` (default 90) prunes stale ids; the store is capped at 100,000 ids.

## 0.1.0 (2026-09-18)

- Initial release: collects remote job listings from the public APIs of RemoteOK, Remotive, Himalayas (cursor pagination) and Jobicy, and from the We Work Remotely RSS feeds (main feed plus category feeds).
- One normalized record per job: parsed salaries, canonical `remoteRegion`, unified employment types, HTML and plain-text descriptions, apply links.
- Keyword, category and age filters, cross-board de-duplication by title + company, optional raw source records.
- Boards that fail to load are reported as free `success: false` records; only listed jobs are billed.
