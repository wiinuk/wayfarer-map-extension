import { describe, expect, it } from "vitest";
import {
    createCategoryColorMap,
    MIN_CATEGORY_HUE_SEPARATION,
} from "./category-colors";

function getHue(color: string) {
    const match = /^hsl\((\d+),/.exec(color);
    if (!match) throw new Error(`Unexpected color: ${color}`);
    return Number(match[1]);
}

function hueDistance(a: number, b: number) {
    const distance = Math.abs(a - b);
    return Math.min(distance, 360 - distance);
}

describe("createCategoryColorMap", () => {
    it("separates the shrine and temple categories", () => {
        const colors = createCategoryColorMap(["神社", "寺院"]);

        expect(
            hueDistance(
                getHue(colors.get("神社")!),
                getHue(colors.get("寺院")!),
            ),
        ).toBeGreaterThanOrEqual(MIN_CATEGORY_HUE_SEPARATION);
    });

    it("keeps a category's base color when no other category conflicts", () => {
        const labels = Array.from({ length: 30 }, (_, i) => `category-${i}`);
        const singleColors = new Map(
            labels.map((label) => [
                label,
                createCategoryColorMap([label]).get(label)!,
            ]),
        );
        const pair = labels.flatMap((first) =>
            labels
                .filter(
                    (second) =>
                        second !== first &&
                        hueDistance(
                            getHue(singleColors.get(first)!),
                            getHue(singleColors.get(second)!),
                        ) >= MIN_CATEGORY_HUE_SEPARATION,
                )
                .map((second) => [first, second] as const),
        )[0]!;
        const colors = createCategoryColorMap(pair);

        expect(colors.get(pair[0])).toBe(singleColors.get(pair[0]));
        expect(colors.get(pair[1])).toBe(singleColors.get(pair[1]));
    });

    it("separates close hues deterministically regardless of input order", () => {
        const labels = Array.from({ length: 30 }, (_, i) => `category-${i}`);
        const singleColors = new Map(
            labels.map((label) => [
                label,
                createCategoryColorMap([label]).get(label)!,
            ]),
        );
        const pair = labels.flatMap((first) =>
            labels
                .filter(
                    (second) =>
                        second !== first &&
                        hueDistance(
                            getHue(singleColors.get(first)!),
                            getHue(singleColors.get(second)!),
                        ) < MIN_CATEGORY_HUE_SEPARATION,
                )
                .map((second) => [first, second] as const),
        )[0]!;
        const colors = createCategoryColorMap(pair);
        const reversedColors = createCategoryColorMap([...pair].reverse());

        expect(
            hueDistance(
                getHue(colors.get(pair[0])!),
                getHue(colors.get(pair[1])!),
            ),
        ).toBeGreaterThanOrEqual(MIN_CATEGORY_HUE_SEPARATION);
        expect([...colors]).toEqual([...reversedColors]);
    });

    it("normalizes category names before assigning colors", () => {
        const colors = createCategoryColorMap([" 神社 ", "神社"]);

        expect(colors.size).toBe(1);
        expect(colors.get("神社")).toBe(
            createCategoryColorMap(["神社"]).get("神社"),
        );
    });
});
