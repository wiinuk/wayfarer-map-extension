const HUE_COUNT = 360;
export const MIN_CATEGORY_HUE_SEPARATION = 60;

function normalizeCategoryName(name: string) {
    return name.normalize("NFC").trim();
}

function getBaseHue(name: string) {
    let hash = 2166136261;
    for (let i = 0; i < name.length; i++) {
        hash ^= name.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) % HUE_COUNT;
}

function hueDistance(a: number, b: number) {
    const distance = Math.abs(a - b);
    return Math.min(distance, HUE_COUNT - distance);
}

function minimumDistance(hue: number, assignedHues: readonly number[]) {
    let minimum = HUE_COUNT / 2;
    for (const assignedHue of assignedHues) {
        minimum = Math.min(minimum, hueDistance(hue, assignedHue));
    }
    return minimum;
}

export function createCategoryColorMap(
    categoryNames: Iterable<string>,
): ReadonlyMap<string, string> {
    const names = [
        ...new Set(
            Array.from(categoryNames, normalizeCategoryName).filter(Boolean),
        ),
    ].sort();
    const assignedHues: number[] = [];
    const colors = new Map<string, string>();

    for (const name of names) {
        const baseHue = getBaseHue(name);
        const candidates = Array.from(
            { length: HUE_COUNT },
            (_, hue) => hue,
        ).sort(
            (a, b) =>
                hueDistance(a, baseHue) - hueDistance(b, baseHue) || a - b,
        );
        const separatedHue = candidates.find((hue) =>
            assignedHues.every(
                (assigned) =>
                    hueDistance(hue, assigned) >= MIN_CATEGORY_HUE_SEPARATION,
            ),
        );
        const hue =
            separatedHue ??
            candidates.reduce((best, candidate) => {
                const candidateDistance = minimumDistance(
                    candidate,
                    assignedHues,
                );
                const bestDistance = minimumDistance(best, assignedHues);
                return candidateDistance > bestDistance ? candidate : best;
            }, baseHue);

        assignedHues.push(hue);
        colors.set(name, `hsl(${hue}, 100%, 45%)`);
    }

    return colors;
}
