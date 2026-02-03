// spell-checker: ignore pois lngs pokestop
import type { EntityKind, Gmo, Poi } from "./gcs-schema";
import { toLatLngLiteral } from "./geometry";
import { id, type UnwrapPromise } from "./standard-extensions";
import * as Idb from "./typed-idb";
import {
    createCellFromCoordinates,
    getCellId,
    type CellId,
    type Cell,
} from "./typed-s2cell";

type LatLngBounds = google.maps.LatLngBounds;
type LatLngLiteral = google.maps.LatLngLiteral;

/** ローカルマシンから取得した時間 */
type ClientDate = number;
type CellIdAny = CellId<number>;
type createCellIds<
    length extends number,
    current extends readonly unknown[] = readonly [],
> = current["length"] extends length
    ? current
    : createCellIds<length, readonly [...current, CellIdAny]>;

export interface PoiRecord {
    readonly guid: string;
    readonly lat: number;
    readonly lng: number;
    readonly name: string;
    readonly data: Poi;
    readonly firstFetchDate: ClientDate;
    readonly lastFetchDate: ClientDate;
    readonly cellIds: readonly CellIdAny[];
}
export interface CellRecord {
    readonly cellId: CellIdAny;
    readonly level: number;
    readonly ancestorIds: readonly CellIdAny[];
    readonly firstFetchDate: ClientDate;
    readonly lastFetchDate: ClientDate;
    readonly centerLat: number;
    readonly centerLng: number;
}
const databaseSchema = {
    pois: {
        recordType: id<PoiRecord>,
        key: "guid",
        indexes: {
            coordinates: {
                key: ["lat", "lng"],
            },
            cellIds: {
                key: "cellIds",
                multiEntry: true,
            },
        },
    },
    cells: {
        recordType: id<CellRecord>,
        key: "cellId",
        indexes: {
            ancestorIds: {
                key: "ancestorIds",
                multiEntry: true,
            },
        },
    },
} as const satisfies Idb.DatabaseSchemaKind;
type DatabaseSchema = typeof databaseSchema;

export type PoiStore = ReturnType<typeof createPoiStore>;
export type PoiRecords = UnwrapPromise<ReturnType<typeof openRecords>>;
const poisSymbol = Symbol("_pois");
const cellsSymbol = Symbol("_cells");
const coordinatesIndexSymbol = Symbol("_coordinatesIndex");
const cellIdsIndexSymbol = Symbol("_cellIdsIndex");
const ancestorIdsIndexSymbol = Symbol("_ancestorIdsIndexSymbol");
function createPoiStore({
    pois,
    cells,
}: Readonly<{
    pois: Idb.Store<DatabaseSchema, "pois">;
    cells: Idb.Store<DatabaseSchema, "cells">;
}>) {
    return {
        [poisSymbol]: pois,
        [cellsSymbol]: cells,
        [coordinatesIndexSymbol]: Idb.getIndex(pois, "coordinates"),
        [cellIdsIndexSymbol]: Idb.getIndex(pois, "cellIds"),
        [ancestorIdsIndexSymbol]: Idb.getIndex(cells, "ancestorIds"),
    };
}
export function getPoiOfGuid(store: PoiStore, guid: string) {
    return Idb.getValue(store[poisSymbol], guid);
}
export function getPoiOfCoordinates(store: PoiStore, lat: number, lng: number) {
    return Idb.getValueOfIndex(store[coordinatesIndexSymbol], [lat, lng]);
}
export function setPoi(store: PoiStore, value: PoiRecord) {
    return Idb.putValue(store[poisSymbol], value);
}
export function removePoi(store: PoiStore, guid: string) {
    return Idb.deleteValue(store[poisSymbol], guid);
}
export function iteratePois(
    store: PoiStore,
    action: (value: PoiRecord) => Idb.IterationFlow,
) {
    return Idb.iterateValues(store[poisSymbol], undefined, action);
}
export function iteratePoisInCell(
    store: PoiStore,
    cellId: CellIdAny,
    action: (poi: PoiRecord) => Idb.IterationFlow,
) {
    return Idb.iterateValuesOfIndex(store[cellIdsIndexSymbol], cellId, action);
}
function iterateCellsInCell(
    store: PoiStore,
    cellId: CellIdAny,
    action: (cell: CellRecord) => Idb.IterationFlow,
) {
    return Idb.iterateValuesOfIndex(
        store[ancestorIdsIndexSymbol],
        cellId,
        action,
    );
}
export function getCell(store: PoiStore, cellId: CellIdAny) {
    return Idb.getValue(store[cellsSymbol], cellId);
}
export function setCell(store: PoiStore, cell: CellRecord) {
    return Idb.putValue(store[cellsSymbol], cell);
}
export function iterateCells(
    store: PoiStore,
    action: (cell: CellRecord) => Idb.IterationFlow,
) {
    return Idb.iterateValues(store[cellsSymbol], undefined, action);
}

const databaseName = "poi-records-e232930d-7282-4c02-aeef-bb9508576d2e";
const databaseVersion = 1;
const databaseSymbol = Symbol("_database");
export async function openRecords() {
    return {
        [databaseSymbol]: await Idb.openDatabase(
            databaseName,
            databaseVersion,
            databaseSchema,
        ),
    };
}
export function closeRecords(records: PoiRecords) {
    Idb.closeDatabase(records[databaseSymbol]);
}
export function enterTransactionScope<R>(
    records: PoiRecords,
    options: { signal?: AbortSignal } | null | undefined,
    scope: (pois: PoiStore) => Idb.TransactionScope<R>,
): Promise<R> {
    return Idb.enterTransactionScope(
        records[databaseSymbol],
        { mode: "readwrite", signal: options?.signal },
        (stores) => scope(createPoiStore(stores)),
        "pois",
        "cells",
    );
}

function setEntry<K, V>(map: Map<K, V>, key: K, value: V): V {
    map.set(key, value);
    return value;
}
function boundsIncludesCell<TLevel extends number>(
    cell: Cell<TLevel>,
    bounds: LatLngBounds,
) {
    for (const corner of cell.getCornerLatLngs()) {
        if (!bounds.contains(corner)) return false;
    }
    return true;
}

/** 指定された領域に近いセルを返す */
export function getNearlyCellsForBounds<TLevel extends number>(
    bounds: LatLngBounds,
    level: TLevel,
) {
    const result: Cell<TLevel>[] = [];
    const seenCellIds = new Set<CellIdAny>();
    const remainingCells = [
        createCellFromCoordinates(toLatLngLiteral(bounds.getCenter()), level),
    ];
    for (let cell; (cell = remainingCells.pop()); ) {
        const id = cell.toString();
        if (seenCellIds.has(id)) continue;
        seenCellIds.add(id);

        const cellBounds = new google.maps.LatLngBounds();
        for (const corner of cell.getCornerLatLngs()) {
            cellBounds.extend(corner);
        }
        if (!bounds.intersects(cellBounds)) continue;
        result.push(cell);
        remainingCells.push(...cell.getNeighbors());
    }
    return result;
}

/** データベース中からセル14内のPOIを返す */
function* getPoisInCell14s(store: PoiStore, cell14s: readonly Cell<14>[]) {
    const pois: PoiRecord[] = [];
    for (const cell14 of cell14s) {
        yield* iteratePoisInCell(store, cell14.toString(), (poi) => {
            pois.push(poi);
            return "continue";
        });
    }
    return pois;
}

function createCellIds(lat: number, lng: number, maxLevel = 30) {
    const cellIds: CellIdAny[] = [];
    const latLng = { lat, lng };
    for (let level = 0; level <= maxLevel; level++) {
        const cellId = getCellId(latLng, level);
        cellIds.push(cellId);
    }
    return cellIds;
}
function createAncestorIds(lat: number, lng: number, level: number) {
    return createCellIds(lat, lng, level - 1);
}
export async function updateRecordsOfReceivedPois(
    records: PoiRecords,
    receivedPois: readonly Poi[],
    fetchBounds: LatLngBounds,
    fetchDate: number,
    signal: AbortSignal,
) {
    const pois = new Map<string, Poi>();
    for (const poi of receivedPois) {
        pois.set(poi.poiId, poi);
    }
    performance.mark("begin nearly cells calculation");
    const cell14s = getNearlyCellsForBounds(fetchBounds, 14);
    const cell17s = getNearlyCellsForBounds(fetchBounds, 17);
    performance.mark("end nearly cells calculation");

    await enterTransactionScope(records, { signal }, function* (poisStore) {
        performance.mark("begin remove deleted pois");
        // 領域内に存在しないPOI記録を削除
        for (const poi of yield* getPoisInCell14s(poisStore, cell14s)) {
            if (pois.has(poi.guid)) continue;
            if (!fetchBounds.contains(poi)) continue;
            yield* removePoi(poisStore, poi.guid);
        }
        performance.mark("end remove deleted pois");

        // POI記録を更新
        performance.mark("begin update pois");
        for (const [id, p] of pois) {
            const lat = p.latE6 / 1_000_000;
            const lng = p.lngE6 / 1_000_000;
            const name = p.title;
            const cellIds = createCellIds(lat, lng);
            const poi: PoiRecord = (yield* getPoiOfGuid(poisStore, id)) ?? {
                guid: id,
                lat,
                lng,
                name,
                data: p,
                cellIds,
                firstFetchDate: fetchDate,
                lastFetchDate: fetchDate,
            };

            yield* setPoi(poisStore, {
                ...poi,
                name: name !== "" ? name : poi.name,
                lat,
                lng,
                data: p,
                cellIds,
                lastFetchDate: fetchDate,
            });
        }
        performance.mark("end update pois");

        // 全面が取得されたセル17を更新
        performance.mark("begin update cells");
        for (const cell of cell17s) {
            if (!boundsIncludesCell(cell, fetchBounds)) continue;

            const cellId = cell.toString();
            const coordinates = cell.getLatLng();
            const record: CellRecord = (yield* getCell(poisStore, cellId)) ?? {
                cellId: cell.toString(),
                centerLat: coordinates.lat,
                centerLng: coordinates.lng,
                level: cell.level,
                ancestorIds: createAncestorIds(
                    coordinates.lat,
                    coordinates.lng,
                    cell.level,
                ),
                firstFetchDate: fetchDate,
                lastFetchDate: fetchDate,
            };
            yield* setCell(poisStore, {
                ...record,
                lastFetchDate: fetchDate,
            });
        }
        performance.mark("end update cells");
    });
}

export interface CellStatistic<TLevel extends number> {
    readonly center: Readonly<LatLngLiteral>;
    readonly cell: Cell<TLevel>;
    readonly kindToCount: Map<EntityKind, number>;
    lastFetchDate: ClientDate | undefined;
}
type CellStatisticMap<TLevel extends number> = Map<
    CellId<TLevel>,
    CellStatistic<TLevel>
>;
export interface Cell14Statistics {
    readonly cell17s: CellStatisticMap<17>;
    readonly cell16s: CellStatisticMap<16>;
    readonly corner: [
        LatLngLiteral,
        LatLngLiteral,
        LatLngLiteral,
        LatLngLiteral,
    ];
    readonly center: LatLngLiteral;
    readonly cell: Cell<14>;
    readonly id: CellId<14>;
    readonly pois: Map<string, PoiRecord>;
    readonly kindToPois: Map<EntityKind, PoiRecord[]>;
}
function createEmptyCell14Statistics(cell: Cell<14>): Cell14Statistics {
    return {
        cell,
        id: cell.toString(),
        pois: new Map(),
        corner: cell.getCornerLatLngs(),
        center: cell.getLatLng(),
        cell17s: new Map(),
        cell16s: new Map(),
        kindToPois: new Map(),
    };
}
function updateCellStatisticsByCell<TLevel extends number>(
    cells: CellStatisticMap<TLevel>,
    cell: Cell<TLevel>,
    lastFetchDate: ClientDate | undefined,
) {
    const key = cell.toString();
    return (
        cells.get(key) ??
        setEntry(cells, key, {
            cell,
            center: cell.getLatLng(),
            kindToCount: new Map(),
            lastFetchDate,
        })
    );
}
function updateCellStatisticsByPoi<TLevel extends number>(
    cells: CellStatisticMap<TLevel>,
    poi: PoiRecord,
    level: TLevel,
) {
    const cell = createCellFromCoordinates(poi, level);
    const { kindToCount } = updateCellStatisticsByCell(cells, cell, undefined);
    for (const { entity } of poi.data.gmo) {
        const count = kindToCount.get(entity) ?? 0;
        kindToCount.set(entity, count + 1);
    }
}
function isGymOrPokestop(g: Gmo) {
    return g.entity === "GYM" || g.entity === "POKESTOP";
}
export async function getCell14Stats(
    records: PoiRecords,
    lat: number,
    lng: number,
    signal: AbortSignal,
) {
    const cell = createCellFromCoordinates({ lat, lng }, 14);
    const cellId = cell.toString();
    let cell14: Cell14Statistics | undefined;
    const collectPois = (poi: PoiRecord) => {
        cell14 ??= createEmptyCell14Statistics(cell);
        const latLng = new google.maps.LatLng(poi.lat, poi.lng);
        const coordinateKey = latLng.toString();
        if (cell14.pois.get(coordinateKey) != null) return "continue";

        cell14.pois.set(coordinateKey, poi);
        for (const { entity } of poi.data.gmo) {
            const pois =
                cell14.kindToPois.get(entity) ??
                setEntry(cell14.kindToPois, entity, []);
            pois.push(poi);
        }
        if (poi.data.gmo.some(isGymOrPokestop)) {
            updateCellStatisticsByPoi(cell14.cell16s, poi, 16);
            updateCellStatisticsByPoi(cell14.cell17s, poi, 17);
        }
    };
    const collectCells = (childCell: CellRecord) => {
        if (childCell.level !== 17) {
            return "continue";
        }

        cell14 ??= createEmptyCell14Statistics(cell);

        const cell17 = createCellFromCoordinates(
            { lat: childCell.centerLat, lng: childCell.centerLng },
            17,
        );
        updateCellStatisticsByCell(
            cell14.cell17s,
            cell17,
            childCell.lastFetchDate,
        );
    };
    await enterTransactionScope(records, { signal }, function* (store) {
        yield* iteratePoisInCell(store, cellId, collectPois);
        yield* iterateCellsInCell(store, cellId, collectCells);
    });
    return cell14;
}
