// spell-checker: ignore drivetunnel
import type { z } from "gas-drivetunnel/source/json-schema";
import {
    type GetApiSchema,
    interfaces,
    jsonResponseSchema,
    type ErrorResponse,
    type Route,
} from "gas-drivetunnel/source/schemas";
import { newAbortError } from "./standard-extensions";
import type { LatLng } from "./s2";

interface FetchJsonpOptions {
    data?: Record<string, unknown>;
    jsonp?: string;
    signal?: AbortSignal;
}
export async function fetchJsonp(
    url: string,
    options: FetchJsonpOptions = {},
): Promise<unknown> {
    const { data, jsonp = "callback", signal } = options;

    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(newAbortError());
            return;
        }

        const script = document.createElement("script");

        const callbackName = `__fetchJsonp_cb_${Date.now()}_${Math.random()
            .toString(36)
            .slice(2)}`;

        let finished = false;

        const cleanup = () => {
            if (finished) return;
            finished = true;

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            delete (window as any)[callbackName];
            script.remove();

            signal?.removeEventListener("abort", onAbort);
        };

        const onAbort = () => {
            cleanup();
            reject(newAbortError());
        };

        signal?.addEventListener("abort", onAbort);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any)[callbackName] = (data: unknown) => {
            cleanup();
            resolve(data);
        };

        const u = new URL(url, window.location.href);
        if (data) {
            for (const [key, value] of Object.entries(data)) {
                if (value == null) continue;
                u.searchParams.append(key, String(value));
            }
        }
        u.searchParams.append(jsonp, callbackName);

        script.onerror = () => {
            cleanup();
            reject(new Error("JSONP request failed"));
        };

        script.src = u.toString();
        script.async = true;

        document.head.appendChild(script);
    });
}

class RemoteError extends Error {
    constructor(public readonly response: ErrorResponse) {
        super();
    }
    override get name() {
        return "RemoteError";
    }
}

interface RemoteOptions {
    signal?: AbortSignal;
    rootUrl: string;
}
async function fetchGet<T extends GetApiSchema>(
    schema: T,
    parameters: z.infer<T["parameter"]>,
    options: RemoteOptions,
): Promise<z.infer<T["result"]>> {
    const rootUrl = options.rootUrl;
    const method = "GET";
    const url = `${rootUrl}/${schema.path}`;

    console.debug(
        `-> ${JSON.stringify([method, url, JSON.stringify(parameters)])}`,
    );
    const responseData = await fetchJsonp(url, {
        jsonp: "jsonp-callback",
        data: parameters,
        signal: options.signal,
    });

    console.debug(`<- ${JSON.stringify([method, url, responseData])}`);

    const result = jsonResponseSchema.parse(responseData);
    const { type } = result;
    switch (type) {
        case "success": {
            return schema.result.parse(result.value);
        }
        case "error": {
            throw new RemoteError(result);
        }
        default: {
            throw new Error(`unknown response type: ${type satisfies never}`);
        }
    }
}

export interface Draft extends Omit<
    Route,
    "coordinates" | "routeId" | "routeName"
> {
    coordinates: [LatLng, ...LatLng[]];
    id: string;
    name: string;
}

export async function getRoutes(
    parameter: z.infer<typeof interfaces.getRoutes.parameter>,
    options: RemoteOptions,
) {
    return await fetchGet(interfaces.getRoutes, parameter, options);
}
export async function setRoute(
    parameter: z.infer<typeof interfaces.setRoute.parameter>,
    options: RemoteOptions,
) {
    return await fetchGet(interfaces.setRoute, parameter, options);
}
export async function deleteRoute(
    parameter: z.infer<typeof interfaces.deleteRoute.parameter>,
    options: RemoteOptions,
) {
    return await fetchGet(interfaces.deleteRoute, parameter, options);
}
export async function clearRoutes(
    parameter: z.infer<typeof interfaces.clearRoutes.parameter>,
    options: RemoteOptions,
) {
    return await fetchGet(interfaces.clearRoutes, parameter, options);
}
