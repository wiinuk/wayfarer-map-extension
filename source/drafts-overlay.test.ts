import { afterEach, expect, it, vi } from "vitest";
import { createDraftsOverlay, type DraftWithView } from "./drafts-overlay";
import type { Draft } from "./remote";

class MockMap {}

class MockOverlayView {
    getProjection() {
        return null;
    }

    getMap() {
        return null;
    }
}

class Point {
    constructor(
        readonly x: number,
        readonly y: number,
    ) {}
}

class Size {
    constructor(
        readonly width: number,
        readonly height: number,
    ) {}
}

const originalGoogle = globalThis.google;

afterEach(() => {
    globalThis.google = originalGoogle;
});

it("does not reapply an unchanged marker icon", () => {
    globalThis.google = {
        maps: {
            Map: MockMap,
            OverlayView: MockOverlayView,
            Point,
            Size,
        },
    } as unknown as typeof google;

    const overlay = createDraftsOverlay(
        new MockMap() as unknown as google.maps.Map,
        vi.fn(),
    );
    let iconChanges = 0;
    const draft = { id: "draft-1" } as Draft;
    overlay.drafts.set(draft.id, {
        draft,
        mapView: {
            marker: {
                setIcon() {
                    iconChanges++;
                },
            },
            label: {},
            currentIcon: overlay.cachedOptions.draftMarkerIcon,
        },
    } as unknown as DraftWithView);

    const highlighted = new Map([[draft.id, ["category"]]]);
    overlay.setHighlightedDrafts(highlighted);
    overlay.setHighlightedDrafts(highlighted);
    expect(iconChanges).toBe(1);

    const unclassified = new Map([[draft.id, []]]);
    overlay.setHighlightedDrafts(unclassified);
    overlay.setHighlightedDrafts(unclassified);
    expect(iconChanges).toBe(2);

    overlay.setHighlightedDrafts(new Map());
    expect(iconChanges).toBe(3);
});
