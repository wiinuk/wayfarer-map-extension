// spell-checker: words POKESTOP
import { distance } from "../geometry";
import type { CellStatistic } from "../poi-records";
import type { Draft } from "../remote";
import { done, type Effective } from "../sal/effective";
import type { Value } from "../sal/evaluator";

export interface CellRepository {
    getCell17Stat(
        p: google.maps.LatLngLiteral,
    ): Effective<CellStatistic<17> | undefined>;
}
export interface QueryEnvironment {
    getMinFreshDate(): Effective<number>;
    getCellStats(): Effective<CellRepository>;
    getUserLocation(): Effective<{ lat: number; lng: number }>;
}

export interface DraftQuery {
    isVisible(draft: Draft): Effective<boolean>;
}
export interface DraftQueryBuilder {
    initialize(environment: QueryEnvironment): Effective<DraftQuery>;
    isIgnorable: boolean;
}

function hasTermInString(text: string, term: string): boolean {
    return text.toLowerCase().includes(term);
}

function hasTermInDraft(
    { name, description, note }: Draft,
    term: string,
): boolean {
    return (
        hasTermInString(name, term) ||
        hasTermInString(description, term) ||
        hasTermInString(note, term)
    );
}

function queryAsBuilder(query: DraftQuery): DraftQueryBuilder {
    return {
        isIgnorable: false,
        initialize() {
            return done(query);
        },
    };
}
function builderAsValue(builder: DraftQueryBuilder) {
    return builder as unknown as Value; // TODO:
}
function valueAsBuilder(v: Value) {
    return v as unknown as DraftQueryBuilder;
}

function stringTermQuery(text: string) {
    return builderAsValue({
        isIgnorable: false,
        initialize() {
            const term = text.toLocaleLowerCase();
            return done({
                isVisible(d) {
                    return done(hasTermInDraft(d, term));
                },
            });
        },
    });
}
function any() {
    return builderAsValue(
        queryAsBuilder({
            isVisible() {
                return done(true);
            },
        }),
    );
}
function not(b: DraftQueryBuilder) {
    if (b.isIgnorable) return builderAsValue(b);

    return builderAsValue({
        isIgnorable: false,
        *initialize(e) {
            const q = yield* b.initialize(e);
            return {
                *isVisible(d) {
                    return !(yield* q.isVisible(d));
                },
                isAny: false,
            };
        },
    });
}

function fromString(x: Value) {
    return done(stringTermQuery(String(x)));
}

function and(b1: DraftQueryBuilder, b2: DraftQueryBuilder): DraftQueryBuilder {
    if (b2.isIgnorable) return b1;
    if (b1.isIgnorable) return b2;

    return {
        isIgnorable: false,
        *initialize(e) {
            const q1 = yield* b1.initialize(e);
            const q2 = yield* b2.initialize(e);
            return {
                *isVisible(draft) {
                    return (
                        (yield* q1.isVisible(draft)) &&
                        (yield* q2.isVisible(draft))
                    );
                },
            };
        },
    };
}

function or(b1: DraftQueryBuilder, b2: DraftQueryBuilder): DraftQueryBuilder {
    if (b2.isIgnorable) return b1;
    if (b1.isIgnorable) return b2;

    return {
        isIgnorable: false,
        *initialize(e) {
            const q1 = yield* b1.initialize(e);
            const q2 = yield* b2.initialize(e);
            return {
                *isVisible(d) {
                    return (yield* q1.isVisible(d)) || (yield* q2.isVisible(d));
                },
            };
        },
    };
}

export function reachableWith(
    center: readonly [number, number],
    radius: number,
): DraftQueryBuilder {
    return {
        isIgnorable: false,
        initialize() {
            const p1 = { lat: center[0], lng: center[1] };
            return done({
                isVisible(d) {
                    const [p2] = d.coordinates;
                    return done(distance(p1, p2) <= radius);
                },
            });
        },
    };
}

function hasPokestopOrGymInCell17(): DraftQueryBuilder {
    return {
        isIgnorable: false,
        *initialize(e) {
            const minFetchDate = yield* e.getMinFreshDate();
            const stats = yield* e.getCellStats();
            return {
                *isVisible(d) {
                    const [p] = d.coordinates;
                    const stat17 = yield* stats.getCell17Stat(p);

                    // セル情報が取得されていないか古いなら検索にヒットさせる
                    if (
                        stat17 == null ||
                        stat17.lastFetchDate == null ||
                        stat17.lastFetchDate < minFetchDate
                    ) {
                        return true;
                    }

                    // セル17にジムかポケストップが存在するか
                    const count =
                        (stat17.kindToCount.get("GYM") ?? 0) +
                        (stat17.kindToCount.get("POKESTOP") ?? 0);
                    return 0 < count;
                },
            };
        },
    };
}

function binaryBuilder(
    f: (x: DraftQueryBuilder, y: DraftQueryBuilder) => DraftQueryBuilder,
): Value {
    return (x) => {
        return done((y) => {
            const b = f(valueAsBuilder(x), valueAsBuilder(y));
            return done(builderAsValue(b));
        });
    };
}
function binaryFunction(f: (a: Value, b: Value) => Value): Value {
    return (x) => done((y) => done(f(x, y)));
}
export function createStandardQueries() {
    const all = any();
    const ignorableAll = builderAsValue({
        isIgnorable: true,
        initialize() {
            return done({
                isVisible() {
                    return done(true);
                },
            });
        },
    });
    const seq = binaryBuilder(and);
    const occupied = builderAsValue(hasPokestopOrGymInCell17());
    const dict: Record<string, Value> = {
        fromVoid(_) {
            return done(all);
        },
        fromMissing(_) {
            return done(ignorableAll);
        },
        fromNumber(x) {
            return done(stringTermQuery(String(x)));
        },
        fromString,
        fromWord: fromString,
        not_(x) {
            return done(not(valueAsBuilder(x)));
        },
        _seq_: seq,
        _and_: seq,
        _or_: binaryBuilder(or),

        reachableWith: binaryFunction((center, distanceMeter) => {
            return builderAsValue(
                reachableWith(
                    center as [number, number],
                    distanceMeter as number,
                ),
            );
        }),
        occupied,
        hasPokestopOrGymInCell17: occupied,
    };
    return new Map<string, Value>(Object.entries(dict));
}
