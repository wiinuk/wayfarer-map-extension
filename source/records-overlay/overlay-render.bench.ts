import { bench } from "vitest";
import {
    createLabelBounds,
    layoutLabelsByScanningVisible,
    layoutLabelsWithSpatialIndex,
} from "./overlay-collision-benchmark";

const labels = createLabelBounds(4096);
const expected = layoutLabelsByScanningVisible(labels);
const actual = layoutLabelsWithSpatialIndex(labels);

if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("Label visibility differs between collision algorithms");
}

console.info(
    "[records-overlay benchmark]",
    JSON.stringify({
        node: process.version,
        labels: labels.length,
        visible: actual.length,
        resultsMatch: true,
        workload: "ordered 64x64 synthetic label grid",
    }),
);

bench("spatial index (production collision checker)", () => {
    const visible = layoutLabelsWithSpatialIndex(labels);
    if (visible.length !== expected.length) {
        throw new Error("Spatial-index output changed during benchmark");
    }
});

bench("scan all visible labels (reference)", () => {
    const visible = layoutLabelsByScanningVisible(labels);
    if (visible.length !== expected.length) {
        throw new Error("Reference output changed during benchmark");
    }
});
