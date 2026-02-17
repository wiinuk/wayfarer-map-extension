// spell-checker: ignore comlink
import { createGcsHandler } from "./gcs-recorder";
import {
    createTypedEventTarget,
    type TypedCustomEvent,
} from "./typed-event-target";
import { pageEventTypes, type PageEventMap } from "./page-events";
import { createGcsSchemas } from "./gcs-schema";

export interface WorkerApi {
    hello(message: string): string;
    onGcsReceived(url: string, responseText: string): void;
}

function handleAsyncError(reason: unknown) {
    console.error("An error occurred during asynchronous processing:", reason);
}
async function setup() {
    const Comlink =
        await import("https://cdn.jsdelivr.net/npm/comlink@4.4.2/+esm");
    const mainAPI = Comlink.wrap<import("./setup").MainApi>(
        self as import("comlink").Endpoint,
    );
    const schemas = await createGcsSchemas();

    const events = createTypedEventTarget<PageEventMap>();
    const transferEvent = (
        e: TypedCustomEvent<
            keyof PageEventMap,
            PageEventMap[keyof PageEventMap]
        >,
    ) => void mainAPI.dispatchEvent(e.type, e.detail).catch(handleAsyncError);

    pageEventTypes.forEach((type) =>
        events.addEventListener(type, transferEvent),
    );

    const handler = await createGcsHandler(schemas, events, handleAsyncError);
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
