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
import { createDialog } from "./drafts-view/dialog";
import { createDraftList } from "./drafts-view/draft-list";
import jaDictionary from "./locales/ja.json";
import { createRemote, type Remote } from "./remote";

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

function setStyle(page: PageResource, cssText: string) {
    page.styleElement.textContent += cssText + "\n";
}

function getDictionaryEntry(page: PageResource, key: keyof Dictionary) {
    const lang = navigator.language;
    return (
        page.local.getConfig()?.dictionaries?.[lang]?.[key] ??
        page.defaultDictionary[key]
    );
}
function setupDraftManagerDialog(page: PageResource) {
    const draftList = createDraftList({
        overlay: page.drafts,
        remote: page.remote,
        local: page.local,
    });

    const drafts = createDialog(draftList.element, {
        title: getDictionaryEntry(page, "draftsTitle"),
    });
    drafts.show();
    setStyle(page, drafts.cssText);
    setStyle(page, draftList.cssText);
    document.body.append(drafts.element);

    page.events.addEventListener("config-changed", () => {
        drafts.setTitle(getDictionaryEntry(page, "draftsTitle"));
    });

    page.drafts.events.addEventListener("drafts-updated", (e) =>
        draftList.setDrafts(e.detail),
    );
}

async function asyncSetup(signal: AbortSignal) {
    await awaitElement(() => document.querySelector("#wfmapmods-side-panel"), {
        signal,
    });

    const map = await getGMapObject({ signal });
    const events = createTypedEventTarget<PageEventMap>();
    const local = createConfigAccessor(localConfigKey);
    local.addEventHandler("config-changed", () =>
        events.dispatchEvent(
            createTypedCustomEvent("config-changed", undefined),
        ),
    );
    const page: PageResource = {
        records: await openRecords(),
        remote: createRemote(handleAsyncError, 2000),
        styleElement: document.createElement("style"),
        map,
        defaultAsyncErrorHandler: handleAsyncError,
        overlay: createPoisOverlay(map),
        events,
        local,
        drafts: createDraftsOverlay(map, handleAsyncError),
        defaultDictionary,
    };
    document.head.appendChild(page.styleElement);

    setupWorkerRecorder(events);
    setupPoiRecordOverlay(page);
    setupDraftManagerDialog(page);
    await setupDraftsOverlay(page.drafts, local);
}

export function setup() {
    const cancel = new AbortController();
    asyncSetup(cancel.signal).catch(handleAsyncError);
}
