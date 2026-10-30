declare const __DEBUG_BUILD__: boolean;

declare module "*?worker" {
    const workerConstructor: {
        new (): Worker;
    };
    export default workerConstructor;
}
