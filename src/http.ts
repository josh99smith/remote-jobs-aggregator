/**
 * Small fetch wrapper: browser-like User-Agent, timeout, one retry on transient errors and
 * an error class that carries the HTTP status so failures can be categorised.
 */
import { setTimeout as sleep } from 'node:timers/promises';

import type { ErrorType } from './types.js';

export const USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

export class HttpError extends Error {
    constructor(
        message: string,
        public readonly statusCode?: number,
    ) {
        super(message);
        this.name = 'HttpError';
    }
}

export function categorizeError(error: unknown): { errorType: ErrorType; message: string; statusCode?: number } {
    const err = error as {
        message?: string;
        name?: string;
        statusCode?: number;
        cause?: { code?: string; message?: string };
    };
    const statusCode = err?.statusCode;
    const cause = err?.cause?.code ?? err?.cause?.message ?? '';
    const message = `${err?.message ?? String(error)}${cause ? ` (${cause})` : ''}`;
    const m = message.toLowerCase();
    if (statusCode === 429) return { errorType: 'rate-limited', message, statusCode };
    if (statusCode === 403 || statusCode === 401 || m.includes('captcha') || m.includes('cloudflare'))
        return { errorType: 'blocked', message, statusCode };
    if (statusCode === 404 || statusCode === 410) return { errorType: 'not-found', message, statusCode };
    if (statusCode && statusCode >= 400) return { errorType: 'http-error', message, statusCode };
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError' || m.includes('timeout') || m.includes('timed out'))
        return { errorType: 'timeout', message };
    if (m.includes('enotfound') || m.includes('getaddrinfo') || m.includes('eai_again'))
        return { errorType: 'dns', message };
    if (m.includes('invalid url') || m.includes('err_invalid_url')) return { errorType: 'invalid-url', message };
    if (
        m.includes('econnrefused') ||
        m.includes('econnreset') ||
        m.includes('socket') ||
        m.includes('tls') ||
        m.includes('certificate') ||
        m.includes('fetch failed') ||
        m.includes('network')
    )
        return { errorType: 'network', message };
    return { errorType: 'other', message };
}

export interface FetchTextOptions {
    timeoutMs: number;
    accept?: string;
    retries?: number;
}

function isRetryable(error: unknown): boolean {
    const { errorType, statusCode } = categorizeError(error);
    if (statusCode !== undefined) return statusCode >= 500 || statusCode === 429;
    return errorType === 'timeout' || errorType === 'network';
}

/** GET a URL and return the body as text. Throws HttpError for non-2xx responses. */
export async function fetchText(url: string, options: FetchTextOptions): Promise<string> {
    const retries = options.retries ?? 1;
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const response = await fetch(url, {
                headers: {
                    'user-agent': USER_AGENT,
                    accept:
                        options.accept ??
                        'application/json, application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
                    'accept-language': 'en-US,en;q=0.9',
                },
                redirect: 'follow',
                signal: AbortSignal.timeout(options.timeoutMs),
            });
            const body = await response.text();
            if (!response.ok) {
                throw new HttpError(
                    `HTTP ${response.status} ${response.statusText} for ${url}`.trim(),
                    response.status,
                );
            }
            return body;
        } catch (error) {
            lastError = error;
            if (attempt < retries && isRetryable(error)) {
                await sleep(1000 * (attempt + 1));
                continue;
            }
            throw error;
        }
    }
    throw lastError;
}

/** GET a URL and parse the body as JSON. A 200 with a non-JSON body throws a categorised "other" error. */
export async function fetchJson<T = unknown>(url: string, options: FetchTextOptions): Promise<T> {
    const body = await fetchText(url, { ...options, accept: options.accept ?? 'application/json, */*;q=0.8' });
    try {
        return JSON.parse(body) as T;
    } catch {
        throw new Error(`Response from ${url} is not valid JSON (first bytes: ${JSON.stringify(body.slice(0, 80))})`);
    }
}
