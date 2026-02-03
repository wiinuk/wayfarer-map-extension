import { ignore, newAbortError, withTag, type Id, type Tagged, type UnwrapId } from "./standard-extensions";

export interface IndexSchemaKind {
    readonly key: string | readonly string[];
    readonly unique?: boolean;
    readonly multiEntry?: boolean;
}

type error<_TMessage extends string> = never;
type unreachable = error<"unreachable">;
type cast<T, K> = T extends K ? T : never;
type As<T, K> = T extends K ? T : K;

export interface StoreSchemaKind {
    /** record type */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    readonly recordType: Id<any>;
    readonly key: string | readonly string[];
    /** index name to key paths */
    readonly indexes: Readonly<Record<string, IndexSchemaKind>>;
}
export type DatabaseSchemaKind = Readonly<Record<string, StoreSchemaKind>>;
export type Database<TSchema extends DatabaseSchemaKind> = Tagged<
    IDBDatabase,
    TSchema
>;

function defineDatabase<TSchema extends DatabaseSchemaKind>(
    database: IDBDatabase,
    schema: TSchema
) {
    for (const [storeName, storeSchema] of Object.entries(schema)) {
        const store = database.createObjectStore(storeName, {
            keyPath: storeSchema.key.slice(),
        });
        for (const [indexName, options] of Object.entries(
            storeSchema.indexes
        )) {
            store.createIndex(indexName, options.key, options);
        }
    }
}

export function openDatabase<TSchema extends DatabaseSchemaKind>(
    databaseName: string,
    databaseVersion: number | undefined,
    databaseSchema: TSchema
) {
    return new Promise<Database<TSchema>>((resolve, reject) => {
        const request = window.indexedDB.open(databaseName, databaseVersion);
        request.addEventListener("upgradeneeded", () =>
            defineDatabase(request.result, databaseSchema)
        );
        request.addEventListener("blocked", () =>
            reject(new Error("database blocked"))
        );
        request.addEventListener("error", () => reject(request.error));
        request.addEventListener("success", () =>
            resolve(withTag(request.result))
        );
    });
}
export function closeDatabase<TSchema extends DatabaseSchemaKind>(
    database: Database<TSchema>
) {
    database.close();
}

export type IterationFlow = "continue" | "break" | undefined;
export interface IterateValuesRequest {
    readonly source: IDBObjectStore | IDBIndex;
    readonly query: IDBValidKey | IDBKeyRange | null | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    readonly action: (value: any) => IterationFlow;
}
interface TransactionalOperations {
    request(value: IDBRequest): unknown;
    iterateValues(value: IterateValuesRequest): void;
}
export type TransactionScope<R> = Generator<
    Parameters<TransactionalOperations[keyof TransactionalOperations]>[0],
    R,
    ReturnType<TransactionalOperations[keyof TransactionalOperations]>
>;

export type Store<
    TSchema extends DatabaseSchemaKind,
    TStoreName extends keyof TSchema & string
> = Tagged<IDBObjectStore, [TSchema, TStoreName]>;

export type Stores<
    TSchema extends DatabaseSchemaKind,
    TStoreNames extends readonly (keyof TSchema & string)[]
> = {
        [p in TStoreNames[number]]: Store<TSchema, As<p, keyof TSchema & string>>;
    };

export function enterTransactionScope<
    TSchema extends DatabaseSchemaKind,
    TStoreNames extends readonly (keyof TSchema & string)[],
    TResult
>(
    database: Database<TSchema>,
    {
        mode,
        signal,
    }: {
        mode: IDBTransactionMode;
        signal?: AbortSignal;
    },
    scope: (
        stores: Readonly<Stores<TSchema, TStoreNames>>
    ) => TransactionScope<TResult>,
    ...storeNames: TStoreNames
): Promise<TResult> {
    return new Promise<TResult>((resolve, reject) => {
        if (signal?.aborted) {
            reject(newAbortError());
            return;
        }

        let hasResult = false;
        let result: TResult;

        const transaction = database.transaction(storeNames, mode);

        const onAbort = signal
            ? () => {
                if (!hasResult) {
                    transaction.abort();
                }
            }
            : ignore;
        transaction.addEventListener("complete", () => {
            signal?.removeEventListener("abort", onAbort);
            if (hasResult) {
                resolve(result);
            } else {
                reject(new Error(`internal error`));
            }
        });
        transaction.addEventListener("error", (e) => {
            signal?.removeEventListener("abort", onAbort);
            reject((e.target as IDBRequest).error);
        });
        signal?.addEventListener("abort", onAbort);

        const stores: Partial<Stores<TSchema, TStoreNames>> = {};
        for (const name of storeNames) {
            stores[name] = withTag(transaction.objectStore(name));
        }

        const iterator = scope(
            stores as Readonly<Stores<TSchema, TStoreNames>>
        );

        type ResolvingStateKind = "Request" | "OpenCursor";
        let stateKind: ResolvingStateKind | undefined;
        let request_request: IDBRequest | undefined;
        let openCursor_request:
            | IDBRequest<IDBCursorWithValue | null>
            | undefined;
        let openCursor_action: IterateValuesRequest["action"] | undefined;
        function onResolved() {
            let r;
            switch (stateKind) {
                case undefined:
                    r = iterator.next();
                    break;
                case "Request": {

                    const result = request_request!.result;
                    stateKind = undefined;
                    request_request = undefined;
                    r = iterator.next(result);
                    break;
                }
                case "OpenCursor": {

                    const cursor = openCursor_request!.result;
                    if (
                        cursor === null ||

                        openCursor_action!(cursor.value) === "break"
                    ) {
                        stateKind = undefined;
                        openCursor_request = undefined;
                        openCursor_action = undefined;
                        r = iterator.next(undefined);
                    } else {
                        cursor.continue();
                        return;
                    }
                    break;
                }
                default: {
                    reject(new Error(`Invalid resolving kind: ${stateKind}`));
                    return;
                }
            }
            if (r.done) {
                hasResult = true;
                result = r.value;
                return;
            }
            const yieldValue = r.value;
            if (yieldValue instanceof IDBRequest) {
                stateKind = "Request";
                request_request = yieldValue;
                yieldValue.onsuccess = onResolved;
                return;
            }
            stateKind = "OpenCursor";
            openCursor_request = yieldValue.source.openCursor(yieldValue.query);
            openCursor_action = yieldValue.action;
            openCursor_request.onsuccess = onResolved;
        }
        onResolved();
    });
}
export type Index<
    TSchema extends DatabaseSchemaKind,
    TStoreName extends keyof TSchema & string,
    TIndexName extends keyof TSchema[TStoreName]["indexes"] & string
> = Tagged<IDBIndex, [TSchema, TStoreName, TIndexName]>;
export function getIndex<
    TSchema extends DatabaseSchemaKind,
    TStoreName extends keyof TSchema & string,
    TIndexName extends keyof TSchema[TStoreName]["indexes"] & string
>(
    store: Store<TSchema, TStoreName>,
    indexName: TIndexName
): Index<TSchema, TStoreName, TIndexName> {
    return withTag(store.index(indexName));
}

type unwrapMultiEntry<key> = key extends readonly (infer e)[]
    ? cast<e, IDBValidKey>
    : cast<key, IDBValidKey>;

type resolveRecordKey<
    propertyName extends string,
    multiEntry extends boolean,
    recordType
> = propertyName extends keyof recordType
    ? multiEntry extends true
    ? unwrapMultiEntry<recordType[propertyName]>
    : cast<recordType[propertyName], IDBValidKey>
    : error<`property "${propertyName}" does not exist in record type`>;

type resolveRecordKeyArray<
    propertyNames extends readonly string[],
    recordType
> = {
        -readonly [i in keyof propertyNames]: resolveRecordKey<
            propertyNames[i],
            false,
            recordType
        >;
    };
type resolveRecordKeyType<
    keys extends string | readonly string[],
    multiEntry extends boolean,
    recordType
> = keys extends string
    ? resolveRecordKey<keys, multiEntry, recordType>
    : (keys extends readonly string[]
        ? (multiEntry extends true
            ? error<"multiEntry indexes cannot have array keys">
            : resolveRecordKeyArray<keys, recordType>)
        : unreachable);

export type StoreKey<
    TSchema extends DatabaseSchemaKind,
    TStoreName extends keyof TSchema & string
> = resolveRecordKeyType<
    TSchema[TStoreName]["key"],
    false,
    UnwrapId<TSchema[TStoreName]["recordType"]>
>;
export type IndexKey<
    schema extends DatabaseSchemaKind,
    storeName extends keyof schema & string,
    indexName extends keyof schema[storeName]["indexes"] & string
> = resolveRecordKeyType<
    schema[storeName]["indexes"][indexName]["key"],
    schema[storeName]["indexes"][indexName]["multiEntry"] extends true ? true : false,
    UnwrapId<schema[storeName]["recordType"]>
>;

export type AllValue = null;

export function* getValue<
    TSchema extends DatabaseSchemaKind,
    TStoreName extends keyof TSchema & string
>(
    store: Store<TSchema, TStoreName>,
    query:
        | StoreKey<TSchema, TStoreName>
        | KeyRange<StoreKey<TSchema, TStoreName>>
) {
    return (yield store.get(query)) as
        | UnwrapId<TSchema[TStoreName]["recordType"]>
        | undefined;
}
export function* getValueOfIndex<
    TSchema extends DatabaseSchemaKind,
    TStoreName extends keyof TSchema & string,
    TIndexName extends keyof TSchema[TStoreName]["indexes"] & string
>(
    index: Index<TSchema, TStoreName, TIndexName>,
    query:
        | IndexKey<TSchema, TStoreName, TIndexName>
        | KeyRange<IndexKey<TSchema, TStoreName, TIndexName>>
): TransactionScope<UnwrapId<TSchema[TStoreName]["recordType"]> | undefined> {
    return (yield index.get(query)) as
        | UnwrapId<TSchema[TStoreName]["recordType"]>
        | undefined;
}
export function* putValue<
    TSchema extends DatabaseSchemaKind,
    TStoreName extends keyof TSchema & string
>(
    store: Store<TSchema, TStoreName>,
    value: UnwrapId<TSchema[TStoreName]["recordType"]>
): TransactionScope<UnwrapId<TSchema[TStoreName]["recordType"]>> {
    yield store.put(value);
    return value;
}
export function* deleteValue<
    TSchema extends DatabaseSchemaKind,
    TStoreName extends keyof TSchema & string
>(
    store: Store<TSchema, TStoreName>,
    query:
        | StoreKey<TSchema, TStoreName>
        | KeyRange<StoreKey<TSchema, TStoreName>>
): TransactionScope<void> {
    yield store.delete(query);
}

export function* iterateValues<
    TSchema extends DatabaseSchemaKind,
    TStoreName extends keyof TSchema & string
>(
    store: Store<TSchema, TStoreName>,
    query:
        | StoreKey<TSchema, TStoreName>
        | KeyRange<StoreKey<TSchema, TStoreName>>
        | AllValue
        | undefined,
    action: (
        value: UnwrapId<TSchema[TStoreName]["recordType"]>
    ) => IterationFlow
): TransactionScope<void> {
    yield { source: store, query, action };
    return;
}
export function* iterateValuesOfIndex<
    TSchema extends DatabaseSchemaKind,
    TStoreName extends keyof TSchema & string,
    TIndexName extends keyof TSchema[TStoreName]["indexes"] & string
>(
    index: Index<TSchema, TStoreName, TIndexName>,
    query:
        | IndexKey<TSchema, TStoreName, TIndexName>
        | KeyRange<IndexKey<TSchema, TStoreName, TIndexName>>
        | AllValue
        | undefined,
    action: (
        value: UnwrapId<TSchema[TStoreName]["recordType"]>
    ) => IterationFlow
): TransactionScope<void> {
    yield { source: index, query, action };
    return;
}

export type KeyRange<K> = Tagged<IDBKeyRange, K>;
export function createBound<K extends IDBValidKey>(
    lower: K,
    upper: K,
    lowerOpen?: boolean,
    upperOpen?: boolean
) {
    return IDBKeyRange.bound(lower, upper, lowerOpen, upperOpen) as KeyRange<K>;
}
export function createUpperBound<K extends IDBValidKey>(
    upper: K,
    open?: boolean
) {
    return IDBKeyRange.upperBound(upper, open) as KeyRange<K>;
}
export function createLowerBound<K extends IDBValidKey>(
    lower: K,
    open?: boolean
) {
    return IDBKeyRange.lowerBound(lower, open) as KeyRange<K>;
}
