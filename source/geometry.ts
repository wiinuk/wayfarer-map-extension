import type { LatLng } from "./s2";

export function toLatLngLiteral(latLng: google.maps.LatLng): LatLng {
    return { lat: latLng.lat(), lng: latLng.lng() };
}
export function distanceSquared(a: LatLng, b: LatLng) {
    const dLat = b.lat - a.lat;
    const dLng = b.lng - a.lng;
    return dLat * dLat + dLng * dLng;
}
export function padBounds(bounds: google.maps.LatLngBounds, ratio: number) {
    const sw = bounds.getSouthWest(),
        ne = bounds.getNorthEast(),
        swLat = sw.lat(),
        swLng = sw.lng(),
        neLat = ne.lat(),
        neLng = ne.lng();

    const height = Math.abs(swLat - neLat) * ratio;
    const width = Math.abs(swLng - neLng) * ratio;

    return new google.maps.LatLngBounds(
        { lat: swLat - height, lng: swLng - width },
        { lat: neLat + height, lng: neLng + width },
    );
}

export function parseCoordinates(coordinatesText: string) {
    const tokens = coordinatesText.split(",");
    const result: LatLng[] = [];
    for (let i = 1; i < tokens.length; i += 2) {
        result.push({ lat: Number(tokens[i - 1]!), lng: Number(tokens[i]!) });
    }
    if (result.length === 0) {
        throw new Error();
    }
    return result as LatLng[];
}

export function coordinatesToString(coords: readonly LatLng[]): string {
    return coords.map((ll) => `${ll.lat},${ll.lng}`).join(",");
}
