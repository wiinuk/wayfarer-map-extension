
export function injectGcsListener(listener: (queries: Record<string, string>, response: string) => void) {
    const TARGET_PATH = "/api/v1/vault/mapview/gcs";

    function normalizeUrl(url: string | URL) {
        try {
            return new URL(url, location.origin);
        } catch {
            return null;
        }
    }

    function parseQueryFromUrl(urlObj: URL) {

        const q: Record<string, string> = {};
        urlObj.searchParams.forEach((v, k) => {
            q[k] = v;
        });
        return q;
    }

    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;

    const isTargetSymbol = Symbol("_isTarget");
    const urlObjSymbol = Symbol("_urlObj");
    type XHRWithSymbols = XMLHttpRequest & { [isTargetSymbol]?: boolean, [urlObjSymbol]?: URL | null }
    XMLHttpRequest.prototype.open = function (this: XHRWithSymbols, method, url, ...rest: [boolean]) {
        const urlObj = normalizeUrl(url);

        this[isTargetSymbol] =
            method === "GET" &&
            urlObj?.pathname === TARGET_PATH;

        this[urlObjSymbol] = urlObj;

        return origOpen.call(this, method, url, ...rest);
    } as typeof XMLHttpRequest.prototype.open;

    XMLHttpRequest.prototype.send = function (this: XHRWithSymbols, ...args) {
        if (this[isTargetSymbol]) {
            this.addEventListener("load", function (this: XHRWithSymbols) {
                try {
                    const ct = this.getResponseHeader("content-type") || "";
                    if (!ct.includes("application/json")) return;

                    const queries = parseQueryFromUrl(this[urlObjSymbol]!);
                    listener(queries, this.responseText);
                } catch (e) {
                    console.warn("[GCS LOGGER] Parse failed", e);
                }
            });
        }

        return origSend.apply(this, args);
    }
}