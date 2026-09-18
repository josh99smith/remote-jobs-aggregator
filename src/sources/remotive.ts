/**
 * Remotive public API: https://remotive.com/api/remote-jobs?limit=N
 * Returns { "0-legal-notice", "job-count", "jobs": [...] }. Jobs are delayed by 24 hours on purpose.
 * Attribution: link back to the Remotive job URL and mention Remotive as the source.
 */
import { fetchJson } from '../http.js';
import {
    asString,
    asStringArray,
    describe,
    normalizeEmploymentType,
    normalizeRegion,
    parseSalaryString,
    toIso,
} from '../normalize.js';
import type { FetchOptions, JobRecord } from '../types.js';
import { SOURCE_LABELS } from '../types.js';

export const REMOTIVE_API = 'https://remotive.com/api/remote-jobs';

export interface RemotiveJob {
    id?: number | string;
    url?: string;
    title?: string;
    company_name?: string;
    company_logo?: string;
    company_logo_url?: string;
    category?: string;
    tags?: string[];
    job_type?: string;
    publication_date?: string;
    candidate_required_location?: string;
    salary?: string;
    description?: string;
}

export interface RemotiveResponse {
    'job-count'?: number;
    'total-job-count'?: number;
    jobs?: RemotiveJob[];
}

export function isRemotiveJob(value: unknown): value is RemotiveJob {
    if (!value || typeof value !== 'object') return false;
    const v = value as RemotiveJob;
    return v.id !== undefined && typeof v.title === 'string' && typeof v.url === 'string';
}

export function mapRemotiveJob(job: RemotiveJob, fetchedAt: string): JobRecord {
    const location = asString(job.candidate_required_location);
    const salaryRaw = asString(job.salary);
    return {
        id: `remotive:${job.id}`,
        source: SOURCE_LABELS.remotive,
        success: true,
        title: (job.title ?? '').trim(),
        company: asString(job.company_name),
        companyLogo: asString(job.company_logo_url) ?? asString(job.company_logo),
        location,
        remoteRegion: location ? normalizeRegion(location) : 'Worldwide',
        category: asString(job.category),
        tags: asStringArray(job.tags),
        employmentType: normalizeEmploymentType(job.job_type),
        ...parseSalaryString(salaryRaw),
        salaryRaw,
        ...describe(job.description),
        url: job.url!,
        applyUrl: job.url!,
        publishedAt: toIso(job.publication_date),
        fetchedAt,
        raw: job,
    };
}

export async function fetchRemotive(options: FetchOptions): Promise<JobRecord[]> {
    const fetchedAt = new Date().toISOString();
    const url = `${REMOTIVE_API}?limit=${options.limit}`;
    const data = await fetchJson<RemotiveResponse>(url, { timeoutMs: options.timeoutMs });
    if (!data || typeof data !== 'object' || !Array.isArray(data.jobs)) {
        throw new Error('Remotive API returned an unexpected shape (expected { jobs: [...] }).');
    }
    return data.jobs
        .filter(isRemotiveJob)
        .slice(0, options.limit)
        .map((job) => mapRemotiveJob(job, fetchedAt));
}
