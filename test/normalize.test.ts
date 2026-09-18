import { describe, expect, it } from 'vitest';

import { categorizeError, HttpError } from '../src/http.js';
import {
    cleanLocation,
    dedupeKey,
    describe as describeHtml,
    fixMojibake,
    htmlToText,
    isWithin,
    matchesCategories,
    matchesKeywords,
    normalizeEmploymentType,
    normalizeRegion,
    parseSalaryString,
    splitCompanyTitle,
    toIso,
} from '../src/normalize.js';
import { filterJobs } from '../src/pipeline.js';
import type { JobRecord } from '../src/types.js';

function job(overrides: Partial<JobRecord>): JobRecord {
    return {
        id: 'x:1',
        source: 'Test',
        success: true,
        title: 'Senior Python Engineer',
        company: 'Acme',
        companyLogo: null,
        location: null,
        remoteRegion: null,
        category: 'Software Development',
        tags: ['python', 'django'],
        employmentType: null,
        salaryMin: null,
        salaryMax: null,
        salaryCurrency: null,
        salaryPeriod: null,
        salaryRaw: null,
        descriptionHtml: '<p>Hi</p>',
        descriptionText: 'Hi',
        url: 'https://example.com/job/1',
        applyUrl: null,
        publishedAt: new Date().toISOString(),
        fetchedAt: new Date().toISOString(),
        raw: { any: 'thing' },
        ...overrides,
    };
}

describe('htmlToText', () => {
    it('strips tags, decodes entities and keeps paragraph breaks', () => {
        const text = htmlToText(
            '<p>Hello &amp; <b>welcome</b></p><ul><li>one</li><li>two&nbsp;&#8211;&#x2014;</li></ul><script>x()</script>',
        );
        expect(text).toBe('Hello & welcome\none\ntwo \u2013\u2014');
    });

    it('caps description sizes', () => {
        const html = `<p>${'a'.repeat(30_000)}</p>`;
        const out = describeHtml(html);
        expect(out.descriptionHtml!.length).toBe(20_000);
        expect(out.descriptionText!.length).toBe(2_000);
        expect(describeHtml('   ')).toEqual({ descriptionHtml: null, descriptionText: null });
    });
});

describe('parseSalaryString', () => {
    it.each([
        ['$90 - $150 /hour', 90, 150, 'USD', 'hourly'],
        ['$170k - $200k', 170_000, 200_000, 'USD', 'yearly'],
        ['$31,2k- $52k', 31_200, 52_000, 'USD', 'yearly'],
        ['OTE $25k - $35k', 25_000, 35_000, 'USD', 'yearly'],
        ['\u20ac60K-\u20ac80K', 60_000, 80_000, 'EUR', 'yearly'],
        ['$14/hour', 14, 14, 'USD', 'hourly'],
        ['120,000 - 150,000 GBP per year', 120_000, 150_000, 'GBP', 'yearly'],
    ])('parses %s', (raw, min, max, currency, period) => {
        expect(parseSalaryString(raw)).toEqual({
            salaryMin: min,
            salaryMax: max,
            salaryCurrency: currency,
            salaryPeriod: period,
        });
    });

    it('returns nulls for empty or non-numeric text', () => {
        expect(parseSalaryString('')).toEqual({
            salaryMin: null,
            salaryMax: null,
            salaryCurrency: null,
            salaryPeriod: null,
        });
        expect(parseSalaryString('Competitive').salaryMin).toBeNull();
    });
});

describe('normalizeRegion', () => {
    it.each([
        ['Anywhere in the World', 'Worldwide'],
        ['Remote', 'Worldwide'],
        ['Remote - US', 'US'],
        ['USA Only', 'US'],
        ['Northern America, LATAM, Europe, APAC', 'US, LATAM, EU, APAC'],
        [['United States', 'Canada'], 'US, Canada'],
        ['Germany', 'EU'],
        ['United Kingdom of Great Britain and Northern Ireland', 'UK'],
        ['Seoul', null],
        ['', null],
        [[], null],
    ])('maps %j', (input, expected) => {
        expect(normalizeRegion(input as string | string[])).toBe(expected);
    });
});

describe('cleanLocation and fixMojibake', () => {
    it('removes repeated parts and trailing commas', () => {
        expect(cleanLocation('Austin, Austin, Texas, United States')).toBe('Austin, Texas, United States');
        expect(cleanLocation('Wichita, ')).toBe('Wichita');
        expect(cleanLocation('')).toBeNull();
    });

    it('repairs double-encoded UTF-8 but leaves clean text alone', () => {
        expect(fixMojibake('Z\u00c3\u00bcrich')).toBe('Z\u00fcrich');
        expect(fixMojibake('Z\u00fcrich')).toBe('Z\u00fcrich');
        expect(fixMojibake('Plain')).toBe('Plain');
    });
});

describe('small helpers', () => {
    it('splits "Company: Title"', () => {
        expect(splitCompanyTitle('Toptal: Senior Engineer: Platform')).toEqual({
            company: 'Toptal',
            title: 'Senior Engineer: Platform',
        });
        expect(splitCompanyTitle('No company here')).toEqual({ company: null, title: 'No company here' });
    });

    it('normalizes employment types', () => {
        expect(normalizeEmploymentType('full_time')).toBe('Full-Time');
        expect(normalizeEmploymentType(['Contractor'])).toBe('Contract');
        expect(normalizeEmploymentType('Intern')).toBe('Internship');
        expect(normalizeEmploymentType(undefined)).toBeNull();
    });

    it('converts dates', () => {
        expect(toIso(1789750770)).toBe('2026-09-18T16:59:30.000Z');
        expect(toIso('2026-09-16T12:35:28')).toBe('2026-09-16T12:35:28.000Z');
        expect(toIso('Fri, 18 Sep 2026 17:01:08 +0000')).toBe('2026-09-18T17:01:08.000Z');
        expect(toIso('not a date')).toBeNull();
    });

    it('builds a stable dedupe key', () => {
        expect(dedupeKey({ title: '  Senior  Engineer!', company: 'ACME Inc.' })).toBe('senior engineer|acme inc');
    });

    it('checks the date window', () => {
        const since = new Date(Date.now() - 86_400_000);
        expect(isWithin(new Date().toISOString(), since)).toBe(true);
        expect(isWithin('2020-01-01T00:00:00Z', since)).toBe(false);
        expect(isWithin(null, since)).toBe(true);
        expect(isWithin('2020-01-01T00:00:00Z', null)).toBe(true);
    });
});

describe('filters', () => {
    it('matches keywords against title, company and tags, case-insensitively', () => {
        const j = job({});
        expect(matchesKeywords(j, ['PYTHON'])).toBe(true);
        expect(matchesKeywords(j, ['acme'])).toBe(true);
        expect(matchesKeywords(j, ['django'])).toBe(true);
        expect(matchesKeywords(j, ['rust', 'go'])).toBe(false);
        expect(matchesKeywords(j, [])).toBe(true);
    });

    it('matches categories loosely', () => {
        const j = job({});
        expect(matchesCategories(j, ['software-dev'])).toBe(true);
        expect(matchesCategories(j, ['Software Development'])).toBe(true);
        expect(matchesCategories(job({ category: 'Full-Stack Programming', tags: [] }), ['programming'])).toBe(true);
        expect(matchesCategories(j, ['design'])).toBe(false);
    });

    it('filterJobs applies the window, filters, de-duplication and output shaping', () => {
        const seen = new Set<string>();
        const jobs = [
            job({ id: 'a' }),
            job({ id: 'b', source: 'Other' }), // duplicate title+company
            job({ id: 'c', title: 'Designer', tags: [], category: 'Design' }),
            job({ id: 'd', publishedAt: '2020-01-01T00:00:00Z' }),
        ];
        const { jobs: kept, stats } = filterJobs(
            jobs,
            {
                keywords: ['python'],
                categories: [],
                since: new Date(Date.now() - 86_400_000),
                dedupe: true,
                includeDescription: false,
                includeRaw: false,
            },
            seen,
        );
        expect(kept.map((j) => j.id)).toEqual(['a']);
        expect(stats).toEqual({ kept: 1, tooOld: 1, keywordMiss: 1, categoryMiss: 0, duplicates: 1 });
        expect(kept[0]).not.toHaveProperty('descriptionHtml');
        expect(kept[0]).not.toHaveProperty('raw');

        const withExtras = filterJobs(
            [job({ id: 'e', title: 'Other role' })],
            { keywords: [], categories: [], since: null, dedupe: false, includeDescription: true, includeRaw: true },
            seen,
        );
        expect(withExtras.jobs[0].descriptionHtml).toBe('<p>Hi</p>');
        expect(withExtras.jobs[0].raw).toEqual({ any: 'thing' });
    });
});

describe('categorizeError', () => {
    it.each([
        [new HttpError('HTTP 429', 429), 'rate-limited'],
        [new HttpError('HTTP 403', 403), 'blocked'],
        [new HttpError('HTTP 404', 404), 'not-found'],
        [new HttpError('HTTP 500', 500), 'http-error'],
        [Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }), 'timeout'],
        [Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } }), 'dns'],
        [Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNRESET' } }), 'network'],
        [new Error('Response is not valid JSON'), 'other'],
    ])('categorises %o', (error, expected) => {
        expect(categorizeError(error).errorType).toBe(expected);
    });
});
