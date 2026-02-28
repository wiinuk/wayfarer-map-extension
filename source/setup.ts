// spell-checker: ignore pois Comlink
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
import { openRecords, type PoiRecords } from "./poi-records";
import { createDialog } from "./drafts-view/dialog";
import { createDraftList } from "./drafts-view/draft-list";
import jaDictionary from "./locales/ja.json";
import { createRemote, type Remote } from "./remote";
import { createDraftsDialogTitle } from "./drafts-view/drafts-dialog-title";
import { createScheduler } from "./dom-extensions";
import * as poiGl from "./poi-gl/poi-gl";

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

const defaultDictionary = jaDictionary satisfies Record<string, string>;
type Dictionary = typeof defaultDictionary;
export interface PageResource {
    readonly records: PoiRecords;
    readonly remote: Remote;
    readonly styleElement: HTMLStyleElement;
    readonly overlay: PoisOverlay;
    readonly defaultAsyncErrorHandler: (reason: unknown) => void;
    readonly map: google.maps.Map;
    readonly events: PageEventTarget;
    readonly local: LocalConfigAccessor;
    readonly defaultDictionary: Dictionary;
    readonly drafts: DraftsOverlay;
}

export type MainApi = {
    dispatchEvent<K extends keyof PageEventMap>(
        type: K,
        data: PageEventMap[K],
    ): void;
};

async function setupWorkerRecorder(events: PageEventTarget) {
    const Comlink =
        await import("https://cdn.jsdelivr.net/npm/comlink@4.4.2/+esm");
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

function getDictionaryEntry(page: PageResource, key: keyof Dictionary) {
    const lang = navigator.language;
    return (
        page.local.getConfig().dictionaries?.[lang]?.[key] ??
        page.defaultDictionary[key]
    );
}
function setupDraftManagerDialog(page: PageResource) {
    const draftList = createDraftList({
        overlay: page.drafts,
        remote: page.remote,
        records: page.records,
        local: page.local,
        handleAsyncError,
    });

    const title = createDraftsDialogTitle({
        title: getDictionaryEntry(page, "draftsTitle"),
    });
    const drafts = createDialog(draftList.element, {
        title: title.element,
    });
    drafts.show();
    document.body.append(drafts.element);

    draftList.events.addEventListener("count-changed", (e) => {
        title.setCounts(e.detail);
    });
    draftList.events.addEventListener("filter-start", () => title.pushIsBusy());
    draftList.events.addEventListener("filter-end", () => title.popIsBusy());

    page.remote.events.addEventListener("fetch-start", () =>
        title.pushIsBusy(),
    );
    page.remote.events.addEventListener("fetch-end", () => title.popIsBusy());

    page.drafts.events.addEventListener("drafts-updated", (e) =>
        draftList.setDrafts(e.detail),
    );
}

async function asyncSetup(signal: AbortSignal) {
    const map = await getGMapObject({ signal });
    const events = createTypedEventTarget<PageEventMap>();
    const local = await createConfigAccessor(localConfigKey);
    local.events.addEventListener("config-changed", () =>
        events.dispatchEvent(
            createTypedCustomEvent("config-changed", undefined),
        ),
    );
    const scheduler = createScheduler(signal);
    const page: PageResource = {
        records: await openRecords(),
        remote: createRemote(handleAsyncError, 2000),
        styleElement: document.createElement("style"),
        map,
        defaultAsyncErrorHandler: handleAsyncError,
        overlay: await createPoisOverlay(map, handleAsyncError),
        events,
        local,
        drafts: createDraftsOverlay(map, handleAsyncError),
        defaultDictionary,
    };
    document.head.appendChild(page.styleElement);

    await setupWorkerRecorder(events);
    setupPoiRecordOverlay(page);
    setupDraftManagerDialog(page);
    await setupDraftsOverlay(page.drafts, local, scheduler);
}

export function setup() {
    const cancel = new AbortController();
    asyncSetup(cancel.signal).catch(handleAsyncError);
}
