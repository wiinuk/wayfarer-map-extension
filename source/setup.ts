// spell-checker: ignore wfmapmods pois
import { createAsyncQueue, type AsyncQueue } from "./async-queue";
import { injectGcsListener } from "./gcs";
import {
    GcsQueriesSchema,
    GcsResponseSchema,
    type GcsQueries,
    type GcsResponse,
    type Poi,
} from "./gcs-schema";
import {
    openRecords,
    updateRecordsOfReceivedPois,
    type PoiRecords,
} from "./poi-records";
import {
    createPoisOverlay,
    setupPoiRecordOverlay,
    type PoisOverlay,
} from "./poi-records-overlay";
import { awaitElement } from "./standard-extensions";
import {
    createTypedCustomEvent,
    createTypedEventTarget,
    type TypedEventTarget,
} from "./typed-event-target";
import * as remote from "./remote";
import { createConfigAccessor, type LocalConfigAccessor } from "./local-config";
import type { Draft } from "./remote";
import {
    createDraftsOverlay,
    setupDraftsOverlay,
    type DraftsOverlay,
} from "./drafts-overlay";

const localConfigKey =
    "wayfarer-map-extension-f079bd37-f7cd-4d65-9def-f0888b70b231";

function handleAsyncError(reason: unknown) {
    console.error("An error occurred during asynchronous processing:", reason);
}

async function getGMapObject(options: {
    signal?: AbortSignal;
}): Promise<google.maps.Map> {
    return await awaitElement(() => {
        try {
            // 実行時エラーは catch で無視する
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const e: any = document.querySelector("app-wf-base-map");
            return e.__ngContext__[27];
        } catch {
            return null;
        }
    }, options);
}

interface PageEventMap {
    "gcs-saved": undefined;
}
export interface PageResource {
    readonly overlay: PoisOverlay;
    readonly defaultAsyncErrorHandler: (reason: unknown) => void;
    readonly map: google.maps.Map;
    readonly records: PoiRecords;
    readonly events: TypedEventTarget<PageEventMap>;
    readonly local: LocalConfigAccessor;
    readonly drafts: DraftsOverlay;
}
async function processGcsRequest(
    page: PageResource,
    queries: GcsQueries,
    response: GcsResponse,
    signal: AbortSignal,
) {
    if (response.captcha || !response.result.success) return;

    const bounds = new google.maps.LatLngBounds(queries.sw, queries.ne);
    const pois: Poi[] = [];
    for (const cellData of response.result.data) {
        pois.push(...cellData.pois);
    }
    performance.mark("start save");
    await updateRecordsOfReceivedPois(
        page.records,
        pois,
        bounds,
        Date.now(),
        signal,
    );
    performance.mark("end save");
    page.events.dispatchEvent(createTypedCustomEvent("gcs-saved", undefined));

    performance.measure("parse", "start json parse", "end json parse");
    performance.measure("save", "start save", "end save");

    performance.measure(
        "nearly cells calculation",
        "begin nearly cells calculation",
        "end nearly cells calculation",
    );
    performance.measure(
        "remove deleted pois",
        "begin remove deleted pois",
        "begin remove deleted pois",
    );
    performance.measure(
        "update cells",
        "begin update cells",
        "end update cells",
    );
    performance.measure("update pois", "begin update pois", "end update pois");
}

function parseQueryFromUrl(urlObj: URL) {
    const q: Record<string, string> = {};
    urlObj.searchParams.forEach((v, k) => {
        q[k] = v;
    });
    return q;
}

async function asyncSetup(signal: AbortSignal) {
    await awaitElement(() => document.querySelector("#wfmapmods-side-panel"), {
        signal,
    });

    const map = await getGMapObject({ signal });
    const local = createConfigAccessor(localConfigKey);
    const page: PageResource = {
        map,
        records: await openRecords(),
        defaultAsyncErrorHandler: handleAsyncError,
        overlay: createPoisOverlay(map),
        events: createTypedEventTarget(),
        local,
        drafts: createDraftsOverlay(map, handleAsyncError),
    };

    const gcsQueue: AsyncQueue<{ url: URL; responseText: string }> =
        createAsyncQueue(async (items) => {
            for (const { url, responseText } of items) {
                performance.mark("start json parse");
                const queries = GcsQueriesSchema.parse(parseQueryFromUrl(url));
                const response = GcsResponseSchema.parse(
                    JSON.parse(responseText),
                );
                performance.mark("end json parse");
                await processGcsRequest(page, queries, response, signal);
            }
        }, handleAsyncError);

    injectGcsListener((url, responseText) => {
        gcsQueue.push({ url, responseText });
    });

    setupPoiRecordOverlay(page);
    await setupDraftsOverlay(page.drafts, local);
}

export function setup() {
    const cancel = new AbortController();
    asyncSetup(cancel.signal).catch(handleAsyncError);
}
