// spell-checker: ignore Pois Comlink
import { toLatLngLiteral } from "./geometry";
import {
    createRecordsOverlayView,
    type Viewport,
    renderRecordsOverlayView,
} from "./poi-records-overlay-view";
import PoisOverlayWorker from "./poi-records-overlay.worker.ts?worker";
import type { PageResource } from "./setup";
import {
    createAsyncCancelScope,
    sleep,
    wrapCancellable,
} from "./standard-extensions";
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

    return wrapCancellable(workerApi.draw, workerApi.drawCancel);
}

function pointClassToRecord({ x, y }: google.maps.Point) {
    return { x, y };
}

function padBoundsRelative(
    map: google.maps.Map,
    bounds: google.maps.LatLngBounds,
    ratio: number,
) {
    const projection = map.getProjection()!;

    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();

    // 画面サイズ[世界座標]を計算
    const swWorld = projection.fromLatLngToPoint(sw)!;
    const neWorld = projection.fromLatLngToPoint(ne)!;
    const worldWidth = Math.abs(neWorld.x - swWorld.x);
    const worldHeight = Math.abs(swWorld.y - neWorld.y);

    // 拡張されたサイズ[世界座標]を計算
    const padX = worldWidth * ratio;
    const padY = worldHeight * ratio;
    const paddedSwWorld = new google.maps.Point(
        swWorld.x - padX,
        swWorld.y + padY,
    );
    const paddedNeWorld = new google.maps.Point(
        neWorld.x + padX,
        neWorld.y - padY,
    );

    // 拡張された領域[緯度経度]を計算
    const paddedSw = projection.fromPointToLatLng(paddedSwWorld)!;
    const paddedNe = projection.fromPointToLatLng(paddedNeWorld)!;
    const paddedBounds = new google.maps.LatLngBounds(paddedSw, paddedNe);
    const nwLatLng = new google.maps.LatLng(paddedNe.lat(), paddedSw.lng());
    return { paddedBounds, nwLatLng };
}

export type PoiRecordsCanvasOverlay = Awaited<
    ReturnType<typeof createPoiRecordsCanvasOverlay>
>;
export async function createPoiRecordsCanvasOverlay(
    handleAsyncError: (reason: unknown) => void,
) {
    const bufferRatio = 0.5;
    class PoiRecordsCanvasOverlay extends google.maps.OverlayView {
        private canvas: HTMLCanvasElement;
        private drawer!: (
            signal: AbortSignal,
            parameters: Viewport,
        ) => Promise<void>;
        private debounceScope = createAsyncCancelScope(handleAsyncError);

        constructor() {
            super();
            this.canvas = document.createElement("canvas");
            this.canvas.style.position = "absolute";
            this.canvas.style.transition = "none";
            this.canvas.style.transformOrigin = "0 0";
            this.canvas.style.left = "0px";
            this.canvas.style.top = "0px";
            this.canvas.style.imageRendering = "pixelated";
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
        }

        override onRemove() {
            this.canvas.remove();
        }

        private renderedBounds: google.maps.LatLngBounds | null = null;
        private renderedNWLatLng: google.maps.LatLng | null = null;
        private renderedZoom: number | null = null;
        override draw() {
            const projection = this.getProjection() as
                | google.maps.MapCanvasProjection
                | undefined;
            const map = this.getMap();
            if (!projection || !(map instanceof google.maps.Map)) return;

            const currentZoom = map.getZoom();
            const currentBounds = map.getBounds()!;
            if (this.renderedNWLatLng && this.renderedZoom !== null) {
                const currentWorldWidth = projection.getWorldWidth();
                const renderedWorldWidth = 256 * 2 ** this.renderedZoom;
                const scale = currentWorldWidth / renderedWorldWidth;

                const currentPos = projection.fromLatLngToDivPixel(
                    this.renderedNWLatLng,
                )!;
                this.canvas.style.transform = `translate(${currentPos.x | 0}px, ${currentPos.y | 0}px) scale(${scale})`;
            }

            let needsRedraw = false;
            if (!this.renderedBounds || this.renderedZoom !== currentZoom) {
                needsRedraw = true;
            } else {
                const { paddedBounds: bounds } = padBoundsRelative(
                    map,
                    currentBounds,
                    bufferRatio / 2,
                );
                if (
                    !this.renderedBounds.contains(bounds.getSouthWest()) ||
                    !this.renderedBounds.contains(bounds.getNorthEast())
                ) {
                    needsRedraw = true;
                }
            }
            if (needsRedraw) {
                this.debounceScope(async (signal) => {
                    await sleep(300, { signal });
                    await this.fullDraw(signal);
                });
            }
        }
        async fullDraw(signal: AbortSignal) {
            const map = this.getMap();
            if (!(map instanceof google.maps.Map)) return;

            const projection = this.getProjection() as
                | google.maps.MapCanvasProjection
                | undefined;

            if (projection == null) return;

            const zoom = map.getZoom()!;

            // スクロールに対応するため拡張
            const { paddedBounds: bounds, nwLatLng: nw } = padBoundsRelative(
                map,
                map.getBounds()!,
                bufferRatio,
            );
            const center = map.getCenter()!;

            const sw = bounds.getSouthWest();
            const ne = bounds.getNorthEast();

            // 地図の左下[px]
            const swPixel = projection.fromLatLngToDivPixel(sw)!;
            // 地図の右上[px]
            const nePixel = projection.fromLatLngToDivPixel(ne)!;

            // 地図のサイズ[px]
            const canvasWidth = Math.abs(nePixel.x - swPixel.x) | 0;
            const canvasHeight = Math.abs(swPixel.y - nePixel.y) | 0;
            this.canvas.style.width = `${canvasWidth}px`;
            this.canvas.style.height = `${canvasHeight}px`;

            // 地図の左上[世界座標]
            const nwWorld = pointClassToRecord(
                map.getProjection()!.fromLatLngToPoint(nw)!,
            );

            const port: Viewport = {
                zoom,
                bounds: Bounds.fromClass(bounds),
                center: toLatLngLiteral(center),
                nwWorld,
                width: canvasWidth,
                height: canvasHeight,
                devicePixelRatio: window.devicePixelRatio || 1,
            };

            await this.drawer(signal, port);
            // キャンバスをずらすため必要な、最後の描画時の情報を記録
            this.renderedBounds = bounds;
            this.renderedZoom = zoom;
            this.renderedNWLatLng = nw;

            // 現在の地図状態に合わせてキャンパスを調整
            const latestProjection = this.getProjection() as
                | google.maps.MapCanvasProjection
                | undefined;
            if (latestProjection) {
                const currentPos = latestProjection.fromLatLngToDivPixel(nw)!;
                this.canvas.style.transform = `translate(${currentPos.x | 0}px, ${currentPos.y | 0}px) scale(1)`;
            }
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
    canvasOverlay.draw();
    page.events.addEventListener("gcs-saved", () => canvasOverlay.draw());
}
