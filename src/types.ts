export const SOURCE_KEYS = ['remoteok', 'remotive', 'himalayas', 'jobicy', 'weworkremotely'] as const;
export type SourceKey = (typeof SOURCE_KEYS)[number];

export const SOURCE_LABELS: Record<SourceKey, string> = {
    remoteok: 'RemoteOK',
    remotive: 'Remotive',
    himalayas: 'Himalayas',
    jobicy: 'Jobicy',
    weworkremotely: 'We Work Remotely',
};

export type ErrorType =
    'invalid-url' | 'dns' | 'timeout' | 'blocked' | 'http-error' | 'network' | 'not-found' | 'rate-limited' | 'other';

export interface Input {
    sources?: SourceKey[];
    keywords?: string[];
    categories?: string[];
    maxJobsPerSource?: number;
    postedWithinDays?: number;
    dedupe?: boolean;
    includeDescription?: boolean;
    includeRaw?: boolean;
}

/** One normalized job listing. `raw` is only present when `includeRaw` is on. */
export interface JobRecord {
    id: string;
    source: string;
    success: true;
    title: string;
    company: string | null;
    companyLogo: string | null;
    location: string | null;
    remoteRegion: string | null;
    category: string | null;
    tags: string[];
    employmentType: string | null;
    salaryMin: number | null;
    salaryMax: number | null;
    salaryCurrency: string | null;
    salaryPeriod: string | null;
    salaryRaw: string | null;
    descriptionHtml?: string | null;
    descriptionText: string | null;
    url: string;
    applyUrl: string | null;
    publishedAt: string | null;
    fetchedAt: string;
    raw?: unknown;
}

export interface FailureItem {
    success: false;
    source: string;
    errorType: ErrorType;
    error: string;
    statusCode?: number;
    fetchedAt: string;
}

/** Options every source fetcher receives. */
export interface FetchOptions {
    /** Upper bound on jobs to return from this source. */
    limit: number;
    /** Oldest acceptable publication date, or null for no limit. Lets paginated sources stop early. */
    since: Date | null;
    /** Timeout budget per HTTP request. */
    timeoutMs: number;
}
