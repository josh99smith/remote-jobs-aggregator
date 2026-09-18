/**
 * RemoteOK public API: https://remoteok.com/api
 * Returns a JSON array whose first element is a legal notice object (no `id`), followed by ~100 jobs.
 * Attribution: link back to the job's RemoteOK URL and name "Remote OK" as the source.
 */
import { fetchJson } from '../http.js';
import {
    asNumber,
    asString,
    asStringArray,
    cleanLocation,
    describe,
    fixMojibake,
    normalizeRegion,
    toIso,
} from '../normalize.js';
import type { FetchOptions, JobRecord } from '../types.js';
import { SOURCE_LABELS } from '../types.js';

export const REMOTEOK_API = 'https://remoteok.com/api';

export interface RemoteOkJob {
    id?: string | number;
    slug?: string;
    epoch?: number;
    date?: string;
    company?: string;
    company_logo?: string;
    position?: string;
    tags?: string[];
    description?: string;
    location?: string;
    apply_url?: string;
    salary_min?: number;
    salary_max?: number;
    logo?: string;
    url?: string;
    legal?: string;
}

export function isRemoteOkJob(value: unknown): value is RemoteOkJob {
    if (!value || typeof value !== 'object') return false;
    const v = value as RemoteOkJob;
    return v.id !== undefined && typeof v.position === 'string' && typeof v.url === 'string';
}

function formatUsdRange(min: number | null, max: number | null): string | null {
    if (min && max) return `$${min} - $${max}`;
    if (min || max) return `$${min ?? max}`;
    return null;
}

export function mapRemoteOkJob(job: RemoteOkJob, fetchedAt: string): JobRecord {
    const location = cleanLocation(job.location);
    const company = asString(job.company);
    const salaryMin = asNumber(job.salary_min);
    const salaryMax = asNumber(job.salary_max);
    const url = job.url!.replace('https://remoteOK.com', 'https://remoteok.com');
    return {
        id: `remoteok:${job.id}`,
        source: SOURCE_LABELS.remoteok,
        success: true,
        title: fixMojibake((job.position ?? '').trim()),
        company: company ? fixMojibake(company) : null,
        companyLogo: asString(job.company_logo) ?? asString(job.logo),
        location,
        remoteRegion: location ? normalizeRegion(location) : 'Worldwide',
        category: null,
        tags: asStringArray(job.tags),
        employmentType: null,
        salaryMin,
        salaryMax,
        salaryCurrency: salaryMin || salaryMax ? 'USD' : null,
        salaryPeriod: salaryMin || salaryMax ? 'yearly' : null,
        salaryRaw: formatUsdRange(salaryMin, salaryMax),
        ...describe(job.description),
        url,
        applyUrl: asString(job.apply_url)?.replace('https://remoteOK.com', 'https://remoteok.com') ?? url,
        publishedAt: toIso(job.date) ?? toIso(job.epoch),
        fetchedAt,
        raw: job,
    };
}

export async function fetchRemoteOk(options: FetchOptions): Promise<JobRecord[]> {
    const fetchedAt = new Date().toISOString();
    const data = await fetchJson<unknown>(REMOTEOK_API, { timeoutMs: options.timeoutMs });
    if (!Array.isArray(data)) throw new Error('RemoteOK API returned an unexpected shape (expected a JSON array).');
    const jobs = data.filter(isRemoteOkJob);
    if (jobs.length === 0 && data.length > 1) throw new Error('RemoteOK API returned no recognisable job objects.');
    return jobs.slice(0, options.limit).map((job) => mapRemoteOkJob(job, fetchedAt));
}
