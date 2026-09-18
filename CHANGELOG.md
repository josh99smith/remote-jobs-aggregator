# Changelog

## 0.1.0 (2026-09-18)

- Initial release: collects remote job listings from the public APIs of RemoteOK, Remotive, Himalayas (cursor pagination) and Jobicy, and from the We Work Remotely RSS feeds (main feed plus category feeds).
- One normalized record per job: parsed salaries, canonical `remoteRegion`, unified employment types, HTML and plain-text descriptions, apply links.
- Keyword, category and age filters, cross-board de-duplication by title + company, optional raw source records.
- Boards that fail to load are reported as free `success: false` records; only listed jobs are billed.
