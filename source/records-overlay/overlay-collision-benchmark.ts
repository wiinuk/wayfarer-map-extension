import { createCollisionChecker } from "../collision-checker";

export interface LabelBounds {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly key: number;
}

export function createLabelBounds(count: number): LabelBounds[] {
    const columnCount = Math.ceil(Math.sqrt(count));
    return Array.from({ length: count }, (_, key) => {
        const column = key % columnCount;
        const row = Math.floor(key / columnCount);
        return {
            x: column * 60,
            y: row * 25,
            width: 80 + ((key * 37) % 70),
            height: 18 + ((key * 13) % 12),
            key,
        };
    });
}

export function layoutLabelsWithSpatialIndex(
    labels: readonly LabelBounds[],
): number[] {
    const checker = createCollisionChecker();
    const visibleKeys: number[] = [];

    for (const label of labels) {
        if (checker.check(label)) continue;
        checker.addBox(label);
        visibleKeys.push(label.key);
    }

    return visibleKeys;
}

export function layoutLabelsByScanningVisible(
    labels: readonly LabelBounds[],
): number[] {
    const visible: LabelBounds[] = [];

    for (const label of labels) {
        const overlaps = visible.some(
            (other) =>
                label.key !== other.key &&
                Math.abs(label.x - other.x) < (label.width + other.width) / 2 &&
                Math.abs(label.y - other.y) <
                    (label.height + other.height) / 2,
        );
        if (!overlaps) visible.push(label);
    }

    return visible.map(({ key }) => key);
}
