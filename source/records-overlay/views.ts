// spell: words Lngs POKESTOP POWERSPOT Pois Wayspot
import type { EntityKind } from "../gcs-schema";
import type PIXI from "pixi.js";
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
import type { CanvasRenderer, CellViews, Viewport } from "./canvas-renderer";
import type { CirclesMeshBuilder } from "./circles-mesh-builder";
import type { CellMeshBuilder } from "./cell-mesh-builder";

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

function createCell14Label(
    { PIXI, cell14LabelTextStyle, updateFixedScale }: CanvasRenderer,
    text: string,
    { lat, lng }: LatLng,
) {
    const pointResultCache = createZeroPoint();
    const { x: worldX, y: worldY } = latLngToWorldPoint(
        lat,
        lng,
        pointResultCache,
    );

    const label = new PIXI.Text({ text, style: cell14LabelTextStyle });
    label.anchor.set(0.5);
    label.x = worldX;
    label.y = worldY;
    label.onRender = function () {
        updateFixedScale.apply(this);
        const { x, y, width, height } = this.getBounds();
        console.debug(x, y, width, height);
    };
    return label;
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

        fillColor: "#00000000",
    };
}
function sumGymAndPokestopCount({ kindToPois }: Cell14Statistics) {
    return (
        (kindToPois.get("GYM")?.length ?? 0) +
        (kindToPois.get("POKESTOP")?.length ?? 0)
    );
}
export function addCell14Bound(
    renderer: CanvasRenderer,
    cellViews: CellViews,
    cell14: Cell14Statistics,
) {
    const { options: store } = renderer;
    const entityCount = sumGymAndPokestopCount(cell14);
    const coverRate = cell14.cell17s.size / 4 ** (17 - 14);
    const options = getCell14Options(store, entityCount, coverRate);
    return cellViews.cellMeshBuilder.add(cell14.corner, options);
}

export function createCell17CountLabel(
    renderer: CanvasRenderer,
    cell14: Cell14Statistics,
) {
    const count = sumGymAndPokestopCount(cell14);
    if (count <= 0) return;

    return createCell14Label(renderer, `${count}`, cell14.center);
}

function has(kind: EntityKind, cell17: CellStatistic<17>) {
    return (cell17.kindToCount.get(kind) ?? 0) !== 0;
}

export function addCell17Bounds(
    renderer: CanvasRenderer,
    stat14: Cell14Statistics,
    builder: CellMeshBuilder,
) {
    const { options: store } = renderer;
    for (const cell17 of stat14.cell17s.values()) {
        let options;
        if (has("GYM", cell17)) {
            options = store.cell17GymOptions;
        } else if (has("POKESTOP", cell17)) {
            options = store.cell17PokestopOptions;
        } else {
            options = store.cell17EmptyOptions;
        }
        const path = cell17.cell.getCornerLatLngs();
        builder.add(path, options);
    }
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

export function addCell14PoiCircles(
    { options: store }: CanvasRenderer,
    { zoom }: Viewport,
    stat14: Cell14Statistics,
    builder: CirclesMeshBuilder,
) {
    for (const [kind, pois] of stat14.kindToPois) {
        const options = entityKindToCircleOptions(store, kind);
        const radius =
            zoom <= 16 ? options.markerSize * 0.5 : options.markerSize;
        for (const poi of pois) {
            if (!poi.data.isCommunityContributed) continue;
            builder.add(poi, radius, options);
        }
    }
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
    // const pointResultCache = createZeroPoint();
    // function createPoiLabelView(
    //     ctx: RenderingContext,
    //     poi: PoiRecord,
    // ): PoiLabelView {
    //     const { lat, lng, guid, name } = poi;
    //     const options = entityKindToLabelOptions(store, getKind(poi));
    //     ctx.save();
    //     applyLabelOptions(ctx, options);
    //     let truncatedMetrics = getEllipsisTextWithMetrics(ctx, name, 140);
    //     let truncatedText = name;
    //     if (!(truncatedMetrics instanceof TextMetrics)) {
    //         truncatedText = truncatedMetrics.bestText;
    //         truncatedMetrics = truncatedMetrics.bestMetrics;
    //     }
    //     const { x, y } = latLngToWorldPoint(lat, lng, pointResultCache);
    //     ctx.restore();
    //     return {
    //         worldX: x,
    //         worldY: y,
    //         text: truncatedText,
    //         textMetrics: truncatedMetrics,
    //         guid,
    //         options,
    //     };
    // }
    // const pois: PoiRecord[] = [];
    // for (const poi of stat14.pois.values()) {
    //     if (poi.data.isCommunityContributed) pois.push(poi);
    // }
    // pois.sort(comparePoiByImportance);
    // // 基準となるズームレベル
    // const referenceZoom = 16;
    // // 基準となるズームレベルでの最大POI数
    // const maxPoisAtReferenceZoom = 6;
    // const maxPois = Math.max(
    //     1,
    //     Math.ceil(maxPoisAtReferenceZoom * 2 ** (zoom - referenceZoom)),
    // );
    // // 上位POIのみを残す
    // pois.length = Math.min(pois.length, maxPois);
    // const labels = pois.map((poi) => createPoiLabelView(ctx, poi));
    // return {
    //     zIndex: store.poiLabelBaseZIndex,
    //     draw: (context: ViewsRenderingContext) => {
    //         const { ctx, checker } = context;
    //         ctx.save();
    //         try {
    //             ctx.textBaseline = "middle";
    //             ctx.textAlign = "center";
    //             for (const {
    //                 options,
    //                 worldX,
    //                 worldY,
    //                 text,
    //                 textMetrics,
    //                 guid,
    //             } of labels) {
    //                 applyLabelOptions(ctx, options);
    //                 const { x, y } = worldPointToScreenPoint(
    //                     context.nwWorld,
    //                     context.zoom,
    //                     worldX,
    //                     worldY,
    //                     context._point_result_cache,
    //                 );
    //                 const textX = x;
    //                 const textY = y + 15;
    //                 const box = getTextBox(
    //                     ctx,
    //                     textMetrics,
    //                     textX,
    //                     textY,
    //                     guid,
    //                 );
    //                 if (checker.check(box)) continue;
    //                 checker.addBox(box);
    //                 ctx.strokeText(text, textX, textY);
    //                 ctx.fillText(text, textX, textY);
    //             }
    //         } finally {
    //             ctx.restore();
    //         }
    //     },
    // };
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
