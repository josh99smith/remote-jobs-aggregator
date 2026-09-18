/**
 * Source registry plus the pure post-processing steps applied to every batch of jobs:
 * date window, keyword and category filters, cross-source de-duplication and output shaping.
 */
import { dedupeKey, isWithin, matchesCategories, matchesKeywords } from './normalize.js';
import { fetchHimalayas } from './sources/himalayas.js';
import { fetchJobicy } from './sources/jobicy.js';
import { fetchRemoteOk } from './sources/remoteok.js';
import { fetchRemotive } from './sources/remotive.js';
import { fetchWeWorkRemotely } from './sources/weworkremotely.js';
import type { FetchOptions, JobRecord, SourceKey } from './types.js';

export const SOURCE_FETCHERS: Record<SourceKey, (options: FetchOptions) => Promise<JobRecord[]>> = {
    remoteok: fetchRemoteOk,
    remotive: fetchRemotive,
    himalayas: fetchHimalayas,
    jobicy: fetchJobicy,
    weworkremotely: fetchWeWorkRemotely,
};

export interface FilterOptions {
    keywords: string[];
    categories: string[];
    since: Date | null;
    dedupe: boolean;
    includeDescription: boolean;
    includeRaw: boolean;
}

export interface FilterStats {
    kept: number;
    tooOld: number;
    keywordMiss: number;
    categoryMiss: number;
    duplicates: number;
}

/**
 * Applies the user's filters to one source's jobs. `seenKeys` is shared across sources so the same
 * title + company pair is only emitted once per run. Mappers attach the source item as `raw`; it is
 * dropped here unless includeRaw is on.
 */
export function filterJobs(
    jobs: JobRecord[],
    options: FilterOptions,
    seenKeys: Set<string>,
): { jobs: JobRecord[]; stats: FilterStats } {
    const stats: FilterStats = { kept: 0, tooOld: 0, keywordMiss: 0, categoryMiss: 0, duplicates: 0 };
    const out: JobRecord[] = [];
    for (const job of jobs) {
        if (!isWithin(job.publishedAt, options.since)) {
            stats.tooOld += 1;
            continue;
        }
        if (!matchesKeywords(job, options.keywords)) {
            stats.keywordMiss += 1;
            continue;
        }
        if (!matchesCategories(job, options.categories)) {
            stats.categoryMiss += 1;
            continue;
        }
        if (options.dedupe) {
            const key = dedupeKey(job);
            if (seenKeys.has(key)) {
                stats.duplicates += 1;
                continue;
            }
            seenKeys.add(key);
        }
        const shaped: JobRecord = { ...job };
        if (!options.includeDescription) delete shaped.descriptionHtml;
        if (!options.includeRaw) delete shaped.raw;
        out.push(shaped);
        stats.kept += 1;
    }
    return { jobs: out, stats };
}
