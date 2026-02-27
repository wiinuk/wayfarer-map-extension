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
    createCancelScope,
    ignore,
    sleep,
    wrapCancellable,
} from "./standard-extensions";
import * as Bounds from "./bounds";
import {
    createTypedCustomEvent,
    createTypedEventTarget,
    type TypedEventTarget,
} from "./typed-event-target";

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
    const scope = createCancelScope();
    const views = createRecordsOverlayView(canvas, handleAsyncError);
    return (viewport: Viewport) =>
        scope(async (signal) =>
            renderRecordsOverlayView(await views, viewport, signal, ignore),
        );
}

type IsolatedDrawerEventMap = { "render-start": undefined };
export type MainApi = ReturnType<typeof createMainApi>;
function createMainApi(
    comlink: typeof import("https://cdn.jsdelivr.net/npm/comlink@4.4.2/+esm"),
    canvas: HTMLCanvasElement,
    handleAsyncError: (reason: unknown) => void,
    eventTarget: TypedEventTarget<IsolatedDrawerEventMap>,
) {
    return {
        takeCanvas() {
            const offscreen = canvas.transferControlToOffscreen();
            return comlink.transfer(offscreen, [offscreen]);
        },
        reportError(reason: Error | string) {
            handleAsyncError(reason);
        },
        onRenderStart() {
            eventTarget.dispatchEvent(
                createTypedCustomEvent("render-start", undefined),
            );
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

    const events = createTypedEventTarget<IsolatedDrawerEventMap>();
    const mainApi = createMainApi(Comlink, canvas, handleAsyncError, events);
    Comlink.expose(mainApi, overlayWorker);

    return {
        draw: wrapCancellable(workerApi.draw, workerApi.drawCancel),
        events,
    };
}

interface IsolatedDrawer {
    draw(
        this: unknown,
        signal: AbortSignal,
        parameters: Viewport,
    ): Promise<void>;
    readonly events: TypedEventTarget<IsolatedDrawerEventMap>;
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
    const bufferRatio = 0;
    class PoiRecordsCanvasOverlay extends google.maps.OverlayView {
        private canvas: HTMLCanvasElement;
        private drawer!: IsolatedDrawer;
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

        private renderedViewport: Viewport | null = null;
        override draw() {
            const projection = this.getProjection() as
                | google.maps.MapCanvasProjection
                | undefined;
            const map = this.getMap();
            if (!projection || !(map instanceof google.maps.Map)) return;

            const currentZoom = map.getZoom();
            const currentBounds = map.getBounds()!;
            if (this.renderedViewport) {
                const currentWorldWidth = projection.getWorldWidth();
                const renderedWorldWidth =
                    256 * 2 ** this.renderedViewport.zoom;
                const scale = currentWorldWidth / renderedWorldWidth;

                const currentPos = projection.fromLatLngToDivPixel(
                    this.renderedViewport.nwLatLng,
                )!;
                this.canvas.style.transform = `translate(${currentPos.x | 0}px, ${currentPos.y | 0}px) scale(${scale})`;
            }

            let needsRedraw = false;
            if (
                !this.renderedViewport ||
                this.renderedViewport.zoom !== currentZoom
            ) {
                needsRedraw = true;
            } else {
                const { paddedBounds: bounds } = padBoundsRelative(
                    map,
                    currentBounds,
                    bufferRatio / 2,
                );
                needsRedraw = !Bounds.containsBounds(
                    this.renderedViewport.bounds,
                    Bounds.fromClass(bounds),
                );
            }
            if (needsRedraw) {
                this.debounceScope(async (signal) => {
                    await sleep(100, { signal });
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
                nwLatLng: toLatLngLiteral(nw),
                nwWorld,
                width: canvasWidth,
                height: canvasHeight,
                devicePixelRatio: window.devicePixelRatio || 1,
            };

            this.drawer.events.addEventListener(
                "render-start",
                () => {
                    // 最後の描画時の情報を記録（canvasをずらすため必要）
                    this.renderedViewport = port;

                    // 現在の地図状態に合わせてキャンパスを調整
                    const latestProjection = this.getProjection() as
                        | google.maps.MapCanvasProjection
                        | undefined;
                    if (latestProjection) {
                        const currentPos =
                            latestProjection.fromLatLngToDivPixel(
                                port.nwLatLng,
                            )!;
                        this.canvas.style.transform = `translate(${currentPos.x | 0}px, ${currentPos.y | 0}px) scale(1)`;
                    }
                },
                { once: true },
            );
            await this.drawer.draw(signal, port);
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
