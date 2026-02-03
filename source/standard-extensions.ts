export type Id<T> = (x: T) => T;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type UnwrapId<TId extends Id<any>> = TId extends Id<infer T> ? T : never;

export function id<T>(value: T): T {
    return value;
}
export function ignore(..._: unknown[]): void {
    // do nothing
}
export type UnwrapPromise<T> = T extends Promise<infer U> ? U : T;

const privateTagSymbol = Symbol("privateTagSymbol");
export type Tagged<TEntity, TTag> = TEntity & {
    readonly [privateTagSymbol]: TTag;
};
export function withTag<E, M>(value: E) {
    return value as unknown as Tagged<E, M>;
}

// 要素が出現するまで待機するユーティリティ
export async function awaitElement<T>(
    get: () => T,
    options?: { signal?: AbortSignal },
): Promise<NonNullable<T>> {
    let currentInterval = 100;
    const maxInterval = 500;
    while (true) {
        const ref = get();
        if (ref) return ref;
        await sleep(Math.min((currentInterval *= 2), maxInterval), options);
    }
}
export function sleep(
    ms: number,
    options?: { signal?: AbortSignal },
): Promise<void> {
    return new Promise((resolve, reject) => {
        const handle = setTimeout(() => {
            cleanup();
            resolve();
        }, ms);
        function onAbort() {
            cleanup();
            reject(newAbortError());
        }
        function cleanup() {
            clearTimeout(handle);
            options?.signal?.removeEventListener("abort", onAbort);
        }
        options?.signal?.addEventListener("abort", onAbort);
    });
}

export function raise(
    templateStringsArray: TemplateStringsArray,
    ...substitutions: unknown[]
): never {
    throw new Error(String.raw(templateStringsArray, ...substitutions));
}

class AbortError extends Error {
    override name = "AbortError";
    constructor(message: string) {
        super(message);
    }
}
export function newAbortError(message = "The operation was aborted.") {
    if (typeof DOMException === "function") {
        return new DOMException(message, "AbortError");
    } else {
        return new AbortError(message);
    }
}

function cancelToReject<T>(promise: Promise<T>, onCancel: () => T): Promise<T>;
function cancelToReject(promise: Promise<void>): Promise<void>;
function cancelToReject<T>(promise: Promise<T>, onCancel: () => void = ignore) {
    return promise.catch((e) => {
        if (e instanceof Error && e.name === "AbortError") {
            return onCancel();
        }
        throw e;
    });
}
export function createAsyncCancelScope(
    asyncErrorHandler: (reason: unknown) => void,
): (cancelableProcess: (signal: AbortSignal) => Promise<void>) => void {
    let lastCancel: AbortController | undefined;

    return (process) => {
        lastCancel?.abort(newAbortError());
        lastCancel = new AbortController();
        cancelToReject(process(lastCancel.signal)).catch(asyncErrorHandler);
    };
}
