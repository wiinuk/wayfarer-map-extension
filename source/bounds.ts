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
export function contains(bounds: LatLngBounds, point: LatLng) {
    const { lat, lng } = point;
    const { sw, ne } = bounds;

    const isInLat = lat >= sw.lat && lat <= ne.lat;
    if (!isInLat) return false;

    if (sw.lng <= ne.lng) {
        return lng >= sw.lng && lng <= ne.lng;
    } else {
        return lng >= sw.lng || lng <= ne.lng;
    }
}
export function containsBounds(outer: LatLngBounds, inner: LatLngBounds) {
    return contains(outer, inner.sw) && contains(outer, inner.ne);
}

export function intersects(bounds: LatLngBounds, other: LatLngBounds): boolean {
    const latIntersects =
        bounds.sw.lat <= other.ne.lat && other.sw.lat <= bounds.ne.lat;
    if (!latIntersects) return false;
    return intersectsLng(bounds, other);
}

function intersectsLng(b1: LatLngBounds, b2: LatLngBounds): boolean {
    const cdl1 = b1.sw.lng > b1.ne.lng;
    const cdl2 = b2.sw.lng > b2.ne.lng;

    if (!cdl1 && !cdl2) {
        return b1.sw.lng <= b2.ne.lng && b2.sw.lng <= b1.ne.lng;
    }
    return (
        containsLng(b1, b2.sw.lng) ||
        containsLng(b1, b2.ne.lng) ||
        containsLng(b2, b1.sw.lng) ||
        containsLng(b2, b1.ne.lng) ||
        (cdl1 && cdl2)
    );
}

function containsLng(bounds: LatLngBounds, lng: number): boolean {
    if (bounds.sw.lng <= bounds.ne.lng) {
        return lng >= bounds.sw.lng && lng <= bounds.ne.lng;
    }
    return lng >= bounds.sw.lng || lng <= bounds.ne.lng;
}
export function fromClass(object: google.maps.LatLngBounds): LatLngBounds {
    const sw = object.getSouthWest();
    const ne = object.getNorthEast();
    return fromSwNeLatLng(sw.lat(), sw.lng(), ne.lat(), ne.lng());
}
