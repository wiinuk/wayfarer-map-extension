// 要素が出現するまで待機するユーティリティ
export function awaitElement<T>(get: () => T): Promise<NonNullable<T>> {
    return new Promise((resolve) => {
        let currentInterval = 100;
        const maxInterval = 500;
        const queryLoop = () => {
            const ref = get();
            if (ref) return resolve(ref);
            setTimeout(
                queryLoop,
                Math.min((currentInterval *= 2), maxInterval),
            );
        };
        queryLoop();
    });
}

export function raise(
    templateStringsArray: TemplateStringsArray,
    ...substitutions: unknown[]
): never {
    throw new Error(String.raw(templateStringsArray, ...substitutions));
}
