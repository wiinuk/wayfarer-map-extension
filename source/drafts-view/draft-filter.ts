import {
    getCell14Stats,
    type Cell14Statistics,
    type PoiRecords,
} from "../poi-records";
import {
    buildDraftMap,
    createStandardQueries,
    type Cell14DraftStat,
    type DraftQueryBuilder,
    type Cell14DraftMap,
    type QueryEnvironment,
} from "../query/standard-queries";
import type { Draft } from "../remote";
import {
    awaitPromise,
    done,
    forceAsPromise,
    getCancel,
    type Effective,
} from "../sal/effective";
import { evaluateExpression } from "../sal/evaluator";
import { cached, memoizeWith } from "../standard-extensions";
import {
    createCellFromCoordinates,
    getCellId,
    type Cell,
    type Cell14Id,
} from "../typed-s2cell";

async function getDraftStat(
    source: CellStatisticsSource,
    cell14: Cell<14>,
    signal: AbortSignal,
): Promise<Cell14DraftStat | undefined> {
    const cell14Drafts = source.cell14DraftsLazy();
    const cell14Id = cell14.toString();
    const draft14 = cell14Drafts.get(cell14Id);
    if (draft14 == null) return;

    const stat14 = await source.cell14StatMemoized(cell14, signal);
    if (stat14 == null) return;

    let potentialStops = 0;
    for (const cell17IdOnDraft of draft14.cell17Drafts) {
        const stat17 = stat14.cell17s.get(cell17IdOnDraft);
        const stopCount =
            (stat17?.kindToCount.get("POKESTOP") ?? 0) +
            (stat17?.kindToCount.get("GYM") ?? 0);
        if (stopCount === 0) {
            potentialStops++;
        }
    }
    return {
        potentialStops,
    };
}

interface CellStatisticsSource {
    readonly records: PoiRecords;
    readonly cell14StatMemoized: (
        p: Cell<14>,
        signal: AbortSignal,
    ) => Promise<Cell14Statistics | undefined>;
    readonly cell14DraftsLazy: () => ReadonlyMap<Cell14Id, Cell14DraftMap>;
    readonly draftStatMemoized: (
        cell: Cell<14>,
        signal: AbortSignal,
    ) => Promise<Cell14DraftStat | undefined>;
}

async function getCell17(
    resource: CellStatisticsSource,
    cell: Cell<17>,
    signal: AbortSignal,
) {
    const cell14 = createCellFromCoordinates(cell.getLatLng(), 14);
    const stat = await resource.cell14StatMemoized(cell14, signal);
    if (stat == null) return;

    const cell17Id = getCellId(cell.getLatLng(), 17);
    return stat.cell17s.get(cell17Id);
}

function createEnvironment(
    records: PoiRecords,
    drafts: readonly Draft[],
): QueryEnvironment {
    const resource: CellStatisticsSource = {
        records,
        cell14DraftsLazy: cached(() => buildDraftMap(drafts)),
        cell14StatMemoized: memoizeWith(
            (cell, _) => cell.toString(),
            (_, cell, signal) => getCell14Stats(records, cell, signal),
        ),
        draftStatMemoized: memoizeWith(
            (cell, _) => cell.toString(),
            (_, cell, signal) => getDraftStat(resource, cell, signal),
        ),
    };
    const duration = 60 * 60 * 24 * 7; // 一週間
    const minFreshDate = Date.now() - duration * 1000;
    return {
        getUserLocation() {
            return done({
                lat: 0,
                lng: 0,
            });
        },
        *getCell14Stat(d) {
            const signal = yield* getCancel();
            return yield* awaitPromise(
                resource.cell14StatMemoized(
                    createCellFromCoordinates(d.coordinates[0], 14),
                    signal,
                ),
            );
        },
        *getCell17Stat(d) {
            const signal = yield* getCancel();
            return yield* awaitPromise(
                getCell17(
                    resource,
                    createCellFromCoordinates(d.coordinates[0], 17),
                    signal,
                ),
            );
        },
        *getCell14DraftStat(d): Effective<Cell14DraftStat | undefined> {
            const signal = yield* getCancel();
            return yield* awaitPromise(
                resource.draftStatMemoized(
                    createCellFromCoordinates(d.coordinates[0], 14),
                    signal,
                ),
            );
        },
        getMinFreshDate() {
            return done(minFreshDate);
        },
    };
}

export async function filterDrafts(
    records: PoiRecords,
    drafts: readonly Draft[],
    source: string,
    signal: AbortSignal,
): Promise<Draft[]> {
    const queryGlobals = createStandardQueries();
    const effective = evaluateExpression(source, (k) => queryGlobals.get(k));
    const filter = await forceAsPromise(effective, signal);
    const queryBuilder = filter as unknown as DraftQueryBuilder;
    const environment = createEnvironment(records, drafts);
    const query = await forceAsPromise(
        queryBuilder.initialize(environment),
        signal,
    );

    const result = [];
    let error = null;
    for (const d of drafts) {
        let isVisible = false;
        try {
            isVisible = await forceAsPromise(query.isVisible(d), signal);
        } catch (e) {
            error ??= e;
        }
        if (isVisible) {
            result.push(d);
        }
    }
    if (error) console.error(error);
    return result;
}
