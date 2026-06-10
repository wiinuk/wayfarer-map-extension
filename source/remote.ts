// spell-checker: ignore drivetunnel
import type { z } from "gas-drivetunnel/source/json-schema";
import {
    type GetApiSchema,
    interfaces,
    jsonResponseSchema,
    type ErrorResponse,
    type Route,
} from "gas-drivetunnel/source/schemas";
import { newAbortError, sleep } from "./standard-extensions";
import type { LatLng } from "./s2";
import { createAsyncQueue } from "./async-queue";
import {
    createTypedCustomEvent,
    createTypedEventTarget,
    type TypedEventTarget,
} from "./typed-event-target";

interface FetchJsonpOptions {
    data?: Record<string, unknown>;
    jsonp?: string;
    signal?: AbortSignal;
}
async function fetchJsonp(
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
        if (data) appendSearchParams(u, data);
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

function appendSearchParams(url: URL, data: Readonly<Record<string, unknown>>) {
    for (const [key, value] of Object.entries(data)) {
        if (value == null) continue;
        url.searchParams.append(key, String(value));
    }
}

async function fetchGM(
    url: string | URL,
    data: Readonly<Record<string, unknown>>,
    options?: RemoteOptions,
): Promise<unknown> {
    const signal = options?.signal;
    signal?.throwIfAborted();

    url = new URL(url, window.location.href);
    appendSearchParams(url, data);

    const requestPromise = GM.xmlHttpRequest({
        url,
        method: "GET",
        responseType: "json",
    });

    const onAbort = () => requestPromise.abort();
    signal?.addEventListener("abort", onAbort);

    try {
        const response = await requestPromise;
        if (response.status < 200 || response.status >= 300) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return response.response;
    } catch (error) {
        signal?.throwIfAborted();
        throw error;
    } finally {
        signal?.removeEventListener("abort", onAbort);
    }
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

    let responseData;
    if (typeof GM !== "undefined" && typeof GM.xmlHttpRequest !== "undefined") {
        responseData = await fetchGM(url, parameters, options);
    } else {
        responseData = await fetchJsonp(url, {
            jsonp: "jsonp-callback",
            data: parameters,
            signal: options.signal,
        });
    }

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

export async function getDrafts(
    parameter: z.infer<typeof interfaces.getRoutes.parameter>,
    options: RemoteOptions,
) {
    return await fetchGet(interfaces.getRoutes, parameter, options);
}
type SetParameter = z.infer<typeof interfaces.setRoute.parameter>;
type DeleteParameter = z.infer<typeof interfaces.deleteRoute.parameter>;

export interface RemoteEventMap {
    "fetch-ready": undefined;
    "fetch-done": undefined;
}
export interface Remote {
    events: TypedEventTarget<RemoteEventMap>;
    set(parameter: SetParameter, rootUrl: string): void;
    delete(parameter: DeleteParameter, rootUrl: string): void;
}
export function createRemote(
    handleAsyncError: (reason: unknown) => void,
    intervalMs: number,
): Remote {
    const events = createTypedEventTarget<RemoteEventMap>();
    type Command =
        | {
              type: "set";
              parameter: SetParameter;
              rootUrl: string;
          }
        | {
              type: "delete";
              parameter: DeleteParameter;
              rootUrl: string;
          };

    const queue = createAsyncQueue<Command>(
        async (commands) => {
            const map = new Map<string, Command>();
            for (const command of commands) {
                const id = command.parameter["route-id"];
                map.set(id, command);
            }
            try {
                for (const command of map.values()) {
                    const { type, parameter, rootUrl } = command;
                    switch (type) {
                        case "set":
                            await fetchGet(interfaces.setRoute, parameter, {
                                rootUrl,
                            });
                            break;
                        case "delete":
                            await fetchGet(interfaces.deleteRoute, parameter, {
                                rootUrl,
                            });
                            break;
                    }
                    await sleep(intervalMs);
                }
            } finally {
                events.dispatchEvent(
                    createTypedCustomEvent("fetch-done", undefined),
                );
            }
        },
        handleAsyncError,
        { batchSize: 100, delayMilliseconds: intervalMs },
    );
    return {
        events,
        set(parameter, rootUrl) {
            events.dispatchEvent(
                createTypedCustomEvent("fetch-ready", undefined),
            );
            queue.push({ type: "set", parameter, rootUrl });
        },
        delete(parameter, rootUrl) {
            events.dispatchEvent(
                createTypedCustomEvent("fetch-ready", undefined),
            );
            queue.push({ type: "delete", parameter, rootUrl });
        },
    };
}
