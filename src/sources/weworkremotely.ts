/**
 * We Work Remotely RSS feeds.
 * The main feed (https://weworkremotely.com/remote-jobs.rss) only carries ~10 jobs per category, so
 * the category feeds are fetched as well and merged by GUID. Item titles are "Company: Job title";
 * `<region>`, `<country>`, `<category>`, `<type>`, `<skills>` and `<media:content>` are WWR extensions.
 */
import { setTimeout as sleep } from 'node:timers/promises';

import { XMLParser } from 'fast-xml-parser';

import { fetchText } from '../http.js';
import {
    asString,
    describe,
    normalizeEmploymentType,
    normalizeRegion,
    splitCompanyTitle,
    stripEmoji,
    toIso,
} from '../normalize.js';
import type { FetchOptions, JobRecord } from '../types.js';
import { SOURCE_LABELS } from '../types.js';

export const WWR_MAIN_FEED = 'https://weworkremotely.com/remote-jobs.rss';
export const WWR_CATEGORY_FEEDS = [
    'https://weworkremotely.com/categories/remote-full-stack-programming-jobs.rss',
    'https://weworkremotely.com/categories/remote-front-end-programming-jobs.rss',
    'https://weworkremotely.com/categories/remote-back-end-programming-jobs.rss',
    'https://weworkremotely.com/categories/remote-devops-sysadmin-jobs.rss',
    'https://weworkremotely.com/categories/remote-design-jobs.rss',
    'https://weworkremotely.com/categories/remote-product-jobs.rss',
    'https://weworkremotely.com/categories/remote-sales-and-marketing-jobs.rss',
    'https://weworkremotely.com/categories/remote-customer-support-jobs.rss',
    'https://weworkremotely.com/categories/remote-management-and-finance-jobs.rss',
    'https://weworkremotely.com/categories/all-other-remote-jobs.rss',
];
const FEED_DELAY_MS = 300;

export interface WwrItem {
    title?: string;
    region?: string;
    country?: string;
    state?: string;
    skills?: string;
    category?: string;
    type?: string;
    description?: string;
    pubDate?: string;
    expires_at?: string;
    guid?: string | { '#text'?: string };
    link?: string;
    'media:content'?: { '@_url'?: string } | { '@_url'?: string }[];
}

const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    isArray: (name) => name === 'item',
    processEntities: true,
    htmlEntities: true,
    trimValues: true,
});

/** Parses an RSS document into its item list. Throws if the document is not an RSS feed. */
export function parseWwrFeed(xml: string): WwrItem[] {
    let doc: { rss?: { channel?: { item?: WwrItem[] } } };
    try {
        doc = parser.parse(xml) as typeof doc;
    } catch (error) {
        throw new Error(`We Work Remotely feed is not valid XML: ${(error as Error).message}`);
    }
    const channel = doc?.rss?.channel;
    if (!channel || typeof channel !== 'object') throw new Error('We Work Remotely feed is not an RSS document.');
    return Array.isArray(channel.item) ? channel.item : [];
}

function text(value: unknown): string | null {
    if (typeof value === 'string') return asString(value);
    if (value && typeof value === 'object' && '#text' in value)
        return asString((value as { '#text'?: unknown })['#text']);
    return asString(value);
}

export function splitSkills(value: string | null): string[] {
    if (!value) return [];
    return value
        .split(/\s*,\s*(?:and\s+)?|\s+and\s+/)
        .map((s) => s.trim())
        .filter(Boolean);
}

export function mapWwrItem(item: WwrItem, fetchedAt: string): JobRecord | null {
    const link = text(item.link) ?? text(item.guid);
    const rawTitle = text(item.title);
    if (!link || !rawTitle) return null;
    const { company, title } = splitCompanyTitle(rawTitle);
    const region = text(item.region);
    const country = text(item.country) ? stripEmoji(text(item.country)!).replace(/\s+/g, ' ').trim() : null;
    const state = text(item.state);
    const location = [country, state].filter(Boolean).join(', ') || region;
    const media = item['media:content'];
    const logo = Array.isArray(media) ? media[0]?.['@_url'] : media?.['@_url'];
    const category = text(item.category);
    const slug = link.split('/').filter(Boolean).pop() ?? link;
    return {
        id: `weworkremotely:${slug}`,
        source: SOURCE_LABELS.weworkremotely,
        success: true,
        title,
        company,
        companyLogo: asString(logo),
        location,
        remoteRegion: region ? normalizeRegion(region) : 'Worldwide',
        category,
        tags: splitSkills(text(item.skills)),
        employmentType: normalizeEmploymentType(text(item.type)),
        salaryMin: null,
        salaryMax: null,
        salaryCurrency: null,
        salaryPeriod: null,
        salaryRaw: null,
        ...describe(text(item.description)),
        url: link,
        applyUrl: link,
        publishedAt: toIso(text(item.pubDate)),
        fetchedAt,
        raw: item,
    };
}

export type TextFetcher = (url: string, timeoutMs: number) => Promise<string>;

const defaultFetcher: TextFetcher = async (url, timeoutMs) =>
    fetchText(url, { timeoutMs, accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8' });

export async function fetchWeWorkRemotely(
    options: FetchOptions,
    fetcher: TextFetcher = defaultFetcher,
): Promise<JobRecord[]> {
    const fetchedAt = new Date().toISOString();
    const out: JobRecord[] = [];
    const seen = new Set<string>();
    const feeds = [WWR_MAIN_FEED, ...WWR_CATEGORY_FEEDS];
    let feedErrors = 0;
    let lastError: unknown;

    for (const [index, feed] of feeds.entries()) {
        if (out.length >= options.limit) break;
        try {
            const xml = await fetcher(feed, options.timeoutMs);
            for (const item of parseWwrFeed(xml)) {
                const record = mapWwrItem(item, fetchedAt);
                if (!record || seen.has(record.id)) continue;
                seen.add(record.id);
                out.push(record);
                if (out.length >= options.limit) break;
            }
        } catch (error) {
            // The main feed is mandatory; a single broken category feed should not fail the whole source.
            if (index === 0) throw error;
            feedErrors += 1;
            lastError = error;
        }
        if (index < feeds.length - 1 && out.length < options.limit) await sleep(FEED_DELAY_MS);
    }
    if (out.length === 0 && lastError) throw lastError;
    if (feedErrors > 0 && out.length === 0) throw new Error('All We Work Remotely feeds failed.');
    return out;
}
