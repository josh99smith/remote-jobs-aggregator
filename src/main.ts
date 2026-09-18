import { setTimeout as sleep } from 'node:timers/promises';

import { Actor, log } from 'apify';

import { categorizeError } from './http.js';
import { filterJobs, type FilterStats, SOURCE_FETCHERS } from './pipeline.js';
import { type FailureItem, type Input, type JobRecord, SOURCE_KEYS, SOURCE_LABELS, type SourceKey } from './types.js';

const CHARGE_EVENT = 'job-listed';
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

log.info(
    `Fetching up to ${maxJobsPerSource} jobs from ${sources.length} source(s): ${sources.map((s) => SOURCE_LABELS[s]).join(', ')}` +
        `${since ? `, posted since ${since.toISOString().slice(0, 10)}` : ''}` +
        `${keywords.length ? `, keywords: ${keywords.join(' | ')}` : ''}` +
        `${categories.length ? `, categories: ${categories.join(' | ')}` : ''}` +
        `${dedupe ? ', de-duplicating across sources' : ''}.`,
);

const chargingManager = Actor.getChargingManager();
const { isPayPerEvent } = chargingManager.getPricingInfo();

const seenKeys = new Set<string>();
const perSource: Record<
    string,
    { fetched: number; pushed: number; charged: number } & Partial<FilterStats> & { error?: string }
> = {};
let totalPushed = 0;
let totalCharged = 0;
let failedSources = 0;
let stopBecauseOfBudget = false;

async function pushJobs(jobs: JobRecord[], label: string): Promise<{ pushed: number; charged: number }> {
    let pushed = 0;
    let charged = 0;
    for (let i = 0; i < jobs.length && !stopBecauseOfBudget; i += PUSH_BATCH_SIZE) {
        const batch = jobs.slice(i, i + PUSH_BATCH_SIZE);
        const { eventChargeLimitReached, chargedCount } = await Actor.pushData(batch, CHARGE_EVENT);
        const accepted = isPayPerEvent ? Math.min(chargedCount ?? batch.length, batch.length) : batch.length;
        for (const job of batch.slice(0, accepted)) {
            log.info(`[${label}] ${job.title}${job.company ? ` @ ${job.company}` : ''}`);
        }
        pushed += accepted;
        charged += chargedCount ?? 0;
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

    const { jobs, stats } = filterJobs(
        fetched,
        { keywords, categories, since, dedupe, includeDescription, includeRaw },
        seenKeys,
    );
    const { pushed, charged } = await pushJobs(jobs, label);
    totalPushed += pushed;
    totalCharged += charged;
    perSource[source] = { fetched: fetched.length, pushed, charged, ...stats };
    log.info(
        `[${label}] fetched ${fetched.length}, kept ${pushed} (${stats.tooOld} too old, ${stats.keywordMiss} keyword miss, ` +
            `${stats.categoryMiss} category miss, ${stats.duplicates} duplicates) in ${((Date.now() - started) / 1000).toFixed(1)}s`,
    );
}

const summary = {
    sources: sources.length,
    failedSources,
    jobsPushed: totalPushed,
    chargedEvents: isPayPerEvent ? totalCharged : undefined,
    stoppedEarlyDueToBudget: stopBecauseOfBudget,
    perSource,
    filters: { keywords, categories, postedWithinDays, dedupe, maxJobsPerSource },
    finishedAt: new Date().toISOString(),
};
await Actor.setValue('SUMMARY', summary);
log.info(`Done. ${JSON.stringify({ ...summary, perSource: undefined, filters: undefined })}`);
if (totalPushed === 0 && failedSources === sources.length) {
    await Actor.fail('Every selected source failed to load. See the dataset for the error of each source.');
}

await Actor.exit();
