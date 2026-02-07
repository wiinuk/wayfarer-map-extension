// spell-checker: ignore comlink
import * as Comlink from "comlink";
import { createGcsHandler } from "./gcs-recorder";
import {
    createTypedEventTarget,
    type TypedCustomEvent,
} from "./typed-event-target";
import { pageEventTypes, type PageEventMap } from "./page-events";

export interface WorkerApi {
    hello(message: string): string;
    onGcsReceived(url: string, responseText: string): void;
}

function handleAsyncError(reason: unknown) {
    console.error("An error occurred during asynchronous processing:", reason);
}
async function setup() {
    const mainAPI = Comlink.wrap<import("./setup").MainApi>(
        self as Comlink.Endpoint,
    );

    const events = createTypedEventTarget<PageEventMap>();
    const transferEvent = (
        e: TypedCustomEvent<
            keyof PageEventMap,
            PageEventMap[keyof PageEventMap]
        >,
    ) => mainAPI.dispatchEvent(e.type, e.detail);

    pageEventTypes.forEach((type) =>
        events.addEventListener(type, transferEvent),
    );

    const handler = await createGcsHandler(events, handleAsyncError);
    const api: WorkerApi = {
        hello(e) {
            return `Worker received: ${e}`;
        },
        onGcsReceived(url, responseText) {
            handler(new URL(url), responseText);
        },
    };
    Comlink.expose(api);
}

setup().catch(handleAsyncError);
