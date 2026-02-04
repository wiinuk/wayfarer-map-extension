export interface TypedCustomEvent<TType, TDetail> extends Omit<
    CustomEvent<TDetail>,
    "type"
> {
    readonly type: TType;
}
export interface TypedEventTarget<TEventMap> {
    addEventListener<TType extends keyof TEventMap>(
        type: TType,
        listener: (event: TypedCustomEvent<TType, TEventMap[TType]>) => void,
        options?: AddEventListenerOptions | boolean,
    ): void;
    dispatchEvent<TType extends keyof TEventMap>(
        event: TypedCustomEvent<TType, TEventMap[TType]>,
    ): boolean;
    removeEventListener<TType extends keyof TEventMap>(
        type: TType,
        listener: (event: TypedCustomEvent<TType, TEventMap[TType]>) => void,
        options?: EventListenerOptions | boolean,
    ): void;
}
export function createTypedEventTarget<TEventMap>() {
    return new EventTarget() as TypedEventTarget<TEventMap>;
}
export function createTypedCustomEvent<TType extends string, TDetail>(
    type: TType,
    detail: TDetail,
) {
    return new CustomEvent(type, { detail }) as TypedCustomEvent<
        TType,
        TDetail
    >;
}
