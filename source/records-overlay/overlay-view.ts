// spell-checker: ignore Pois Comlink
import { toLatLngLiteral } from "../geometry";
import {
    createRecordsCanvasRenderer,
    setRecordsRangeDisplayPlan,
    type Viewport,
    updateRecordsCanvasRenderer,
    type CanvasRenderer,
} from "./canvas-renderer";
import PoisOverlayWorker from "./canvas-renderer.worker.ts?worker";
import type { PageResource } from "../setup";
import {
    createAsyncCancelScope,
    raise,
    sleep,
    waitAnimationFrame,
    wrapCancellable,
} from "../standard-extensions";
import * as Bounds from "../bounds";
import type { RangeDisplayPlan } from "./range-display";

interface ViewOptions {
    readonly cell17CountMarkerOptions: google.maps.MarkerOptions;
}
export interface PoisOverlay {
    readonly options: ViewOptions;
    readonly map: google.maps.Map;
    readonly canvasOverlay: PoiRecordsCanvasOverlay;
}

async function createDrawerForMainThread(
    handleAsyncError: (reason: unknown) => void,
    onRenderUpdated: (image: ImageBitmap, port: Viewport) => void,
    onRangeRenderUpdated: CanvasRenderer["onRangeRenderUpdated"],
): Promise<IsolatedDrawer> {
    const views = createRecordsCanvasRenderer(
        handleAsyncError,
        onRenderUpdated,
        onRangeRenderUpdated,
    );
    return {
        async draw(signal, viewport: Viewport) {
            await updateRecordsCanvasRenderer(await views, viewport, signal);
        },
        async setRangeDisplayPlan(plan, revision) {
            setRecordsRangeDisplayPlan(await views, plan, revision);
        },
    };
}

export type MainApi = ReturnType<typeof createMainApi>;
function createMainApi(
    handleAsyncError: (reason: unknown) => void,
    onRenderUpdated: CanvasRenderer["onRenderUpdated"],
    onRangeRenderUpdated: CanvasRenderer["onRangeRenderUpdated"],
) {
    return {
        reportError(reason: Error | string) {
            handleAsyncError(reason);
        },
        notifyRenderCompleted: onRenderUpdated,
        notifyRangeRenderCompleted: onRangeRenderUpdated,
    };
}
async function createDrawerForWorker(
    handleAsyncError: (reason: unknown) => void,
    onRenderUpdated: CanvasRenderer["onRenderUpdated"],
    onRangeRenderUpdated: CanvasRenderer["onRangeRenderUpdated"],
) {
    const Comlink =
        await import("https://cdn.jsdelivr.net/npm/comlink@4.4.2/+esm");
    const overlayWorker = new PoisOverlayWorker();

    const workerApi =
        Comlink.wrap<import("./canvas-renderer.worker").WorkerApi>(
            overlayWorker,
        );

    const mainApi = createMainApi(
        handleAsyncError,
        onRenderUpdated,
        onRangeRenderUpdated,
    );
    Comlink.expose(mainApi, overlayWorker);

    return {
        draw: wrapCancellable(workerApi.draw, workerApi.drawCancel),
        setRangeDisplayPlan: workerApi.setRangeDisplayPlan,
    };
}

interface IsolatedDrawer {
    draw(signal: AbortSignal, parameters: Viewport): Promise<void>;
    setRangeDisplayPlan(
        plan: RangeDisplayPlan,
        revision: number,
    ): Promise<void>;
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

function initCanvas(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    port: Viewport,
) {
    const { canvas } = ctx;
    const { width, height, devicePixelRatio } = port;

    // 非整数DPR環境を考慮
    const canvasWidth = Math.round(width * devicePixelRatio);
    const canvasHeight = Math.round(height * devicePixelRatio);
    if (canvas.width !== canvasWidth || canvas.height !== canvasHeight) {
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;
    }
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
}

function configureCanvas(canvas: HTMLCanvasElement) {
    canvas.style.position = "absolute";
    canvas.style.transition = "none";
    canvas.style.transformOrigin = "0 0";
    canvas.style.left = "0px";
    canvas.style.top = "0px";
    canvas.style.imageRendering = "crisp-edges";
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
        private rangeCtx: CanvasRenderingContext2D;
        private drawer!: IsolatedDrawer;
        private drawDebounceScope = createAsyncCancelScope(handleAsyncError);
        private rangePlanRevision = 0;
        private lastRangeRenderId = 0;

        constructor() {
            super();
            const canvas = document.createElement("canvas");
            configureCanvas(canvas);
            this.ctx = canvas.getContext("2d") ?? raise`context 2d`;
            const rangeCanvas = document.createElement("canvas");
            configureCanvas(rangeCanvas);
            rangeCanvas.style.pointerEvents = "none";
            this.rangeCtx =
                rangeCanvas.getContext("2d") ?? raise`range context 2d`;
        }

        async init(handleAsyncError: (reason: unknown) => void) {
            const imageScope = createAsyncCancelScope(handleAsyncError);
            const rangeScope = createAsyncCancelScope(handleAsyncError);
            const onRenderUpdated: CanvasRenderer["onRenderUpdated"] = (
                image,
                port,
            ) =>
                imageScope(async (signal) => {
                    try {
                        await this.commitImage(image, port, signal);
                    } finally {
                        image.close();
                    }
                });
            const onRangeRenderUpdated: CanvasRenderer["onRangeRenderUpdated"] =
                (image, port, planRevision, renderId) =>
                    rangeScope(async (signal) => {
                        try {
                            await this.commitRangeImage(
                                image,
                                port,
                                planRevision,
                                renderId,
                                signal,
                            );
                        } finally {
                            image.close();
                        }
                    });
            const createDrawer =
                typeof Worker === "undefined" ||
                typeof OffscreenCanvas === "undefined"
                    ? createDrawerForMainThread
                    : createDrawerForWorker;
            this.drawer = await createDrawer(
                handleAsyncError,
                onRenderUpdated,
                onRangeRenderUpdated,
            );
        }

        override onAdd() {
            const panes = this.getPanes()!;
            panes.overlayLayer.appendChild(this.rangeCtx.canvas);
            panes.overlayLayer.appendChild(this.ctx.canvas);
        }

        override onRemove() {
            this.ctx.canvas.remove();
            this.rangeCtx.canvas.remove();
        }

        private renderedViewport: Viewport | null = null;
        private rangeRenderedViewport: Viewport | null = null;
        override draw() {
            const projection = this.getProjection() as
                google.maps.MapCanvasProjection | undefined;
            const map = this.getMap();
            if (!projection || !(map instanceof google.maps.Map)) return;

            const currentZoom = map.getZoom();
            const currentBounds = map.getBounds()!;
            this.applyCanvasViewportTransform(
                this.ctx.canvas,
                this.renderedViewport,
                projection,
            );
            this.applyCanvasViewportTransform(
                this.rangeCtx.canvas,
                this.rangeRenderedViewport,
                projection,
            );

            const renderedViewport = this.renderedViewport;
            const needsRedraw =
                !renderedViewport ||
                renderedViewport.zoom !== currentZoom ||
                !Bounds.containsBounds(
                    renderedViewport.bounds,
                    Bounds.fromClass(
                        padBoundsRelative(map, currentBounds, bufferRatio / 2)
                            .paddedBounds,
                    ),
                );
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
                google.maps.MapCanvasProjection | undefined;

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
            for (const canvas of [this.ctx.canvas, this.rangeCtx.canvas]) {
                canvas.style.width = `${canvasWidth}px`;
                canvas.style.height = `${canvasHeight}px`;
            }

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

            await this.drawer.draw(signal, port);
        }
        applyCanvasViewportTransform(
            canvas: HTMLCanvasElement,
            renderedViewport: Viewport | null,
            projection: google.maps.MapCanvasProjection,
        ) {
            if (!renderedViewport) return;
            const currentWorldWidth = projection.getWorldWidth();
            const renderedWorldWidth = 256 * 2 ** renderedViewport.zoom;
            const scale = currentWorldWidth / renderedWorldWidth;
            const currentPos = projection.fromLatLngToDivPixel(
                renderedViewport.nwLatLng,
            )!;
            canvas.style.transform = `translate(${currentPos.x | 0}px, ${currentPos.y | 0}px) scale(${scale})`;
        }
        async commitImage(
            image: ImageBitmap,
            port: Viewport,
            signal: AbortSignal,
        ) {
            // 転送された画面を描画
            await waitAnimationFrame(signal);
            const { ctx } = this;
            initCanvas(ctx, port);
            ctx.drawImage(image, 0, 0);

            // 最後の描画時の情報を記録（canvasをずらすため必要）
            this.renderedViewport = port;

            // 現在の地図状態に合わせてキャンパスを調整
            const latestProjection = this.getProjection() as
                google.maps.MapCanvasProjection | undefined;
            if (latestProjection) {
                const currentPos = latestProjection.fromLatLngToDivPixel(
                    port.nwLatLng,
                )!;
                this.ctx.canvas.style.transform = `translate(${currentPos.x | 0}px, ${currentPos.y | 0}px) scale(1)`;
            }
        }
        async commitRangeImage(
            image: ImageBitmap,
            port: Viewport,
            planRevision: number,
            renderId: number,
            signal: AbortSignal,
        ) {
            if (
                planRevision !== this.rangePlanRevision ||
                renderId < this.lastRangeRenderId
            ) {
                return;
            }
            await waitAnimationFrame(signal);
            if (
                planRevision !== this.rangePlanRevision ||
                renderId < this.lastRangeRenderId
            ) {
                return;
            }
            initCanvas(this.rangeCtx, port);
            this.rangeCtx.drawImage(
                image,
                0,
                0,
                this.rangeCtx.canvas.width,
                this.rangeCtx.canvas.height,
            );
            this.rangeRenderedViewport = port;
            this.lastRangeRenderId = renderId;
            const projection = this.getProjection() as
                google.maps.MapCanvasProjection | undefined;
            if (projection) {
                this.applyCanvasViewportTransform(
                    this.rangeCtx.canvas,
                    port,
                    projection,
                );
            }
        }
        setRangeDisplayPlan(plan: RangeDisplayPlan) {
            const revision = ++this.rangePlanRevision;
            this.drawer
                .setRangeDisplayPlan(plan, revision)
                .then(() => this.notifyDrawNeeded())
                .catch(handleAsyncError);
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
