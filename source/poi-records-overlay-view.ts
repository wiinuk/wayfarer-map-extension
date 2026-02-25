//spell-checker:words Lngs POKESTOP Pois pokestops Hiragino Kaku Meiryo Neue POWERSPOT wayspot
import type { LatLngBounds } from "./bounds";
import { createCollisionChecker } from "./collision-checker";
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
    readonly devicePixelRatio: number;
}
export interface RecordsRenderingContext extends OverlayView, Viewport {
    readonly ctx: RenderingContext;
    readonly checker: ReturnType<typeof createCollisionChecker>;
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

    result.x = x | 0;
    result.y = y | 0;
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

function getEllipsisTextWithMetrics(
    ctx: RenderingContext,
    text: string,
    maxWidth: number,
    ellipsis = "…",
) {
    const fullMetrics = ctx.measureText(text);
    if (fullMetrics.width <= maxWidth) return fullMetrics;

    let low = 0;
    let high = text.length;
    let bestText = ellipsis;
    let bestMetrics = ctx.measureText(ellipsis);
    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const testString = text.substring(0, mid) + ellipsis;
        const testMetrics = ctx.measureText(testString);

        if (testMetrics.width <= maxWidth) {
            bestText = testString;
            bestMetrics = testMetrics;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }

    return { bestText, bestMetrics };
}

function drawPolygons(
    context: RecordsRenderingContext,
    paths: readonly Path[],
    options: Cell17Options,
) {
    const { ctx } = context;
    if (paths.length === 0) return;

    ctx.beginPath();
    for (const path of paths) {
        setSubPath(context, path);
    }
    ctx.fillStyle = options.fillColor;
    ctx.fill();

    ctx.strokeStyle = options.strokeColor;
    ctx.lineWidth = options.strokeWeight;
    ctx.stroke();
}

function drawPolygon(
    context: RecordsRenderingContext,
    path: Path,
    options: typeof cell17EmptyOptions,
) {
    const { ctx } = context;
    ctx.beginPath();
    setSubPath(context, path);

    ctx.fillStyle = options.fillColor;
    ctx.fill();

    ctx.strokeStyle = options.strokeColor;
    ctx.lineWidth = options.strokeWeight;
    ctx.stroke();
}

function drawCell14Label(
    context: RecordsRenderingContext,
    text: string,
    center: LatLng,
) {
    const { ctx } = context;
    const { x, y } = latLngToScreenPoint(
        context,
        center.lat,
        center.lng,
        context._point_result_cache,
    );

    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.font = `bold 20px "Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", "Hiragino Sans", Meiryo, sans-serif`;

    ctx.lineWidth = 4;
    ctx.lineJoin = "round";
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
    context: RecordsRenderingContext,
    cell14: Cell14Statistics,
) {
    const entityCount = sumGymAndPokestopCount(cell14);
    const coverRate = cell14.cell17s.size / 4 ** (17 - 14);
    const options = getCell14Options(entityCount, coverRate);
    drawPolygon(context, cell14.corner, options);
}

function drawCell17CountLabel(
    context: RecordsRenderingContext,
    cell14: Cell14Statistics,
) {
    const count = sumGymAndPokestopCount(cell14);
    if (count <= 0) return;

    drawCell14Label(context, `${count}`, cell14.center);
}

function has(kind: EntityKind, cell17: CellStatistic<17>) {
    return (cell17.kindToCount.get(kind) ?? 0) !== 0;
}

function drawCell17Bounds(
    context: RecordsRenderingContext,
    stat14: Cell14Statistics,
) {
    const gyms = context._gyms_cache;
    const stops = context._pokestops_cache;
    const empties = context._empties_cache;
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
        drawPolygons(context, empties, cell17EmptyOptions);
        drawPolygons(context, stops, cell17PokestopOptions);
        drawPolygons(context, gyms, cell17GymOptions);
    } finally {
        empties.length = 0;
        stops.length = 0;
        gyms.length = 0;
    }
}

const wayspotOptions = Object.freeze({
    markerSize: 8,
    borderColor: "#ff6600",
    borderWidth: 2,
    fillColor: "#ff660080",
});
const gymOptions = Object.freeze({
    ...wayspotOptions,
    borderColor: "#ffffff",
    fillColor: "#ff2450",
});
const pokestopOptions = Object.freeze({
    ...wayspotOptions,
    borderColor: "#0000cd",
    fillColor: "#00bfff",
});
const powerspotOptions = Object.freeze({
    ...wayspotOptions,
    borderColor: "#e762d3",
    fillColor: "#f195eb",
});

function entityKindToOptions(kind: EntityKind | "") {
    switch (kind) {
        case "GYM":
            return gymOptions;
        case "POKESTOP":
            return pokestopOptions;
        case "POWERSPOT":
            return powerspotOptions;
        default:
            return wayspotOptions;
    }
}

function enterRenderingScope<T1, R>(
    scope: (context: RecordsRenderingContext, arg1: T1) => R,
    context: RecordsRenderingContext,
    arg1: T1,
): R {
    const { ctx } = context;
    ctx.save();
    try {
        return scope(context, arg1);
    } finally {
        ctx.restore();
    }
}

function drawCell14PoiCircles(
    context: RecordsRenderingContext,
    stat14: Cell14Statistics,
) {
    const { ctx } = context;
    for (const [kind, pois] of stat14.kindToPois) {
        const options = entityKindToOptions(kind);
        const radius =
            context.zoom <= 16 ? options.markerSize * 0.5 : options.markerSize;

        ctx.beginPath();
        for (const { lat, lng, data } of pois) {
            if (!data.isCommunityContributed) continue;

            const { x, y } = latLngToScreenPoint(
                context,
                lat,
                lng,
                context._point_result_cache,
            );
            ctx.moveTo(x + radius, y);
            ctx.arc(x, y, radius, 0, Math.PI * 2);
        }
        ctx.fillStyle = options.fillColor;
        ctx.fill();

        ctx.strokeStyle = options.borderColor;
        ctx.lineWidth = options.borderWidth;
        ctx.stroke();
    }
}
function drawCell14PoiNames(
    context: RecordsRenderingContext,
    stat14: Cell14Statistics,
) {
    const { ctx, checker } = context;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.font = `11px "Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", "Hiragino Sans", Meiryo, sans-serif`;

    ctx.shadowColor = "rgb(0, 0, 0)";
    ctx.shadowBlur = 1;
    ctx.fillStyle = "#FFFFBB";

    ctx.strokeStyle = "rgb(0, 0, 0)";
    ctx.lineJoin = "round";
    ctx.lineWidth = 2;
    for (const { lat, lng, data, guid, name } of stat14.pois.values()) {
        if (!data.isCommunityContributed) continue;

        const { x, y } = latLngToScreenPoint(
            context,
            lat,
            lng,
            context._point_result_cache,
        );

        const textX = x;
        const textY = y + 15;

        let truncatedMetrics = getEllipsisTextWithMetrics(ctx, name, 140);
        let truncatedText = name;
        if (!(truncatedMetrics instanceof TextMetrics)) {
            truncatedText = truncatedMetrics.bestText;
            truncatedMetrics = truncatedMetrics.bestMetrics;
        }

        const box = getTextBox(ctx, truncatedMetrics, textX, textY, guid);
        if (checker.check(box)) continue;
        checker.addBox(box);

        ctx.strokeText(truncatedText, textX, textY);
        ctx.fillText(truncatedText, textX, textY);
    }
}
function getTextBox(
    ctx: RenderingContext,
    metrics: TextMetrics,
    textX: number,
    textY: number,
    guid: string,
) {
    const actualHeight =
        metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
    const textWidth =
        metrics.width +
        ctx.lineWidth +
        ctx.shadowBlur +
        Math.abs(ctx.shadowOffsetX);
    const textHeight =
        actualHeight +
        ctx.lineWidth +
        ctx.shadowBlur +
        Math.abs(ctx.shadowOffsetY);

    const box = {
        centerX: textX,
        centerY: textY,
        width: textWidth,
        height: textHeight,
        key: guid,
    };
    return box;
}

async function drawCell14(
    context: RecordsRenderingContext,
    cell14: Cell<14>,
    signal: AbortSignal,
) {
    const { records, zoom } = context;

    const stat14 = await getCell14Stats(records, cell14, signal);
    if (stat14 == null) return;

    if (14 < zoom) {
        enterRenderingScope(drawCell17Bounds, context, stat14);
    }
    drawCell14Bound(context, stat14);
    if (14 < zoom && zoom < 18) {
        enterRenderingScope(drawCell14PoiCircles, context, stat14);
    }
    if (14 < zoom) {
        enterRenderingScope(drawCell14PoiNames, context, stat14);
    }
    if (13 < zoom) {
        enterRenderingScope(drawCell17CountLabel, context, stat14);
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

function setSubPath(context: RecordsRenderingContext, path: Path) {
    const { ctx } = context;
    const start = path[0];
    if (start != null) {
        const { x, y } = latLngToScreenPoint(
            context,
            start.lat,
            start.lng,
            context._point_result_cache,
        );
        ctx.moveTo(x, y);

        for (let i = 1; i < path.length; i++) {
            const p = path[i]!;
            const { x, y } = latLngToScreenPoint(
                context,
                p.lat,
                p.lng,
                context._point_result_cache,
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
    const { zoom, bounds, width, height, devicePixelRatio } = port;

    const ctx = views.canvas.getContext("2d") as RenderingContext | null;
    if (ctx == null) return;

    const checker = createCollisionChecker();
    const context: RecordsRenderingContext = {
        ...views,
        ...port,
        ctx,
        checker,
    };

    views.canvas.width = width * devicePixelRatio;
    views.canvas.height = height * devicePixelRatio;
    ctx.scale(devicePixelRatio, devicePixelRatio);

    ctx.clearRect(0, 0, width, height);
    await waitAnimationFrame(signal);

    if (zoom <= 12) return;

    const cell14s = getNearlyCellsForBounds(bounds, 14);
    for (const cell14 of cell14s) {
        await drawCell14(context, cell14, signal);
    }
}
