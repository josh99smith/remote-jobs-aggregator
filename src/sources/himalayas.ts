/**
 * Himalayas public jobs API: https://himalayas.app/jobs/api?limit=20&cursor=...
 * Pages are capped at 20 jobs by the API regardless of `limit`; `nextCursor` continues the feed,
 * which is ordered newest first (so we can stop paginating once jobs are older than `since`).
 */
import { setTimeout as sleep } from 'node:timers/promises';

import { fetchJson } from '../http.js';
import {
    asNumber,
    asString,
    asStringArray,
    describe,
    normalizeEmploymentType,
    normalizeRegion,
    normalizeSalaryPeriod,
    toIso,
} from '../normalize.js';
import type { FetchOptions, JobRecord } from '../types.js';
import { SOURCE_LABELS } from '../types.js';

export const HIMALAYAS_API = 'https://himalayas.app/jobs/api';
export const HIMALAYAS_PAGE_SIZE = 20;
const PAGE_DELAY_MS = 250;

export interface HimalayasJob {
    title?: string;
    excerpt?: string;
    companyName?: string;
    companySlug?: string;
    companyLogo?: string;
    employmentType?: string;
    minSalary?: number;
    maxSalary?: number;
    salaryPeriod?: string;
    seniority?: string[];
    currency?: string;
    locationRestrictions?: string[];
    timezoneRestrictions?: number[];
    categories?: string[];
    parentCategories?: string[];
    description?: string;
    pubDate?: number;
    expiryDate?: number;
    applicationLink?: string;
    guid?: string;
}

export interface HimalayasResponse {
    totalCount?: number;
    nextCursor?: string | null;
    jobs?: HimalayasJob[];
}

export function isHimalayasJob(value: unknown): value is HimalayasJob {
    if (!value || typeof value !== 'object') return false;
    const v = value as HimalayasJob;
    return typeof v.title === 'string' && typeof v.guid === 'string';
}

/** Himalayas category slugs use hyphens for spaces ("Customer-Experience"). */
function unhyphenate(value: string): string {
    return value.replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
}

function idFromGuid(guid: string, companySlug: string | undefined): string {
    try {
        const parts = new URL(guid).pathname.split('/').filter(Boolean);
        const jobSlug = parts[parts.length - 1] ?? guid;
        return `himalayas:${companySlug ?? parts[1] ?? 'job'}/${jobSlug}`;
    } catch {
        return `himalayas:${guid}`;
    }
}

export function mapHimalayasJob(job: HimalayasJob, fetchedAt: string): JobRecord {
    const locations = asStringArray(job.locationRestrictions);
    const salaryMin = asNumber(job.minSalary);
    const salaryMax = asNumber(job.maxSalary);
    const currency = asString(job.currency);
    const period = normalizeSalaryPeriod(job.salaryPeriod);
    const salaryRaw =
        salaryMin || salaryMax
            ? `${currency ?? ''} ${salaryMin ?? ''}${salaryMin && salaryMax ? ' - ' : ''}${salaryMax ?? ''}${period ? ` ${period}` : ''}`
                  .replace(/\s+/g, ' ')
                  .trim()
            : null;
    const parents = asStringArray(job.parentCategories).map(unhyphenate);
    const categories = asStringArray(job.categories).map(unhyphenate);
    return {
        id: idFromGuid(job.guid!, job.companySlug),
        source: SOURCE_LABELS.himalayas,
        success: true,
        title: (job.title ?? '').trim(),
        company: asString(job.companyName),
        companyLogo: asString(job.companyLogo),
        location: locations.length ? locations.join(', ') : null,
        remoteRegion: locations.length ? normalizeRegion(locations) : 'Worldwide',
        category: parents[0] ?? categories[0] ?? null,
        tags: [...new Set([...parents.slice(1), ...categories])],
        employmentType: normalizeEmploymentType(job.employmentType),
        salaryMin,
        salaryMax,
        salaryCurrency: salaryMin || salaryMax ? (currency ?? null) : currency,
        salaryPeriod: salaryMin || salaryMax ? period : null,
        salaryRaw,
        ...describe(job.description),
        url: job.guid!,
        applyUrl: asString(job.applicationLink) ?? job.guid!,
        publishedAt: toIso(job.pubDate),
        fetchedAt,
        raw: job,
    };
}

export type JsonFetcher = <T>(url: string, timeoutMs: number) => Promise<T>;

const defaultFetcher: JsonFetcher = async <T>(url: string, timeoutMs: number) => fetchJson<T>(url, { timeoutMs });

export async function fetchHimalayas(
    options: FetchOptions,
    fetcher: JsonFetcher = defaultFetcher,
): Promise<JobRecord[]> {
    const fetchedAt = new Date().toISOString();
    const out: JobRecord[] = [];
    const seen = new Set<string>();
    let cursor: string | null | undefined = null;
    let page = 0;
    const maxPages = Math.ceil(options.limit / HIMALAYAS_PAGE_SIZE) + 1;

    while (out.length < options.limit && page < maxPages) {
        const pageSize = Math.min(HIMALAYAS_PAGE_SIZE, options.limit - out.length);
        const url = `${HIMALAYAS_API}?limit=${pageSize}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
        const data: HimalayasResponse = await fetcher<HimalayasResponse>(url, options.timeoutMs);
        if (!data || typeof data !== 'object' || !Array.isArray(data.jobs)) {
            throw new Error('Himalayas API returned an unexpected shape (expected { jobs: [...], nextCursor }).');
        }
        page += 1;
        const jobs = data.jobs.filter(isHimalayasJob);
        if (jobs.length === 0) break;

        let sawOldJob = false;
        for (const job of jobs) {
            const record = mapHimalayasJob(job, fetchedAt);
            if (seen.has(record.id)) continue;
            seen.add(record.id);
            if (options.since && record.publishedAt && new Date(record.publishedAt) < options.since) {
                sawOldJob = true;
                continue;
            }
            out.push(record);
            if (out.length >= options.limit) break;
        }
        if (sawOldJob || !data.nextCursor || data.nextCursor === cursor) break;
        cursor = data.nextCursor;
        await sleep(PAGE_DELAY_MS);
    }
    return out;
}
