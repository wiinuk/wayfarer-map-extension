import {
    getCell14Stats,
    type Cell14Statistics,
    type CellStatistic,
    type PoiRecords,
} from "../poi-records";
import {
    createStandardQueries,
    type DraftQueryBuilder,
    type QueryEnvironment,
} from "../query/standard-queries";
import type { Draft } from "../remote";
import type { LatLng } from "../s2";
import {
    awaitPromise,
    done,
    forceAsPromise,
    getCancel,
    type Effective,
} from "../sal/effective";
import { evaluateExpression } from "../sal/evaluator";
import { getCellId, type Cell14Id } from "../typed-s2cell";

type Cell14Cache = Map<Cell14Id, Promise<Cell14Statistics | undefined>>;
function* getCell14Cached(records: PoiRecords, p: LatLng, cache: Cell14Cache) {
    const id14 = getCellId(p, 14);
    let cell14 = cache.get(id14);
    if (cell14 == null) {
        const signal = yield* getCancel();
        cell14 = getCell14Stats(records, p.lat, p.lng, signal);
        cache.set(id14, cell14);
    }
    return yield* awaitPromise(cell14);
}

function* getCell17Cached(records: PoiRecords, p: LatLng, cache: Cell14Cache) {
    const cell14Stat = yield* getCell14Cached(records, p, cache);
    if (cell14Stat == null) return;

    const cell17Id = getCellId(p, 17);
    return cell14Stat.cell17s.get(cell17Id);
}

function getCellStats(records: PoiRecords): QueryEnvironment["getCellStats"] {
    const cell14s = new Map<Cell14Id, Promise<Cell14Statistics | undefined>>();
    return function () {
        return done({
            getCell17Stat(p) {
                return getCell17Cached(records, p, cell14s);
            },
            getCell14Stat(p) {
                return getCell14Cached(records, p, cell14s);
            },
        });
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
    const duration = 60 * 60 * 24 * 7; // 一週間
    const minFreshDate = Date.now() - duration * 1000;
    const query = await forceAsPromise(
        queryBuilder.initialize({
            getUserLocation() {
                return done({
                    lat: 0,
                    lng: 0,
                });
            },
            getCellStats: getCellStats(records),
            getMinFreshDate() {
                return done(minFreshDate);
            },
        }),
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
