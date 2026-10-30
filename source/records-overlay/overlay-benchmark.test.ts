import { describe, expect, it } from "vitest";
import {
    getWorldWidth,
    hashPixels,
    resolveBufferRatio,
    setCanvasStyleIfChanged,
} from "./overlay-benchmark";

describe("overlay benchmark helpers", () => {
    it("keeps benchmark buffer selection out of production builds", () => {
        expect(
            resolveBufferRatio("?wfmap-overlay-buffer=0.5", false),
        ).toBe(0);
        expect(
            resolveBufferRatio("?wfmap-overlay-buffer=0.5", true),
        ).toBe(0.5);
        expect(resolveBufferRatio("", true)).toBe(0);
        expect(() =>
            resolveBufferRatio("?wfmap-overlay-buffer=1", true),
        ).toThrow(/Expected 0 or 0\.5/);
    });

    it("calculates a short world width across the antimeridian", () => {
        expect(getWorldWidth(0.97, 0.03, true)).toBeCloseTo(0.06);
        expect(getWorldWidth(0.1, 0.9, false)).toBeCloseTo(0.8);
    });

    it("hashes pixel bytes deterministically", async () => {
        const pixels = new Uint8ClampedArray([1, 2, 3, 4]);
        await expect(hashPixels(pixels)).resolves.toBe(
            await hashPixels(pixels),
        );
        await expect(
            hashPixels(new Uint8ClampedArray([1, 2, 3, 5])),
        ).resolves.not.toBe(await hashPixels(pixels));
    });

    it("does not write unchanged canvas styles", () => {
        let writes = 0;
        let currentValue = "";
        const style = {
            get transform() {
                return currentValue;
            },
            set transform(value: string) {
                writes++;
                currentValue = value;
            },
        } as CSSStyleDeclaration;

        setCanvasStyleIfChanged(style, "transform", "translate(10px, 20px)");
        setCanvasStyleIfChanged(style, "transform", "translate(10px, 20px)");

        expect(writes).toBe(1);
        expect(currentValue).toBe("translate(10px, 20px)");
    });
});
