// spell-checker: ignore wfmapmods pois
import { createAsyncQueue, type AsyncQueue } from "./async-queue";
import { injectGcsListener } from "./gcs";
import { GcsQueriesSchema, GcsResponseSchema, type GcsQueries, type GcsResponse, type Poi } from "./gcs-schema";
import { openRecords, updateRecordsOfReceivedPois, type PoiRecords } from "./poi-records";
import { awaitElement } from "./standard-extensions";

function handleAsyncError(reason: unknown) {
    console.error("An error occurred during asynchronous processing:", reason);
}

async function getGMapObject(options: { signal?: AbortSignal }): Promise<google.maps.Map> {
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


interface PageResource {
    gMap: google.maps.Map;
    records: PoiRecords;
}
async function processGcsRequest(page: PageResource, queries: GcsQueries, response: GcsResponse, signal: AbortSignal) {
    if (response.captcha || !response.result.success) return;

    const bounds = new google.maps.LatLngBounds(queries.sw, queries.ne);
    const pois: Poi[] = []
    for (const cellData of response.result.data) {
        pois.push(...cellData.pois);
    }
    await updateRecordsOfReceivedPois(page.records, pois, bounds, Date.now(), signal);
}

function parseQueryFromUrl(urlObj: URL) {
    const q: Record<string, string> = {};
    urlObj.searchParams.forEach((v, k) => {
        q[k] = v;
    });
    return q;
}

async function asyncSetup(signal: AbortSignal) {
    await awaitElement(() => document.querySelector("#wfmapmods-side-panel"), { signal });

    const page: PageResource = {
        gMap: await getGMapObject({ signal }),
        records: await openRecords(),
    }

    const gcsQueue: AsyncQueue<{ queries: GcsQueries, response: GcsResponse }> = createAsyncQueue(async (items) => {
        for (const { queries, response } of items) {
            await processGcsRequest(page, queries, response, signal);
        }
    }, handleAsyncError);

    injectGcsListener((url, rawResponseText) => {
        const queries = GcsQueriesSchema.parse(parseQueryFromUrl(url));
        const response = GcsResponseSchema.parse(JSON.parse(rawResponseText));
        gcsQueue.push({ queries, response });
    });
}

export function setup() {
    const cancel = new AbortController()
    asyncSetup(cancel.signal).catch(handleAsyncError);
}