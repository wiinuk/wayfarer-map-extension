import type { Draft } from "../remote";
import { done, type Effective } from "../sal/effective";
import type { Value } from "../sal/evaluator";

export interface QueryEnvironment {
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
    };
    return new Map<string, Value>(Object.entries(dict));
}
