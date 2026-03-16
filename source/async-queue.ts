export interface AsyncQueue<T> {
    push(item: T): void;
    close(): void;
}
interface CreateAsyncQueueOptions {
    batchSize?: number;
    delayMilliseconds?: number;
}
export function createAsyncQueue<T>(
    consume: (items: T[]) => Promise<void>,
    handleAsyncError: (reason: unknown) => void,
    { batchSize = 10, delayMilliseconds = 1000 }: CreateAsyncQueueOptions = {},
): AsyncQueue<T> {
    const queue: T[] = [];

    let processing = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    function push(item: T) {
        queue.push(item);
        if (timeoutId !== null) clearTimeout(timeoutId);
        schedule();
    }
    function schedule() {
        if (processing) return;

        timeoutId = setTimeout(() => {
            timeoutId = null;
            void flush().catch(handleAsyncError);
        }, delayMilliseconds);
    }

    async function flush() {
        if (processing || queue.length === 0) return;

        processing = true;
        const batch = queue.splice(0, batchSize);

        try {
            await consume(batch);
        } finally {
            processing = false;

            if (queue.length > 0) schedule();
        }
    }
    function close() {
        if (timeoutId !== null) {
            clearTimeout(timeoutId);
            timeoutId = null;
        }
        queue.length = 0;
    }
    return { push, close };
}
