
export interface AsyncQueue<T> {
    push(item: T): void;
    close(): void;
}
interface CreateAsyncQueueOptions {
    batchSize?: number;
}
export function createAsyncQueue<T>(consume: (items: T[]) => Promise<void>, handleAsyncError: (reason: unknown) => void, { batchSize = 10 }: CreateAsyncQueueOptions = {}): AsyncQueue<T> {
    const queue: T[] = [];

    let processing = false;
    let scheduled = false;

    function push(item: T) {
        queue.push(item);
        schedule();
    }
    function schedule() {
        if (scheduled) return;
        scheduled = true;

        queueMicrotask(() => {
            scheduled = false;
            void flush().catch(handleAsyncError);
        });
    }

    async function flush() {
        if (processing) return;
        if (queue.length === 0) return;

        processing = true;
        const batch = queue.splice(0, batchSize);

        try {
            await consume(batch);
        } catch {
            // 失敗時は戻す
            queue.unshift(...batch);
        } finally {
            processing = false;

            // まだあれば次のtickで続き
            if (queue.length) {
                schedule();
            }
        }
    }
    function close() {
        queue.length = 0;
    }
    return { push, close }
}
