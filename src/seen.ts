/**
 * "Only new since the last run" monitor mode: a record of item ids delivered by previous runs, kept in
 * a named key-value store so scheduled runs can return only items that were not seen before.
 * Everything here is pure so it can be unit-tested without the Apify platform.
 */
import { createHash } from 'node:crypto';

export const SEEN_RECORD_KEY = 'SEEN';
export const SEEN_RECORD_VERSION = 1;
export const MAX_SEEN_IDS = 100_000;
export const DEFAULT_SEEN_TTL_DAYS = 90;

export interface SeenRecord {
    version: typeof SEEN_RECORD_VERSION;
    updatedAt: string;
    /** Stable item id -> ISO timestamp of the last run that saw the item. */
    ids: Record<string, string>;
}

export function emptySeenRecord(now: Date = new Date()): SeenRecord {
    return { version: SEEN_RECORD_VERSION, updatedAt: now.toISOString(), ids: {} };
}

/** Turns whatever was stored under the SEEN key into a valid record; anything malformed starts fresh. */
export function parseSeenRecord(raw: unknown, now: Date = new Date()): SeenRecord {
    if (!raw || typeof raw !== 'object') return emptySeenRecord(now);
    const candidate = raw as Partial<SeenRecord>;
    if (candidate.version !== SEEN_RECORD_VERSION || !candidate.ids || typeof candidate.ids !== 'object') {
        return emptySeenRecord(now);
    }
    const ids: Record<string, string> = {};
    for (const [id, lastSeen] of Object.entries(candidate.ids)) {
        if (id && typeof lastSeen === 'string' && !Number.isNaN(Date.parse(lastSeen))) {
            ids[id] = lastSeen;
        }
    }
    return {
        version: SEEN_RECORD_VERSION,
        updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : now.toISOString(),
        ids,
    };
}

/** Splits items into those never seen before and those already in the record. Does not mutate the record. */
export function splitBySeen<T>(
    items: T[],
    idOf: (item: T) => string,
    record: SeenRecord,
): { fresh: T[]; alreadySeen: T[] } {
    const fresh: T[] = [];
    const alreadySeen: T[] = [];
    for (const item of items) {
        if (Object.prototype.hasOwnProperty.call(record.ids, idOf(item))) alreadySeen.push(item);
        else fresh.push(item);
    }
    return { fresh, alreadySeen };
}

/** Returns a new record with every id marked as seen at `now` (existing ids get their timestamp refreshed). */
export function markSeen(record: SeenRecord, ids: Iterable<string>, now: Date = new Date()): SeenRecord {
    const iso = now.toISOString();
    const merged: Record<string, string> = { ...record.ids };
    for (const id of ids) {
        if (id) merged[id] = iso;
    }
    return { version: SEEN_RECORD_VERSION, updatedAt: iso, ids: merged };
}

/**
 * Drops ids last seen more than `ttlDays` ago (0 = keep forever) and, if the record is still larger than
 * `maxIds`, the oldest ones until it fits.
 */
export function pruneSeen(
    record: SeenRecord,
    ttlDays: number,
    now: Date = new Date(),
    maxIds: number = MAX_SEEN_IDS,
): { record: SeenRecord; pruned: number } {
    const cutoff = ttlDays > 0 ? now.getTime() - ttlDays * 86_400_000 : Number.NEGATIVE_INFINITY;
    let entries = Object.entries(record.ids).filter(([, lastSeen]) => Date.parse(lastSeen) >= cutoff);
    if (entries.length > maxIds) {
        entries.sort((a, b) => Date.parse(b[1]) - Date.parse(a[1]));
        entries = entries.slice(0, maxIds);
    }
    const pruned = Object.keys(record.ids).length - entries.length;
    return {
        record: { version: SEEN_RECORD_VERSION, updatedAt: record.updatedAt, ids: Object.fromEntries(entries) },
        pruned,
    };
}

/** Store names must be 3-63 characters of letters, digits and dashes, not starting or ending with a dash. */
export const STORE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]$/;

/** Resolves the user's store name; empty means the auto name `<actor-name>-seen`. Returns null when invalid. */
export function resolveStoreName(requested: string | undefined | null, actorName: string): string | null {
    const trimmed = (requested ?? '').trim();
    const name = trimmed || `${actorName}-seen`;
    return STORE_NAME_PATTERN.test(name) ? name : null;
}

/** Short stable hash for items without a natural id. */
export function hashId(...parts: (string | null | undefined)[]): string {
    return createHash('sha1')
        .update(parts.map((p) => p ?? '').join('|'))
        .digest('hex')
        .slice(0, 24);
}
