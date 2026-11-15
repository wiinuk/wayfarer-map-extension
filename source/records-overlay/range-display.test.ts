import { describe, expect, it } from "vitest";
import {
    createRangeDisplayPlan,
    type RangeDisplayCandidate,
    type RangeDisplayCircle,
} from "./range-display";

function circle(id: string, lat: number, radius: number): RangeDisplayCircle {
    return {
        id,
        center: { lat, lng: 0 },
        radius,
    };
}

function candidate(
    operator: "and" | "or",
    first: RangeDisplayCircle,
    second: RangeDisplayCircle,
): RangeDisplayCandidate {
    return {
        expression: {
            type: operator,
            left: { type: "circle", id: first.id },
            right: { type: "circle", id: second.id },
        },
        circles: [first, second],
    };
}

describe("range display plans", () => {
    it("marks the outer circle non-contributing in a contained intersection", () => {
        const outer = circle("outer", 0, 20_000);
        const inner = circle("inner", 0, 5_000);

        const plan = createRangeDisplayPlan(candidate("and", outer, inner));

        expect(plan.expression).toEqual({ type: "circle", id: "inner" });
        expect(
            plan.circles.map(({ id, contribution }) => [id, contribution]),
        ).toEqual([
            ["outer", "non-contributing"],
            ["inner", "contributing"],
        ]);
    });

    it("marks the inner circle non-contributing in a containing union", () => {
        const outer = circle("outer", 0, 20_000);
        const inner = circle("inner", 0, 5_000);

        const plan = createRangeDisplayPlan(candidate("or", outer, inner));

        expect(plan.expression).toEqual({ type: "circle", id: "outer" });
        expect(
            plan.circles.map(({ id, contribution }) => [id, contribution]),
        ).toEqual([
            ["outer", "contributing"],
            ["inner", "non-contributing"],
        ]);
    });

    it("preserves an empty intersection as a fully outside region", () => {
        const first = circle("first", 0, 1_000);
        const second = circle("second", 10, 1_000);

        const plan = createRangeDisplayPlan(candidate("and", first, second));

        expect(plan.expression).toBe(false);
        expect(
            plan.circles.every(
                ({ contribution }) => contribution === "contributing",
            ),
        ).toBe(true);
    });

    it("marks a circle and its negation as non-contributing", () => {
        const range = circle("range", 0, 1_000);
        const plan = createRangeDisplayPlan({
            expression: {
                type: "and",
                left: { type: "circle", id: range.id },
                right: {
                    type: "not",
                    expression: { type: "circle", id: range.id },
                },
            },
            circles: [range],
        });

        expect(plan.expression).toBe(false);
        expect(plan.circles[0]?.contribution).toBe("non-contributing");
    });

    it("keeps circles from non-geographic disjunctions as non-contributing", () => {
        const circleRange = circle("circle", 0, 1_000);

        const plan = createRangeDisplayPlan({
            circles: [circleRange],
        });

        expect(plan.expression).toBeNull();
        expect(plan.circles[0]?.contribution).toBe("non-contributing");
    });

    it("marks duplicate ranges non-contributing", () => {
        const first = circle("first", 0, 5_000);
        const duplicate = circle("duplicate", 0, 5_000);
        const plan = createRangeDisplayPlan(candidate("or", first, duplicate));

        expect(plan.expression).toEqual({ type: "circle", id: "first" });
        expect(
            plan.circles.every(
                ({ contribution }) => contribution === "non-contributing",
            ),
        ).toBe(true);
    });
});
