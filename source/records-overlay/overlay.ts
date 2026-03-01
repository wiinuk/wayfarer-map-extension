// spell-checker: ignore Pois Comlink
import { toLatLngLiteral } from "../geometry";
import {
    createRecordsOverlayView,
    type Viewport,
    renderRecordsOverlayView,
    type OverlayView,
} from "./view";
import PoisOverlayWorker from "./poi-records-overlay.worker.ts?worker";
import type { PageResource } from "../setup";
import {
    createAsyncCancelScope,
    raise,
    sleep,
    waitAnimationFrame,
    wrapCancellable,
} from "../standard-extensions";
import * as Bounds from "../bounds";

interface ViewOptions {
    readonly cell17CountMarkerOptions: google.maps.MarkerOptions;
}
export interface PoisOverlay {
    readonly options: ViewOptions;
    readonly map: google.maps.Map;
    readonly canvasOverlay: PoiRecordsCanvasOverlay;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function createDrawerForMainThread(
    handleAsyncError: (reason: unknown) => void,
    onRenderUpdated: (image: ImageBitmap, port: Viewport) => void,
): Promise<IsolatedDrawer> {
    const views = createRecordsOverlayView(handleAsyncError, onRenderUpdated);
    return async (signal, viewport: Viewport) =>
        renderRecordsOverlayView(await views, viewport, signal);
}

export type MainApi = ReturnType<typeof createMainApi>;
function createMainApi(
    handleAsyncError: (reason: unknown) => void,
    onRenderUpdated: OverlayView["onRenderUpdated"],
) {
    return {
        reportError(reason: Error | string) {
            handleAsyncError(reason);
        },
        notifyRenderCompleted: onRenderUpdated,
    };
}
async function createDrawerForWorker(
    handleAsyncError: (reason: unknown) => void,
    onRenderUpdated: OverlayView["onRenderUpdated"],
) {
    const Comlink =
        await import("https://cdn.jsdelivr.net/npm/comlink@4.4.2/+esm");
    const overlayWorker = new PoisOverlayWorker();

    const workerApi =
        Comlink.wrap<import("./overlay.worker").WorkerApi>(overlayWorker);

    const mainApi = createMainApi(handleAsyncError, onRenderUpdated);
    Comlink.expose(mainApi, overlayWorker);

    return wrapCancellable(workerApi.draw, workerApi.drawCancel);
}

type IsolatedDrawer = (
    signal: AbortSignal,
    parameters: Viewport,
) => Promise<void>;

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

function initCanvas(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    port: Viewport,
) {
    const { canvas } = ctx;
    const { width, height, devicePixelRatio } = port;
    const canvasWidth = width * devicePixelRatio;
    const canvasHeight = height * devicePixelRatio;
    if (canvas.width !== canvasWidth || canvas.height !== canvasHeight) {
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;
    }
    ctx.scale(devicePixelRatio, devicePixelRatio);
    ctx.clearRect(0, 0, width, height);
}

export type PoiRecordsCanvasOverlay = Awaited<
    ReturnType<typeof createPoiRecordsCanvasOverlay>
>;
export async function createPoiRecordsCanvasOverlay(
    handleAsyncError: (reason: unknown) => void,
) {
    const bufferRatio = 0;
    class PoiRecordsCanvasOverlay extends google.maps.OverlayView {
        private ctx: CanvasRenderingContext2D;
        private drawer!: IsolatedDrawer;
        private drawDebounceScope = createAsyncCancelScope(handleAsyncError);

        constructor() {
            super();
            const canvas = document.createElement("canvas");
            canvas.style.position = "absolute";
            canvas.style.transition = "none";
            canvas.style.transformOrigin = "0 0";
            canvas.style.left = "0px";
            canvas.style.top = "0px";
            canvas.style.imageRendering = "crisp-edges";
            this.ctx = canvas.getContext("2d") ?? raise`context 2d`;
        }

        async init(handleAsyncError: (reason: unknown) => void) {
            const scope = createAsyncCancelScope(handleAsyncError);
            this.drawer = await createDrawerForWorker(
                handleAsyncError,
                (image, port) =>
                    scope(async (signal) =>
                        this.commitImage(image, port, signal),
                    ),
            );
        }

        override onAdd() {
            const panes = this.getPanes()!;
            panes.overlayLayer.appendChild(this.ctx.canvas);
        }

        override onRemove() {
            this.ctx.canvas.remove();
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
                this.ctx.canvas.style.transform = `translate(${currentPos.x | 0}px, ${currentPos.y | 0}px) scale(${scale})`;
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
                this.notifyDrawNeeded();
            }
        }
        notifyDrawNeeded() {
            this.drawDebounceScope(async (signal) => {
                await sleep(100, { signal });
                await this.fullDraw(signal);
            });
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
            this.ctx.canvas.style.width = `${canvasWidth}px`;
            this.ctx.canvas.style.height = `${canvasHeight}px`;

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

            await this.drawer(signal, port);
        }
        async commitImage(
            image: ImageBitmap,
            port: Viewport,
            signal: AbortSignal,
        ) {
            try {
                // 転送された画面を描画
                await waitAnimationFrame(signal);
                const { ctx } = this;
                initCanvas(ctx, port);
                ctx.drawImage(image, 0, 0);

                // 最後の描画時の情報を記録（canvasをずらすため必要）
                this.renderedViewport = port;

                // 現在の地図状態に合わせてキャンパスを調整
                const latestProjection = this.getProjection() as
                    | google.maps.MapCanvasProjection
                    | undefined;
                if (latestProjection) {
                    const currentPos = latestProjection.fromLatLngToDivPixel(
                        port.nwLatLng,
                    )!;
                    this.ctx.canvas.style.transform = `translate(${currentPos.x | 0}px, ${currentPos.y | 0}px) scale(1)`;
                }
            } finally {
                image.close();
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
    canvasOverlay.notifyDrawNeeded();
    page.events.addEventListener("gcs-saved", () =>
        canvasOverlay.notifyDrawNeeded(),
    );
}
