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
export type Reference<T> = { contents: T };

const privateTagSymbol = Symbol("privateTagSymbol");
export type Tagged<TEntity, TTag> = TEntity & {
    readonly [privateTagSymbol]: TTag;
};
export function withTag<E, M>(value: E) {
    return value as unknown as Tagged<E, M>;
}

export type Flatten<T> = {
    [K in keyof T]: T[K];
} & {};

// 要素が出現するまで待機するユーティリティ
export async function awaitElement<T>(
    get: () => T,
    options?: { signal?: AbortSignal },
): Promise<NonNullable<T>> {
    let currentInterval = 100;
    const maxInterval = 500;
    for (;;) {
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
        const signal = options?.signal;
        if (signal?.aborted) return reject(signal.reason);

        const handle = setTimeout(() => {
            cleanup();
            resolve();
        }, ms);
        function onAbort() {
            cleanup();
            // イベントリスナーのコールバック内で同期的に reject すると
            // Zone.js が「未ハンドルの拒否」と誤認するため、マイクロタスクに逃がす
            queueMicrotask(() =>
                reject(signal == null ? newAbortError() : signal.reason),
            );
        }
        function cleanup() {
            clearTimeout(handle);
            signal?.removeEventListener("abort", onAbort);
        }
        signal?.addEventListener("abort", onAbort);
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

function isAbortError(e: unknown) {
    return (
        e != null &&
        typeof e === "object" &&
        "name" in e &&
        e.name === "AbortError"
    );
}
export function createAsyncCancelScope(
    onError: (reason: unknown) => void,
): (task: (signal: AbortSignal) => Promise<void>) => void {
    let activeController: AbortController | undefined;

    return (process) => {
        activeController?.abort(newAbortError());
        activeController = new AbortController();
        process(activeController.signal).catch((e) => {
            if (isAbortError(e)) return;
            onError(e);
        });
    };
}

export function cached<T>(f: () => T) {
    let hasValue = false;
    let value: T;
    return () => {
        if (!hasValue) {
            hasValue = true;
            value = f();
        }
        return value;
    };
}
export function memoize<T extends null | boolean | string | symbol, R>(
    f: (x: T) => R,
) {
    const memo = new Map<T, R>();
    return (x: T) => {
        let r = memo.get(x);
        if (r === undefined) {
            r = f(x);
            memo.set(x, r);
        }
        return r;
    };
}

export function memoizeWith<
    TArgs extends unknown[],
    K extends null | boolean | string | symbol,
    R,
>(getKey: (...x: TArgs) => K, f: (k: K, ...args: TArgs) => R) {
    const memo = new Map<K, R>();
    return (...x: TArgs) => {
        const k = getKey(...x);
        let r = memo.get(k);
        if (r === undefined) {
            r = f(k, ...x);
            memo.set(k, r);
        }
        return r;
    };
}
