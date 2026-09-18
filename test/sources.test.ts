import { describe, expect, it } from 'vitest';

import { fetchHimalayas, type HimalayasResponse, mapHimalayasJob } from '../src/sources/himalayas.js';
import { mapJobicyJob } from '../src/sources/jobicy.js';
import { isRemoteOkJob, mapRemoteOkJob } from '../src/sources/remoteok.js';
import { mapRemotiveJob } from '../src/sources/remotive.js';
import { fetchWeWorkRemotely, mapWwrItem, parseWwrFeed, splitSkills } from '../src/sources/weworkremotely.js';

const FETCHED_AT = '2026-09-18T12:00:00.000Z';

describe('RemoteOK mapper', () => {
    const legal = { last_updated: 1789738193, legal: 'API Terms of Service: Please link back...' };
    const raw = {
        slug: 'remote-golang-kubernetes-engineer-arango-1137400',
        id: '1137400',
        epoch: 1789585202,
        date: '2026-09-16T19:00:02+00:00',
        company: 'Arango',
        company_logo: '',
        position: 'Golang Kubernetes Engineer',
        tags: ['golang', 'golang', 'engineer'],
        description: 'Remote - Arango delivers...<br/><br/>Please mention the word <strong>X</strong>',
        location: 'Remote - US',
        apply_url: 'https://remoteOK.com/remote-jobs/remote-golang-kubernetes-engineer-arango-1137400',
        salary_min: 150000,
        salary_max: 250000,
        logo: 'https://remoteok.com/assets/logo.png',
        url: 'https://remoteOK.com/remote-jobs/remote-golang-kubernetes-engineer-arango-1137400',
    };

    it('skips the legal notice element', () => {
        expect(isRemoteOkJob(legal)).toBe(false);
        expect(isRemoteOkJob(raw)).toBe(true);
    });

    it('maps fields', () => {
        const job = mapRemoteOkJob(raw, FETCHED_AT);
        expect(job.id).toBe('remoteok:1137400');
        expect(job.source).toBe('RemoteOK');
        expect(job.title).toBe('Golang Kubernetes Engineer');
        expect(job.company).toBe('Arango');
        expect(job.companyLogo).toBe('https://remoteok.com/assets/logo.png');
        expect(job.tags).toEqual(['golang', 'engineer']);
        expect(job.location).toBe('Remote - US');
        expect(job.remoteRegion).toBe('US');
        expect(job.salaryMin).toBe(150000);
        expect(job.salaryMax).toBe(250000);
        expect(job.salaryCurrency).toBe('USD');
        expect(job.salaryRaw).toBe('$150000 - $250000');
        expect(job.url).toBe('https://remoteok.com/remote-jobs/remote-golang-kubernetes-engineer-arango-1137400');
        expect(job.publishedAt).toBe('2026-09-16T19:00:02.000Z');
        expect(job.descriptionText).toContain('Remote - Arango delivers...\n\nPlease mention the word X');
        expect(job.raw).toBe(raw);
    });

    it('treats zero salaries and empty location as unknown / worldwide', () => {
        const job = mapRemoteOkJob({ ...raw, salary_min: 0, salary_max: 0, location: '' }, FETCHED_AT);
        expect(job.salaryMin).toBeNull();
        expect(job.salaryCurrency).toBeNull();
        expect(job.salaryRaw).toBeNull();
        expect(job.location).toBeNull();
        expect(job.remoteRegion).toBe('Worldwide');
    });
});

describe('Remotive mapper', () => {
    it('maps fields and parses the salary string', () => {
        const job = mapRemotiveJob(
            {
                id: 2091129,
                url: 'https://remotive.com/remote-jobs/data/senior-data-scientist-2091129',
                title: 'Senior Data Scientist',
                company_name: 'Lemon.io',
                company_logo: 'https://remotive.com/job/2091129/logo',
                category: 'Data and Analytics',
                tags: ['python', 'Typescript '],
                job_type: 'full_time',
                publication_date: '2026-09-16T12:35:28',
                candidate_required_location: 'Northern America, LATAM, Europe, APAC',
                salary: '$170k - $200k',
                description: '<p>Are you a talented <a href="x">Senior Data Scientist</a>?</p>',
                company_logo_url: 'https://remotive.com/job/2091129/logo',
            },
            FETCHED_AT,
        );
        expect(job.id).toBe('remotive:2091129');
        expect(job.source).toBe('Remotive');
        expect(job.employmentType).toBe('Full-Time');
        expect(job.tags).toEqual(['python', 'Typescript']);
        expect(job.remoteRegion).toBe('US, LATAM, EU, APAC');
        expect(job.salaryMin).toBe(170000);
        expect(job.salaryMax).toBe(200000);
        expect(job.salaryPeriod).toBe('yearly');
        expect(job.salaryRaw).toBe('$170k - $200k');
        expect(job.publishedAt).toBe('2026-09-16T12:35:28.000Z');
        expect(job.descriptionText).toBe('Are you a talented Senior Data Scientist ?');
    });
});

describe('Himalayas mapper and pagination', () => {
    const raw = {
        title: 'Provider Enrollment - REMOTE',
        companyName: 'Gainwell Technologies',
        companySlug: 'gainwell-technologies',
        companyLogo: 'https://cdn-images.himalayas.app/abc',
        employmentType: 'Full Time',
        minSalary: 31200,
        maxSalary: 44500,
        salaryPeriod: 'annual',
        seniority: ['Entry-level'],
        currency: 'USD',
        locationRestrictions: ['United States'],
        categories: ['Provider-Enrollment', 'Customer-Service'],
        parentCategories: ['Customer Service', 'Operations'],
        description: '<p>Great companies need great teams.</p>',
        pubDate: 1789750770,
        applicationLink: 'https://himalayas.app/companies/gainwell-technologies/jobs/provider-enrollment-remote',
        guid: 'https://himalayas.app/companies/gainwell-technologies/jobs/provider-enrollment-remote',
    };

    it('maps fields', () => {
        const job = mapHimalayasJob(raw, FETCHED_AT);
        expect(job.id).toBe('himalayas:gainwell-technologies/provider-enrollment-remote');
        expect(job.category).toBe('Customer Service');
        expect(job.tags).toEqual(['Operations', 'Provider Enrollment', 'Customer Service']);
        expect(job.employmentType).toBe('Full-Time');
        expect(job.remoteRegion).toBe('US');
        expect(job.salaryPeriod).toBe('yearly');
        expect(job.salaryRaw).toBe('USD 31200 - 44500 yearly');
        expect(job.publishedAt).toBe('2026-09-18T16:59:30.000Z');
    });

    it('follows nextCursor until the limit is reached', async () => {
        const calls: string[] = [];
        const page = (n: number, next: string | null): HimalayasResponse => ({
            nextCursor: next,
            jobs: Array.from({ length: 20 }, (_, i) => ({
                ...raw,
                guid: `https://himalayas.app/companies/c/jobs/p${n}-j${i}`,
            })),
        });
        const fetcher = async <T>(url: string): Promise<T> => {
            calls.push(url);
            if (url.includes('cursor=c1')) return page(2, 'c2') as T;
            if (url.includes('cursor=c2')) return page(3, null) as T;
            return page(1, 'c1') as T;
        };
        const jobs = await fetchHimalayas({ limit: 45, since: null, timeoutMs: 1000 }, fetcher);
        expect(jobs).toHaveLength(45);
        expect(calls).toHaveLength(3);
        expect(calls[0]).toBe('https://himalayas.app/jobs/api?limit=20');
        expect(calls[2]).toContain('limit=5&cursor=c2');
    });

    it('stops paginating once jobs are older than the window', async () => {
        let calls = 0;
        const fetcher = async <T>(): Promise<T> => {
            calls += 1;
            return { nextCursor: 'more', jobs: [{ ...raw, pubDate: 1_600_000_000 }] } as T;
        };
        const jobs = await fetchHimalayas({ limit: 100, since: new Date('2026-01-01'), timeoutMs: 1000 }, fetcher);
        expect(jobs).toHaveLength(0);
        expect(calls).toBe(1);
    });

    it('rejects an unexpected shape', async () => {
        const fetcher = async <T>(): Promise<T> => ({ hello: 'world' }) as T;
        await expect(fetchHimalayas({ limit: 10, since: null, timeoutMs: 1000 }, fetcher)).rejects.toThrow(
            /unexpected shape/,
        );
    });
});

describe('Jobicy mapper', () => {
    it('maps fields', () => {
        const job = mapJobicyJob(
            {
                id: 153610,
                url: 'https://jobicy.com/jobs/153610-manager',
                jobSlug: '153610-manager',
                jobTitle: 'Manager, Clinical Review',
                companyName: 'SmithRx',
                companyLogo: 'https://jobicy.com/logo.jpeg',
                jobIndustry: ['Healthcare & Medical'],
                jobType: ['Full-Time'],
                jobGeo: 'Anywhere',
                jobLevel: 'Senior',
                jobExcerpt: 'Who We Are',
                jobDescription: '<p><strong>Who We Are:</strong></p>',
                pubDate: '2026-09-18T14:43:04+00:00',
                salaryMin: 136000,
                salaryMax: 192000,
                salaryCurrency: 'USD',
                salaryPeriod: 'yearly',
            },
            FETCHED_AT,
        );
        expect(job.id).toBe('jobicy:153610');
        expect(job.source).toBe('Jobicy');
        expect(job.category).toBe('Healthcare & Medical');
        expect(job.tags).toEqual(['Healthcare & Medical', 'Senior']);
        expect(job.remoteRegion).toBe('Worldwide');
        expect(job.employmentType).toBe('Full-Time');
        expect(job.salaryRaw).toBe('USD 136000 - 192000 yearly');
        expect(job.publishedAt).toBe('2026-09-18T14:43:04.000Z');
        expect(job.descriptionText).toBe('Who We Are:');
    });
});

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss">
  <channel>
    <title>We Work Remotely: Remote jobs</title>
    <item>
      <title>Toptal: Senior Integration Engineer &amp; Architect</title>
      <region>North America Only</region>
      <country>\u{1F1FA}\u{1F1F8} United States of America</country>
      <state></state>
      <skills>Java, PostgreSQL, and Spring</skills>
      <category>Full-Stack Programming</category>
      <type>Full-Time</type>
      <description>&lt;p&gt;&lt;strong&gt;Headquarters:&lt;/strong&gt; NYC&lt;/p&gt;</description>
      <pubDate>Fri, 18 Sep 2026 17:01:08 +0000</pubDate>
      <guid>https://weworkremotely.com/remote-jobs/toptal-senior-integration-engineer</guid>
      <link>https://weworkremotely.com/remote-jobs/toptal-senior-integration-engineer</link>
      <media:content url="https://wwr-pro.s3.amazonaws.com/logos/0171/3386/logo.gif" type="image/png"/>
    </item>
    <item>
      <title>Second: Role</title>
      <region>Anywhere in the World</region>
      <category>Design</category>
      <type>Contract</type>
      <pubDate>Thu, 17 Sep 2026 10:00:00 +0000</pubDate>
      <guid>https://weworkremotely.com/remote-jobs/second-role</guid>
      <link>https://weworkremotely.com/remote-jobs/second-role</link>
    </item>
  </channel>
</rss>`;

describe('We Work Remotely feed', () => {
    it('parses items and maps fields', () => {
        const items = parseWwrFeed(RSS);
        expect(items).toHaveLength(2);
        const job = mapWwrItem(items[0], FETCHED_AT)!;
        expect(job.id).toBe('weworkremotely:toptal-senior-integration-engineer');
        expect(job.source).toBe('We Work Remotely');
        expect(job.company).toBe('Toptal');
        expect(job.title).toBe('Senior Integration Engineer & Architect');
        expect(job.location).toBe('United States of America');
        expect(job.remoteRegion).toBe('US');
        expect(job.category).toBe('Full-Stack Programming');
        expect(job.tags).toEqual(['Java', 'PostgreSQL', 'Spring']);
        expect(job.employmentType).toBe('Full-Time');
        expect(job.companyLogo).toBe('https://wwr-pro.s3.amazonaws.com/logos/0171/3386/logo.gif');
        expect(job.descriptionHtml).toBe('<p><strong>Headquarters:</strong> NYC</p>');
        expect(job.descriptionText).toBe('Headquarters: NYC');
        expect(job.publishedAt).toBe('2026-09-18T17:01:08.000Z');

        const second = mapWwrItem(items[1], FETCHED_AT)!;
        expect(second.remoteRegion).toBe('Worldwide');
        expect(second.location).toBe('Anywhere in the World');
        expect(second.companyLogo).toBeNull();
    });

    it('handles a single-item feed and an empty channel', () => {
        const single = RSS.replace(/<item>[\s\S]*?<\/item>\s*(?=<item>)/, '');
        expect(parseWwrFeed(single)).toHaveLength(1);
        expect(
            parseWwrFeed('<?xml version="1.0"?><rss version="2.0"><channel><title>x</title></channel></rss>'),
        ).toEqual([]);
        expect(() => parseWwrFeed('<html><body>Not a feed</body></html>')).toThrow(/not an RSS document/);
    });

    it('splits skills', () => {
        expect(splitSkills('Outreach, Sales, Deal Closure, and Customer Service')).toEqual([
            'Outreach',
            'Sales',
            'Deal Closure',
            'Customer Service',
        ]);
    });

    it('merges the main and category feeds without duplicates and tolerates a broken category feed', async () => {
        const urls: string[] = [];
        const fetcher = async (url: string) => {
            urls.push(url);
            if (url.includes('remote-design-jobs')) throw new Error('HTTP 500');
            return RSS;
        };
        const jobs = await fetchWeWorkRemotely({ limit: 500, since: null, timeoutMs: 1000 }, fetcher);
        expect(jobs).toHaveLength(2);
        expect(urls[0]).toBe('https://weworkremotely.com/remote-jobs.rss');
        expect(urls.length).toBe(11);
    }, 15_000);

    it('stops fetching feeds once the limit is reached', async () => {
        let calls = 0;
        const jobs = await fetchWeWorkRemotely({ limit: 1, since: null, timeoutMs: 1000 }, async () => {
            calls += 1;
            return RSS;
        });
        expect(jobs).toHaveLength(1);
        expect(calls).toBe(1);
    });
});
