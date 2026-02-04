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
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;

    const isTargetSymbol = Symbol("_isTarget");
    const urlObjSymbol = Symbol("_urlObj");
    type XHRWithSymbols = XMLHttpRequest & {
        [isTargetSymbol]?: boolean;
        [urlObjSymbol]?: URL | null;
    };
    XMLHttpRequest.prototype.open = function (
        this: XHRWithSymbols,
        method,
        url,
        ...rest: [boolean]
    ) {
        const urlObj = normalizeUrl(url);

        this[isTargetSymbol] =
            method === "GET" && urlObj?.pathname === TARGET_PATH;

        this[urlObjSymbol] = urlObj;

        return origOpen.call(this, method, url, ...rest);
    } as typeof XMLHttpRequest.prototype.open;

    XMLHttpRequest.prototype.send = function (this: XHRWithSymbols, ...args) {
        if (this[isTargetSymbol]) {
            this.addEventListener("load", function (this: XHRWithSymbols) {
                try {
                    const ct = this.getResponseHeader("content-type") || "";
                    if (!ct.includes("application/json")) return;

                    listener(this[urlObjSymbol]!, this.responseText);
                } catch (e) {
                    console.warn("[GCS LOGGER] Parse failed", e);
                }
            });
        }

        return origSend.apply(this, args);
    };
}
