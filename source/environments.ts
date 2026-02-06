export function isWebWorker() {
    return typeof window === "undefined" && typeof self !== "undefined";
}
