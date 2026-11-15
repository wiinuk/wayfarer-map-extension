//spell-checker:words Pois Hiragino Kaku Meiryo Neue
import type { LatLngBounds } from "../bounds";
import {
    createCollisionChecker,
    type CollisionChecker,
} from "../collision-checker";
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
import {
    addCell17Bounds,
    addCell14Bound,
    addCell14PoiCircles,
    createCell17CountLabel,
    createCell14PoiNames,
} from "./views";
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
import {
    createRangeCanvasPool,
    renderRangeDisplay,
    type RangeDisplayPlan,
    type RangeCanvasPool,
} from "./range-display";
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
    readonly views: PIXI.Container[];
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
    return { views: [], center, cellMeshBuilder, circlesBuilder };
}

type BoxBounds = ReturnType<typeof createBoxBoundsClass>;
function createBoxBoundsClass(PIXI: PIXI) {
    return class BoxBounds extends PIXI.Bounds {
        constructor(public key: unknown) {
            super();
        }
    };
}

type Mesh = PIXI.Mesh<PIXI.Geometry, PIXI.Shader>;
export interface CanvasRenderer {
    readonly handleAsyncError: (this: unknown, reason: unknown) => void;
    readonly onRenderUpdated: (
        this: unknown,
        image: ImageBitmap,
        port: Viewport,
    ) => void;
    readonly onRangeRenderUpdated: (
        this: unknown,
        image: ImageBitmap,
        port: Viewport,
        planRevision: number,
        renderId: number,
    ) => void;
    readonly canvas: HTMLCanvasElement | OffscreenCanvas;
    readonly rangeCanvas: HTMLCanvasElement | OffscreenCanvas;
    readonly rangeCanvasPool: RangeCanvasPool;
    rangeDisplayPlan: RangeDisplayPlan;
    rangeDisplayRevision: number;
    rangeDisplayRenderId: number;
    rangeDisplayCacheKey: string | null;
    readonly PIXI: PIXI;
    readonly BoxBounds: BoxBounds;

    readonly shader: ReturnType<typeof createCellBoundsShader>;
    readonly circleShader: ReturnType<typeof createCirclesShader>;

    readonly app: PIXI.Application;
    readonly worldContainer: PIXI.Container;
    readonly layers: {
        readonly cellLayer: PIXI.Container<Mesh>;
        readonly circleLayer: PIXI.Container<Mesh>;
        readonly labelLayer: PIXI.Container<PIXI.Text>;
        readonly cell14TextLayer: PIXI.Container<PIXI.Text>;
    };

    readonly cell14LabelTextStyle: PIXI.TextStyle;

    readonly records: PoiRecords;
    readonly options: OverlayOptions;
    readonly cells: Map<Cell14Id, CellViews>;

    readonly _tempTransform: PIXI.TransformableObject;
    readonly _point_result_cache: Point;
    readonly _pois_cache: PoiRecord[];
}

async function initPIXI(canvas: HTMLCanvasElement | OffscreenCanvas) {
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
        // OffscreenCanvas では自動追従されない
        autoDensity: false,
        autoStart: false,
        backgroundAlpha: 0,
        antialias: true,
        roundPixels: true,
    });
    return {
        PIXI,
        app,
    };
}

function createCanvasSurface() {
    if (typeof OffscreenCanvas !== "undefined") {
        return new OffscreenCanvas(0, 0);
    }
    return document.createElement("canvas");
}

async function createCanvasImageBitmap(
    canvas: HTMLCanvasElement | OffscreenCanvas,
) {
    if (
        typeof OffscreenCanvas !== "undefined" &&
        canvas instanceof OffscreenCanvas
    ) {
        return canvas.transferToImageBitmap();
    }
    return createImageBitmap(canvas);
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

function updateFixedScale(renderer: CanvasRenderer, container: PIXI.Container) {
    if (container.parent == null) return;

    const { scale } = container.parent.worldTransform.decompose(
        renderer._tempTransform,
    );
    container.scale.x = 1 / scale.x;
    container.scale.y = 1 / scale.y;
}
export async function createRecordsCanvasRenderer(
    handleAsyncError: (reason: unknown) => void,
    onRenderUpdated: CanvasRenderer["onRenderUpdated"],
    onRangeRenderUpdated: CanvasRenderer["onRangeRenderUpdated"],
): Promise<CanvasRenderer> {
    const records = await openRecords();
    const canvas = createCanvasSurface();
    const rangeCanvas = createCanvasSurface();
    const { PIXI, app } = await initPIXI(canvas);
    const worldContainer = app.stage.addChild(new PIXI.Container());

    const cell14LabelTextStyle = new PIXI.TextStyle({
        align: "center",
        fontWeight: "bold",
        fontSize: "20px",
        fontFamily: `"Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", "Hiragino Sans", Meiryo, sans-serif`,
        fill: "rgb(255, 255, 255)",
        stroke: {
            width: 4,
            join: "round",
            color: "#c54545",
        },
    });
    return {
        canvas,
        rangeCanvas,
        rangeCanvasPool: createRangeCanvasPool(createCanvasSurface),
        rangeDisplayPlan: { expression: null, circles: [] },
        rangeDisplayRevision: 0,
        rangeDisplayRenderId: 0,
        rangeDisplayCacheKey: null,
        layers: {
            cellLayer: worldContainer.addChild(new PIXI.Container<PIXI.Mesh>()),
            circleLayer: worldContainer.addChild(
                new PIXI.Container<PIXI.Mesh>(),
            ),
            labelLayer: worldContainer.addChild(
                new PIXI.Container<PIXI.Text>(),
            ),
            cell14TextLayer: worldContainer.addChild(
                new PIXI.Container<PIXI.Text>(),
            ),
        },
        PIXI,
        BoxBounds: createBoxBoundsClass(PIXI),
        shader: createCellBoundsShader(PIXI),
        circleShader: createCirclesShader(PIXI),
        cell14LabelTextStyle,
        app,
        worldContainer,
        handleAsyncError,
        onRenderUpdated,
        onRangeRenderUpdated,
        options: createOverlayViewOptions(),
        records,
        cells: new Map(),

        _point_result_cache: { x: 0, y: 0 },
        _pois_cache: [],
        _tempTransform: new PIXI.Transform(),
    };
}
export function setRecordsRangeDisplayPlan(
    renderer: CanvasRenderer,
    plan: RangeDisplayPlan,
    revision: number,
) {
    renderer.rangeDisplayPlan = plan;
    renderer.rangeDisplayRevision = revision;
    renderer.rangeDisplayCacheKey = null;
}

async function drawRangeDisplay(renderer: CanvasRenderer, port: Viewport) {
    const cacheKey = [
        renderer.rangeDisplayRevision,
        port.zoom,
        port.nwWorld.x,
        port.nwWorld.y,
        port.width,
        port.height,
        port.devicePixelRatio,
    ].join(":");
    if (renderer.rangeDisplayCacheKey === cacheKey) return;

    const plan = renderer.rangeDisplayPlan;
    const planRevision = renderer.rangeDisplayRevision;
    const renderId = ++renderer.rangeDisplayRenderId;
    renderRangeDisplay(
        renderer.rangeCanvas,
        renderer.rangeCanvasPool,
        plan,
        port,
    );
    const image = await createCanvasImageBitmap(renderer.rangeCanvas);
    if (
        planRevision !== renderer.rangeDisplayRevision ||
        renderId !== renderer.rangeDisplayRenderId
    ) {
        image.close();
        return;
    }
    renderer.onRangeRenderUpdated(image, port, planRevision, renderId);
    renderer.rangeDisplayCacheKey = cacheKey;
}

function applyViewport(layer: PIXI.Container, viewport: Viewport) {
    const scale = 2 ** viewport.zoom;
    layer.scale.set(scale);
    layer.x = -viewport.nwWorld.x * scale;
    layer.y = -viewport.nwWorld.y * scale;
}

function updateVisibility(
    { BoxBounds }: CanvasRenderer,
    checker: CollisionChecker,
    label: PIXI.Text,
) {
    const box = new BoxBounds(label.uid);

    // bounds を測定するため一旦表示する
    label.visible = true;
    label.getBounds(false, box);

    if (checker.check(box)) {
        label.visible = false;
        return;
    }
    checker.addBox(box);
    label.visible = true;
}
function updateContainers(renderer: CanvasRenderer) {
    for (const label14 of renderer.layers.cell14TextLayer.children) {
        updateFixedScale(renderer, label14);
    }

    for (const label of renderer.layers.labelLayer.children) {
        updateFixedScale(renderer, label);
    }

    const checker = createCollisionChecker();
    for (const label of renderer.layers.labelLayer.children) {
        updateVisibility(renderer, checker, label);
    }
}

async function draw(
    renderer: CanvasRenderer,
    port: Viewport,
    signal: AbortSignal,
) {
    await waitAnimationFrame(signal);
    const { app, worldContainer } = renderer;
    const { width, height, devicePixelRatio } = port;
    app.renderer.resize(width, height, devicePixelRatio);
    applyViewport(worldContainer, port);
    updateContainers(renderer);
    app.render();
    const bitmap = await createCanvasImageBitmap(renderer.canvas);
    renderer.onRenderUpdated(bitmap, port);
}

function deleteAndDestroyCellView(
    cells: CanvasRenderer["cells"],
    cellId: Cell14Id,
) {
    const views = cells.get(cellId);
    if (views) {
        for (const m of views.views) m.destroy();
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
    if (14 < zoom && zoom < 16) {
        addCell14PoiCircles(renderer, port, stat14, views.circlesBuilder);
    }
    if (14 < zoom) {
        for (const label of createCell14PoiNames(renderer, port, stat14)) {
            views.views.push(renderer.layers.labelLayer.addChild(label));
        }
    }
    if (13 < zoom) {
        const label = createCell17CountLabel(renderer, stat14);
        if (label) {
            views.views.push(renderer.layers.cell14TextLayer.addChild(label));
        }
    }
    views.views.push(
        renderer.layers.cellLayer.addChild(views.cellMeshBuilder.bake()),
    );
    views.views.push(
        renderer.layers.circleLayer.addChild(views.circlesBuilder.bake()),
    );
}

export async function updateRecordsCanvasRenderer(
    overlay: CanvasRenderer,
    port: Viewport,
    signal: AbortSignal,
) {
    const { cells } = overlay;
    const { zoom, bounds } = port;
    await drawRangeDisplay(overlay, port);

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
