// spell-checker: ignore drivetunnel
import type { z } from "gas-drivetunnel/source/json-schema";
import {
    type GetApiSchema,
    interfaces,
    jsonResponseSchema,
    type ErrorResponse,
} from "gas-drivetunnel/source/schemas";

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
    options: RemoteOptions
): Promise<z.infer<T["result"]>> {
    const rootUrl = options.rootUrl;
    const method = parameters.method;
    const url = `${rootUrl}/${schema.path}`;

    console.debug(
        `-> ${JSON.stringify([method, url, JSON.stringify(parameters)])}`
    );
    const response = await fetch(url, {
        method: "GET",
        credentials: "omit",
        signal: options.signal,
    })
    const responseData: unknown = await response.json()

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

export async function getRoutes(
    parameter: z.infer<typeof interfaces.getRoutes.parameter>,
    options: RemoteOptions
) {
    return await fetchGet(interfaces.getRoutes, parameter, options);
}
export async function setRoute(
    parameter: z.infer<typeof interfaces.setRoute.parameter>,
    options: RemoteOptions
) {
    return await fetchGet(interfaces.setRoute, parameter, options);
}
export async function deleteRoute(
    parameter: z.infer<typeof interfaces.deleteRoute.parameter>,
    options: RemoteOptions
) {
    return await fetchGet(interfaces.deleteRoute, parameter, options);
}
export async function clearRoutes(
    parameter: z.infer<typeof interfaces.clearRoutes.parameter>,
    options: RemoteOptions
) {
    return await fetchGet(interfaces.clearRoutes, parameter, options);
}
