import { raise } from "../standard-extensions";

export type Effective<T> = Generator<unknown, T, unknown>;

// eslint-disable-next-line require-yield
export function* done<T>(x: T): Effective<T> {
    return x;
}

class EffectiveRequest {}
class AwaitPromiseRequest extends EffectiveRequest {
    constructor(readonly promise: Promise<unknown>) {
        super();
    }
}

export function* awaitPromise<T>(promise: Promise<T>): Effective<T> {
    return (yield new AwaitPromiseRequest(promise)) as T;
}

const privateGetAbortSignalSymbol = Symbol("privateGetAbortSignal");
export function* getCancel() {
    return (yield privateGetAbortSignalSymbol) as AbortSignal;
}

export async function forceAsPromise<T>(g: Effective<T>, signal: AbortSignal) {
    let nextInput = undefined;
    let nextResult;
    for (; (nextResult = g.next(nextInput)), !nextResult.done; ) {
        const nextOutput = nextResult.value;
        if (nextOutput === privateGetAbortSignalSymbol) {
            nextInput = signal;
            continue;
        }
        if (nextOutput instanceof AwaitPromiseRequest) {
            nextInput = await nextOutput.promise;
            continue;
        }
        return raise`unknown effect: ${nextOutput}`;
    }
    return nextResult.value;
}
