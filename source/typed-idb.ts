import {
    ignore,
    newAbortError,
    withTag,
    type Id,
    type Tagged,
    type UnwrapId,
} from "./standard-extensions";

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
    schema: TSchema,
) {
    for (const [storeName, storeSchema] of Object.entries(schema)) {
        const store = database.createObjectStore(storeName, {
            keyPath: storeSchema.key.slice(),
        });
        for (const [indexName, options] of Object.entries(
            storeSchema.indexes,
        )) {
            store.createIndex(indexName, options.key, options);
        }
    }
}

export function openDatabase<TSchema extends DatabaseSchemaKind>(
    databaseName: string,
    databaseVersion: number | undefined,
    databaseSchema: TSchema,
) {
    return new Promise<Database<TSchema>>((resolve, reject) => {
        const request = window.indexedDB.open(databaseName, databaseVersion);
        request.addEventListener("upgradeneeded", () =>
            defineDatabase(request.result, databaseSchema),
        );
        request.addEventListener("blocked", () =>
            reject(new Error("database blocked")),
        );
        request.addEventListener("error", () => reject(request.error));
        request.addEventListener("success", () =>
            resolve(withTag(request.result)),
        );
    });
}
export function closeDatabase<TSchema extends DatabaseSchemaKind>(
    database: Database<TSchema>,
) {
    database.close();
}

export type IterationFlow = "continue" | "break" | undefined;
class IterateValuesRequest {
    constructor(
        readonly source: IDBObjectStore | IDBIndex,
        readonly query: IDBValidKey | IDBKeyRange | null | undefined,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        readonly action: (value: any) => IterationFlow,
    ) {}
}
interface TransactionalOperations {
    request(value: IDBRequest): unknown;
    requests(value: readonly IDBRequest[]): unknown[];
    iterateValues(value: IterateValuesRequest): void;
}
export type TransactionScope<R> = Generator<
    Parameters<TransactionalOperations[keyof TransactionalOperations]>[0],
    R,
    ReturnType<TransactionalOperations[keyof TransactionalOperations]>
>;

export type Store<
    TSchema extends DatabaseSchemaKind,
    TStoreName extends keyof TSchema & string,
> = Tagged<IDBObjectStore, [TSchema, TStoreName]>;

export type Stores<
    TSchema extends DatabaseSchemaKind,
    TStoreNames extends readonly (keyof TSchema & string)[],
> = {
    [p in TStoreNames[number]]: Store<TSchema, As<p, keyof TSchema & string>>;
};

export function enterTransactionScope<
    TSchema extends DatabaseSchemaKind,
    TStoreNames extends readonly (keyof TSchema & string)[],
    TResult,
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
        stores: Readonly<Stores<TSchema, TStoreNames>>,
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
            stores as Readonly<Stores<TSchema, TStoreNames>>,
        );

        type ResolvingStateKind = "Request" | "WaitRequests" | "OpenCursor";
        let stateKind: ResolvingStateKind | undefined;
        let request_request: IDBRequest | undefined;
        let waitRequests_results: unknown[] | undefined;
        let waitRequests_requests: readonly IDBRequest[] | undefined;
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
                case "WaitRequests": {
                    const results = waitRequests_results!;
                    const requests = waitRequests_requests!;
                    const result = requests[results.length]!.result;
                    results.push(result);
                    if (results.length !== requests.length) return;

                    stateKind = undefined;
                    waitRequests_requests = undefined;
                    waitRequests_results = undefined;
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
            if (yieldValue instanceof IterateValuesRequest) {
                stateKind = "OpenCursor";
                openCursor_request = yieldValue.source.openCursor(
                    yieldValue.query,
                );
                openCursor_action = yieldValue.action;
                openCursor_request.onsuccess = onResolved;
                return;
            }

            stateKind = "WaitRequests";
            waitRequests_requests = yieldValue;
            waitRequests_results = [];
            for (const request of yieldValue) {
                request.onsuccess = onResolved;
            }
            return;
        }
        onResolved();
    });
}
export type Index<
    TSchema extends DatabaseSchemaKind,
    TStoreName extends keyof TSchema & string,
    TIndexName extends keyof TSchema[TStoreName]["indexes"] & string,
> = Tagged<IDBIndex, [TSchema, TStoreName, TIndexName]>;
export function getIndex<
    TSchema extends DatabaseSchemaKind,
    TStoreName extends keyof TSchema & string,
    TIndexName extends keyof TSchema[TStoreName]["indexes"] & string,
>(
    store: Store<TSchema, TStoreName>,
    indexName: TIndexName,
): Index<TSchema, TStoreName, TIndexName> {
    return withTag(store.index(indexName));
}

type unwrapMultiEntry<key> = key extends readonly (infer e)[]
    ? cast<e, IDBValidKey>
    : cast<key, IDBValidKey>;

type resolveRecordKey<
    propertyName extends string,
    multiEntry extends boolean,
    recordType,
> = propertyName extends keyof recordType
    ? multiEntry extends true
        ? unwrapMultiEntry<recordType[propertyName]>
        : cast<recordType[propertyName], IDBValidKey>
    : error<`property "${propertyName}" does not exist in record type`>;

type resolveRecordKeyArray<
    propertyNames extends readonly string[],
    recordType,
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
    recordType,
> = keys extends string
    ? resolveRecordKey<keys, multiEntry, recordType>
    : keys extends readonly string[]
      ? multiEntry extends true
          ? error<"multiEntry indexes cannot have array keys">
          : resolveRecordKeyArray<keys, recordType>
      : unreachable;

type RecordType<
    TSchema extends DatabaseSchemaKind,
    TStoreName extends keyof TSchema & string,
> = UnwrapId<TSchema[TStoreName]["recordType"]>;

export type StoreKey<
    TSchema extends DatabaseSchemaKind,
    TStoreName extends keyof TSchema & string,
> = resolveRecordKeyType<
    TSchema[TStoreName]["key"],
    false,
    RecordType<TSchema, TStoreName>
>;
export type IndexKey<
    schema extends DatabaseSchemaKind,
    storeName extends keyof schema & string,
    indexName extends keyof schema[storeName]["indexes"] & string,
> = resolveRecordKeyType<
    schema[storeName]["indexes"][indexName]["key"],
    schema[storeName]["indexes"][indexName]["multiEntry"] extends true
        ? true
        : false,
    RecordType<schema, storeName>
>;

export type AllValue = null | undefined;
type Query<
    TSchema extends DatabaseSchemaKind,
    TStoreName extends keyof TSchema & string,
> = StoreKey<TSchema, TStoreName> | KeyRange<StoreKey<TSchema, TStoreName>>;

type IndexQuery<
    TSchema extends DatabaseSchemaKind,
    TStoreName extends keyof TSchema & string,
    TIndexName extends keyof TSchema[TStoreName]["indexes"] & string,
> =
    | IndexKey<TSchema, TStoreName, TIndexName>
    | KeyRange<IndexKey<TSchema, TStoreName, TIndexName>>;

type GetResult<
    TSchema extends DatabaseSchemaKind,
    TStoreName extends keyof TSchema & string,
> = RecordType<TSchema, TStoreName> | undefined;

export function* getValue<
    TSchema extends DatabaseSchemaKind,
    TStoreName extends keyof TSchema & string,
>(store: Store<TSchema, TStoreName>, query: Query<TSchema, TStoreName>) {
    return (yield store.get(query)) as GetResult<TSchema, TStoreName>;
}
export function* getAll<
    TSchema extends DatabaseSchemaKind,
    TStoreName extends keyof TSchema & string,
>(
    store: Store<TSchema, TStoreName>,
    query: Query<TSchema, TStoreName> | AllValue,
    count?: number,
): TransactionScope<RecordType<TSchema, TStoreName>[]> {
    return (yield store.getAll(query, count)) as RecordType<
        TSchema,
        TStoreName
    >[];
}

function getRequests(
    source: IDBObjectStore | IDBIndex,
    queries: Iterable<IDBValidKey | IDBKeyRange>,
) {
    const requests = [];
    for (const query of queries) {
        requests.push(source.get(query));
    }
    return requests;
}
export function* bulkGet<
    TSchema extends DatabaseSchemaKind,
    TStoreName extends keyof TSchema & string,
>(
    store: Store<TSchema, TStoreName>,
    queries: Iterable<Query<TSchema, TStoreName>>,
) {
    const requests = getRequests(store, queries);
    if (requests.length === 0) return [];
    return (yield requests) as GetResult<TSchema, TStoreName>[];
}
export function* getValueOfIndex<
    TSchema extends DatabaseSchemaKind,
    TStoreName extends keyof TSchema & string,
    TIndexName extends keyof TSchema[TStoreName]["indexes"] & string,
>(
    index: Index<TSchema, TStoreName, TIndexName>,
    query: IndexQuery<TSchema, TStoreName, TIndexName>,
) {
    return (yield index.get(query)) as GetResult<TSchema, TStoreName>;
}
export function* getAllOfIndex<
    TSchema extends DatabaseSchemaKind,
    TStoreName extends keyof TSchema & string,
    TIndexName extends keyof TSchema[TStoreName]["indexes"] & string,
>(
    index: Index<TSchema, TStoreName, TIndexName>,
    query: Query<TSchema, TStoreName> | AllValue,
    count?: number,
): TransactionScope<RecordType<TSchema, TStoreName>[]> {
    return (yield index.getAll(query, count)) as RecordType<
        TSchema,
        TStoreName
    >[];
}
export function* bulkGetOfIndex<
    TSchema extends DatabaseSchemaKind,
    TStoreName extends keyof TSchema & string,
    TIndexName extends keyof TSchema[TStoreName]["indexes"] & string,
>(
    index: Index<TSchema, TStoreName, TIndexName>,
    queries: Iterable<IndexQuery<TSchema, TStoreName, TIndexName>>,
): TransactionScope<GetResult<TSchema, TStoreName>[]> {
    const requests = getRequests(index, queries);
    if (requests.length === 0) return [];
    return (yield requests) as GetResult<TSchema, TStoreName>[];
}
export function* putValue<
    TSchema extends DatabaseSchemaKind,
    TStoreName extends keyof TSchema & string,
>(
    store: Store<TSchema, TStoreName>,
    value: RecordType<TSchema, TStoreName>,
): TransactionScope<RecordType<TSchema, TStoreName>> {
    yield store.put(value);
    return value;
}
export function* bulkPut<
    TSchema extends DatabaseSchemaKind,
    TStoreName extends keyof TSchema & string,
>(
    store: Store<TSchema, TStoreName>,
    values: Iterable<RecordType<TSchema, TStoreName>>,
): TransactionScope<void> {
    let lastRequest;
    for (const value of values) {
        lastRequest = store.put(value);
    }
    if (lastRequest != null) {
        yield lastRequest;
    }
}
export function* deleteValue<
    TSchema extends DatabaseSchemaKind,
    TStoreName extends keyof TSchema & string,
>(
    store: Store<TSchema, TStoreName>,
    query: Query<TSchema, TStoreName>,
): TransactionScope<void> {
    yield store.delete(query);
}
export function* bulkDelete<
    TSchema extends DatabaseSchemaKind,
    TStoreName extends keyof TSchema & string,
>(
    store: Store<TSchema, TStoreName>,
    queries: Iterable<Query<TSchema, TStoreName>>,
): TransactionScope<void> {
    let lastRequest;
    for (const query of queries) {
        lastRequest = store.delete(query);
    }
    if (lastRequest != null) {
        yield lastRequest;
    }
}

export function* iterateValues<
    TSchema extends DatabaseSchemaKind,
    TStoreName extends keyof TSchema & string,
>(
    store: Store<TSchema, TStoreName, ReadableModes>,
    query: Query<TSchema, TStoreName> | AllValue,
    action: (value: RecordType<TSchema, TStoreName>) => IterationFlow,
): TransactionScope<void> {
    yield new IterateValuesRequest(store, query, action);
    return;
}
export function* iterateValuesOfIndex<
    TSchema extends DatabaseSchemaKind,
    TStoreName extends keyof TSchema & string,
    TIndexName extends keyof TSchema[TStoreName]["indexes"] & string,
>(
    index: Index<TSchema, TStoreName, TIndexName>,
    query: IndexQuery<TSchema, TStoreName, TIndexName> | AllValue,
    action: (value: RecordType<TSchema, TStoreName>) => IterationFlow,
): TransactionScope<void> {
    yield new IterateValuesRequest(index, query, action);
    return;
}

export type KeyRange<K> = Tagged<IDBKeyRange, K>;
export function createBound<K extends IDBValidKey>(
    lower: K,
    upper: K,
    lowerOpen?: boolean,
    upperOpen?: boolean,
) {
    return IDBKeyRange.bound(lower, upper, lowerOpen, upperOpen) as KeyRange<K>;
}
export function createUpperBound<K extends IDBValidKey>(
    upper: K,
    open?: boolean,
) {
    return IDBKeyRange.upperBound(upper, open) as KeyRange<K>;
}
export function createLowerBound<K extends IDBValidKey>(
    lower: K,
    open?: boolean,
) {
    return IDBKeyRange.lowerBound(lower, open) as KeyRange<K>;
}
