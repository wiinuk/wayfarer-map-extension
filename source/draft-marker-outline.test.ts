import { describe, expect, it } from "vitest";
import { createDraftMarkerOutlineSegments } from "./draft-marker-outline";

describe("createDraftMarkerOutlineSegments", () => {
    it("uses a full outline for zero or one category color", () => {
        expect(createDraftMarkerOutlineSegments([])).toEqual([]);
        expect(createDraftMarkerOutlineSegments(["red"])).toEqual([]);
    });

    it("splits the outline into separated category-colored arcs", () => {
        const segments = createDraftMarkerOutlineSegments(["red", "blue"]);

        expect(segments).toHaveLength(2);
        expect(segments[0]!.color).toBe("red");
        expect(segments[1]!.color).toBe("blue");
        expect(segments[0]!.endAngle).toBeLessThan(segments[1]!.startAngle);
    });
});
