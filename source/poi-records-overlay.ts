// spell-checker: ignore Pois Comlink
import { toLatLngLiteral } from "./geometry";
import {
    createRecordsOverlayView,
    type Viewport,
    renderRecordsOverlayView,
} from "./poi-records-overlay-view";
import PoisOverlayWorker from "./poi-records-overlay.worker.ts?worker";
import type { PageResource } from "./setup";
import { createAsyncCancelScope } from "./standard-extensions";
import * as Bounds from "./bounds";

interface ViewOptions {
    readonly cell17CountMarkerOptions: google.maps.MarkerOptions;
}
export interface PoisOverlay {
    readonly options: ViewOptions;
    readonly map: google.maps.Map;
    readonly canvasOverlay: PoiRecordsCanvasOverlay;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function createDrawerForMainThread(
    canvas: HTMLCanvasElement,
    handleAsyncError: (reason: unknown) => void,
) {
    const scope = createAsyncCancelScope(handleAsyncError);
    const views = createRecordsOverlayView(canvas, handleAsyncError);
    return (viewport: Viewport) =>
        scope(async (signal) =>
            renderRecordsOverlayView(await views, viewport, signal),
        );
}

export type MainApi = ReturnType<typeof createMainApi>;
function createMainApi(
    comlink: typeof import("https://cdn.jsdelivr.net/npm/comlink@4.4.2/+esm"),
    canvas: HTMLCanvasElement,
    handleAsyncError: (reason: unknown) => void,
) {
    return {
        takeCanvas() {
            const offscreen = canvas.transferControlToOffscreen();
            return comlink.transfer(offscreen, [offscreen]);
        },
        reportError(reason: Error | string) {
            handleAsyncError(reason);
        },
    };
}
async function createDrawerForWorker(
    canvas: HTMLCanvasElement,
    handleAsyncError: (reason: unknown) => void,
) {
    const Comlink =
        await import("https://cdn.jsdelivr.net/npm/comlink@4.4.2/+esm");
    const overlayWorker = new PoisOverlayWorker();

    const workerApi =
        Comlink.wrap<import("./poi-records-overlay.worker").WorkerApi>(
            overlayWorker,
        );

    const mainApi = createMainApi(Comlink, canvas, handleAsyncError);
    Comlink.expose(mainApi, overlayWorker);

    return (viewport: Viewport) => {
        workerApi.draw(viewport).catch(handleAsyncError);
    };
}

export type PoiRecordsCanvasOverlay = Awaited<
    ReturnType<typeof createPoiRecordsCanvasOverlay>
>;
export async function createPoiRecordsCanvasOverlay(
    handleAsyncError: (reason: unknown) => void,
) {
    // バッファ倍率
    const BUFFER_RATIO = 1.5;

    class PoiRecordsCanvasOverlay extends google.maps.OverlayView {
        private canvas: HTMLCanvasElement;
        private drawer!: (parameters: Viewport) => void;
        private idleListener: google.maps.MapsEventListener | undefined;

        private anchorCenterLatLng: google.maps.LatLng | undefined;
        private anchorZoom: number | undefined;

        /** 中心から Canvas 左上へのオフセット */
        private offsetFromCenterToNW = { x: 0, y: 0 };

        constructor() {
            super();
            this.canvas = document.createElement("canvas");
            this.canvas.style.position = "absolute";
            this.canvas.style.transition = "none";
            this.canvas.style.transformOrigin = "0 0";
            this.canvas.style.left = "0px";
            this.canvas.style.top = "0px";
        }
        async init(handleAsyncError: (reason: unknown) => void) {
            this.drawer = await createDrawerForWorker(
                this.canvas,
                handleAsyncError,
            );
        }

        override onAdd() {
            const panes = this.getPanes()!;
            panes.overlayLayer.appendChild(this.canvas);
            this.idleListener = this.getMap()?.addListener("idle", () =>
                this.drawFull(),
            );
        }

        override onRemove() {
            this.canvas.parentNode?.removeChild(this.canvas);
            this.idleListener?.remove();
        }

        override draw() {
            if (!this.anchorCenterLatLng || this.anchorZoom == null) return;

            const map = this.getMap();
            if (!(map instanceof google.maps.Map)) return;

            const projection = this.getProjection() as
                | google.maps.MapCanvasProjection
                | undefined;
            if (projection == null) return;

            const currentZoom = map.getZoom()!;
            const currentCenterPos = projection.fromLatLngToDivPixel(
                this.anchorCenterLatLng,
            )!;

            const scale = Math.pow(2, currentZoom - this.anchorZoom);

            const canvasX =
                currentCenterPos.x + this.offsetFromCenterToNW.x * scale;
            const canvasY =
                currentCenterPos.y + this.offsetFromCenterToNW.y * scale;

            this.canvas.style.transform = `translate(${canvasX}px, ${canvasY}px) scale(${scale})`;
        }

        drawFull() {
            const map = this.getMap();
            if (!(map instanceof google.maps.Map)) return;

            const zoom = map.getZoom();
            if (zoom == null) return;

            const projection = this.getProjection() as
                | google.maps.MapCanvasProjection
                | undefined;
            if (projection == null) return;

            const bounds = map.getBounds()!;
            const center = map.getCenter()!;

            this.anchorCenterLatLng = center;
            this.anchorZoom = zoom;

            const centerPixel = projection.fromLatLngToDivPixel(center)!;
            const swPixel = projection.fromLatLngToDivPixel(
                bounds.getSouthWest(),
            )!;
            const nePixel = projection.fromLatLngToDivPixel(
                bounds.getNorthEast(),
            )!;

            // 画面の正規サイズ
            const screenWidth = nePixel.x - swPixel.x;
            const screenHeight = swPixel.y - nePixel.y;

            // バッファ適用後サイズ
            const canvasWidth = Math.ceil(screenWidth * BUFFER_RATIO);
            const canvasHeight = Math.ceil(screenHeight * BUFFER_RATIO);
            this.offsetFromCenterToNW = {
                x: -canvasWidth / 2,
                y: -canvasHeight / 2,
            };
            const canvasNWPixel = {
                x: centerPixel.x + this.offsetFromCenterToNW.x,
                y: centerPixel.y + this.offsetFromCenterToNW.y,
            };
            this.canvas.style.transform = `translate(${canvasNWPixel.x}px, ${canvasNWPixel.y}px) scale(1)`;

            // 拡張後の領域を計算
            const bufferedNWLatLng = projection.fromDivPixelToLatLng(
                new google.maps.Point(canvasNWPixel.x, canvasNWPixel.y),
            )!;
            const bufferedSELatLng = projection.fromDivPixelToLatLng(
                new google.maps.Point(
                    canvasNWPixel.x + canvasWidth,
                    canvasNWPixel.y + canvasHeight,
                ),
            )!;
            const extendedBounds = new google.maps.LatLngBounds(
                new google.maps.LatLng(
                    bufferedSELatLng.lat(),
                    bufferedNWLatLng.lng(),
                ),
                new google.maps.LatLng(
                    bufferedNWLatLng.lat(),
                    bufferedSELatLng.lng(),
                ),
            );

            const port: Viewport = {
                zoom,
                bounds: Bounds.fromClass(extendedBounds),
                center: toLatLngLiteral(center),
                nwWorld: map
                    .getProjection()!
                    .fromLatLngToPoint(bufferedNWLatLng)!,
                width: canvasWidth,
                height: canvasHeight,
                devicePixelRatio: window.devicePixelRatio || 1,
            } satisfies Viewport;

            this.drawer(port);
        }
    }
    const overlay = new PoiRecordsCanvasOverlay();
    await overlay.init(handleAsyncError);
    return overlay;
}

export async function createPoisOverlay(
    map: google.maps.Map,
    handleAsyncError: (reason: unknown) => void,
): Promise<PoisOverlay> {
    const options: ViewOptions = {
        cell17CountMarkerOptions: {
            clickable: false,
            icon: {
                path: google.maps.SymbolPath.CIRCLE,
                scale: 0,
            },
        },
    };
    return {
        options,
        map,
        canvasOverlay: await createPoiRecordsCanvasOverlay(handleAsyncError),
    };
}

export function setupPoiRecordOverlay(page: PageResource) {
    const { canvasOverlay } = page.overlay;
    canvasOverlay.setMap(page.map);
    canvasOverlay.drawFull();
    page.events.addEventListener("gcs-saved", () => canvasOverlay.drawFull());
}
