// spell-checker: ignore Pois POKESTOP Lngs

import { createScheduler, type Scheduler } from "./dom-extensions";
import type { EntityKind } from "./gcs-schema";
import { distanceSquared, toLatLngLiteral } from "./geometry";
import { getCell14Stats, getNearlyCellsForBounds, type Cell14Statistics, type CellStatistic } from "./poi-records";
import type { LatLng } from "./s2";
import type { PageResource } from "./setup";
import { createAsyncCancelScope } from "./standard-extensions";
import type { Cell, Cell14Id, CellId } from "./typed-s2cell";

export interface PoisOverlay {
    readonly map: google.maps.Map;
    readonly cell14IdToAddedViews: Map<CellId<14>, {
        polygons: google.maps.Polygon[];
        markers: google.maps.Marker[];
    }>
}
export function createPoisOverlay(map: google.maps.Map): PoisOverlay {
    return {
        map,
        cell14IdToAddedViews: new Map(),
    }
}

function getOrCreateAddedViewsOfCell14Id({ cell14IdToAddedViews }: PoisOverlay, cellId: CellId<14>) {
    const views = cell14IdToAddedViews.get(cellId)
    if (views) return views
    else {
        const views = { polygons: [], markers: [] }
        cell14IdToAddedViews.set(cellId, views)
        return views;
    }
}
function allocatePolygonAtMap(overlay: PoisOverlay, cellId: CellId<14>, options: google.maps.PolygonOptions) {
    const p = new google.maps.Polygon();
    p.setOptions(options);
    p.setMap(overlay.map);
    getOrCreateAddedViewsOfCell14Id(overlay, cellId).polygons.push(p);
    return p;
}
function allocateMarkerAtMap(overlay: PoisOverlay, cellId: CellId<14>, options: google.maps.MarkerOptions) {
    // 新しい google.maps.marker.AdvancedMarkerElement を使うには、地図の初期化時に ID を指定する必要がある
    // UserScript は地図の初期化に関与できず、後から ID を付与することもできないので、ここでは古い google.maps.Marker を使う
    const m = new google.maps.Marker()
    m.setOptions(options)
    m.setMap(overlay.map);
    getOrCreateAddedViewsOfCell14Id(overlay, cellId).markers.push(m);
    return m;
}
function clearMarkersInCell14({ cell14IdToAddedViews }: PoisOverlay, cellId: Cell14Id) {
    const views = cell14IdToAddedViews.get(cellId)
    if (views == null) return
    const { polygons, markers } = views
    for (let p; (p = polygons.pop());) {
        p.setMap(null);
    }
    for (let m; (m = markers.pop());) {
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
    zIndex: baseZIndex,
} satisfies google.maps.PolygonOptions)

const cell17PokestopOptions = Object.freeze({
    ...cell17EmptyOptions,

    fillColor: "rgba(0, 191, 255, 0.6)",
    zIndex: baseZIndex + 1,
} satisfies google.maps.PolygonOptions)
const cell17GymOptions = Object.freeze({
    ...cell17PokestopOptions,

    fillColor: "rgba(255, 0, 13, 0.6)"
} satisfies google.maps.PolygonOptions)

const cell14Options = Object.freeze({
    strokeColor: "#c54545b7",
    strokeOpacity: 1,
    strokeWeight: 2,
    fillColor: "transparent",
    fillOpacity: 1,
    clickable: false,
    zIndex: baseZIndex + 2
} satisfies google.maps.PolygonOptions)

const cell14Options1 = Object.freeze({
    ...cell14Options,
    fillColor: "#dd767625"
} satisfies google.maps.PolygonOptions)

const cell14Options2 = Object.freeze({
    ...cell14Options,
    fillColor: "#d3b71738"
} satisfies google.maps.PolygonOptions)

const cell17CountMarkerOptions = Object.freeze({
} satisfies google.maps.marker.AdvancedMarkerElementOptions)

function countToCell14Options(count: number) {
    switch (count) {
        case 1:
        case 5:
        case 19: return cell14Options1;
        case 4:
        case 18: return cell14Options2;
    }
    return cell14Options;
}
function sumGymAndPokestopCount({ kindToPois }: Cell14Statistics) {
    return (kindToPois.get("GYM")?.length ?? 0)
        + (kindToPois.get("POKESTOP")?.length ?? 0)
}
function renderCell14(page: PageResource, cell14: Cell14Statistics) {
    if (cell14.pois.size === 0) return;

    const entityCount = sumGymAndPokestopCount(cell14)
    const options = countToCell14Options(entityCount)
    const polygon = allocatePolygonAtMap(page.overlay, cell14.id, options)
    polygon.setPath(cell14.corner);
}
function has(kind: EntityKind, cell17: CellStatistic<17>) {
    return cell17.kindToCount.get(kind) ?? 0 !== 0
}
function renderCell17(page: PageResource, cell14: Cell14Statistics, cell17: CellStatistic<17>) {
    let options = cell17EmptyOptions;
    if (has("GYM", cell17)) {
        options = cell17GymOptions
    }
    else if (has("POKESTOP", cell17)) {
        options = cell17PokestopOptions;
    }
    const polygon = allocatePolygonAtMap(page.overlay, cell14.id, options)
    polygon.setPath(cell17.cell.getCornerLatLngs())
}
function renderCell17CountLabel(page: PageResource, cell14: Cell14Statistics) {
    const count = sumGymAndPokestopCount(cell14)
    if (count <= 0) return

    const countMarker = allocateMarkerAtMap(page.overlay, cell14.id, cell17CountMarkerOptions);
    countMarker.setPosition(cell14.cell.getLatLng())
    countMarker.setLabel(`${count}`)
}
async function renderPoiAndCells(page: PageResource, scheduler: Scheduler, signal: AbortSignal) {
    const { records, map } = page

    const bounds = map.getBounds()
    const zoom = map.getZoom()!
    const center = toLatLngLiteral(map.getCenter()!)
    if (bounds == null) return;

    function compareByDistanceToMapCenter(a: { center: LatLng }, b: { center: LatLng }) {
        return distanceSquared(center, a.center) - distanceSquared(center, b.center)
    }

    const nearlyCell14s = getNearlyCellsForBounds(bounds, 14)
    nearlyCell14s.sort((a, b) =>
        distanceSquared(center, a.getLatLng()) - distanceSquared(center, b.getLatLng())
    );

    await clearUnusedCell14Markers(page, scheduler, nearlyCell14s);

    for (const nearlyCell14 of nearlyCell14s) {
        const { lat, lng } = nearlyCell14.getLatLng()
        const cell14 = await getCell14Stats(records, lat, lng, signal)
        if (cell14 == null) continue;

        clearMarkersInCell14(page.overlay, cell14.id);
        renderCell14(page, cell14);

        if (13 < zoom) {
            renderCell17CountLabel(page, cell14)
        }
        if (14 < zoom) {
            const cell17s = [...cell14.cell17s.values()]
            cell17s.sort(compareByDistanceToMapCenter)
            for (const cell17 of cell17s.values()) {
                renderCell17(page, cell14, cell17);
            }
        }
    }
}

async function clearUnusedCell14Markers(page: PageResource, scheduler: Scheduler, nearlyCell14s: readonly Cell<14>[]) {
    const cell14Ids = new Set<Cell14Id>(nearlyCell14s.map(cell => cell.toString()));
    for (const cell14Id of page.overlay.cell14IdToAddedViews.keys()) {
        if (cell14Ids.has(cell14Id)) continue;

        await scheduler.yield();
        clearMarkersInCell14(page.overlay, cell14Id);
    }
}

export function setupPoiRecordOverlay(page: PageResource) {
    const enterCancelScope = createAsyncCancelScope(page.defaultAsyncErrorHandler)
    page.map.addListener("idle", () => {
        enterCancelScope((signal) => {
            const scheduler = createScheduler(signal)
            return renderPoiAndCells(page, scheduler, signal);
        })
    })
}
