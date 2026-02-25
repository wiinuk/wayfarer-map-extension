// spell-checker:words vitest
import { describe, it, expect } from "vitest";
import { evaluateExpression, type Value } from "../evaluator";
import {
    awaitPromise,
    done,
    forceAsPromise,
    getCancel,
    type Effective,
} from "../effective";
import { sleep } from "../../standard-extensions";

const createStandardLibrary = () => {
    const lib = new Map<string, Value>();

    const binaryGeneric =
        (op: (a: Value, b: Value) => Value): Value =>
        (a: Value) =>
            done((b: Value) => done(op(a, b)));

    const binary = binaryGeneric as (
        op: (a: number, b: number) => Value,
    ) => Value;

    lib.set("fromVoid", () => done(null));
    lib.set("fromNumber", (x) => done(x));
    lib.set("fromString", (x) => done(x));
    lib.set("fromWord", (x) => done(x));
    lib.set(
        "add",
        binary((a, b) => a + b),
    );
    lib.set(
        "sub",
        binary((a, b) => a - b),
    );
    lib.set(
        "mul",
        binary((a, b) => a * b),
    );
    lib.set(
        "div",
        binary((a, b) => {
            if (b === 0) throw new Error("Division by zero");
            return a / b;
        }),
    );
    lib.set(
        "mod",
        binary((a, b) => a % b),
    );
    lib.set(
        "eq",
        binary((a, b) => a === b),
    );
    lib.set(
        "neq",
        binary((a, b) => a !== b),
    );
    lib.set(
        "lt",
        binary((a, b) => a < b),
    );
    lib.set(
        "lte",
        binary((a, b) => a <= b),
    );
    lib.set(
        "gt",
        binary((a, b) => a > b),
    );
    lib.set(
        "gte",
        binary((a, b) => a >= b),
    );

    lib.set("not_", (a) => done(!a));
    lib.set(
        "_seq_",
        binary((a, b) => [a, b]),
    );
    lib.set(
        "_and_",
        binary((a, b) => a && b),
    );
    lib.set(
        "_or_",
        binary((a, b) => a || b),
    );
    lib.set("true", true);
    lib.set("false", false);
    lib.set("null", null);
    lib.set("sleep", function* (milliseconds) {
        yield* awaitPromise(
            sleep(milliseconds as number, { signal: yield* getCancel() }),
        );
        return (f) => {
            return (f as (x: Value) => Effective<Value>)(null);
        };
    });

    return lib;
};

async function evaluate(source: string, globals?: ReadonlyMap<string, Value>) {
    const lib = createStandardLibrary();
    const effective = evaluateExpression(source, (k) => {
        const v = globals?.get(k);
        if (v !== undefined) return v;
        return lib.get(k);
    });
    const { signal } = new AbortController();
    return await forceAsPromise(effective, signal);
}

describe("Evaluator", () => {
    describe("Literals and Basic Expressions", () => {
        it("should evaluate numbers", async () => {
            expect(await evaluate("123")).toBe(123);
            expect(await evaluate("-45.5")).toBe(-45.5);
        });

        it("should evaluate strings", async () => {
            expect(await evaluate('"hello world"')).toBe("hello world");
            expect(
                await evaluate('"string with "quotes" and \\\\ backslash"'),
            ).toStrictEqual([["string with ", "quotes"], " and \\ backslash"]);
        });

        it("should treat unknown words as strings", async () => {
            expect(await evaluate("aWord")).toBe("aWord");
        });
    });

    describe("Operators and Precedence", () => {
        it("should handle arithmetic operators", async () => {
            expect(await evaluate("1 /add 2")).toBe(3);
            expect(await evaluate("10 /sub 3")).toBe(7);
            expect(await evaluate("4 /mul 5")).toBe(20);
            expect(await evaluate("20 /div 4")).toBe(5);
            expect(await evaluate("10 /mod 3")).toBe(1);
        });

        it("should respect operator precedence", async () => {
            // 記号ではなく単なる名前なので優先順位の違いはない。
            // 2.add(3).mul(4) というメソッド構文に優先順位がないのと同じ
            expect(await evaluate("2 /add 3 /mul 4")).toBe(20);
            expect(await evaluate("(2 /add 3) /mul 4")).toBe(20);
            expect(await evaluate("2 /add (3 /mul 4)")).toBe(14);
        });

        it("should handle division by zero", async () => {
            await expect(evaluate("1 /div 0")).rejects.toThrow(
                "Division by zero",
            );
        });

        it("should handle comparison operators", async () => {
            expect(await evaluate("5 /gt 3")).toBe(true);
            expect(await evaluate("3 /gt 5")).toBe(false);
            expect(await evaluate("3 /lte 3")).toBe(true);
            expect(await evaluate('"a" /eq "a"')).toBe(true);
            expect(await evaluate('"a" /eq "b"')).toBe(false);
            expect(await evaluate("null /eq null")).toBe(true);
        });
    });

    describe("Logical Operators", () => {
        it("should evaluate 'not'", async () => {
            expect(await evaluate("-true")).toBe(false);
            expect(await evaluate("-false")).toBe(true);
            expect(await evaluate("-(1)")).toBe(false);
            expect(await evaluate("-(0)")).toBe(true);
        });

        it("'and' should not be short-circuit evaluated", async () => {
            expect(await evaluate("true and false")).toBe(false);
            expect(await evaluate("false and true")).toBe(false);
            // a and b は、単なる関数呼び出し _and_:a:b の構文糖
            await expect(evaluate("false and @undefinedVar")).rejects.toThrow(
                "undefinedVar",
            );
        });

        it("'or' should not be short-circuit evaluated", async () => {
            expect(await evaluate("true or false")).toBe(true);
            expect(await evaluate("false or true")).toBe(true);
            await expect(evaluate("true or @undefinedVar")).rejects.toThrow(
                "undefinedVar",
            );
        });
    });

    describe("Variables and Scoping with 'where'", () => {
        it("should define and use a variable", async () => {
            expect(await evaluate("@x @where x = 10")).toBe(10);
        });

        it("should define and use a function", async () => {
            expect(await evaluate("@f:10:7 @where f x y = x /sub y")).toBe(3);
        });

        it("should apply the last definition when duplicate parameters exist", async () => {
            expect(await evaluate("@f:10:7 @where f x x = x")).toBe(7);
        });

        it("should handle multiple declarations", async () => {
            expect(
                await evaluate(
                    "@x /add @y /add @z @where @x = 10 @where @y = 20 @where @z = 30",
                ),
            ).toBe(60);
        });

        it("should allow shadowing parent scopes", async () => {
            const globals = new Map<string, Value>([["x", 1]]);
            expect(await evaluate("@x @where x = 10", globals)).toBe(10);
            expect(await evaluate("@x", globals)).toBe(1);
        });

        it("declaration behind is visible", async () => {
            expect(await evaluate("@y @where @y = @x @where @x = 10")).toBe(10);
        });

        it("should handle nested where clauses", async () => {
            const code = `
                @x /add @y
                @where y = @x /add 1
                @where x = 10
            `;
            expect(await evaluate(code)).toBe(21);
        });
    });

    describe("Functions and Lambdas", () => {
        it("should define and apply a lambda", async () => {
            expect(await evaluate("(@fn x: @x /add 1):10")).toBe(11);
        });

        it("should handle closures correctly", async () => {
            const code = `
                (@fn y: (@fn x: @x /add @y):10):5
            `;
            expect(await evaluate(code)).toBe(15);
        });
        it("should handle closures correctly - parameters", async () => {
            const code = `
                (@fn x y: x /sub y):10:5
            `;
            expect(await evaluate(code)).toBe(5);
        });
        it("parameters shadow", async () => {
            const code = `
                (@fn x x: x):10:5
            `;
            expect(await evaluate(code)).toBe(5);
        });

        it("should work as higher-order functions", async () => {
            const code = `
                (
                    (@fn f: @f:10)
                    : (@fn x: @x /mul 2)
                )
            `;
            expect(await evaluate(code)).toBe(20);
        });
    });

    describe("List and Record Literals", () => {
        it("should evaluate empty list literal", async () => {
            expect(await evaluate("[]")).toEqual([]);
        });

        it("should evaluate list literal with numbers", async () => {
            expect(await evaluate("[1, 2, 3]")).toEqual([1, 2, 3]);
        });

        it("should evaluate list literal with expressions", async () => {
            expect(await evaluate('[1 /add 2, "hello", -true]')).toEqual([
                3,
                "hello",
                false,
            ]);
        });

        it("should evaluate nested list literals", async () => {
            expect(await evaluate("[1, [2, 3], 4]")).toEqual([1, [2, 3], 4]);
        });

        it("should evaluate sequence of list and custom value", async () => {
            expect(
                await evaluate(
                    "[1] 2",
                    new Map([["fromNumber", (x) => done({ fromNumber: x })]]),
                ),
            ).toEqual([[1], { fromNumber: 2 }]);
        });
        it("should evaluate sequence of list and custom value", async () => {
            const globals = new Map<string, Value>([
                ["fromString", (x) => done({ fromString: x })],
                ["fromNumber", (x) => done({ fromNumber: x })],
            ]);
            expect(await evaluate(`[1, "a"] 2 "b"`, globals)).toEqual([
                [[1, "a"], { fromNumber: 2 }],
                { fromString: "b" },
            ]);
        });
        it("should evaluate sequence of record and custom value", async () => {
            const globals = new Map<string, Value>([
                ["fromString", (x) => done({ fromString: x })],
                ["fromNumber", (x) => done({ fromNumber: x })],
            ]);
            expect(await evaluate(`{ k1: 1, k2: "a" } 2 "b"`, globals)).toEqual(
                [[{ k1: 1, k2: "a" }, { fromNumber: 2 }], { fromString: "b" }],
            );
        });
        it("should evaluate sequence of record and custom value", async () => {
            expect(
                await evaluate(
                    "[1] 2",
                    new Map([["fromNumber", (x) => done({ fromNumber: x })]]),
                ),
            ).toEqual([[1], { fromNumber: 2 }]);
        });
        it("should evaluate sequence of string record and custom value", async () => {
            expect(
                await evaluate(
                    `["a"] "b"`,
                    new Map([["fromString", (x) => done({ fromString: x })]]),
                ),
            ).toEqual([["a"], { fromString: "b" }]);
        });

        it("should evaluate record literal with simple entries", async () => {
            expect(await evaluate('{a: 1, b: "hello", c: true}')).toEqual({
                a: 1,
                b: "hello",
                c: true,
            });
        });

        it("should evaluate record literal with expression values", async () => {
            expect(await evaluate("{a: 1 /add 2, b: (@fn x: x):5}")).toEqual({
                a: 3,
                b: 5,
            });
        });

        it("should evaluate record literal with string keys", async () => {
            expect(
                await evaluate(
                    '{ "key with space": 10, "another-key": "value" }',
                ),
            ).toEqual({ "key with space": 10, "another-key": "value" });
        });

        it("should evaluate nested record literals", async () => {
            expect(await evaluate("{a: 1, b: {c: 2}}")).toEqual({
                a: 1,
                b: { c: 2 },
            });
        });

        it("should evaluate mixed list and record literals", async () => {
            const code = `
                [
                    {name: "item1", value: 10},
                    {name: "item2", value: 20},
                    [1, {nested: true}]
                ]
            `;
            expect(await evaluate(code)).toEqual([
                { name: "item1", value: 10 },
                { name: "item2", value: 20 },
                [1, { nested: true }],
            ]);
        });
    });

    describe("Corner Cases and Error Handling", () => {
        it("should fail on syntax error", async () => {
            expect(await evaluate("(1 /add 2")).toBe(3);
        });

        it("should fail on undefined variable", async () => {
            await expect(evaluate("@undefinedVar")).rejects.toThrow(
                "undefinedVar",
            );
        });

        it("should handle complex nested expressions", async () => {
            const code = `
                (@fn z: @z /mul 100)
                : (
                    (5 /add 3) /div (2 /mul 2)
                    @where @y = 10
                )
            `;
            expect(await evaluate(code)).toBe(200);
        });

        it("should handle empty string input", async () => {
            expect(await evaluate("")).toBe(null);
        });

        it("should handle input with only comments", async () => {
            const code = `
                // This is a comment
                /* And this is a block comment */
            `;
            expect(await evaluate(code)).toBe(null);
        });
    });

    describe("promise", () => {
        it("sleep", async () => {
            expect(await evaluate(`200 /sleep @fn x: "woke up!"`)).toBe(
                "woke up!",
            );
        });
    });
});
