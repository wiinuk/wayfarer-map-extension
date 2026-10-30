import { describe, expect, it } from "vitest";
import {
    createLabelBounds,
    layoutLabelsByScanningVisible,
    layoutLabelsWithSpatialIndex,
} from "./overlay-collision-benchmark";

describe("overlay label collision benchmark", () => {
    it("keeps label visibility identical to an exhaustive collision scan", () => {
        const labels = createLabelBounds(4096);
        expect(layoutLabelsWithSpatialIndex(labels)).toEqual(
            layoutLabelsByScanningVisible(labels),
        );
    });
});
