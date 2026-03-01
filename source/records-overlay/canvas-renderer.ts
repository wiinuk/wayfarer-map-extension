//spell-checker:words Pois
import type { LatLngBounds } from "../bounds";
import { createCollisionChecker } from "../collision-checker";
import { type Point } from "../geometry";
import {
    type Cell14Statistics,
    getCell14Stats,
    type PoiRecords,
    openRecords,
    getNearlyCellsForBounds,
    type PoiRecord,
} from "../poi-records";
import { createOverlayViewOptions, type OverlayOptions } from "./options";
import type { LatLng } from "../s2";
import { raise, waitAnimationFrame, type Memo } from "../standard-extensions";
import type { Cell, Cell14Id } from "../typed-s2cell";
import {
    createCell14Bound,
    createCell14PoiCircles,
    createCell14PoiNames,
    createCell17Bounds,
    createCell17CountLabel,
} from "./views";

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
type View = {
    draw: (this: unknown, context: ViewsRenderingContext) => void;
    readonly zIndex: number;
};
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
    readonly ctx: OffscreenCanvasRenderingContext2D;
    readonly records: PoiRecords;
    readonly options: OverlayOptions;
    readonly cells: Map<Cell14Id, View[]>;

    readonly _point_result_cache: Point;
    readonly _pois_cache: PoiRecord[];
}

export async function createRecordsCanvasRenderer(
    handleAsyncError: (reason: unknown) => void,
    onRenderUpdated: CanvasRenderer["onRenderUpdated"],
): Promise<CanvasRenderer> {
    const records = await openRecords();
    return {
        handleAsyncError,
        onRenderUpdated,
        options: createOverlayViewOptions(),
        ctx: new OffscreenCanvas(0, 0).getContext("2d") ?? raise`context2d`,
        records,
        cells: new Map(),
        _point_result_cache: { x: 0, y: 0 },
        _pois_cache: [],
    };
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

function drawOverlay(overlay: CanvasRenderer, port: Viewport) {
    const { ctx } = overlay;
    const checker = createCollisionChecker();
    const context: ViewsRenderingContext = {
        ...overlay,
        ...port,
        ctx,
        checker,
    };
    initCanvas(ctx, port);

    const vs: View[] = [];
    for (const views of overlay.cells.values()) {
        for (const view of views) vs.push(view);
    }
    vs.sort((v1, v2) => v1.zIndex - v2.zIndex);
    for (const view of vs) view.draw(context);
}

async function drawAndWait(
    overlay: CanvasRenderer,
    port: Viewport,
    signal: AbortSignal,
) {
    await waitAnimationFrame(signal);
    drawOverlay(overlay, port);
    const bitmap = overlay.ctx.canvas.transferToImageBitmap();
    overlay.onRenderUpdated(bitmap, port);
}

function clearOutOfRangeCellViews(
    { cells }: CanvasRenderer,
    nearlyCell14s: readonly Cell<14>[],
) {
    const cellIds = new Set(nearlyCell14s.map((cell) => cell.toString()));
    for (const cellId of cells.keys()) {
        if (!cellIds.has(cellId)) cells.delete(cellId);
    }
}

async function updateCell14Views(
    overlay: CanvasRenderer,
    port: Viewport,
    cell14: Cell<14>,
    signal: AbortSignal,
) {
    const { cells, options, records } = overlay;
    const { zoom } = port;

    const stat14 = await getCell14Stats(records, cell14, signal);
    if (stat14 == null) return cells.delete(cell14.toString());

    const views: View[] = [];
    if (14 < zoom) {
        views.push(...createCell17Bounds(options, stat14));
    }
    views.push(createCell14Bound(options, stat14));
    if (14 < zoom && zoom < 18) {
        views.push(...createCell14PoiCircles(options, port, stat14));
    }
    if (14 < zoom) {
        views.push(createCell14PoiNames(options, port, overlay.ctx, stat14));
    }
    if (13 < zoom) {
        views.push(createCell17CountLabel(options, stat14));
    }
    cells.set(stat14.id, views);
}

export async function updateRecordsCanvasRenderer(
    overlay: CanvasRenderer,
    port: Viewport,
    signal: AbortSignal,
) {
    const { cells } = overlay;
    const { zoom, bounds } = port;

    if (zoom <= 12) {
        cells.clear();
        return drawAndWait(overlay, port, signal);
    }

    const cell14s = getNearlyCellsForBounds(bounds, 14);
    clearOutOfRangeCellViews(overlay, cell14s);

    await drawAndWait(overlay, port, signal);
    for (const cell14 of cell14s) {
        await updateCell14Views(overlay, port, cell14, signal);
        await drawAndWait(overlay, port, signal);
    }
}
