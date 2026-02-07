// spell-checker: ignore wfmapmods pois Comlink
import { injectGcsListener } from "./gcs";
import {
    createPoisOverlay,
    setupPoiRecordOverlay,
    type PoisOverlay,
} from "./poi-records-overlay";
import { awaitElement } from "./standard-extensions";
import {
    createTypedCustomEvent,
    createTypedEventTarget,
} from "./typed-event-target";
import { createConfigAccessor, type LocalConfigAccessor } from "./local-config";
import {
    createDraftsOverlay,
    setupDraftsOverlay,
    type DraftsOverlay,
} from "./drafts-overlay";
import PoiRecordsWorker from "./poi-records.worker.ts?worker";
import type { PageEventMap, PageEventTarget } from "./page-events";
import * as Comlink from "comlink";
import { openRecords, type PoiRecords } from "./poi-records";

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

export interface PageResource {
    readonly records: PoiRecords;
    readonly overlay: PoisOverlay;
    readonly defaultAsyncErrorHandler: (reason: unknown) => void;
    readonly map: google.maps.Map;
    readonly events: PageEventTarget;
    readonly local: LocalConfigAccessor;
    readonly drafts: DraftsOverlay;
}

export type MainApi = {
    dispatchEvent<K extends keyof PageEventMap>(
        type: K,
        data: PageEventMap[K],
    ): void;
};

function setupWorkerRecorder(events: PageEventTarget) {
    const mainApi: MainApi = {
        dispatchEvent(type, data) {
            events.dispatchEvent(createTypedCustomEvent(type, data));
        },
    };
    const recordsWorker = new PoiRecordsWorker();
    Comlink.expose(mainApi, recordsWorker);

    const workerApi =
        Comlink.wrap<import("./poi-records.worker").WorkerApi>(recordsWorker);

    injectGcsListener((url, responseText) => {
        events.dispatchEvent(createTypedCustomEvent("gcs-received", undefined));
        workerApi
            .onGcsReceived(url.toString(), responseText)
            .catch(handleAsyncError);
    });
}

async function asyncSetup(signal: AbortSignal) {
    await awaitElement(() => document.querySelector("#wfmapmods-side-panel"), {
        signal,
    });

    const map = await getGMapObject({ signal });
    const local = createConfigAccessor(localConfigKey);
    const events = createTypedEventTarget<PageEventMap>();
    const page: PageResource = {
        records: await openRecords(),
        map,
        defaultAsyncErrorHandler: handleAsyncError,
        overlay: createPoisOverlay(map),
        events,
        local,
        drafts: createDraftsOverlay(map, handleAsyncError),
    };

    setupWorkerRecorder(events);
    setupPoiRecordOverlay(page);
    await setupDraftsOverlay(page.drafts, local);
}

export function setup() {
    const cancel = new AbortController();
    asyncSetup(cancel.signal).catch(handleAsyncError);
}
