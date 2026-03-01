//spell-checker:words Pois
import type { LatLngBounds } from "../bounds";
import { createCollisionChecker } from "../collision-checker";
import { type Point } from "../geometry";
import {
    getCell14Stats,
    type PoiRecords,
    openRecords,
    getNearlyCellsForBounds,
    type PoiRecord,
} from "../poi-records";
import { createOverlayViewOptions, type OverlayOptions } from "./options";
import type { LatLng } from "../s2";
import { waitAnimationFrame } from "../standard-extensions";
import type { Cell, Cell14Id } from "../typed-s2cell";
import { createCell14Bound } from "./views";
import type PIXI from "pixi.js";
import { isWebWorker } from "../environments";
type PIXI = typeof PIXI;

export interface Viewport {
    readonly zoom: number;
    readonly bounds: LatLngBounds;
    readonly center: LatLng;
    readonly nwLatLng: LatLng;
    readonly nwWorld: Point;
    readonly width: number;
    readonly height: number;
    readonly devicePixelRatio: number;
}
export interface ViewsRenderingContext extends CanvasRenderer, Viewport {
    readonly checker: ReturnType<typeof createCollisionChecker>;
}
export interface CanvasRenderer {
    readonly handleAsyncError: (this: unknown, reason: unknown) => void;
    readonly onRenderUpdated: (
        this: unknown,
        image: ImageBitmap,
        port: Viewport,
    ) => void;
    readonly canvas: OffscreenCanvas;
    readonly PIXI: PIXI;
    readonly app: PIXI.Application;
    readonly topContainer: PIXI.Container;
    readonly records: PoiRecords;
    readonly options: OverlayOptions;
    readonly cells: Map<Cell14Id, PIXI.Container>;

    readonly _point_result_cache: Point;
    readonly _pois_cache: PoiRecord[];
}

async function initPIXI(canvas: OffscreenCanvas) {
    const PIXI = isWebWorker()
        ? await import("https://cdn.jsdelivr.net/npm/pixi.js@8.16.0/dist/webworker.min.mjs")
        : await import("https://cdn.jsdelivr.net/npm/pixi.js@8.16.0/+esm");
    if (isWebWorker()) {
        PIXI.DOMAdapter.set(PIXI.WebWorkerAdapter);
    }

    const app = new PIXI.Application();
    await app.init({
        canvas,
        autoDensity: true,
        autoStart: false,
        backgroundAlpha: 0,
        antialias: true,
    });
    return {
        PIXI,
        app,
    };
}

export async function createRecordsCanvasRenderer(
    handleAsyncError: (reason: unknown) => void,
    onRenderUpdated: CanvasRenderer["onRenderUpdated"],
): Promise<CanvasRenderer> {
    const records = await openRecords();
    const canvas = new OffscreenCanvas(0, 0);
    const { PIXI, app } = await initPIXI(canvas);
    const topContainer = app.stage.addChild(new PIXI.Container());
    return {
        canvas,
        PIXI,
        app,
        topContainer,
        handleAsyncError,
        onRenderUpdated,
        options: createOverlayViewOptions(),
        records,
        cells: new Map(),
        _point_result_cache: { x: 0, y: 0 },
        _pois_cache: [],
    };
}
function applyViewport(layer: PIXI.Container, viewport: Viewport) {
    const scale = 2 ** viewport.zoom;
    layer.scale.set(scale);
    layer.x = -viewport.nwWorld.x * scale;
    layer.y = -viewport.nwWorld.y * scale;
}

async function draw(
    renderer: CanvasRenderer,
    port: Viewport,
    signal: AbortSignal,
) {
    await waitAnimationFrame(signal);
    const { app, topContainer } = renderer;
    const { width, height, devicePixelRatio } = port;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const checker = createCollisionChecker();
    app.renderer.resize(width, height, devicePixelRatio);
    applyViewport(topContainer, port);
    app.render();
    const bitmap = renderer.canvas.transferToImageBitmap();
    renderer.onRenderUpdated(bitmap, port);
}

function deleteAndDestroyCell14Container(
    cells: CanvasRenderer["cells"],
    cellId: Cell14Id,
) {
    cells.get(cellId)?.destroy({ children: true });
    cells.delete(cellId);
}

function clearOutOfRangeCellViews(
    { cells }: CanvasRenderer,
    nearlyCell14s: readonly Cell<14>[],
) {
    const cellIds = new Set(nearlyCell14s.map((cell) => cell.toString()));
    for (const cellId of cells.keys()) {
        if (!cellIds.has(cellId)) {
            deleteAndDestroyCell14Container(cells, cellId);
        }
    }
}

async function updateCell14Views(
    renderer: CanvasRenderer,
    port: Viewport,
    cell14: Cell<14>,
    signal: AbortSignal,
) {
    const { cells, records, PIXI, topContainer } = renderer;
    const { zoom } = port;

    const cellId = cell14.toString();
    deleteAndDestroyCell14Container(cells, cellId);

    const stat14 = await getCell14Stats(records, cell14, signal);
    if (stat14 == null) return;

    const cellContainer = new PIXI.Container();
    topContainer.addChild(cellContainer);
    cells.set(cellId, cellContainer);

    // const views: View[] = [];
    // if (14 < zoom) {
    //     views.push(...createCell17Bounds(options, stat14));
    // }
    cellContainer.addChild(createCell14Bound(renderer, stat14));
    // if (14 < zoom && zoom < 18) {
    //     views.push(...createCell14PoiCircles(options, port, stat14));
    // }
    // if (14 < zoom) {
    //     views.push(createCell14PoiNames(options, port, overlay.ctx, stat14));
    // }
    // if (13 < zoom) {
    //     views.push(createCell17CountLabel(options, stat14));
    // }
}

export async function updateRecordsCanvasRenderer(
    overlay: CanvasRenderer,
    port: Viewport,
    signal: AbortSignal,
) {
    const { cells } = overlay;
    const { zoom, bounds } = port;

    if (zoom <= 12) {
        for (const cell of cells.values()) {
            cell.destroy({ children: true });
        }
        cells.clear();
        return draw(overlay, port, signal);
    }

    const cell14s = getNearlyCellsForBounds(bounds, 14);
    clearOutOfRangeCellViews(overlay, cell14s);

    await draw(overlay, port, signal);
    for (const cell14 of cell14s) {
        await updateCell14Views(overlay, port, cell14, signal);
        await draw(overlay, port, signal);
    }
}
