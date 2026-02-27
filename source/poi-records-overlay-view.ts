//spell-checker:words Lngs POKESTOP Pois Hiragino Kaku Meiryo Neue POWERSPOT wayspot
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
    type PoiRecord,
} from "./poi-records";
import type { LatLng } from "./s2";
import { ignore, raise, waitAnimationFrame } from "./standard-extensions";
import type { Cell, Cell14Id } from "./typed-s2cell";

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
    worldX: number,
    worldY: number,
    result: Point,
) {
    const scale = 2 ** zoom;
    const x = (worldX - nwWorld.x) * scale;
    const y = (worldY - nwWorld.y) * scale;

    result.x = x | 0;
    result.y = y | 0;
    return result;
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

const Point_size = 2;
const Point_x = 0;
const Point_y = 1;

function createCellBounds(
    cornerPaths: readonly LatLngPath[],
    options: Cell17Options,
) {
    const pathCount = cornerPaths.length;
    const cornerCount = 4;
    const buffer = new Float64Array(pathCount * cornerCount * Point_size);
    let bufferIndex = 0;
    const pointResultCache = createZeroPoint();
    for (const cornerPath of cornerPaths) {
        if (cornerPath.length !== cornerCount) return raise`internal error`;
        for (const { lat, lng } of cornerPath) {
            const { x, y } = latLngToWorldPoint(lat, lng, pointResultCache);
            buffer[bufferIndex++] = x;
            buffer[bufferIndex++] = y;
        }
    }
    return {
        zIndex: options.zIndex,
        draw: (context: RecordsRenderingContext) => {
            const { ctx } = context;

            ctx.beginPath();
            for (let pathIndex = 0; pathIndex < pathCount; pathIndex++) {
                const pathPointer = pathIndex * cornerCount * Point_size;
                for (
                    let cornerIndex = 0;
                    cornerIndex < cornerCount;
                    cornerIndex++
                ) {
                    const pointPointer = pathPointer + cornerIndex * Point_size;
                    const worldX = buffer[pointPointer + Point_x]!;
                    const worldY = buffer[pointPointer + Point_y]!;
                    const { x, y } = worldPointToScreenPoint(
                        context,
                        worldX,
                        worldY,
                        pointResultCache,
                    );
                    if (cornerIndex === 0) {
                        ctx.moveTo(x, y);
                    } else {
                        ctx.lineTo(x, y);
                    }
                }
                ctx.closePath();
            }
            ctx.fillStyle = options.fillColor;
            ctx.fill();

            ctx.strokeStyle = options.strokeColor;
            ctx.lineWidth = options.strokeWeight;
            ctx.stroke();
        },
    };
}

function createCell14Label(text: string, { lat, lng }: LatLng) {
    const pointResultCache = createZeroPoint();
    const { x: worldX, y: worldY } = latLngToWorldPoint(
        lat,
        lng,
        pointResultCache,
    );

    return {
        zIndex: statLabelBaseZIndex,
        draw: (context: RecordsRenderingContext) => {
            const { ctx } = context;
            const { x, y } = worldPointToScreenPoint(
                context,
                worldX,
                worldY,
                pointResultCache,
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
        },
    };
}

const cellBaseZIndex = 3100;
const poiBaseZIndex = cellBaseZIndex + 100;
const poiLabelBaseZIndex = poiBaseZIndex + 100;
const statLabelBaseZIndex = poiLabelBaseZIndex + 100;

const cell17EmptyOptions = Object.freeze({
    strokeColor: "rgba(253, 255, 114, 0.4)",
    strokeWeight: 1,
    fillColor: "#0000002d",
    clickable: false,
    zIndex: cellBaseZIndex + 1,
} satisfies google.maps.PolygonOptions);

const cell17PokestopOptions = Object.freeze({
    ...cell17EmptyOptions,

    fillColor: "rgba(0, 191, 255, 0.4)",
    strokeColor: "rgba(0, 191, 255, 0.6)",
    zIndex: cellBaseZIndex,
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
    zIndex: cellBaseZIndex + 2,
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

function createCell14Bound(cell14: Cell14Statistics) {
    const entityCount = sumGymAndPokestopCount(cell14);
    const coverRate = cell14.cell17s.size / 4 ** (17 - 14);
    const options = getCell14Options(entityCount, coverRate);
    return createCellBounds([cell14.corner], options);
}

const noDraw = {
    zIndex: 0,
    draw: ignore,
};
function createCell17CountLabel(cell14: Cell14Statistics) {
    const count = sumGymAndPokestopCount(cell14);
    if (count <= 0) return noDraw;

    return createCell14Label(`${count}`, cell14.center);
}

function has(kind: EntityKind, cell17: CellStatistic<17>) {
    return (cell17.kindToCount.get(kind) ?? 0) !== 0;
}

function createCell17Bounds(stat14: Cell14Statistics) {
    const gyms = [];
    const stops = [];
    const empties = [];
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
    return [
        createCellBounds(empties, cell17EmptyOptions),
        createCellBounds(stops, cell17PokestopOptions),
        createCellBounds(gyms, cell17GymOptions),
    ];
}

const wayspotOptions = Object.freeze({
    markerSize: 8,
    borderColor: "#ff6600",
    borderWidth: 2,
    fillColor: "#ff660080",
    zIndex: poiBaseZIndex,
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

function entityKindToCircleOptions(kind: EntityKind | "") {
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

const wayspotLabelOptions = {
    font: `11px "Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", "Hiragino Sans", Meiryo, sans-serif`,
    strokeColor: "rgb(0, 0, 0)",
    fillColor: "#FFFFBB",
    strokeWeight: 2,
    lineJoin: "round" as CanvasLineJoin,
    shadowBlur: 1,
};
const gymLabelOptions = Object.freeze({
    ...wayspotLabelOptions,
    font: `bold ` + wayspotLabelOptions.font,
    strokeColor: "#ffffffd5",
    fillColor: "#9c1933",
});
const powerspotLabelOptions = Object.freeze({
    ...wayspotLabelOptions,
    strokeColor: "#e762d3",
});
function entityKindToLabelOptions(kind: EntityKind | "") {
    switch (kind) {
        case "GYM":
            return gymLabelOptions;
        case "POKESTOP":
            return wayspotLabelOptions;
        case "POWERSPOT":
            return powerspotLabelOptions;
        default:
            return wayspotLabelOptions;
    }
}

function createPoiCircles(
    { zoom }: Viewport,
    pois: readonly PoiRecord[],
    kind: EntityKind | "",
) {
    const poisLength = pois.length;
    const options = entityKindToCircleOptions(kind);
    const radius = zoom <= 16 ? options.markerSize * 0.5 : options.markerSize;

    const pointResultCache = createZeroPoint();
    const buffer = new Float64Array(poisLength * Point_size);
    let bufferIndex = 0;
    for (const { lat, lng, data } of pois) {
        if (!data.isCommunityContributed) continue;

        const { x, y } = latLngToWorldPoint(lat, lng, pointResultCache);
        buffer[bufferIndex++] = x;
        buffer[bufferIndex++] = y;
    }

    return {
        zIndex: options.zIndex,
        draw: (context: RecordsRenderingContext) => {
            const { ctx } = context;
            ctx.beginPath();
            for (let pointIndex = 0; pointIndex < poisLength; pointIndex++) {
                const pointPointer = pointIndex * Point_size;
                const worldX = buffer[pointPointer + Point_x]!;
                const worldY = buffer[pointPointer + Point_y]!;
                const { x, y } = worldPointToScreenPoint(
                    context,
                    worldX,
                    worldY,
                    pointResultCache,
                );
                ctx.moveTo(x + radius, y);
                ctx.arc(x, y, radius, 0, Math.PI * 2);
            }
            ctx.fillStyle = options.fillColor;
            ctx.fill();

            ctx.strokeStyle = options.borderColor;
            ctx.lineWidth = options.borderWidth;
            ctx.stroke();
        },
    };
}

function createCell14PoiCircles(port: Viewport, stat14: Cell14Statistics) {
    return [...stat14.kindToPois].map(([kind, pois]) =>
        createPoiCircles(port, pois, kind),
    );
}

function getPoiImportance({ data }: PoiRecord) {
    let importance = 0;
    if (data.isCommunityContributed) {
        importance += 0.5;
    }
    let hasActive = false;
    let hasGym = false;
    let hasPokestop = false;
    let hasPowerspot = false;
    for (const { status, entity } of data.gmo) {
        if (status === "ACTIVE") hasActive = true;
        switch (entity) {
            case "GYM":
                hasGym = true;
                break;
            case "POKESTOP":
                hasPokestop = true;
                break;
            case "POWERSPOT":
                hasPowerspot = true;
                break;
        }
    }
    if (hasActive) {
        importance += 0.5;
    }
    if (hasGym) {
        importance += 0.4;
    }
    if (hasPokestop) {
        importance += 0.1;
    }
    if (hasPowerspot) {
        importance += 0.05;
    }
    if (data.hasAdditionalImages) {
        importance += 0.01;
    }
    return importance;
}
function comparePoiByImportance(p1: PoiRecord, p2: PoiRecord) {
    return getPoiImportance(p2) - getPoiImportance(p1);
}

function getKind(poi: PoiRecord) {
    for (const { entity } of poi.data.gmo) return entity;
    return "";
}

interface PoiLabelView {
    readonly worldX: number;
    readonly worldY: number;
    readonly text: string;
    readonly textMetrics: TextMetrics;
    readonly guid: string;
    readonly options: typeof wayspotLabelOptions;
}
function createCell14PoiNames(
    { zoom }: Viewport,
    ctx: RenderingContext,
    stat14: Cell14Statistics,
) {
    const pointResultCache = createZeroPoint();
    function createPoiLabelView(
        ctx: RenderingContext,
        poi: PoiRecord,
    ): PoiLabelView {
        const { lat, lng, guid, name } = poi;
        const options = entityKindToLabelOptions(getKind(poi));

        applyLabelOptions(ctx, options);

        let truncatedMetrics = getEllipsisTextWithMetrics(ctx, name, 140);
        let truncatedText = name;
        if (!(truncatedMetrics instanceof TextMetrics)) {
            truncatedText = truncatedMetrics.bestText;
            truncatedMetrics = truncatedMetrics.bestMetrics;
        }
        const { x, y } = latLngToWorldPoint(lat, lng, pointResultCache);
        return {
            worldX: x,
            worldY: y,
            text: truncatedText,
            textMetrics: truncatedMetrics,
            guid,
            options,
        };
    }

    const pois: PoiRecord[] = [];
    for (const poi of stat14.pois.values()) {
        if (poi.data.isCommunityContributed) pois.push(poi);
    }
    pois.sort(comparePoiByImportance);

    // 基準となるズームレベル
    const referenceZoom = 16;

    // 基準となるズームレベルでの最大POI数
    const maxPoisAtReferenceZoom = 6;

    const maxPois = Math.max(
        1,
        Math.ceil(maxPoisAtReferenceZoom * 2 ** (zoom - referenceZoom)),
    );
    // 上位POIのみを残す
    pois.length = Math.min(pois.length, maxPois);

    const labels = pois.map((poi) => createPoiLabelView(ctx, poi));

    return {
        zIndex: poiLabelBaseZIndex,
        draw: (context: RecordsRenderingContext) => {
            const { ctx, checker } = context;
            ctx.save();
            try {
                ctx.textBaseline = "middle";
                ctx.textAlign = "center";

                for (const {
                    options,
                    worldX,
                    worldY,
                    text,
                    textMetrics,
                    guid,
                } of labels) {
                    applyLabelOptions(ctx, options);
                    const { x, y } = worldPointToScreenPoint(
                        context,
                        worldX,
                        worldY,
                        context._point_result_cache,
                    );

                    const textX = x;
                    const textY = y + 15;

                    const box = getTextBox(
                        ctx,
                        textMetrics,
                        textX,
                        textY,
                        guid,
                    );
                    if (checker.check(box)) continue;
                    checker.addBox(box);

                    ctx.strokeText(text, textX, textY);
                    ctx.fillText(text, textX, textY);
                }
            } finally {
                ctx.restore();
            }
        },
    };
}
function applyLabelOptions(
    ctx: RenderingContext,
    options:
        | {
              font: string;
              strokeColor: string;
              fillColor: string;
              strokeWeight: number;
              lineJoin: CanvasLineJoin;
              shadowBlur: number;
          }
        | Readonly<{
              font: string;
              strokeColor: "#ffffffd5";
              fillColor: "#9c1933";
              strokeWeight: number;
              lineJoin: CanvasLineJoin;
              shadowBlur: number;
          }>
        | Readonly<{
              strokeColor: "#e762d3";
              font: string;
              fillColor: string;
              strokeWeight: number;
              lineJoin: CanvasLineJoin;
              shadowBlur: number;
          }>,
) {
    ctx.font = options.font;
    ctx.strokeStyle = options.strokeColor;
    ctx.lineJoin = options.lineJoin;
    ctx.lineWidth = options.strokeWeight;

    ctx.shadowColor = options.strokeColor;
    ctx.shadowBlur = options.shadowBlur;
    ctx.fillStyle = options.fillColor;
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

type Cell17Options = typeof cell17EmptyOptions;

type Canvas = HTMLCanvasElement | OffscreenCanvas;

type LatLngPath = readonly LatLng[];
type View = {
    draw: (this: unknown, context: RecordsRenderingContext) => void;
    readonly zIndex: number;
};
export interface OverlayView {
    readonly handleAsyncError: (reason: unknown) => void;
    readonly frontCanvas: Canvas;
    readonly backCanvas: OffscreenCanvas;
    readonly records: PoiRecords;
    readonly cells: Map<Cell14Id, View[]>;

    readonly _point_result_cache: Point;
    readonly _pois_cache: PoiRecord[];
}

type RenderingContext =
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D;

function createZeroPoint(): Point {
    return { x: 0, y: 0 };
}

export async function createRecordsOverlayView(
    canvas: Canvas,
    handleAsyncError: (reason: unknown) => void,
): Promise<OverlayView> {
    const records = await openRecords();
    return {
        handleAsyncError,
        frontCanvas: canvas,
        backCanvas: new OffscreenCanvas(canvas.width, canvas.height),
        records,
        cells: new Map(),
        _point_result_cache: { x: 0, y: 0 },
        _pois_cache: [],
    };
}

function drawOverlay(overlay: OverlayView, port: Viewport) {
    const { backCanvas: canvas } = overlay;
    const ctx = canvas.getContext("2d");
    if (ctx == null) return;

    const { width, height, devicePixelRatio } = port;
    const checker = createCollisionChecker();
    const context: RecordsRenderingContext = {
        ...overlay,
        ...port,
        ctx,
        checker,
    };
    canvas.width = width * devicePixelRatio;
    canvas.height = height * devicePixelRatio;
    ctx.scale(devicePixelRatio, devicePixelRatio);

    ctx.clearRect(0, 0, width, height);

    const vs: View[] = [];
    for (const views of overlay.cells.values()) {
        for (const view of views) vs.push(view);
    }
    vs.sort((v1, v2) => v1.zIndex - v2.zIndex);
    for (const view of vs) view.draw(context);
}

function copyToFrontCanvas({ backCanvas, frontCanvas }: OverlayView) {
    const back = backCanvas.getContext("2d");
    const front = frontCanvas.getContext("2d") as RenderingContext | null;
    if (back == null || front == null) return;

    const width = (frontCanvas.width = back.canvas.width);
    const height = (frontCanvas.height = back.canvas.height);
    front.clearRect(0, 0, width, height);
    front.drawImage(backCanvas, 0, 0);
}

async function drawAndWait(
    overlay: OverlayView,
    port: Viewport,
    signal: AbortSignal,
) {
    let done = false;
    signal.addEventListener(
        "abort",
        () => (!done ? console.debug("canceled") : 0),
        {
            once: true,
        },
    );
    drawOverlay(overlay, port);
    await waitAnimationFrame(signal);
    copyToFrontCanvas(overlay);
    done = true;
}

function clearOutOfRangeCellViews(
    { cells }: OverlayView,
    nearlyCell14s: readonly Cell<14>[],
) {
    const cellIds = new Set(nearlyCell14s.map((cell) => cell.toString()));
    for (const cellId of cells.keys()) {
        if (!cellIds.has(cellId)) cells.delete(cellId);
    }
}

async function updateCell14Views(
    overlay: OverlayView,
    port: Viewport,
    cell14: Cell<14>,
    ctx: RenderingContext,
    signal: AbortSignal,
) {
    const { records, cells } = overlay;
    const { zoom } = port;

    const stat14 = await getCell14Stats(records, cell14, signal);
    if (stat14 == null) return cells.delete(cell14.toString());

    const views: View[] = [];
    if (14 < zoom) {
        views.push(...createCell17Bounds(stat14));
    }
    views.push(createCell14Bound(stat14));
    if (14 < zoom && zoom < 18) {
        views.push(...createCell14PoiCircles(port, stat14));
    }
    if (14 < zoom) {
        views.push(createCell14PoiNames(port, ctx, stat14));
    }
    if (13 < zoom) {
        views.push(createCell17CountLabel(stat14));
    }
    cells.set(stat14.id, views);
}

export async function renderRecordsOverlayView(
    overlay: OverlayView,
    port: Viewport,
    signal: AbortSignal,
) {
    const { cells } = overlay;
    const { zoom, bounds } = port;

    if (zoom <= 12) {
        cells.clear();
        return drawAndWait(overlay, port, signal);
    }
    const ctx = overlay.frontCanvas.getContext("2d") as RenderingContext | null;
    if (ctx == null) return;

    const cell14s = getNearlyCellsForBounds(bounds, 14);
    clearOutOfRangeCellViews(overlay, cell14s);

    await Promise.all(
        cell14s.map((cell14) =>
            updateCell14Views(overlay, port, cell14, ctx, signal),
        ),
    );
    return drawAndWait(overlay, port, signal);
}
