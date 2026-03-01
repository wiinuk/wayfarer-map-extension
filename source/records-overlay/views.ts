// spell: words Hiragino Kaku Lngs Meiryo Neue POKESTOP POWERSPOT Pois Wayspot
import type { EntityKind } from "../gcs-schema";
import {
    createZeroPoint,
    latLngToWorldPoint,
    worldPointToScreenPoint,
} from "../geometry";
import type {
    Cell14Statistics,
    CellStatistic,
    PoiRecord,
} from "../poi-records";
import type { LatLng } from "../s2";
import { raise, ignore } from "../standard-extensions";
import type {
    Cell17Options,
    OverlayOptions,
    WayspotLabelOptions,
} from "./options";
import type { Viewport, ViewsRenderingContext } from "./canvas-renderer";

type RenderingContext = OffscreenCanvasRenderingContext2D;
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

const Point_x = 0;
const Point_y = Point_x + 1;
const Point_size = Point_y + 1;

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
        draw: (context: ViewsRenderingContext) => {
            const { ctx } = context;

            ctx.save();
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
                        context.nwWorld,
                        context.zoom,
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
            ctx.restore();
        },
    };
}

function createCell14Label(
    options: OverlayOptions,
    text: string,
    { lat, lng }: LatLng,
) {
    const pointResultCache = createZeroPoint();
    const { x: worldX, y: worldY } = latLngToWorldPoint(
        lat,
        lng,
        pointResultCache,
    );

    return {
        zIndex: options.statLabelBaseZIndex,
        draw: (context: ViewsRenderingContext) => {
            const { ctx } = context;
            const { x, y } = worldPointToScreenPoint(
                context.nwWorld,
                context.zoom,
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

function countToCell14Options(options: OverlayOptions, count: number) {
    switch (count) {
        case 0:
            return options.cell14OptionsEmpty;
        case 1:
        case 5:
        case 19:
            return options.cell14Options1;
        case 4:
        case 18:
            return options.cell14Options2;
    }
    return options.cell14Options;
}
function getCell14Options(
    store: OverlayOptions,
    entityCount: number,
    coverRate: number,
) {
    const options = countToCell14Options(store, entityCount);
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

export function createCell14Bound(
    store: OverlayOptions,
    cell14: Cell14Statistics,
) {
    const entityCount = sumGymAndPokestopCount(cell14);
    const coverRate = cell14.cell17s.size / 4 ** (17 - 14);
    const options = getCell14Options(store, entityCount, coverRate);
    return createCellBounds([cell14.corner], options);
}

const noDraw = {
    zIndex: 0,
    draw: ignore,
};
export function createCell17CountLabel(
    options: OverlayOptions,
    cell14: Cell14Statistics,
) {
    const count = sumGymAndPokestopCount(cell14);
    if (count <= 0) return noDraw;

    return createCell14Label(options, `${count}`, cell14.center);
}

function has(kind: EntityKind, cell17: CellStatistic<17>) {
    return (cell17.kindToCount.get(kind) ?? 0) !== 0;
}

export function createCell17Bounds(
    options: OverlayOptions,
    stat14: Cell14Statistics,
) {
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
        createCellBounds(empties, options.cell17EmptyOptions),
        createCellBounds(stops, options.cell17PokestopOptions),
        createCellBounds(gyms, options.cell17GymOptions),
    ];
}

function entityKindToCircleOptions(
    options: OverlayOptions,
    kind: EntityKind | "",
) {
    switch (kind) {
        case "GYM":
            return options.gymOptions;
        case "POKESTOP":
            return options.pokestopOptions;
        case "POWERSPOT":
            return options.powerspotOptions;
        default:
            return options.wayspotOptions;
    }
}

function entityKindToLabelOptions(
    options: OverlayOptions,
    kind: EntityKind | "",
) {
    switch (kind) {
        case "GYM":
            return options.gymLabelOptions;
        case "POKESTOP":
            return options.wayspotLabelOptions;
        case "POWERSPOT":
            return options.powerspotLabelOptions;
        default:
            return options.wayspotLabelOptions;
    }
}

function createPoiCircles(
    store: OverlayOptions,
    { zoom }: Viewport,
    pois: readonly PoiRecord[],
    kind: EntityKind | "",
) {
    const poisLength = pois.length;
    const options = entityKindToCircleOptions(store, kind);
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
        draw: (context: ViewsRenderingContext) => {
            const { ctx } = context;
            ctx.beginPath();
            for (let pointIndex = 0; pointIndex < poisLength; pointIndex++) {
                const pointPointer = pointIndex * Point_size;
                const worldX = buffer[pointPointer + Point_x]!;
                const worldY = buffer[pointPointer + Point_y]!;
                const { x, y } = worldPointToScreenPoint(
                    context.nwWorld,
                    context.zoom,
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

export function createCell14PoiCircles(
    store: OverlayOptions,
    port: Viewport,
    stat14: Cell14Statistics,
) {
    return [...stat14.kindToPois].map(([kind, pois]) =>
        createPoiCircles(store, port, pois, kind),
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
    readonly options: WayspotLabelOptions;
}
export function createCell14PoiNames(
    store: OverlayOptions,
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
        const options = entityKindToLabelOptions(store, getKind(poi));

        ctx.save();
        applyLabelOptions(ctx, options);

        let truncatedMetrics = getEllipsisTextWithMetrics(ctx, name, 140);
        let truncatedText = name;
        if (!(truncatedMetrics instanceof TextMetrics)) {
            truncatedText = truncatedMetrics.bestText;
            truncatedMetrics = truncatedMetrics.bestMetrics;
        }
        const { x, y } = latLngToWorldPoint(lat, lng, pointResultCache);
        ctx.restore();
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
        zIndex: store.poiLabelBaseZIndex,
        draw: (context: ViewsRenderingContext) => {
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
                        context.nwWorld,
                        context.zoom,
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
    options: WayspotLabelOptions,
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

type LatLngPath = readonly LatLng[];
