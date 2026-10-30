import { describe, expect, it } from "vitest";
import { getWorldWidth, setCanvasStyleIfChanged } from "./overlay-utils";

describe("overlay utilities", () => {
    it("calculates a short world width across the antimeridian", () => {
        expect(getWorldWidth(0.97, 0.03, true)).toBeCloseTo(0.06);
        expect(getWorldWidth(0.1, 0.9, false)).toBeCloseTo(0.8);
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
