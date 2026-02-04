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
    overlay: PoisOverlay;
    defaultAsyncErrorHandler: (reason: unknown) => void;
    map: google.maps.Map;
    records: PoiRecords;
    events: TypedEventTarget<PageEventMap>;
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
    console.debug(`gcs poi count: ${pois.length}`);
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

    for (const m of performance.getEntriesByType("measure")) {
        console.debug(`${m.name}: ${m.duration}ms`);
    }
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
    const page: PageResource = {
        map,
        records: await openRecords(),
        defaultAsyncErrorHandler: handleAsyncError,
        overlay: createPoisOverlay(map),
        events: createTypedEventTarget(),
    };

    const gcsQueue: AsyncQueue<{ url: URL; responseText: string }> =
        createAsyncQueue(async (items) => {
            const jsonLength = items.reduce(
                (n, x) => x.responseText.length + n,
                0,
            );
            console.debug(
                `gcs batch process: items.length = ${items.length}, json length: ${jsonLength}`,
            );

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
}

export function setup() {
    const cancel = new AbortController();
    asyncSetup(cancel.signal).catch(handleAsyncError);
}
