/**
 * Pure helpers shared by all source adapters: HTML to text, salary parsing, region and
 * employment-type normalization, keyword/category filtering and de-duplication keys.
 */
import type { JobRecord } from './types.js';

export const MAX_DESCRIPTION_HTML = 20_000;
export const MAX_DESCRIPTION_TEXT = 2_000;

const NAMED_ENTITIES: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    ndash: '\u2013',
    mdash: '\u2014',
    hellip: '\u2026',
    rsquo: '\u2019',
    lsquo: '\u2018',
    rdquo: '\u201d',
    ldquo: '\u201c',
    bull: '\u2022',
    middot: '\u00b7',
    copy: '\u00a9',
    reg: '\u00ae',
    trade: '\u2122',
    euro: '\u20ac',
    pound: '\u00a3',
    yen: '\u00a5',
};

export function decodeEntities(input: string): string {
    return input.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
        const lower = entity.toLowerCase();
        if (lower.startsWith('#x')) {
            const code = Number.parseInt(lower.slice(2), 16);
            return Number.isFinite(code) ? String.fromCodePoint(code) : match;
        }
        if (lower.startsWith('#')) {
            const code = Number.parseInt(lower.slice(1), 10);
            return Number.isFinite(code) ? String.fromCodePoint(code) : match;
        }
        return NAMED_ENTITIES[lower] ?? match;
    });
}

/** Strips tags, decodes entities and collapses whitespace. Block-level tags become line breaks. */
export function htmlToText(html: string | null | undefined): string {
    if (!html) return '';
    const withBreaks = html
        .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, ' ')
        .replace(/<\s*br\s*\/?\s*>/gi, '\n')
        .replace(/<\s*\/\s*(p|div|li|h[1-6]|tr|ul|ol|blockquote|section|article|header|footer)\s*>/gi, '\n')
        .replace(/<[^>]+>/g, ' ');
    return decodeEntities(withBreaks)
        .replace(/\u00a0/g, ' ')
        .replace(/[ \t\f\v]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .replace(/\n{2,}/g, '\n\n')
        .trim();
}

export function truncate(value: string, max: number): string {
    if (value.length <= max) return value;
    return `${value.slice(0, max - 1)}\u2026`;
}

/** Splits a "Company: Job title" string as used in the We Work Remotely feed. */
export function splitCompanyTitle(value: string): { company: string | null; title: string } {
    const idx = value.indexOf(': ');
    if (idx <= 0) return { company: null, title: value.trim() };
    return { company: value.slice(0, idx).trim() || null, title: value.slice(idx + 2).trim() || value.trim() };
}

export interface ParsedSalary {
    salaryMin: number | null;
    salaryMax: number | null;
    salaryCurrency: string | null;
    salaryPeriod: string | null;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
    $: 'USD',
    '\u20ac': 'EUR',
    '\u00a3': 'GBP',
    '\u00a5': 'JPY',
    '\u20b9': 'INR',
};

/**
 * Best-effort parser for free-text salaries such as "$90 - $150 /hour", "$170k - $200k", "\u20ac60K-\u20ac80K",
 * "OTE $25k - $35k" or "$14/hour". Returns nulls when nothing numeric is found.
 */
export function parseSalaryString(raw: string | null | undefined): ParsedSalary {
    const empty: ParsedSalary = { salaryMin: null, salaryMax: null, salaryCurrency: null, salaryPeriod: null };
    if (!raw) return empty;
    const text = raw.trim();
    if (!text) return empty;

    let currency: string | null = null;
    const code = text.match(/\b(USD|EUR|GBP|CAD|AUD|INR|CHF|SEK|NOK|DKK|PLN|BRL|MXN|SGD|JPY|NZD|ZAR)\b/i);
    if (code) currency = code[1].toUpperCase();
    else {
        const symbol = Object.keys(CURRENCY_SYMBOLS).find((s) => text.includes(s));
        if (symbol) currency = CURRENCY_SYMBOLS[symbol];
    }

    let period: string | null = null;
    if (/\b(hour|hr|hourly)\b|\/\s*h\b/i.test(text)) period = 'hourly';
    else if (/\b(month|monthly|mo)\b/i.test(text)) period = 'monthly';
    else if (/\b(week|weekly)\b/i.test(text)) period = 'weekly';
    else if (/\b(day|daily)\b/i.test(text)) period = 'daily';
    else if (/\b(year|yr|annual|annually|pa|p\.a\.)\b/i.test(text)) period = 'yearly';

    const numbers: number[] = [];
    const re = /(\d{1,3}(?:[,.\s]\d{3})+|\d+(?:[.,]\d+)?)\s*(k|K)?(?![\d%])/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        let numText = m[1];
        // "31,2k" style decimal commas
        if (m[2] && /^\d+,\d$/.test(numText)) numText = numText.replace(',', '.');
        else numText = numText.replace(/[,\s]/g, '');
        let value = Number.parseFloat(numText);
        if (!Number.isFinite(value)) continue;
        if (m[2]) value *= 1000;
        numbers.push(value);
        if (numbers.length === 2) break;
    }
    if (numbers.length === 0)
        return { salaryMin: null, salaryMax: null, salaryCurrency: currency, salaryPeriod: period };
    const [a, b] = numbers;
    const min = b === undefined ? a : Math.min(a, b);
    const max = b === undefined ? a : Math.max(a, b);
    if (!period) period = max >= 5_000 ? 'yearly' : null;
    return { salaryMin: min, salaryMax: max, salaryCurrency: currency, salaryPeriod: period };
}

export function normalizeSalaryPeriod(value: string | null | undefined): string | null {
    if (!value) return null;
    const v = value.toLowerCase();
    if (v.startsWith('year') || v.startsWith('annual')) return 'yearly';
    if (v.startsWith('month')) return 'monthly';
    if (v.startsWith('week')) return 'weekly';
    if (v.startsWith('day') || v.startsWith('dai')) return 'daily';
    if (v.startsWith('hour')) return 'hourly';
    return v;
}

const EU_COUNTRIES =
    'austria|belgium|bulgaria|croatia|cyprus|czechia|czech republic|denmark|estonia|finland|france|germany|greece|hungary|ireland|italy|latvia|lithuania|luxembourg|malta|netherlands|poland|portugal|romania|slovakia|slovenia|spain|sweden|norway|switzerland|iceland|serbia|ukraine|albania|bosnia|montenegro|north macedonia|moldova|georgia|armenia|turkey';
const LATAM_COUNTRIES =
    'latam|latin america|south america|central america|brazil|brasil|mexico|argentina|colombia|chile|peru|uruguay|paraguay|bolivia|ecuador|venezuela|costa rica|panama|guatemala|honduras|el salvador|nicaragua|dominican republic|cuba|puerto rico';
const APAC_COUNTRIES =
    'apac|asia|asia pacific|australia|new zealand|oceania|singapore|japan|india|philippines|pakistan|indonesia|malaysia|vietnam|thailand|south korea|korea|taiwan|hong kong|china|bangladesh|sri lanka|nepal|cambodia';
const AFRICA_COUNTRIES =
    'africa|kenya|nigeria|south africa|morocco|egypt|namibia|ghana|ethiopia|uganda|tanzania|rwanda|senegal|tunisia|algeria|zimbabwe|zambia|cameroon';
const MIDDLE_EAST =
    'middle east|uae|united arab emirates|dubai|israel|saudi arabia|qatar|kuwait|bahrain|oman|jordan|lebanon';

const REGION_RULES: [RegExp, string][] = [
    [/\b(anywhere|worldwide|world wide|global|remote only|remote|remoto)\b/i, 'Worldwide'],
    [/\b(usa|u\.s\.a?|united states|us only|america only|north america|northern america|us)\b/i, 'US'],
    [/\b(canada|canadian)\b/i, 'Canada'],
    [new RegExp(`\\b(${LATAM_COUNTRIES})\\b`, 'i'), 'LATAM'],
    [/\b(uk|u\.k\.|united kingdom|great britain|england|scotland|wales)\b/i, 'UK'],
    [new RegExp(`\\b(eu|europe|european|emea|${EU_COUNTRIES})\\b`, 'i'), 'EU'],
    [new RegExp(`\\b(${APAC_COUNTRIES})\\b`, 'i'), 'APAC'],
    [new RegExp(`\\b(${AFRICA_COUNTRIES})\\b`, 'i'), 'Africa'],
    [new RegExp(`\\b(${MIDDLE_EAST})\\b`, 'i'), 'Middle East'],
];

export function stripEmoji(value: string): string {
    return value.replace(/[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]|\ufe0f/gu, '');
}

/**
 * Repairs UTF-8 text that was decoded as Latin-1 somewhere upstream (e.g. "\u00c3\u00a9" instead of "\u00e9").
 * Leaves the input untouched when it does not look double-encoded or cannot be repaired cleanly.
 */
export function fixMojibake(value: string): string {
    if (!/[\u00c2-\u00f4][\u0080-\u00bf]/.test(value)) return value;
    const repaired = Buffer.from(value, 'latin1').toString('utf8');
    return repaired.includes('\ufffd') ? value : repaired;
}

/** Trims, de-duplicates comma-separated parts ("Austin, Austin, Texas, United States") and drops empty parts. */
export function cleanLocation(value: string | null | undefined): string | null {
    if (!value) return null;
    const parts = fixMojibake(stripEmoji(value))
        .split(',')
        .map((p) => p.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
    const unique = parts.filter((p, i) => parts.findIndex((q) => q.toLowerCase() === p.toLowerCase()) === i);
    return unique.length ? unique.join(', ') : null;
}

/**
 * Maps free-text location restrictions ("Anywhere in the World", "USA Only", "Northern America, LATAM, Europe",
 * "Germany") to a small set of canonical regions joined by ", ": Worldwide, US, Canada, LATAM, UK, EU, APAC, Africa,
 * Middle East. Returns null when the text is a city or something else that cannot be placed.
 */
export function normalizeRegion(values: (string | null | undefined)[] | string | null | undefined): string | null {
    const list = (Array.isArray(values) ? values : [values]).filter(
        (v): v is string => typeof v === 'string' && v.trim() !== '',
    );
    if (list.length === 0) return null;
    // "Northern Ireland" belongs to the UK rule, not to the EU rule's "Ireland".
    const text = list.join(', ').replace(/northern ireland/gi, '');
    const found: string[] = [];
    for (const [re, name] of REGION_RULES) {
        if (re.test(text) && !found.includes(name)) found.push(name);
    }
    if (found.length > 1 && found.includes('Worldwide')) {
        // "Remote - US" is US, not Worldwide.
        found.splice(found.indexOf('Worldwide'), 1);
    }
    return found.length ? found.join(', ') : null;
}

export function normalizeEmploymentType(value: string | string[] | null | undefined): string | null {
    const first = Array.isArray(value) ? value[0] : value;
    if (!first) return null;
    const v = first.toLowerCase().replace(/[_\s-]+/g, '');
    if (v.startsWith('fulltime')) return 'Full-Time';
    if (v.startsWith('parttime')) return 'Part-Time';
    if (v.startsWith('contract')) return 'Contract';
    if (v.startsWith('freelance')) return 'Freelance';
    if (v.startsWith('intern')) return 'Internship';
    if (v.startsWith('temp')) return 'Temporary';
    return first.trim();
}

export function toIso(value: string | number | null | undefined): string | null {
    if (value === null || value === undefined || value === '') return null;
    let date: Date;
    if (typeof value === 'number') date = new Date(value < 1e12 ? value * 1000 : value);
    else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(value)) date = new Date(`${value}Z`);
    else date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function normalizeText(value: string | null | undefined): string {
    return (value ?? '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

/** Key used to detect the same job posted on several boards. */
export function dedupeKey(job: Pick<JobRecord, 'title' | 'company'>): string {
    return `${normalizeText(job.title)}|${normalizeText(job.company)}`;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Case-insensitive whole-word match of any keyword against title, company and tags. Word boundaries ignore
 * `+`, `#` and `.` so that "c++", "c#" and "node.js" work, while "go" does not match "django".
 */
export function matchesKeywords(job: Pick<JobRecord, 'title' | 'company' | 'tags'>, keywords: string[]): boolean {
    const terms = keywords.map((k) => k.trim().toLowerCase()).filter(Boolean);
    if (terms.length === 0) return true;
    const haystack = [job.title, job.company ?? '', ...job.tags].join(' \n ').toLowerCase();
    return terms.some((term) => new RegExp(`(?<![a-z0-9+#])${escapeRegExp(term)}(?![a-z0-9+#])`, 'i').test(haystack));
}

export function matchesCategories(job: Pick<JobRecord, 'category' | 'tags'>, categories: string[]): boolean {
    const wanted = categories.map((c) => normalizeText(c).replace(/\s+/g, '')).filter((c) => c.length >= 2);
    if (wanted.length === 0) return true;
    const candidates = [job.category, ...job.tags]
        .map((c) => normalizeText(c).replace(/\s+/g, ''))
        .filter((c) => c.length >= 2);
    return wanted.some((w) => candidates.some((c) => c.includes(w) || (c.length >= 4 && w.includes(c))));
}

export function isWithin(publishedAt: string | null, since: Date | null): boolean {
    if (!since || !publishedAt) return true;
    const t = new Date(publishedAt).getTime();
    if (Number.isNaN(t)) return true;
    return t >= since.getTime();
}

export function asString(value: unknown): string | null {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed === '' ? null : trimmed;
    }
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return null;
}

export function asNumber(value: unknown): number | null {
    if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
    if (typeof value === 'string' && value.trim() !== '') {
        const n = Number.parseFloat(value.replace(/[,\s]/g, ''));
        return Number.isFinite(n) && n > 0 ? n : null;
    }
    return null;
}

export function asStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const out: string[] = [];
    for (const v of value) {
        const s = asString(v);
        if (s && !out.includes(s)) out.push(s);
    }
    return out;
}

/** Fills the description fields from raw HTML, honouring the size caps. */
export function describe(html: string | null | undefined): {
    descriptionHtml: string | null;
    descriptionText: string | null;
} {
    if (!html || !html.trim()) return { descriptionHtml: null, descriptionText: null };
    const text = htmlToText(html);
    return {
        descriptionHtml: truncate(html.trim(), MAX_DESCRIPTION_HTML),
        descriptionText: text ? truncate(text, MAX_DESCRIPTION_TEXT) : null,
    };
}
