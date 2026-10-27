// spell-checker: ignore pois Comlink wfmap
import { injectGcsListener } from "./gcs";
import {
    createPoisOverlay,
    setupPoiRecordOverlay,
    type PoisOverlay,
} from "./records-overlay/overlay-view";
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
import { modifyWfMapLocation } from "./wfmap-modifier";
import { createGeoForBrowser, type Geo } from "./geo";

const localConfigKey =
    "wayfarer-map-extension-f079bd37-f7cd-4d65-9def-f0888b70b231";

function handleAsyncError(reason: unknown) {
    console.error("An error occurred during asynchronous processing:", reason);
}

async function getGMapObject(options: {
    signal?: AbortSignal;
}): Promise<google.maps.Map> {
    return await awaitElement(() => {
        if (
            typeof google === "undefined" ||
            typeof google.maps.Map !== "function"
        ) {
            return undefined;
        }

        const root = document.querySelector("main");
        if (!root) return undefined;

        const visited = new WeakSet<object>();
        const findMap = (
            value: unknown,
            depth: number,
        ): google.maps.Map | undefined => {
            if (value === null || typeof value !== "object" || depth > 12) {
                return undefined;
            }
            if (value instanceof google.maps.Map) return value;
            if (visited.has(value)) return undefined;
            visited.add(value);

            const prototype = Object.getPrototypeOf(value);
            if (
                !Array.isArray(value) &&
                prototype !== Object.prototype &&
                prototype !== null
            ) {
                return undefined;
            }

            for (const key of Reflect.ownKeys(value)) {
                if (
                    typeof key !== "string" ||
                    key === "_owner" ||
                    key === "_store" ||
                    key === "type"
                ) {
                    continue;
                }
                const map = findMap(Reflect.get(value, key), depth + 1);
                if (map) return map;
            }
            return undefined;
        };

        const elements = [root, ...root.querySelectorAll("*")];
        for (const element of elements) {
            for (const key of Reflect.ownKeys(element)) {
                if (
                    typeof key !== "string" ||
                    !key.startsWith("__reactProps$")
                ) {
                    continue;
                }
                const map = findMap(Reflect.get(element, key), 0);
                if (map) return map;
            }
        }
        return undefined;
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
    readonly geo: Geo;
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
async function setupDraftManagerDialog(page: PageResource) {
    const draftList = await createDraftList({
        overlay: page.drafts,
        remote: page.remote,
        records: page.records,
        geo: page.geo,
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
    draftList.events.addEventListener("filter-start", () =>
        title.markAsBusy(draftList),
    );
    draftList.events.addEventListener("filter-end", () =>
        title.remarkAsBusy(draftList),
    );

    page.remote.events.addEventListener("fetch-ready", () =>
        title.markAsBusy(page.remote),
    );
    page.remote.events.addEventListener("fetch-done", () => {
        title.remarkAsBusy(page.remote);
        title.remarkAsError(page.remote);
    });
    page.remote.events.addEventListener("fetch-error", (e) => {
        title.markAsError(page.remote, e.detail.message);
    });

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
        remote: createRemote(handleAsyncError, 1000),
        styleElement: document.createElement("style"),
        map,
        defaultAsyncErrorHandler: handleAsyncError,
        overlay: await createPoisOverlay(map, handleAsyncError),
        geo: createGeoForBrowser(),
        events,
        local,
        drafts: createDraftsOverlay(map, handleAsyncError),
        defaultDictionary,
    };
    document.head.appendChild(page.styleElement);

    await setupWorkerRecorder(events);
    setupPoiRecordOverlay(page);
    await setupDraftManagerDialog(page);

    await Promise.all([
        setupDraftsOverlay(page.drafts, local, scheduler),
        modifyWfMapLocation(signal),
    ]);
}

export function setup() {
    const cancel = new AbortController();
    asyncSetup(cancel.signal).catch(handleAsyncError);
}
