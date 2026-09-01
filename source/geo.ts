import type { LatLng } from "./s2";

export interface Geo {
    getLatLng(): Promise<LatLng>;
}

export function createGeoForBrowser(): Geo {
    return {
        getLatLng() {
            return new Promise<LatLng>((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(
                    (position) => {
                        resolve({
                            lat: position.coords.latitude,
                            lng: position.coords.longitude,
                        });
                    },
                    reject,
                    {
                        enableHighAccuracy: true,
                        timeout: 5000,
                        maximumAge: 0,
                    },
                );
            });
        },
    };
}
