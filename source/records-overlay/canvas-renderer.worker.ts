// spell-checker: ignore comlink
import {
    createRecordsCanvasRenderer,
    updateRecordsCanvasRenderer,
    type Viewport,
} from "./canvas-renderer";
import { createCancellableWorker } from "../standard-extensions";

function handleError(reason: unknown) {
    console.error("An error occurred during asynchronous processing:", reason);
}
function errorToCloneable(reason: unknown) {
    return reason instanceof Error ? reason : String(reason);
}

export type WorkerApi = Awaited<ReturnType<typeof exposeWorkerApi>>;
async function exposeWorkerApi() {
    const Comlink =
        await import("https://cdn.jsdelivr.net/npm/comlink@4.4.2/+esm");

    const mainAPI = Comlink.wrap<import("./overlay-view").MainApi>(
        self as import("comlink").Endpoint,
    );

    try {
        const handleAsyncError = (reason: unknown) =>
            void mainAPI
                .reportError(errorToCloneable(reason))
                .catch(handleError);

        const views = await createRecordsCanvasRenderer(
            handleAsyncError,
            (image, port) => {
                mainAPI
                    .notifyRenderCompleted(
                        Comlink.transfer(image, [image]),
                        port,
                    )
                    .catch(handleAsyncError);
            },
        );

        const { task: draw, cancelTask: drawCancel } = createCancellableWorker(
            (signal, viewport: Viewport) =>
                updateRecordsCanvasRenderer(views, viewport, signal),
        );
        const api = {
            draw,
            drawCancel,
        };
        Comlink.expose(api);
        return api;
    } catch (e) {
        const reason = e instanceof Error ? e : String(e);
        mainAPI.reportError(reason).catch(handleError);
    }
}
async function setup() {
    await exposeWorkerApi();
}

setup().catch(handleError);
