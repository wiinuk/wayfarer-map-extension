import { describe, expect, it } from "vitest";
import { evaluateExpression } from "../sal/evaluator";
import {
    createStandardQueries,
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
        expect(await isVisible({ ...emptyDraft(), name: "coffee" })).toBe(
            false,
        );
        expect(await isVisible({ ...emptyDraft(), name: "coff" })).toBe(true);
    });
});
