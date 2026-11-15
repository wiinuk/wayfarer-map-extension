import { describe, expect, it } from "vitest";
import { evaluateExpression } from "../sal/evaluator";
import {
    createStandardQueries,
    reachableWith,
    type DraftQueryBuilder,
} from "./standard-queries";
import { done, forceAsPromise } from "../sal/effective";
import type { Draft } from "../remote";

describe("Queries", () => {
    async function evaluate(source: string) {
        const globals = createStandardQueries();

        const signal = new AbortController().signal;
        const e = (await forceAsPromise(
            evaluateExpression(source, (k) => globals.get(k)),
            signal,
        )) as unknown as DraftQueryBuilder;

        return e;
    }
    async function builderAsPredicate(b: DraftQueryBuilder) {
        const signal = new AbortController().signal;
        const q = await forceAsPromise(
            b.initialize({
                getUserLocation() {
                    return done({ lat: 0, lng: 0 });
                },
                getMinFreshDate() {
                    return done(0);
                },
                getCell17Stat() {
                    return done(undefined);
                },
                getCell14Stat() {
                    return done(undefined);
                },
                getCell14DraftStat() {
                    return done(undefined);
                },
            }),
            signal,
        );
        return (d: Draft) => forceAsPromise(q.isVisible(d), signal);
    }
    function emptyDraft(): Draft {
        return {
            type: "route",
            id: "",
            userId: "",
            name: "",
            description: "",
            note: "",
            coordinates: [{ lat: 0, lng: 0 }],
            data: {},
        };
    }
    async function parseToPredicate(source: string) {
        const b = await evaluate(source);
        return await builderAsPredicate(b);
    }

    it("- operator", async () => {
        const isVisible = await parseToPredicate("-coffee");
        expect(
            (await isVisible({ ...emptyDraft(), name: "coffee" })).isVisible,
        ).toBe(false);
        expect(await isVisible({ ...emptyDraft(), name: "coff" })).toEqual({
            isVisible: true,
            categories: [],
        });
    });

    it("reachableWith", async () => {
        const isVisible = await builderAsPredicate(reachableWith([0, 0], 1));
        expect(
            (
                await isVisible({
                    ...emptyDraft(),
                    coordinates: [{ lat: 0, lng: 0 }],
                })
            ).isVisible,
        ).toBe(true);
        expect(
            (
                await isVisible({
                    ...emptyDraft(),
                    coordinates: [{ lat: 30, lng: 30 }],
                })
            ).isVisible,
        ).toBe(false);
    });

    it("searches a built-in name when quoted as a term", async () => {
        const query = await parseToPredicate('"category"');

        await expect(
            query({ ...emptyDraft(), name: "category" }),
        ).resolves.toEqual({
            isVisible: true,
            categories: [],
        });
    });

    it("classifies a matching query", async () => {
        const query = await parseToPredicate(
            'classifyAs: @"神社": 神社 or classifyAs: @"寺院": 寺院',
        );

        await expect(query({ ...emptyDraft(), name: "寺院" })).resolves.toEqual(
            {
                isVisible: true,
                categories: ["寺院"],
            },
        );
    });

    it("shares single-category results across matches", async () => {
        for (const source of [
            'classifyAs: @"神社": 神社',
            'tag: @"神社": 神社',
        ]) {
            const query = await parseToPredicate(source);
            const first = await query({ ...emptyDraft(), name: "神社 1" });
            const second = await query({ ...emptyDraft(), name: "神社 2" });
            expect(first.categories).toBe(second.categories);
        }
    });

    it("uses the first matching classification when both alternatives match", async () => {
        const query = await parseToPredicate(
            'classifyAs: @"神社": 神社 or classifyAs: @"寺院": 寺院',
        );

        await expect(
            query({ ...emptyDraft(), name: "神社 寺院" }),
        ).resolves.toEqual({
            isVisible: true,
            categories: ["神社"],
        });
    });

    it("merges classifications from both matching AND operands", async () => {
        const query = await parseToPredicate(
            'classifyAs: @"神社": 神社 and classifyAs: @"鳥居": 鳥居',
        );

        await expect(
            query({ ...emptyDraft(), name: "神社 鳥居" }),
        ).resolves.toEqual({
            isVisible: true,
            categories: ["神社", "鳥居"],
        });
    });

    it("adds tags without replacing existing classifications", async () => {
        const query = await parseToPredicate(
            'tag: @"鳥居": (classifyAs: @"神社": 神社)',
        );

        await expect(query({ ...emptyDraft(), name: "神社" })).resolves.toEqual(
            {
                isVisible: true,
                categories: ["神社", "鳥居"],
            },
        );
    });

    it("deduplicates repeated tags", async () => {
        const query = await parseToPredicate(
            'tag: @"内側": (tag: @"内側": 神社)',
        );

        await expect(query({ ...emptyDraft(), name: "神社" })).resolves.toEqual(
            {
                isVisible: true,
                categories: ["内側"],
            },
        );
    });

    it("lets classifyAs replace nested labels", async () => {
        const query = await parseToPredicate(
            'classifyAs: @"外側": (tag: @"内側": 神社)',
        );

        await expect(query({ ...emptyDraft(), name: "神社" })).resolves.toEqual(
            {
                isVisible: true,
                categories: ["外側"],
            },
        );
    });

    it("drops labels when a labeled query is negated", async () => {
        const query = await parseToPredicate('-classifyAs: @"神社": 寺院');

        await expect(query({ ...emptyDraft(), name: "神社" })).resolves.toEqual(
            {
                isVisible: true,
                categories: [],
            },
        );
    });
});
