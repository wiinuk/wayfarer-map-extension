import type { LatLng } from "./s2";

export function toLatLngLiteral(latLng: google.maps.LatLng): LatLng {
    return { lat: latLng.lat(), lng: latLng.lng() };
}

export function distance(
    { lat: lat1, lng: lng1 }: LatLng,
    { lat: lat2, lng: lng2 }: LatLng,
) {
    // 地球の平均半径 (m)
    const R = 6_371_000;

    const rLat1 = (lat1 * Math.PI) / 180;
    const rLat2 = (lat2 * Math.PI) / 180;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;

    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(rLat1) * Math.cos(rLat2) * Math.sin(dLng / 2) ** 2;

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
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
    return result;
}

export function coordinatesToString(coords: readonly LatLng[]): string {
    return coords.map((ll) => `${ll.lat},${ll.lng}`).join(",");
}
