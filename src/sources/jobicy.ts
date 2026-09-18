/**
 * Jobicy public API v2: https://jobicy.com/api/v2/remote-jobs?count=N
 * Returns { success, jobCount, jobs: [...] }. `count` is capped at 200 by the API.
 * Attribution: credit Jobicy with a direct link and send applicants to the job URL from the feed.
 */
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

export const JOBICY_API = 'https://jobicy.com/api/v2/remote-jobs';
export const JOBICY_MAX_COUNT = 200;

export interface JobicyJob {
    id?: number | string;
    url?: string;
    jobSlug?: string;
    jobTitle?: string;
    companyName?: string;
    companyLogo?: string;
    jobIndustry?: string[];
    jobType?: string[];
    jobGeo?: string;
    jobLevel?: string;
    jobExcerpt?: string;
    jobDescription?: string;
    pubDate?: string;
    salaryMin?: number;
    salaryMax?: number;
    salaryCurrency?: string;
    salaryPeriod?: string;
}

export interface JobicyResponse {
    success?: boolean;
    error?: string;
    jobCount?: number;
    jobs?: JobicyJob[];
}

export function isJobicyJob(value: unknown): value is JobicyJob {
    if (!value || typeof value !== 'object') return false;
    const v = value as JobicyJob;
    return v.id !== undefined && typeof v.jobTitle === 'string' && typeof v.url === 'string';
}

export function mapJobicyJob(job: JobicyJob, fetchedAt: string): JobRecord {
    const industries = asStringArray(job.jobIndustry);
    const geo = asString(job.jobGeo);
    const salaryMin = asNumber(job.salaryMin);
    const salaryMax = asNumber(job.salaryMax);
    const currency = asString(job.salaryCurrency);
    const period = normalizeSalaryPeriod(job.salaryPeriod);
    const hasSalary = Boolean(salaryMin || salaryMax);
    const tags = [...industries];
    const level = asString(job.jobLevel);
    if (level && level.toLowerCase() !== 'any') tags.push(level);
    return {
        id: `jobicy:${job.id}`,
        source: SOURCE_LABELS.jobicy,
        success: true,
        title: (job.jobTitle ?? '').trim(),
        company: asString(job.companyName),
        companyLogo: asString(job.companyLogo),
        location: geo,
        remoteRegion: geo ? normalizeRegion(geo) : 'Worldwide',
        category: industries[0] ?? null,
        tags,
        employmentType: normalizeEmploymentType(job.jobType),
        salaryMin,
        salaryMax,
        salaryCurrency: hasSalary ? currency : null,
        salaryPeriod: hasSalary ? period : null,
        salaryRaw: hasSalary
            ? `${currency ?? ''} ${salaryMin ?? ''}${salaryMin && salaryMax ? ' - ' : ''}${salaryMax ?? ''}${period ? ` ${period}` : ''}`
                  .replace(/\s+/g, ' ')
                  .trim()
            : null,
        ...describe(job.jobDescription ?? job.jobExcerpt),
        url: job.url!,
        applyUrl: job.url!,
        publishedAt: toIso(job.pubDate),
        fetchedAt,
        raw: job,
    };
}

export async function fetchJobicy(options: FetchOptions): Promise<JobRecord[]> {
    const fetchedAt = new Date().toISOString();
    const url = `${JOBICY_API}?count=${Math.min(options.limit, JOBICY_MAX_COUNT)}`;
    const data = await fetchJson<JobicyResponse>(url, { timeoutMs: options.timeoutMs });
    if (!data || typeof data !== 'object') throw new Error('Jobicy API returned an unexpected shape.');
    if (data.success === false) throw new Error(`Jobicy API error: ${data.error ?? 'unknown error'}`);
    if (!Array.isArray(data.jobs))
        throw new Error('Jobicy API returned an unexpected shape (expected { jobs: [...] }).');
    return data.jobs
        .filter(isJobicyJob)
        .slice(0, options.limit)
        .map((job) => mapJobicyJob(job, fetchedAt));
}
