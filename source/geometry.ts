import type { LatLng } from "./s2";

export function toLatLngLiteral(latLng: google.maps.LatLng): LatLng {
    return { lat: latLng.lat(), lng: latLng.lng() };
}
export function distanceSquared(a: LatLng, b: LatLng) {
    const dLat = b.lat - a.lat;
    const dLng = b.lng - a.lng;
    return dLat * dLat + dLng * dLng;
}