// spell-checker: ignore Pois POKESTOP Lngs

import { createScheduler, type Scheduler } from "./dom-extensions";
import { distanceSquared, toLatLngLiteral } from "./geometry";
import { getCell14Stats, getNearlyCellsForBounds, type Cell14Statistics, type CellStatistic } from "./poi-records";
import type { LatLng } from "./s2";
import type { PageResource } from "./setup";
import { createAsyncCancelScope } from "./standard-extensions";

export interface PoisOverlay {
    readonly map: google.maps.Map;

    readonly addedPolygons: google.maps.Polygon[];
    readonly addedMarkers: google.maps.Marker[];
}
export function createPoisOverlay(map: google.maps.Map): PoisOverlay {
    return {
        map,
        addedPolygons: [],
        addedMarkers: [],
    }
}

function allocatePolygonAtMap(overlay: PoisOverlay, options: google.maps.PolygonOptions) {
    const p = new google.maps.Polygon();
    p.setOptions(options);
    p.setMap(overlay.map);
    overlay.addedPolygons.push(p);
    return p;
}
function allocateMarkerAtMap(overlay: PoisOverlay, options: google.maps.MarkerOptions) {
    // 新しい google.maps.marker.AdvancedMarkerElement を使うには、地図の初期化時に ID を指定する必要がある
    // UserScript は地図の初期化に関与できず、後から ID を付与することもできないので、ここでは古い google.maps.Marker を使う
    const m = new google.maps.Marker()
    m.setOptions(options)
    m.setMap(overlay.map);
    overlay.addedMarkers.push(m);
    return m;
}
async function clearMarkers(page: PageResource, scheduler: Scheduler) {
    const { addedPolygons, addedMarkers } = page.overlay
    for (let p; (p = addedPolygons.pop());) {
        p.setMap(null);
        await scheduler.yield();
    }
    for (let m; (m = addedMarkers.pop());) {
        m.setMap(null);
        await scheduler.yield();
    }
}

const baseZIndex = 3100;

const cell17EmptyOptions = Object.freeze({
    strokeColor: "rgba(253, 255, 114, 0.6)",
    strokeWeight: 1,
    fillColor: "#00000056",
    clickable: false,
    zIndex: baseZIndex,
} satisfies google.maps.PolygonOptions)

const cell17Options = Object.freeze({
    ...cell17EmptyOptions,

    fillColor: "rgba(0, 191, 255, 0.69)",
    zIndex: baseZIndex + 1,
} satisfies google.maps.PolygonOptions)

const cell14Options = Object.freeze({
    strokeColor: "#c54545b0",
    strokeWeight: 2,
    fillColor: "transparent",
    clickable: false,
    zIndex: baseZIndex + 2
} satisfies google.maps.PolygonOptions)

const cell14Options1 = Object.freeze({
    ...cell14Options,
    fillColor: "#dd7676da"
} satisfies google.maps.PolygonOptions)

const cell14Options2 = Object.freeze({
    ...cell14Options,
    fillColor: "#d3b717da"
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
    const polygon = allocatePolygonAtMap(page.overlay, options)
    polygon.setPath(cell14.corner);
}
function renderCell17(page: PageResource, cell17: CellStatistic<17>) {
    const options = cell17.count === 0 ? cell17EmptyOptions : cell17Options
    const polygon = allocatePolygonAtMap(page.overlay, options)
    polygon.setPath(cell17.cell.getCornerLatLngs())
}
function renderCell17CountLabel(page: PageResource, cell14: Cell14Statistics) {
    if (cell14.pois.size === 0) return

    const countMarker = allocateMarkerAtMap(page.overlay, cell17CountMarkerOptions);
    countMarker.setPosition(cell14.cell.getLatLng())
    countMarker.setLabel(`${sumGymAndPokestopCount(cell14)}`)
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

    await clearMarkers(page, scheduler)

    for (const nearlyCell14 of nearlyCell14s) {
        const { lat, lng } = nearlyCell14.getLatLng()
        const cell14 = await getCell14Stats(records, lat, lng, signal)
        if (cell14 == null) continue;

        renderCell14(page, cell14);

        if (13 < zoom) {
            renderCell17CountLabel(page, cell14)
        }
        if (14 < zoom) {
            const cell17s = [...cell14.cell17s.values()]
            cell17s.sort(compareByDistanceToMapCenter)
            for (const cell17 of cell17s.values()) {
                renderCell17(page, cell17);
            }
        }
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
