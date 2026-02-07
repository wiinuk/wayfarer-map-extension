import type { Flatten, Tagged } from "./standard-extensions";

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

export type EventDefinitionKind = readonly Tagged<string, unknown>[];

type UnwrapTag<TTag extends Tagged<unknown, unknown>> =
    TTag extends Tagged<infer t, infer _> ? t : never;

export type DefinitionToTypes<Def extends EventDefinitionKind> = {
    [i in keyof Def]: UnwrapTag<Def[i]>;
};

export type DefinitionToMap<
    Def extends EventDefinitionKind,
    TMap = Record<never, never>,
> = Def extends readonly [
    Tagged<infer type extends string, infer detail>,
    ...infer def extends EventDefinitionKind,
]
    ? DefinitionToMap<def, TMap & { readonly [k in type]: detail }>
    : Flatten<TMap>;
