export interface DraftMarkerOutlineSegment {
    readonly color: string;
    readonly startAngle: number;
    readonly endAngle: number;
}

export function createDraftMarkerOutlineSegments(
    colors: readonly string[],
): readonly DraftMarkerOutlineSegment[] {
    if (colors.length < 2) return [];

    const segmentAngle = (Math.PI * 2) / colors.length;
    const gap = Math.min(0.06, segmentAngle / 4);
    return colors.map((color, index) => ({
        color,
        startAngle: -Math.PI / 2 + index * segmentAngle + gap / 2,
        endAngle: -Math.PI / 2 + (index + 1) * segmentAngle - gap / 2,
    }));
}
