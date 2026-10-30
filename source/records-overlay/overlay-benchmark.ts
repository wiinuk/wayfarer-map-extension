export function resolveBufferRatio(search: string, debugBuild: boolean) {
    if (!debugBuild) return 0;

    const value = new URLSearchParams(search).get("wfmap-overlay-buffer");
    if (value == null || value === "0") return 0;
    if (value === "0.5") return 0.5;

    throw new Error(
        `Invalid wfmap-overlay-buffer value: ${value}. Expected 0 or 0.5.`,
    );
}

export function getWorldWidth(
    swX: number,
    neX: number,
    crossesAntimeridian: boolean,
) {
    const delta = neX - swX;
    if (!crossesAntimeridian) return Math.abs(delta);
    return delta < 0 ? delta + 1 : delta;
}

export async function hashPixels(data: Uint8ClampedArray) {
    const bytes = new Uint8Array(data.length);
    bytes.set(data);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
    ).join("");
}

type CanvasStyleProperty = "height" | "transform" | "width";

export function setCanvasStyleIfChanged(
    style: CSSStyleDeclaration,
    property: CanvasStyleProperty,
    value: string,
) {
    if (style[property] !== value) {
        style[property] = value;
    }
}
