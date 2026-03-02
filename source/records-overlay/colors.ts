export function normalizeColor(
    cssColor: string,
): [r: number, g: number, b: number, a: number] {
    cssColor = cssColor.trim().toLowerCase();

    // #RRGGBBAA
    if (cssColor.startsWith("#")) {
        const hex = cssColor.slice(1);
        const r = parseInt(hex.substring(0, 2), 16) / 255;
        const g = parseInt(hex.substring(2, 4), 16) / 255;
        const b = parseInt(hex.substring(4, 6), 16) / 255;
        const a =
            hex.length === 8 ? parseInt(hex.substring(6, 8), 16) / 255 : 1;
        return [r, g, b, a];
    }

    // rgba(r, g, b, a)
    if (cssColor.startsWith("rgb")) {
        const values = cssColor.match(/[\d.]+/g)?.map(Number);
        if (values?.length === 4) {
            return [
                values[0]! / 255,
                values[1]! / 255,
                values[2]! / 255,
                values[3]!,
            ];
        }
    }

    throw new Error("Unsupported format");
}
