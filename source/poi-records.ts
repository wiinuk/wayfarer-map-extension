// spell-checker: ignore pois lngs pokestop
import type { LatLngBounds } from "./bounds";
import type { EntityKind, Gmo, Poi } from "./gcs-schema";
import * as B from "./bounds";
import { id, type UnwrapPromise } from "./standard-extensions";
import * as Idb from "./typed-idb";
import {
    createCellFromCoordinates,
    getCellId,
    type CellId,
    type Cell,
    getChildCells,
} from "./typed-s2cell";
import type { LatLng } from "./s2";
import { createQueue } from "./queue";
import { gcsCellLevel, type GcsCellLevel } from "./gcs-recorder";

/** ローカルマシンから取得した時間 */
type ClientDate = number;
type CellIdAny = CellId<number>;
export interface PoiRecord {
    readonly guid: string;
    readonly lat: number;
    readonly lng: number;
    readonly name: string;
    readonly data: Poi;
    readonly firstFetchDate: ClientDate;
    readonly lastFetchDate: ClientDate;
    readonly cellIds: readonly CellId<14 | 15>[];
}
export interface CellRecord {
    readonly cellId: CellIdAny;
    readonly level: number;
    readonly ancestorIds: readonly CellId<14>[];
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

export interface PoiStore<
    TMode extends IDBTransactionMode = Idb.ReadableModes,
> {
    [poisSymbol]: Idb.Store<DatabaseSchema, "pois", TMode>;
    [cellsSymbol]: Idb.Store<DatabaseSchema, "cells", TMode>;
    [coordinatesIndexSymbol]: Idb.Index<DatabaseSchema, "pois", "coordinates">;
    [cellIdsIndexSymbol]: Idb.Index<DatabaseSchema, "pois", "cellIds">;
    [ancestorIdsIndexSymbol]: Idb.Index<DatabaseSchema, "cells", "ancestorIds">;
}
export type PoiRecords = UnwrapPromise<ReturnType<typeof openRecords>>;
const poisSymbol = Symbol("_pois");
const cellsSymbol = Symbol("_cells");
const coordinatesIndexSymbol = Symbol("_coordinatesIndex");
const cellIdsIndexSymbol = Symbol("_cellIdsIndex");
const ancestorIdsIndexSymbol = Symbol("_ancestorIdsIndexSymbol");

export function getPoiOfGuid(store: PoiStore, guid: string) {
    return Idb.getValue(store[poisSymbol], guid);
}
export function getPoiOfCoordinates(store: PoiStore, lat: number, lng: number) {
    return Idb.getValueOfIndex(store[coordinatesIndexSymbol], [lat, lng]);
}
export function setPoi(store: PoiStore<Idb.WritableModes>, value: PoiRecord) {
    return Idb.putValue(store[poisSymbol], value);
}
export function removePoi(store: PoiStore<Idb.WritableModes>, guid: string) {
    return Idb.deleteValue(store[poisSymbol], guid);
}
function iteratePoisInCell(
    store: PoiStore,
    cellId: CellId<15 | 14>,
    action: (poi: PoiRecord) => Idb.IterationFlow,
) {
    return Idb.iterateValuesOfIndex(store[cellIdsIndexSymbol], cellId, action);
}
function iterateCellsInCell14(
    store: PoiStore,
    cellId: CellId<14>,
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
export function setCell(store: PoiStore<Idb.WritableModes>, cell: CellRecord) {
    return Idb.putValue(store[cellsSymbol], cell);
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
export function enterTransactionScope<
    TMode extends Idb.NormalTransactionModes,
    R,
>(
    records: PoiRecords,
    mode: TMode,
    options: { signal?: AbortSignal } | null | undefined,
    scope: (pois: PoiStore<TMode>) => Idb.TransactionScope<R>,
): Promise<R> {
    return Idb.enterTransactionScope(
        records[databaseSymbol],
        { mode, signal: options?.signal },
        ({ pois, cells }) => {
            const store = {
                [poisSymbol]: pois,
                [cellsSymbol]: cells,
                [coordinatesIndexSymbol]: Idb.getIndex(pois, "coordinates"),
                [cellIdsIndexSymbol]: Idb.getIndex(pois, "cellIds"),
                [ancestorIdsIndexSymbol]: Idb.getIndex(cells, "ancestorIds"),
            };
            return scope(store);
        },
        "pois",
        "cells",
    );
}

function setEntry<K, V>(map: Map<K, V>, key: K, value: V): V {
    map.set(key, value);
    return value;
}
/** 指定された領域に近いセルを返す */
export function getNearlyCellsForBounds<TLevel extends number>(
    bounds: LatLngBounds,
    level: TLevel,
) {
    const result: Cell<TLevel>[] = [];
    const seenCellIds = new Set<CellIdAny>();
    const remainingCells = createQueue<Cell<TLevel>>();
    remainingCells.enqueue(
        createCellFromCoordinates(B.getCenter(bounds), level),
    );
    for (let cell; (cell = remainingCells.dequeue()); ) {
        const id = cell.toString();
        if (seenCellIds.has(id)) continue;
        seenCellIds.add(id);

        let cellBounds = B.createDefault();
        for (const corner of cell.getCornerLatLngs()) {
            cellBounds = B.toExtended(cellBounds, corner);
        }
        if (!B.intersects(bounds, cellBounds)) continue;
        result.push(cell);
        for (const neighbor of cell.getNeighbors()) {
            remainingCells.enqueue(neighbor);
        }
    }
    return result;
}

function mergePoi(
    oldRecord: PoiRecord | undefined,
    poiId: string,
    poi: Poi,
    fetchDate: number,
) {
    const lat = poi.latE6 / 1e6;
    const lng = poi.lngE6 / 1e6;
    const name = poi.title;
    const latLng = { lat, lng };
    const cellIds = [getCellId(latLng, 14), getCellId(latLng, 15)];
    const record = oldRecord ?? {
        guid: poiId,
        lat,
        lng,
        name,
        data: poi,
        cellIds,
        firstFetchDate: fetchDate,
        lastFetchDate: fetchDate,
    };
    return {
        ...record,
        name: name !== "" ? name : record.name,
        lat,
        lng,
        data: poi,
        cellIds,
        lastFetchDate: fetchDate,
    };
}

export interface CellWithPois<TLevel extends number> {
    readonly cell: Cell<TLevel>;
    readonly pois: readonly Poi[];
}

export async function updateRecordsOfReceivedPoisInCells(
    records: PoiRecords,
    cellIdToPois: ReadonlyMap<CellId<GcsCellLevel>, CellWithPois<GcsCellLevel>>,
    bounds: readonly LatLngBounds[],
    fetchDate: number,
    signal: AbortSignal,
) {
    const emptyCells = new Map<
        CellId<GcsCellLevel>,
        { cell: Cell<GcsCellLevel> }
    >();
    for (const bound of bounds) {
        for (const cell of getNearlyCellsForBounds(bound, gcsCellLevel)) {
            const cellId = cell.toString();
            if (cellIdToPois.has(cellId)) continue;
            emptyCells.set(cellId, { cell });
        }
    }
    await enterTransactionScope(
        records,
        "readwrite",
        { signal },
        function* (store) {
            yield* deleteRemovedPoiRecords(store, cellIdToPois);
            yield* updatePoiRecords(cellIdToPois, store, fetchDate);

            // 全面が取得されたセル17を更新
            yield* updateCell17s(store, cellIdToPois, emptyCells, fetchDate);
        },
    );
}
function* deleteRemovedPoiRecords<TLevel extends number>(
    store: PoiStore<"readwrite">,
    receivedCellToPois: ReadonlyMap<CellId<TLevel>, CellWithPois<TLevel>>,
) {
    const removedPoiIds = [];
    for (const [cellId, { pois: receivedPois }] of receivedCellToPois) {
        const receivedPoiIds = new Set<string>();
        for (const receivedPoi of receivedPois) {
            receivedPoiIds.add(receivedPoi.poiId);
        }
        const recordedPoisInCell = yield* Idb.getAllOfIndex(
            store[cellIdsIndexSymbol],
            cellId,
        );
        for (const { guid } of recordedPoisInCell) {
            if (receivedPoiIds.has(guid)) continue;
            removedPoiIds.push(guid);
        }
    }
    yield* Idb.bulkDelete(store[poisSymbol], removedPoiIds);
}

function* updatePoiRecords<TLevel extends number>(
    cellIdToPois: ReadonlyMap<CellId<TLevel>, CellWithPois<TLevel>>,
    store: PoiStore<"readwrite">,
    fetchDate: number,
) {
    const receivedPoiIds = [];
    const receivedPois: Poi[] = [];
    for (const { pois } of cellIdToPois.values()) {
        for (const poi of pois) {
            receivedPoiIds.push(poi.poiId);
            receivedPois.push(poi);
        }
    }
    const poiRecords = yield* Idb.bulkGet(store[poisSymbol], receivedPoiIds);

    const newPoiRecords = poiRecords.map((poiRecord, i) => {
        const poi = receivedPois[i]!;
        return mergePoi(poiRecord, poi.poiId, poi, fetchDate);
    });

    yield* Idb.bulkPut(store[poisSymbol], newPoiRecords);
}

function* updateCell17s(
    store: PoiStore<"readwrite">,
    cellIdToPois: ReadonlyMap<CellId<14>, CellWithPois<14>>,
    emptyCells: ReadonlyMap<CellId<14>, { cell: Cell<14> }>,
    fetchDate: number,
) {
    const newCell17s: CellRecord[] = [];
    for (const { cell: cell14 } of [
        ...cellIdToPois.values(),
        ...emptyCells.values(),
    ]) {
        for (const cell15 of getChildCells(cell14)) {
            for (const cell16 of getChildCells(cell15)) {
                for (const cell17 of getChildCells(cell16)) {
                    const coordinates = cell17.getLatLng();
                    newCell17s.push({
                        cellId: cell17.toString(),
                        centerLat: coordinates.lat,
                        centerLng: coordinates.lng,
                        level: cell17.level,
                        ancestorIds: [getCellId(coordinates, 14)],
                        firstFetchDate: fetchDate,
                        lastFetchDate: fetchDate,
                    } satisfies CellRecord);
                }
            }
        }
    }

    yield* Idb.bulkPut(store[cellsSymbol], newCell17s);
}

export interface CellStatistic<TLevel extends number> {
    readonly center: Readonly<LatLng>;
    readonly cell: Cell<TLevel>;
    readonly kindToCount: Map<EntityKind, number>;
    // poi のみ取得したセルは undefined
    lastFetchDate: ClientDate | undefined;
}
type CellStatisticMap<TLevel extends number> = Map<
    CellId<TLevel>,
    CellStatistic<TLevel>
>;
export interface Cell14Statistics {
    readonly cell17s: CellStatisticMap<17>;
    readonly cell16s: CellStatisticMap<16>;
    readonly corner: [LatLng, LatLng, LatLng, LatLng];
    readonly center: LatLng;
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
    const stat: CellStatistic<TLevel> =
        cells.get(key) ??
        setEntry(cells, key, {
            cell,
            center: cell.getLatLng(),
            kindToCount: new Map(),
            lastFetchDate,
        });
    stat.lastFetchDate ||= lastFetchDate;
    return stat;
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
        const coordinateKey = `(${poi.lat}, ${poi.lng})`;
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
    await enterTransactionScope(
        records,
        "readonly",
        { signal },
        function* (store) {
            yield* iteratePoisInCell(store, cellId, collectPois);
            yield* iterateCellsInCell14(store, cellId, collectCells);
        },
    );
    return cell14;
}
