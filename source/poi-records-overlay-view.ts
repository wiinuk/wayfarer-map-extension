//spell-checker:words Lngs POKESTOP Pois pokestops Hiragino Kaku Meiryo Neue
import type { LatLngBounds } from "./bounds";
import type { EntityKind } from "./gcs-schema";
import {
    type Cell14Statistics,
    type CellStatistic,
    getCell14Stats,
    type PoiRecords,
    openRecords,
    getNearlyCellsForBounds,
} from "./poi-records";
import type { LatLng } from "./s2";
import { waitAnimationFrame } from "./standard-extensions";
import type { Cell } from "./typed-s2cell";

export interface Viewport {
    readonly zoom: number;
    readonly bounds: LatLngBounds;
    readonly center: LatLng;
    readonly nwWorld: Point;
    readonly width: number;
    readonly height: number;
}

const TILE_SIZE = 256;
const PI = Math.PI;
const RAD_PER_DEG = PI / 180;
const X_FACTOR = TILE_SIZE / 360;
const Y_FACTOR = TILE_SIZE / (2 * PI);
const OFFSET = TILE_SIZE / 2;

function latLngToWorldPoint(lat: number, lng: number, result: Point) {
    // 経度
    const x = (lng + 180) * X_FACTOR;

    // 緯度
    const sinY = Math.sin(lat * RAD_PER_DEG);
    const clampedSinY =
        sinY > 0.9999 ? 0.9999 : sinY < -0.9999 ? -0.9999 : sinY;
    const y = OFFSET - Math.atanh(clampedSinY) * Y_FACTOR;

    result.x = x;
    result.y = y;
    return result;
}

interface Point {
    x: number;
    y: number;
}

function worldPointToScreenPoint(
    { nwWorld, zoom }: Readonly<Viewport>,
    pWorld: Readonly<Point>,
    result: Point,
) {
    const scale = 2 ** zoom;
    const x = (pWorld.x - nwWorld.x) * scale;
    const y = (pWorld.y - nwWorld.y) * scale;

    result.x = x;
    result.y = y;
    return result;
}

function latLngToScreenPoint(
    viewport: Viewport,
    lat: number,
    lng: number,
    result: Point,
) {
    const pWorld = latLngToWorldPoint(lat, lng, result);
    return worldPointToScreenPoint(viewport, pWorld, result);
}

function drawPolygons(
    views: OverlayView,
    port: Viewport,
    ctx: RenderingContext,
    paths: readonly Path[],
    options: Cell17Options,
) {
    if (paths.length === 0) return;

    ctx.beginPath();
    for (const path of paths) {
        setSubPath(views, port, path, ctx);
    }
    ctx.fillStyle = options.fillColor;
    ctx.fill();

    ctx.strokeStyle = options.strokeColor;
    ctx.lineWidth = options.strokeWeight;
    ctx.stroke();
}

function drawPolygon(
    views: OverlayView,
    port: Viewport,
    ctx: RenderingContext,
    path: Path,
    options: typeof cell17EmptyOptions,
) {
    ctx.beginPath();
    setSubPath(views, port, path, ctx);

    ctx.fillStyle = options.fillColor;
    ctx.fill();

    ctx.strokeStyle = options.strokeColor;
    ctx.lineWidth = options.strokeWeight;
    ctx.stroke();
}

function drawCell14Label(
    views: OverlayView,
    port: Viewport,
    ctx: RenderingContext,
    text: string,
    center: LatLng,
) {
    const { x, y } = latLngToScreenPoint(
        port,
        center.lat,
        center.lng,
        views._point_result_cache,
    );

    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.font = `bold 20px "Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", "Hiragino Sans", Meiryo, sans-serif`;

    ctx.lineWidth = 4;
    ctx.strokeStyle = "#c54545";
    ctx.strokeText(text, x, y);

    ctx.fillStyle = "rgb(255, 255, 255)";
    ctx.fillText(text, x, y);
}

const baseZIndex = 3100;

const cell17EmptyOptions = Object.freeze({
    strokeColor: "rgba(253, 255, 114, 0.4)",
    strokeWeight: 1,
    fillColor: "#0000002d",
    clickable: false,
    zIndex: baseZIndex + 1,
} satisfies google.maps.PolygonOptions);

const cell17PokestopOptions = Object.freeze({
    ...cell17EmptyOptions,

    fillColor: "rgba(0, 191, 255, 0.4)",
    strokeColor: "rgba(0, 191, 255, 0.6)",
    zIndex: baseZIndex,
} satisfies google.maps.PolygonOptions);

const cell17GymOptions = Object.freeze({
    ...cell17PokestopOptions,

    fillColor: "rgba(255, 0, 13, 0.4)",
    strokeColor: "rgba(255, 0, 13, 0.6)",
} satisfies google.maps.PolygonOptions);

const cell14Options = Object.freeze({
    strokeColor: "#c54545b7",
    strokeWeight: 2,
    fillColor: "transparent",
    clickable: false,
    zIndex: baseZIndex + 2,
} satisfies google.maps.PolygonOptions);

const cell14OptionsEmpty = cell14Options;
const cell14Options1 = Object.freeze({
    ...cell14Options,
    fillColor: "#dd767625",
} satisfies google.maps.PolygonOptions);

const cell14Options2 = Object.freeze({
    ...cell14Options,
    fillColor: "#d3b71738",
} satisfies google.maps.PolygonOptions);

function countToCell14Options(count: number) {
    switch (count) {
        case 0:
            return cell14OptionsEmpty;
        case 1:
        case 5:
        case 19:
            return cell14Options1;
        case 4:
        case 18:
            return cell14Options2;
    }
    return cell14Options;
}
function getCell14Options(entityCount: number, coverRate: number) {
    const options = countToCell14Options(entityCount);
    if (coverRate === 1) return options;
    return {
        ...options,
        strokeWeight:
            options.strokeWeight * 2 +
            options.strokeWeight * 10 * (1 - coverRate),
        strokePosition: google.maps.StrokePosition.INSIDE,
        strokeOpacity: 0.3 + 0.4 * coverRate,

        fillColor: "transparent",
    };
}
function sumGymAndPokestopCount({ kindToPois }: Cell14Statistics) {
    return (
        (kindToPois.get("GYM")?.length ?? 0) +
        (kindToPois.get("POKESTOP")?.length ?? 0)
    );
}

function drawCell14Bound(
    view: OverlayView,
    port: Viewport,
    ctx: RenderingContext,
    cell14: Cell14Statistics,
) {
    const entityCount = sumGymAndPokestopCount(cell14);
    const coverRate = cell14.cell17s.size / 4 ** (17 - 14);
    const options = getCell14Options(entityCount, coverRate);
    drawPolygon(view, port, ctx, cell14.corner, options);
}

function drawCell17CountLabel(
    views: OverlayView,
    port: Viewport,
    ctx: RenderingContext,
    cell14: Cell14Statistics,
) {
    const count = sumGymAndPokestopCount(cell14);
    if (count <= 0) return;

    drawCell14Label(views, port, ctx, `${count}`, cell14.center);
}

function has(kind: EntityKind, cell17: CellStatistic<17>) {
    return (cell17.kindToCount.get(kind) ?? 0) !== 0;
}

function drawCell17Bounds(
    views: OverlayView,
    port: Viewport,
    ctx: RenderingContext,
    stat14: Cell14Statistics,
) {
    const gyms = views._gyms_cache;
    const stops = views._pokestops_cache;
    const empties = views._empties_cache;
    try {
        for (const cell17 of stat14.cell17s.values()) {
            const path = cell17.cell.getCornerLatLngs();

            if (has("GYM", cell17)) {
                gyms.push(path);
            } else if (has("POKESTOP", cell17)) {
                stops.push(path);
            } else {
                empties.push(path);
            }
        }
        drawPolygons(views, port, ctx, empties, cell17EmptyOptions);
        drawPolygons(views, port, ctx, stops, cell17PokestopOptions);
        drawPolygons(views, port, ctx, gyms, cell17GymOptions);
    } finally {
        empties.length = 0;
        stops.length = 0;
        gyms.length = 0;
    }
}
async function drawCell14(
    views: OverlayView,
    port: Viewport,
    ctx: RenderingContext,
    cell14: Cell<14>,
    signal: AbortSignal,
) {
    const { records } = views;
    const { zoom } = port;

    const stat14 = await getCell14Stats(records, cell14, signal);
    if (stat14 == null) return;

    if (14 < zoom) {
        drawCell17Bounds(views, port, ctx, stat14);
    }
    drawCell14Bound(views, port, ctx, stat14);
    if (13 < zoom) {
        drawCell17CountLabel(views, port, ctx, stat14);
    }
}

type Cell17Options = typeof cell17EmptyOptions;

type Canvas = HTMLCanvasElement | OffscreenCanvas;

type Path = readonly LatLng[];
export interface OverlayView {
    readonly canvas: Canvas;
    readonly records: PoiRecords;

    readonly _point_result_cache: Point;

    readonly _gyms_cache: Path[];
    readonly _pokestops_cache: Path[];
    readonly _empties_cache: Path[];
}

type RenderingContext =
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D;

function setSubPath(
    views: OverlayView,
    port: Viewport,
    path: Path,
    ctx: RenderingContext,
) {
    const start = path[0];
    if (start != null) {
        const { x, y } = latLngToScreenPoint(
            port,
            start.lat,
            start.lng,
            views._point_result_cache,
        );
        ctx.moveTo(x, y);

        for (let i = 1; i < path.length; i++) {
            const p = path[i]!;
            const { x, y } = latLngToScreenPoint(
                port,
                p.lat,
                p.lng,
                views._point_result_cache,
            );
            ctx.lineTo(x, y);
        }
    }
    ctx.closePath();
}

export async function createRecordsOverlayView(
    canvas: Canvas,
    _handleAsyncError: (reason: unknown) => void,
): Promise<OverlayView> {
    const records = await openRecords();
    return {
        canvas,
        records,
        _point_result_cache: { x: 0, y: 0 },
        _empties_cache: [],
        _gyms_cache: [],
        _pokestops_cache: [],
    };
}

export async function renderRecordsOverlayView(
    views: OverlayView,
    port: Viewport,
    signal: AbortSignal,
) {
    const { zoom, bounds, width, height } = port;

    await waitAnimationFrame(signal);
    const ctx = views.canvas.getContext("2d");
    if (ctx == null) return;
    views.canvas.width = width;
    views.canvas.height = height;
    ctx.clearRect(0, 0, width, height);

    if (zoom <= 12) return;

    const cell14s = getNearlyCellsForBounds(bounds, 14);
    for (const cell14 of cell14s) {
        await drawCell14(views, port, ctx, cell14, signal);
    }
}
