//spell-checker:words Pois
import type { LatLngBounds } from "../bounds";
import { createCollisionChecker } from "../collision-checker";
import { createZeroPoint, latLngToWorldPoint, type Point } from "../geometry";
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
import { addCell17Bounds, addCell14Bound, addCell14PoiCircles } from "./views";
import type PIXI from "pixi.js";
import { isWebWorker } from "../environments";
import CellVertex from "./cell.vert";
import CellFragment from "./cell.frag";
import CircleVertex from "./circle.vert";
import CircleFragment from "./circle.frag";
import { createTypedShaderFrom } from "../typed-pixi-shader";
import { newCellMeshBuilder, type CellMeshBuilder } from "./cell-mesh-builder";
import {
    newCirclesMeshBuilder,
    type CirclesMeshBuilder,
} from "./circles-mesh-builder";
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

export interface CellViews {
    readonly meshes: PIXI.Mesh<PIXI.Geometry, PIXI.Shader>[];
    /** セル中心[世界座標] */
    readonly center: Point;
    readonly cellMeshBuilder: CellMeshBuilder;
    readonly circlesBuilder: CirclesMeshBuilder;
}

function createCellViews(
    renderer: CanvasRenderer,
    cell14: Cell<14>,
): CellViews {
    const { lat, lng } = cell14.getLatLng();
    const center = latLngToWorldPoint(lat, lng, createZeroPoint());
    const cellMeshBuilder = newCellMeshBuilder(renderer, center);
    const circlesBuilder = newCirclesMeshBuilder(renderer, center);
    return { meshes: [], center, cellMeshBuilder, circlesBuilder };
}

export interface CanvasRenderer {
    readonly layers: {
        cellLayer: PIXI.Container;
        circleLayer: PIXI.Container;
    };
    readonly handleAsyncError: (this: unknown, reason: unknown) => void;
    readonly onRenderUpdated: (
        this: unknown,
        image: ImageBitmap,
        port: Viewport,
    ) => void;
    readonly canvas: OffscreenCanvas;
    readonly PIXI: PIXI;
    readonly shader: ReturnType<typeof createCellBoundsShader>;
    readonly circleShader: ReturnType<typeof createCirclesShader>;
    readonly app: PIXI.Application;
    readonly worldContainer: PIXI.Container;
    readonly records: PoiRecords;
    readonly options: OverlayOptions;
    readonly cells: Map<Cell14Id, CellViews>;

    readonly _point_result_cache: Point;
    readonly _pois_cache: PoiRecord[];
}

async function initPIXI(canvas: OffscreenCanvas) {
    let PIXI;
    if (isWebWorker()) {
        PIXI =
            await import("https://cdn.jsdelivr.net/npm/pixi.js@8.16.0/dist/webworker.min.mjs");
        PIXI.DOMAdapter.set(PIXI.WebWorkerAdapter);
    } else {
        PIXI = await import("https://cdn.jsdelivr.net/npm/pixi.js@8.16.0/+esm");
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

function createCellBoundsShader(PIXI: PIXI) {
    return createTypedShaderFrom(
        PIXI,
        CellVertex,
        CellFragment,
        new PIXI.UniformGroup({}),
    );
}

function createCirclesShader(PIXI: PIXI) {
    return createTypedShaderFrom(
        PIXI,
        CircleVertex,
        CircleFragment,
        new PIXI.UniformGroup({}),
    );
}

export async function createRecordsCanvasRenderer(
    handleAsyncError: (reason: unknown) => void,
    onRenderUpdated: CanvasRenderer["onRenderUpdated"],
): Promise<CanvasRenderer> {
    const records = await openRecords();
    const canvas = new OffscreenCanvas(0, 0);
    const { PIXI, app } = await initPIXI(canvas);
    const worldContainer = app.stage.addChild(new PIXI.Container());

    return {
        canvas,
        layers: {
            cellLayer: worldContainer.addChild(new PIXI.Container()),
            circleLayer: worldContainer.addChild(new PIXI.Container()),
        },
        PIXI,
        shader: createCellBoundsShader(PIXI),
        circleShader: createCirclesShader(PIXI),
        app,
        worldContainer,
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
    const { app, worldContainer: topContainer } = renderer;
    const { width, height, devicePixelRatio } = port;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const checker = createCollisionChecker();
    app.renderer.resize(width, height, devicePixelRatio);
    applyViewport(topContainer, port);
    app.render();
    const bitmap = renderer.canvas.transferToImageBitmap();
    renderer.onRenderUpdated(bitmap, port);
}

function deleteAndDestroyCellView(
    cells: CanvasRenderer["cells"],
    cellId: Cell14Id,
) {
    const views = cells.get(cellId);
    if (views) {
        for (const m of views.meshes) m.destroy();
        cells.delete(cellId);
    }
}

function clearOutOfRangeCellViews(
    { cells }: CanvasRenderer,
    nearlyCell14s: readonly Cell<14>[],
) {
    const cellIds = new Set(nearlyCell14s.map((cell) => cell.toString()));
    for (const cellId of cells.keys()) {
        if (!cellIds.has(cellId)) {
            deleteAndDestroyCellView(cells, cellId);
        }
    }
}

async function updateCell14Views(
    renderer: CanvasRenderer,
    port: Viewport,
    cell14: Cell<14>,
    signal: AbortSignal,
) {
    const { cells, records } = renderer;
    const { zoom } = port;

    const cellId = cell14.toString();
    deleteAndDestroyCellView(cells, cellId);

    const stat14 = await getCell14Stats(records, cell14, signal);
    if (stat14 == null) return;

    const views = createCellViews(renderer, cell14);
    cells.set(cellId, views);

    if (14 < zoom) {
        addCell17Bounds(renderer, stat14, views.cellMeshBuilder);
    }
    addCell14Bound(renderer, views, stat14);
    if (14 < zoom && zoom < 18) {
        addCell14PoiCircles(renderer, port, stat14, views.circlesBuilder);
    }
    // if (14 < zoom) {
    //     views.push(createCell14PoiNames(options, port, overlay.ctx, stat14));
    // }
    // if (13 < zoom) {
    //     views.push(createCell17CountLabel(options, stat14));
    // }
    const cellMesh = renderer.layers.cellLayer.addChild(
        views.cellMeshBuilder.bake(),
    );
    const circlesMesh = renderer.layers.circleLayer.addChild(
        views.circlesBuilder.bake(),
    );
    views.meshes.push(cellMesh, circlesMesh);
}

export async function updateRecordsCanvasRenderer(
    overlay: CanvasRenderer,
    port: Viewport,
    signal: AbortSignal,
) {
    const { cells } = overlay;
    const { zoom, bounds } = port;

    if (zoom <= 12) {
        for (const cellId of cells.keys()) {
            deleteAndDestroyCellView(cells, cellId);
        }
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
