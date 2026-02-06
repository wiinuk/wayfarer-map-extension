export type Decrement<T extends number> = T extends 0
    ? 0
    : _BuildTuple<T> extends [unknown, ...infer Rest]
      ? Rest["length"]
      : never;

export type Increment<T extends number> = As<
    [unknown, ..._BuildTuple<T>]["length"],
    number
>;

type As<T, K> = T extends K ? T : K;

/**
 * 長さ L のタプルを生成する内部用ヘルパー型
 */
type _BuildTuple<
    L extends number,
    T extends unknown[] = [],
> = T["length"] extends L ? T : _BuildTuple<L, [...T, unknown]>;
