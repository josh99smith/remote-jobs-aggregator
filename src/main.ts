import { setTimeout as sleep } from 'node:timers/promises';

import { Actor, log } from 'apify';

import { categorizeError } from './http.js';
import { filterJobs, type FilterStats, SOURCE_FETCHERS } from './pipeline.js';
import {
    DEFAULT_SEEN_TTL_DAYS,
    markSeen,
    parseSeenRecord,
    pruneSeen,
    resolveStoreName,
    SEEN_RECORD_KEY,
    splitBySeen,
} from './seen.js';
import { type FailureItem, type Input, type JobRecord, SOURCE_KEYS, SOURCE_LABELS, type SourceKey } from './types.js';

const CHARGE_EVENT = 'job-listed';
const ACTOR_NAME = 'remote-jobs-aggregator';
const REQUEST_TIMEOUT_MS = 60_000;
const PUSH_BATCH_SIZE = 50;

await Actor.init();

Actor.on('aborting', async () => {
    await sleep(1000);
    await Actor.exit();
});

const input = (await Actor.getInput<Input>()) ?? {};

const requestedSources = Array.isArray(input.sources) && input.sources.length > 0 ? input.sources : [...SOURCE_KEYS];
const unknownSources = requestedSources.filter((s) => !SOURCE_KEYS.includes(s));
if (unknownSources.length > 0) {
    await Actor.fail(`Unknown source(s): ${unknownSources.join(', ')}. Valid values are: ${SOURCE_KEYS.join(', ')}.`);
}
const sources = [...new Set(requestedSources)] as SourceKey[];

const maxJobsPerSource = Math.min(Math.max(Math.floor(Number(input.maxJobsPerSource ?? 200)) || 200, 1), 1000);
const postedWithinDays = Math.max(Math.floor(Number(input.postedWithinDays ?? 30)) || 0, 0);
const keywords = (input.keywords ?? []).map((k) => String(k).trim()).filter(Boolean);
const categories = (input.categories ?? []).map((c) => String(c).trim()).filter(Boolean);
const dedupe = input.dedupe ?? true;
const includeDescription = input.includeDescription ?? true;
const includeRaw = input.includeRaw ?? false;
const since = postedWithinDays > 0 ? new Date(Date.now() - postedWithinDays * 86_400_000) : null;
const onlyNew = input.onlyNew ?? false;
const seenTtlDays = Math.min(Math.max(Math.floor(Number(input.seenTtlDays ?? DEFAULT_SEEN_TTL_DAYS)) || 0, 0), 3650);
const stateStoreName = resolveStoreName(input.stateStoreName, ACTOR_NAME) ?? '';
if (!stateStoreName) {
    await Actor.fail(
        `Input "stateStoreName" is not a valid key-value store name: "${input.stateStoreName}". Use 3-63 letters, digits and dashes, e.g. "python-jobs-watchlist".`,
    );
}

log.info(
    `Fetching up to ${maxJobsPerSource} jobs from ${sources.length} source(s): ${sources.map((s) => SOURCE_LABELS[s]).join(', ')}` +
        `${since ? `, posted since ${since.toISOString().slice(0, 10)}` : ''}` +
        `${keywords.length ? `, keywords: ${keywords.join(' | ')}` : ''}` +
        `${categories.length ? `, categories: ${categories.join(' | ')}` : ''}` +
        `${dedupe ? ', de-duplicating across sources' : ''}` +
        `${onlyNew ? `, only jobs not seen in previous runs (state store "${stateStoreName}")` : ''}.`,
);

// Monitor mode state: ids delivered by earlier runs live in a named store so scheduled runs can skip them.
const stateStore = await Actor.openKeyValueStore(stateStoreName);
const seenBefore = parseSeenRecord(await stateStore.getValue(SEEN_RECORD_KEY));
const seenBeforeCount = Object.keys(seenBefore.ids).length;
if (seenBeforeCount > 0) log.info(`Loaded ${seenBeforeCount} previously seen job id(s) from store "${stateStoreName}".`);
const idsSeenThisRun = new Set<string>();

const chargingManager = Actor.getChargingManager();
const { isPayPerEvent } = chargingManager.getPricingInfo();

const seenKeys = new Set<string>();
const perSource: Record<
    string,
    { fetched: number; pushed: number; charged: number } & Partial<FilterStats> & {
            newJobs?: number;
            alreadySeen?: number;
            error?: string;
        }
> = {};
let totalPushed = 0;
let totalCharged = 0;
let totalNew = 0;
let totalAlreadySeen = 0;
let failedSources = 0;
let stopBecauseOfBudget = false;

async function pushJobs(jobs: JobRecord[], label: string): Promise<{ pushed: number; charged: number }> {
    let pushed = 0;
    let charged = 0;
    for (let i = 0; i < jobs.length && !stopBecauseOfBudget; i += PUSH_BATCH_SIZE) {
        const wanted = jobs.slice(i, i + PUSH_BATCH_SIZE);
        // Ask the budget how many events still fit and push only that many (the SDK's chargedCount over-reports).
        const allowed = isPayPerEvent ? Actor.getChargingManager().calculateMaxEventChargeCountWithinLimit(CHARGE_EVENT) : wanted.length;
        const batch = wanted.slice(0, Math.max(0, allowed));
        let eventChargeLimitReached = batch.length < wanted.length;
        if (batch.length > 0) {
            const result = await Actor.pushData(batch, CHARGE_EVENT);
            eventChargeLimitReached = eventChargeLimitReached || result.eventChargeLimitReached;
        }
        const accepted = batch.length;
        for (const job of batch.slice(0, accepted)) {
            idsSeenThisRun.add(job.id);
            if (job.isNew) totalNew += 1;
            log.info(`[${label}] ${job.title}${job.company ? ` @ ${job.company}` : ''}${job.isNew ? ' (new)' : ''}`);
        }
        pushed += accepted;
        charged += accepted;
        if (eventChargeLimitReached) {
            stopBecauseOfBudget = true;
            log.warning(
                'Maximum charge limit for this run reached; stopping early. Raise the run cost limit to collect more jobs.',
            );
        }
    }
    return { pushed, charged };
}

for (const source of sources) {
    if (stopBecauseOfBudget) break;
    const label = SOURCE_LABELS[source];
    const started = Date.now();
    let fetched: JobRecord[];
    try {
        fetched = await SOURCE_FETCHERS[source]({ limit: maxJobsPerSource, since, timeoutMs: REQUEST_TIMEOUT_MS });
    } catch (error) {
        const { errorType, message, statusCode } = categorizeError(error);
        const failure: FailureItem = {
            success: false,
            source: label,
            errorType,
            error: message.slice(0, 500),
            statusCode,
            fetchedAt: new Date().toISOString(),
        };
        failedSources += 1;
        perSource[source] = { fetched: 0, pushed: 0, charged: 0, error: `${errorType}: ${failure.error}` };
        log.warning(`[${label}] ${errorType} - ${failure.error}`);
        await Actor.pushData(failure); // free of charge: users only pay for listed jobs
        continue;
    }

    const { jobs: filtered, stats } = filterJobs(
        fetched,
        { keywords, categories, since, dedupe, includeDescription, includeRaw },
        seenKeys,
    );
    // Flag every job; in monitor mode drop the already-seen ones before pushing so they are never billed.
    const { fresh, alreadySeen } = splitBySeen(filtered, (job) => job.id, seenBefore);
    for (const job of fresh) job.isNew = true;
    for (const job of alreadySeen) {
        job.isNew = false;
        idsSeenThisRun.add(job.id); // still listed, so keep it in the store past the TTL
    }
    const jobs = onlyNew ? fresh : filtered;
    const { pushed, charged } = await pushJobs(jobs, label);
    totalPushed += pushed;
    totalCharged += charged;
    totalAlreadySeen += alreadySeen.length;
    perSource[source] = { fetched: fetched.length, pushed, charged, ...stats, newJobs: fresh.length, alreadySeen: alreadySeen.length };
    log.info(
        `[${label}] fetched ${fetched.length}, kept ${pushed} (${stats.tooOld} too old, ${stats.keywordMiss} keyword miss, ` +
            `${stats.categoryMiss} category miss, ${stats.duplicates} duplicates, ${alreadySeen.length} seen before` +
            `${onlyNew ? ' and skipped' : ''}) in ${((Date.now() - started) / 1000).toFixed(1)}s`,
    );
}

// Remember everything delivered this run (plus what was already known) so the next run can skip it.
const { record: seenAfter, pruned } = pruneSeen(markSeen(seenBefore, idsSeenThisRun), seenTtlDays);
await stateStore.setValue(SEEN_RECORD_KEY, seenAfter);
log.info(
    `Saved ${Object.keys(seenAfter.ids).length} seen job id(s) to store "${stateStoreName}"` +
        `${pruned ? ` (${pruned} pruned as older than ${seenTtlDays} days or over the cap)` : ''}.`,
);

const summary = {
    sources: sources.length,
    failedSources,
    jobsPushed: totalPushed,
    chargedEvents: isPayPerEvent ? totalCharged : undefined,
    newItems: totalNew,
    alreadySeen: totalAlreadySeen,
    onlyNew,
    stateStoreName,
    stoppedEarlyDueToBudget: stopBecauseOfBudget,
    perSource,
    filters: { keywords, categories, postedWithinDays, dedupe, maxJobsPerSource, onlyNew, seenTtlDays },
    finishedAt: new Date().toISOString(),
};
await Actor.setValue('SUMMARY', summary);
log.info(`Done. ${JSON.stringify({ ...summary, perSource: undefined, filters: undefined })}`);
if (totalPushed === 0 && failedSources === sources.length) {
    await Actor.fail('Every selected source failed to load. See the dataset for the error of each source.');
}

await Actor.exit();
