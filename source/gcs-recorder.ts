// spell-checker: ignore Pois
import { createAsyncQueue, type AsyncQueue } from "./async-queue";
import { createScheduler, type Scheduler } from "./dom-extensions";
import { GcsQueriesSchema, GcsResponseSchema } from "./gcs-schema";
import {
    openRecords,
    updateRecordsOfReceivedPoisInCells,
    type CellWithPois,
    type PoiRecords,
} from "./poi-records";
import { createTypedCustomEvent } from "./typed-event-target";
import { tokenToCell, type CellId, type S2Token } from "./typed-s2cell";
import * as Bounds from "./bounds";
import type { PageEventTarget } from "./page-events";

interface GcsLog {
    readonly queries: Readonly<Record<string, unknown>>;
    readonly responseText: string;
}

function parseQueryFromUrl(urlObj: URL) {
    const q: Record<string, string> = {};
    urlObj.searchParams.forEach((v, k) => {
        q[k] = v;
    });
    return q;
}

async function processGcsRequests(
    records: PoiRecords,
    events: PageEventTarget,
    { cells: cellToPois, bounds }: Gcs,
    signal: AbortSignal,
) {
    await updateRecordsOfReceivedPoisInCells(
        records,
        cellToPois,
        bounds,
        Date.now(),
        signal,
    );
    events.dispatchEvent(createTypedCustomEvent("gcs-saved", undefined));
}

type Gcs = Awaited<ReturnType<typeof parseGcsLogs>>;
async function parseGcsLogs(logs: readonly GcsLog[], scheduler: Scheduler) {
    const cells = new Map<CellId<15>, CellWithPois>();
    const bounds = [];
    for (const { queries, responseText } of logs) {
        await scheduler.yield();
        const response = GcsResponseSchema.parse(JSON.parse(responseText));
        if (response.captcha || !response.result.success) continue;

        const bound = GcsQueriesSchema.parse(queries);
        bounds.push(Bounds.fromSwNe(bound.sw, bound.ne));

        for (const { metadata, pois } of response.result.data) {
            const expectedLevel = 15;
            if (metadata.s2CellLevel !== expectedLevel) continue;

            const cell = tokenToCell(
                metadata.s2CellId as S2Token<typeof expectedLevel>,
            );
            const cellId = cell.toString();
            cells.set(cellId, { pois, cell });
        }
    }
    return { cells, bounds } as const;
}

export async function createGcsHandler(
    events: PageEventTarget,
    handleAsyncError: (reason: unknown) => void,
) {
    const records = await openRecords();
    const gcsQueue: AsyncQueue<GcsLog> = createAsyncQueue(async (items) => {
        const { signal } = new AbortController();
        const scheduler = createScheduler(signal);

        const receivedPois = await parseGcsLogs(items, scheduler);
        await processGcsRequests(records, events, receivedPois, signal);
    }, handleAsyncError);

    return (url: URL, responseText: string) => {
        gcsQueue.push({
            queries: parseQueryFromUrl(url),
            responseText,
        });
    };
}
