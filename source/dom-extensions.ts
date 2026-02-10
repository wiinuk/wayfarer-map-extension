import { isWebWorker } from "./environments";

export function addNavigateListener(onHistoryChanged: () => void) {
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function (...args) {
        const result = originalPushState.apply(this, args);
        onHistoryChanged();
        return result;
    };
    history.replaceState = function (...args) {
        const result = originalReplaceState.apply(this, args);
        onHistoryChanged();
        return result;
    };
    window.addEventListener("popstate", onHistoryChanged);
    onHistoryChanged();
}

export interface Scheduler {
    readonly isYieldRequested: boolean;
    yield(): Promise<void> | null;
}

function createSchedulerByAnimationFrame(
    signal: AbortSignal,
    thresholdMs: number,
): Scheduler {
    let startTime = performance.now();
    let lastHandle: number | null = null;

    signal.addEventListener(
        "abort",
        () => {
            if (lastHandle != null) {
                cancelAnimationFrame(lastHandle);
                lastHandle = null;
            }
        },
        { once: true },
    );

    return {
        get isYieldRequested() {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if ((navigator as any).scheduling?.isInputPending?.()) {
                return true;
            }
            const now = performance.now();
            return now - startTime >= thresholdMs;
        },

        yield() {
            if (!this.isYieldRequested) return null;

            return new Promise((resolve) => {
                lastHandle = requestAnimationFrame(() => {
                    // yield したら、次のスライスのために開始時間をリセット
                    startTime = performance.now();
                    resolve();
                });
            });
        },
    };
}

function createWorkerScheduler(): Scheduler {
    return {
        isYieldRequested: false,
        yield() {
            return null;
        },
    };
}

export function createScheduler(signal: AbortSignal, thresholdMs = 10) {
    if (isWebWorker()) return createWorkerScheduler();
    return createSchedulerByAnimationFrame(signal, thresholdMs);
}
