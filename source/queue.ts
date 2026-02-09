export function createQueue<T>(initialCapacity = 1024) {
    const buf = new Array<T>(initialCapacity);
    const mask = initialCapacity - 1;
    let head = 0;
    let tail = 0;

    return {
        enqueue(x: T) {
            buf[tail & mask] = x;
            tail++;
        },
        dequeue() {
            if (head === tail) return undefined;
            const x = buf[head & mask];
            head++;
            return x;
        },
    };
}
