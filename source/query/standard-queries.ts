// spell-checker: words POKESTOP pois
import { distance } from "../geometry";
import type { Cell14Statistics, CellStatistic } from "../poi-records";
import type { Draft } from "../remote";
import { done, type Effective } from "../sal/effective";
import type { Value } from "../sal/evaluator";
import {
    type Cell14Id,
    createCellFromCoordinates,
    type Cell,
    type Cell17Id,
    getCellId,
} from "../typed-s2cell";

export interface Cell14DraftStat {
    readonly potentialStops: number;
}

export interface Cell14DraftMap {
    readonly cell14: Cell<14>;
    readonly cell17Drafts: Set<Cell17Id>;
}

export interface QueryEnvironment {
    getMinFreshDate(): Effective<number>;
    getCell14Stat(d: Draft): Effective<Cell14Statistics | undefined>;
    getCell17Stat(d: Draft): Effective<CellStatistic<17> | undefined>;
    getCell14DraftStat(d: Draft): Effective<Cell14DraftStat | undefined>;
    getUserLocation(): Effective<{ lat: number; lng: number }>;
}

export function buildDraftMap(drafts: readonly Draft[]) {
    const cell14s = new Map<Cell14Id, Cell14DraftMap>();
    for (const draft of drafts) {
        const p = draft.coordinates[0];
        const cell14 = createCellFromCoordinates(p, 14);
        const cell14Id = cell14.toString();
        let cell17Drafts = cell14s.get(cell14Id)?.cell17Drafts;
        if (cell17Drafts == null) {
            cell14s.set(cell14Id, {
                cell14,
                cell17Drafts: (cell17Drafts = new Set()),
            });
        }
        cell17Drafts.add(getCellId(p, 17));
    }
    return cell14s;
}

export interface DraftQuery {
    isVisible(draft: Draft): Effective<DraftQueryMatch>;
}
export interface DraftQueryMatch {
    readonly isVisible: boolean;
    readonly categories: readonly string[];
}
export interface DraftQueryBuilder {
    initialize(environment: QueryEnvironment): Effective<DraftQuery>;
    isIgnorable: boolean;
}

const notVisible: DraftQueryMatch = {
    isVisible: false,
    categories: [],
};
const visibleWithoutCategory: DraftQueryMatch = {
    isVisible: true,
    categories: [],
};

function toQueryMatch(isVisible: boolean): DraftQueryMatch {
    return isVisible ? visibleWithoutCategory : notVisible;
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
export function valueAsBuilder(v: Value): DraftQueryBuilder {
    if (!isDraftQueryBuilderValue(v)) {
        throw new Error("Query expression did not produce a draft query.");
    }
    return v as unknown as DraftQueryBuilder;
}

function stringTermQuery(text: string) {
    return builderAsValue({
        isIgnorable: false,
        initialize() {
            const term = text.toLocaleLowerCase();
            return done({
                isVisible(d) {
                    return done(toQueryMatch(hasTermInDraft(d, term)));
                },
            });
        },
    });
}
function any() {
    return builderAsValue(
        queryAsBuilder({
            isVisible() {
                return done(visibleWithoutCategory);
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
                    const match = yield* q.isVisible(d);
                    return match.isVisible
                        ? notVisible
                        : visibleWithoutCategory;
                },
                isAny: false,
            };
        },
    });
}

function classifyAs(label: string, builder: DraftQueryBuilder) {
    if (builder.isIgnorable) return builder;
    const categories = [label];

    return {
        isIgnorable: false,
        *initialize(environment: QueryEnvironment) {
            const query = yield* builder.initialize(environment);
            return {
                *isVisible(draft: Draft) {
                    const match = yield* query.isVisible(draft);
                    if (!match.isVisible) return match;
                    return {
                        isVisible: true,
                        categories,
                    };
                },
            };
        },
    };
}

function tag(label: string, builder: DraftQueryBuilder) {
    if (builder.isIgnorable) return builder;
    const singleCategory = [label];

    return {
        isIgnorable: false,
        *initialize(environment: QueryEnvironment) {
            const query = yield* builder.initialize(environment);
            return {
                *isVisible(draft: Draft) {
                    const match = yield* query.isVisible(draft);
                    if (!match.isVisible || match.categories.includes(label)) {
                        return match;
                    }
                    if (match.categories.length === 0) {
                        return {
                            isVisible: true,
                            categories: singleCategory,
                        };
                    }
                    return {
                        isVisible: true,
                        categories: [...match.categories, label],
                    };
                },
            };
        },
    };
}

function labelQueryFunction(
    name: string,
    applyLabel: (
        label: string,
        builder: DraftQueryBuilder,
    ) => DraftQueryBuilder,
): Value {
    return (label) => {
        if (typeof label !== "string") {
            throw new Error(
                `${name} expects a raw string label, for example @"神社".`,
            );
        }
        const normalizedLabel = label.normalize("NFC").trim();
        if (!normalizedLabel) {
            throw new Error(`${name} label must not be empty.`);
        }
        return done((query: Value) =>
            done(
                builderAsValue(
                    applyLabel(normalizedLabel, valueAsBuilder(query)),
                ),
            ),
        );
    };
}

function isDraftQueryBuilderValue(
    value: Value,
): value is { readonly [k: string]: Value } {
    return (
        typeof value === "object" &&
        value !== null &&
        "initialize" in value &&
        typeof value["initialize"] === "function" &&
        "isIgnorable" in value &&
        typeof value["isIgnorable"] === "boolean"
    );
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
                    const match1 = yield* q1.isVisible(draft);
                    if (!match1.isVisible) return notVisible;

                    const match2 = yield* q2.isVisible(draft);
                    if (!match2.isVisible) return notVisible;

                    const categories = [...match1.categories];
                    for (const category of match2.categories) {
                        if (!categories.includes(category)) {
                            categories.push(category);
                        }
                    }
                    return categories.length === 0
                        ? visibleWithoutCategory
                        : { isVisible: true, categories };
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
                    const match1 = yield* q1.isVisible(d);
                    if (match1.isVisible) return match1;
                    return yield* q2.isVisible(d);
                },
            };
        },
    };
}

function reachableWithQuery(
    center: google.maps.LatLngLiteral,
    radius: number,
): DraftQuery {
    return {
        isVisible(d: Draft) {
            const [p2] = d.coordinates;
            return done(toQueryMatch(distance(center, p2) <= radius));
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
            return done(reachableWithQuery(p1, radius));
        },
    };
}

function builderOfPredicate(
    predicate: (e: QueryEnvironment, d: Draft) => Effective<boolean>,
): DraftQueryBuilder {
    return {
        isIgnorable: false,
        initialize(e) {
            return done({
                *isVisible(d) {
                    return toQueryMatch(yield* predicate(e, d));
                },
            });
        },
    };
}
function* getFreshCell17(e: QueryEnvironment, d: Draft) {
    const minFetchDate = yield* e.getMinFreshDate();
    const stat17 = yield* e.getCell17Stat(d);
    if (
        stat17 == null ||
        stat17.lastFetchDate == null ||
        stat17.lastFetchDate < minFetchDate
    ) {
        return;
    }
    return stat17;
}
function* getFreshStat14(e: QueryEnvironment, d: Draft) {
    const minFetchDate = yield* e.getMinFreshDate();
    const stat14 = yield* e.getCell14Stat(d);
    if (
        stat14 == null ||
        stat14.maxLastFetchDate == null ||
        stat14.maxLastFetchDate < minFetchDate
    )
        return;
    return stat14;
}
function builderOfCellPredicate(
    predicate: (
        stat14: Cell14Statistics,
        stat17: CellStatistic<17>,
        draft: Draft,
    ) => boolean,
): DraftQueryBuilder {
    return {
        isIgnorable: false,
        initialize(e) {
            return done({
                *isVisible(d) {
                    const stat17 = yield* getFreshCell17(e, d);

                    // セル情報が取得されていないか古いなら検索にヒットさせる
                    if (stat17 == null) return visibleWithoutCategory;

                    const stat14 = yield* getFreshStat14(e, d);
                    if (stat14 == null) return visibleWithoutCategory;

                    return toQueryMatch(predicate(stat14, stat17, d));
                },
            });
        },
    };
}

function hasPokestopOrGymInCell17() {
    return builderOfPredicate(function* (e, d) {
        const stat17 = yield* getFreshCell17(e, d);
        if (stat17 == null) return true;

        // セル17にジムかポケストップが存在するか
        const count =
            (stat17.kindToCount.get("GYM") ?? 0) +
            (stat17.kindToCount.get("POKESTOP") ?? 0);
        return 0 < count;
    });
}

const gymThresholds = Object.freeze([2, 6, 20]);
function getGymCount(stopCount: number) {
    for (let i = 0; i < gymThresholds.length; i++) {
        const threshold = gymThresholds[i]!;
        if (stopCount < threshold) {
            return i;
        }
    }
    return gymThresholds.length;
}
export function getPokestopCountForNextGym(current: number) {
    let next = Infinity;
    for (const threshold of gymThresholds) {
        if (current < threshold) {
            next = threshold;
            break;
        }
    }
    return next - current;
}

function stopsForNextGym(expectedCount: number): DraftQueryBuilder {
    return builderOfPredicate(function* (e, d) {
        const stat14 = yield* getFreshStat14(e, d);
        if (stat14 == null) return true;

        const gymCount = stat14.kindToPois.get("GYM")?.length ?? 0;
        const pokestopCount = stat14.kindToPois.get("POKESTOP")?.length ?? 0;
        const stopCount = gymCount + pokestopCount;

        const draftStat14 = yield* e.getCell14DraftStat(d);
        if (draftStat14 == null) return true;

        return (
            // 次のジムに必要なポケストップ数が指定された数で
            getPokestopCountForNextGym(stopCount) === expectedCount &&
            // 候補の数が指定された数以上で
            expectedCount <= draftStat14.potentialStops &&
            // ジムの数が正常（スポンサーポケストップなどは表示されない）
            getGymCount(stopCount) === gymCount
        );
    });
}
function cell14Stops(expectedCount: number): DraftQueryBuilder {
    return builderOfCellPredicate((stat14, _stat17) => {
        return stat14.pois.size === expectedCount;
    });
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
                    return done(visibleWithoutCategory);
                },
            });
        },
    });
    const seq = binaryBuilder(and);
    const duplicated = builderAsValue(hasPokestopOrGymInCell17());
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
        classifyAs: labelQueryFunction("classifyAs", classifyAs),
        tag: labelQueryFunction("tag", tag),
        category: labelQueryFunction("category", classifyAs),
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
        reachable: builderAsValue({
            isIgnorable: false,
            *initialize(e) {
                const p = yield* e.getUserLocation();
                return reachableWithQuery(p, 10000);
            },
        }),
        duplicated,
        hasStopInCell17: duplicated,
        stopsForNextGym(x) {
            return done(builderAsValue(stopsForNextGym(x as number)));
        },
        cell14Stops(x) {
            return done(builderAsValue(cell14Stops(x as number)));
        },
    };
    return new Map<string, Value>(Object.entries(dict));
}
