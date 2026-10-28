const TARGET_PATH = "/api/v1/vault/mapview/gcs";

function normalizeUrl(url: string | URL) {
    try {
        return new URL(url, location.origin);
    } catch {
        return null;
    }
}

export function injectGcsListener(
    listener: (url: URL, responseJsonText: string) => void,
) {
    const targetWindow =
        typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
    const origFetch = targetWindow.fetch;
    type FetchInput = Parameters<typeof fetch>[0];

    targetWindow.fetch = async function (
        input: FetchInput,
        init?: RequestInit,
    ): Promise<Response> {
        const request = input instanceof Request ? input : null;
        const url = request ? request.url : input.toString();
        const method = (init?.method ?? request?.method ?? "GET").toUpperCase();

        const urlObj = normalizeUrl(url);
        const isTarget = method === "GET" && urlObj?.pathname === TARGET_PATH;

        const response = await origFetch.call(this, input, init);

        if (isTarget) {
            try {
                const ct = response.headers.get("content-type") || "";
                if (!ct.includes("application/json")) {
                    return response;
                }

                const responseJsonText = await response.clone().text();
                listener(urlObj, responseJsonText);
            } catch (e) {
                console.warn("[GCS LOGGER] Parse failed", e);
            }
        }

        return response;
    };
}
