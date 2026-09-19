import { describe, expect, it } from 'vitest';

import {
    emptySeenRecord,
    hashId,
    markSeen,
    MAX_SEEN_IDS,
    parseSeenRecord,
    pruneSeen,
    resolveStoreName,
    SEEN_RECORD_VERSION,
    splitBySeen,
} from '../src/seen.js';

const NOW = new Date('2026-09-18T12:00:00.000Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

describe('parseSeenRecord', () => {
    it('starts fresh for missing, malformed or wrong-version records', () => {
        expect(parseSeenRecord(null, NOW)).toEqual(emptySeenRecord(NOW));
        expect(parseSeenRecord('nope', NOW).ids).toEqual({});
        expect(parseSeenRecord({ version: 2, ids: { a: daysAgo(1) } }, NOW).ids).toEqual({});
        expect(parseSeenRecord({ version: 1 }, NOW).ids).toEqual({});
    });

    it('keeps valid ids and drops entries with unparsable timestamps', () => {
        const parsed = parseSeenRecord(
            { version: 1, updatedAt: daysAgo(2), ids: { a: daysAgo(1), b: 'not a date', c: 123, '': daysAgo(1) } },
            NOW,
        );
        expect(parsed.version).toBe(SEEN_RECORD_VERSION);
        expect(parsed.updatedAt).toBe(daysAgo(2));
        expect(Object.keys(parsed.ids)).toEqual(['a']);
    });
});

describe('splitBySeen', () => {
    it('separates unseen items from already seen ones without mutating the record', () => {
        const record = markSeen(emptySeenRecord(NOW), ['x:1', 'x:2'], NOW);
        const items = [{ id: 'x:1' }, { id: 'x:3' }, { id: 'x:2' }, { id: 'x:4' }];
        const { fresh, alreadySeen } = splitBySeen(items, (i) => i.id, record);
        expect(fresh.map((i) => i.id)).toEqual(['x:3', 'x:4']);
        expect(alreadySeen.map((i) => i.id)).toEqual(['x:1', 'x:2']);
        expect(Object.keys(record.ids)).toEqual(['x:1', 'x:2']);
    });

    it('returns everything as fresh on the first run', () => {
        const { fresh, alreadySeen } = splitBySeen([{ id: 'a' }, { id: 'b' }], (i) => i.id, emptySeenRecord(NOW));
        expect(fresh).toHaveLength(2);
        expect(alreadySeen).toHaveLength(0);
    });

    it('is not fooled by prototype property names', () => {
        const { fresh } = splitBySeen([{ id: 'constructor' }, { id: '__proto__' }], (i) => i.id, emptySeenRecord(NOW));
        expect(fresh).toHaveLength(2);
    });
});

describe('markSeen', () => {
    it('adds new ids and refreshes the timestamp of existing ones', () => {
        const old = { version: 1 as const, updatedAt: daysAgo(5), ids: { a: daysAgo(5), b: daysAgo(5) } };
        const merged = markSeen(old, ['b', 'c', ''], NOW);
        expect(merged.ids).toEqual({ a: daysAgo(5), b: NOW.toISOString(), c: NOW.toISOString() });
        expect(merged.updatedAt).toBe(NOW.toISOString());
        expect(old.ids).toEqual({ a: daysAgo(5), b: daysAgo(5) });
    });
});

describe('pruneSeen', () => {
    it('drops ids older than the TTL and keeps the rest', () => {
        const record = {
            version: 1 as const,
            updatedAt: NOW.toISOString(),
            ids: { a: daysAgo(1), b: daysAgo(91), c: daysAgo(89) },
        };
        const { record: pruned, pruned: count } = pruneSeen(record, 90, NOW);
        expect(Object.keys(pruned.ids).sort()).toEqual(['a', 'c']);
        expect(count).toBe(1);
    });

    it('keeps everything when TTL is 0', () => {
        const record = { version: 1 as const, updatedAt: NOW.toISOString(), ids: { a: daysAgo(1000) } };
        expect(pruneSeen(record, 0, NOW).pruned).toBe(0);
    });

    it('caps the record at maxIds by dropping the oldest entries', () => {
        const ids: Record<string, string> = {};
        for (let i = 0; i < 10; i += 1) ids[`id${i}`] = daysAgo(i);
        const { record: pruned, pruned: count } = pruneSeen(
            { version: 1, updatedAt: NOW.toISOString(), ids },
            0,
            NOW,
            4,
        );
        expect(count).toBe(6);
        expect(Object.keys(pruned.ids).sort()).toEqual(['id0', 'id1', 'id2', 'id3']);
    });

    it('exposes a 100,000 id default cap', () => {
        expect(MAX_SEEN_IDS).toBe(100_000);
    });
});

describe('resolveStoreName', () => {
    it('falls back to <actor>-seen when empty', () => {
        expect(resolveStoreName('', 'my-actor')).toBe('my-actor-seen');
        expect(resolveStoreName(undefined, 'my-actor')).toBe('my-actor-seen');
        expect(resolveStoreName('   ', 'my-actor')).toBe('my-actor-seen');
    });

    it('accepts valid custom names and rejects invalid ones', () => {
        expect(resolveStoreName(' python-watchlist ', 'x')).toBe('python-watchlist');
        expect(resolveStoreName('has space', 'x')).toBeNull();
        expect(resolveStoreName('-leading', 'x')).toBeNull();
        expect(resolveStoreName('ab', 'x')).toBeNull();
        expect(resolveStoreName('a'.repeat(64), 'x')).toBeNull();
    });
});

describe('hashId', () => {
    it('is stable and distinguishes inputs', () => {
        expect(hashId('Title', '2026-01-01')).toBe(hashId('Title', '2026-01-01'));
        expect(hashId('Title', '2026-01-01')).not.toBe(hashId('Title', '2026-01-02'));
        expect(hashId('Title', null)).toBe(hashId('Title', undefined));
        expect(hashId('a')).toHaveLength(24);
    });
});
