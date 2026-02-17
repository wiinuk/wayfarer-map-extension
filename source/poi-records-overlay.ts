// spell-checker: ignore Pois POKESTOP Lngs

import { createScheduler, styleSetter, type Scheduler } from "./dom-extensions";
import type { EntityKind } from "./gcs-schema";
import { distanceSquared, toLatLngLiteral } from "./geometry";
import {
    getCell14Stats,
    getNearlyCellsForBounds,
    type Cell14Statistics,
    type CellStatistic,
} from "./poi-records";
import type { LatLng } from "./s2";
import type { PageResource } from "./setup";
import { createAsyncCancelScope } from "./standard-extensions";
import type { Cell, Cell14Id, CellId } from "./typed-s2cell";
import * as Bounds from "./bounds";
import classNames, { cssText } from "./poi-records-overlay.module.css";
const setStyle = styleSetter(cssText);

interface ViewOptions {
    readonly cell17CountMarkerOptions: google.maps.MarkerOptions;
}
export interface PoisOverlay {
    readonly options: ViewOptions;
    readonly map: google.maps.Map;
    readonly cell14IdToAddedViews: Map<
        CellId<14>,
        {
            polygons: google.maps.Polygon[];
            markers: google.maps.Marker[];
        }
    >;
}
export function createPoisOverlay(map: google.maps.Map): PoisOverlay {
    setStyle();

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
        cell14IdToAddedViews: new Map(),
    };
}

function getOrCreateAddedViewsOfCell14Id(
    { cell14IdToAddedViews }: PoisOverlay,
    cellId: CellId<14>,
) {
    const views = cell14IdToAddedViews.get(cellId);
    if (views) return views;
    else {
        const views = { polygons: [], markers: [] };
        cell14IdToAddedViews.set(cellId, views);
        return views;
    }
}
function allocatePolygonAtMap(
    overlay: PoisOverlay,
    cellId: CellId<14>,
    options: google.maps.PolygonOptions,
) {
    const p = new google.maps.Polygon();
    p.setOptions(options);
    p.setMap(overlay.map);
    getOrCreateAddedViewsOfCell14Id(overlay, cellId).polygons.push(p);
    return p;
}
function allocateMarkerAtMap(
    overlay: PoisOverlay,
    cellId: CellId<14>,
    options: google.maps.MarkerOptions,
) {
    // 新しい google.maps.marker.AdvancedMarkerElement を使うには、地図の初期化時に ID を指定する必要がある
    // UserScript は地図の初期化に関与できず、後から ID を付与することもできないので、ここでは古い google.maps.Marker を使う
    const m = new google.maps.Marker();
    m.setOptions(options);
    m.setMap(overlay.map);
    getOrCreateAddedViewsOfCell14Id(overlay, cellId).markers.push(m);
    return m;
}
function clearMarkersInCell14(
    { cell14IdToAddedViews }: PoisOverlay,
    cellId: Cell14Id,
) {
    const views = cell14IdToAddedViews.get(cellId);
    if (views == null) return;
    const { polygons, markers } = views;
    for (let p; (p = polygons.pop()); ) {
        p.setMap(null);
    }
    for (let m; (m = markers.pop()); ) {
        m.setMap(null);
    }
    cell14IdToAddedViews.delete(cellId);
}

const baseZIndex = 3100;

const cell17EmptyOptions = Object.freeze({
    strokeColor: "rgba(253, 255, 114, 0.4)",
    strokeOpacity: 1,
    strokeWeight: 1,
    fillColor: "#0000002d",
    fillOpacity: 1,
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
    strokeOpacity: 1,
    strokeWeight: 2,
    fillColor: "transparent",
    fillOpacity: 1,
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
function renderCell14(overlay: PoisOverlay, cell14: Cell14Statistics) {
    const entityCount = sumGymAndPokestopCount(cell14);
    const coverRate = cell14.cell17s.size / 4 ** (17 - 14);
    const options = getCell14Options(entityCount, coverRate);
    const polygon = allocatePolygonAtMap(overlay, cell14.id, options);
    polygon.setPath(cell14.corner);
}
function has(kind: EntityKind, cell17: CellStatistic<17>) {
    return (cell17.kindToCount.get(kind) ?? 0) !== 0;
}
function renderCell17(
    overlay: PoisOverlay,
    cell14: Cell14Statistics,
    cell17: CellStatistic<17>,
) {
    let options = cell17EmptyOptions;
    if (has("GYM", cell17)) {
        options = cell17GymOptions;
    } else if (has("POKESTOP", cell17)) {
        options = cell17PokestopOptions;
    }
    const polygon = allocatePolygonAtMap(overlay, cell14.id, options);
    polygon.setPath(cell17.cell.getCornerLatLngs());
}
function renderCell17CountLabel(
    overlay: PoisOverlay,
    cell14: Cell14Statistics,
) {
    const count = sumGymAndPokestopCount(cell14);
    if (count <= 0) return;

    const countMarker = allocateMarkerAtMap(
        overlay,
        cell14.id,
        overlay.options.cell17CountMarkerOptions,
    );
    countMarker.setPosition(cell14.cell.getLatLng());
    countMarker.setLabel({
        text: `${count}`,
        color: "rgb(255, 255, 255)",
        fontSize: "20px",
        fontWeight: "400",
        className: classNames["count-label"],
    });
}
async function renderViewsInCell14(
    { records, overlay }: PageResource,
    nearlyCell14: Cell<14>,
    zoom: number,
    center: LatLng,
    scheduler: Scheduler,
    signal: AbortSignal,
) {
    const cell14 = await getCell14Stats(records, nearlyCell14, signal);
    if (cell14 == null) return;

    clearMarkersInCell14(overlay, cell14.id);
    renderCell14(overlay, cell14);

    if (13 < zoom) {
        renderCell17CountLabel(overlay, cell14);
    }
    if (14 < zoom) {
        const cell17s = [...cell14.cell17s.values()];
        cell17s.sort(
            (a, b) =>
                distanceSquared(center, a.center) -
                distanceSquared(center, b.center),
        );
        for (const cell17 of cell17s) {
            renderCell17(overlay, cell14, cell17);
        }
    }
}
async function renderPoiAndCells(
    page: PageResource,
    scheduler: Scheduler,
    signal: AbortSignal,
) {
    const { map } = page;

    const bounds = map.getBounds();
    const zoom = map.getZoom()!;
    const center = toLatLngLiteral(map.getCenter()!);
    if (bounds == null) return;

    if (zoom <= 12) {
        await clearAllMarkers(page.overlay, scheduler);
        return;
    }

    const nearlyCell14s = getNearlyCellsForBounds(Bounds.fromClass(bounds), 14);

    await clearOutOfRangeCell14Markers(page.overlay, scheduler, nearlyCell14s);

    for (const nearlyCell14 of nearlyCell14s) {
        await scheduler.yield();
        await renderViewsInCell14(
            page,
            nearlyCell14,
            zoom,
            center,
            scheduler,
            signal,
        );
    }
}

async function clearAllMarkers(overlay: PoisOverlay, scheduler: Scheduler) {
    const { cell14IdToAddedViews: views } = overlay;
    for (const cellId of views.keys()) {
        await scheduler.yield();
        clearMarkersInCell14(overlay, cellId);
        views.delete(cellId);
    }
}

async function clearOutOfRangeCell14Markers(
    overlay: PoisOverlay,
    scheduler: Scheduler,
    nearlyCell14s: readonly Cell<14>[],
) {
    const cell14Ids = new Set<Cell14Id>(
        nearlyCell14s.map((cell) => cell.toString()),
    );
    for (const cell14Id of overlay.cell14IdToAddedViews.keys()) {
        if (cell14Ids.has(cell14Id)) continue;

        await scheduler.yield();
        clearMarkersInCell14(overlay, cell14Id);
    }
}

export function setupPoiRecordOverlay(page: PageResource) {
    const enterCancelScope = createAsyncCancelScope(
        page.defaultAsyncErrorHandler,
    );
    const render = () => {
        enterCancelScope((signal) => {
            const scheduler = createScheduler(signal);
            return renderPoiAndCells(page, scheduler, signal);
        });
    };
    page.events.addEventListener("gcs-saved", render);
    page.map.addListener("idle", render);
    render();
}
