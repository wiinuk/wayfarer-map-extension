export function getWorldWidth(
    swX: number,
    neX: number,
    crossesAntimeridian: boolean,
) {
    const delta = neX - swX;
    if (!crossesAntimeridian) return Math.abs(delta);
    return delta < 0 ? delta + 1 : delta;
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
