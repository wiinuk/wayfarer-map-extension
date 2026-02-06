import type { LatLng } from "./s2";

export interface LatLngBounds {
    readonly sw: Readonly<LatLng>;
    readonly ne: Readonly<LatLng>;
}

export function createDefault(): LatLngBounds {
    return {
        sw: { lat: Infinity, lng: Infinity },
        ne: { lat: -Infinity, lng: -Infinity },
    };
}

function fromSwNeLatLng(
    swLat: number,
    swLng: number,
    neLat: number,
    neLng: number,
): LatLngBounds {
    return {
        sw: { lat: swLat, lng: swLng },
        ne: { lat: neLat, lng: neLng },
    };
}
export function fromSwNe(
    sw: Readonly<LatLng>,
    ne: Readonly<LatLng>,
): LatLngBounds {
    return fromSwNeLatLng(sw.lat, sw.lng, ne.lat, ne.lng);
}
export function getCenter(bounds: LatLngBounds): LatLng {
    return {
        lat: (bounds.sw.lat + bounds.ne.lat) / 2,
        lng: (bounds.sw.lng + bounds.ne.lng) / 2,
    };
}
export function toExtended(
    bounds: LatLngBounds,
    point: Readonly<LatLng>,
): LatLngBounds {
    return {
        sw: {
            lat: Math.min(bounds.sw.lat, point.lat),
            lng: Math.min(bounds.sw.lng, point.lng),
        },
        ne: {
            lat: Math.max(bounds.ne.lat, point.lat),
            lng: Math.max(bounds.ne.lng, point.lng),
        },
    };
}
export function intersects(bounds: LatLngBounds, other: LatLngBounds): boolean {
    return (
        bounds.sw.lat <= other.ne.lat &&
        bounds.ne.lat >= other.sw.lat &&
        bounds.sw.lng <= other.ne.lng &&
        bounds.ne.lng >= other.sw.lng
    );
}
export function fromClass(object: google.maps.LatLngBounds): LatLngBounds {
    const sw = object.getSouthWest();
    const ne = object.getNorthEast();
    return fromSwNeLatLng(sw.lat(), sw.lng(), ne.lat(), ne.lng());
}
