import { ignore } from "./standard-extensions";

export function debugWorkerForMainThread(
    workerApi: {
        sendDebugLockId(name: string): Promise<void>;
    },
    name: string,
) {
    const lockId = "worker_lock_" + Math.random();

    void (async () => {
        await workerApi.sendDebugLockId(lockId);
        await navigator.locks.request(lockId, async () => {
            alert(`Worker '${name}' が意図せず終了しました`);
        });
    })();
}

export function createDebugWorkerThreadApi() {
    return {
        sendDebugLockId(id: string) {
            void navigator.locks.request(id, () => {
                return new Promise(ignore);
            });
        },
    };
}
