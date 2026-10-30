import {
    evaluateExpression,
    type Value,
} from "../sal/evaluator";
import { done, forceAsPromise, type Effective } from "../sal/effective";

const externalUrlMarker = "sal-external-url";

interface ExternalUrlDefinition extends Record<string, Value> {
    readonly marker: typeof externalUrlMarker;
    readonly label: string;
    readonly buildUrl: (data: Value) => Effective<Value>;
}

export interface ExternalUrlData extends Record<string, Value> {
    readonly lat: number;
    readonly lng: number;
    readonly title: string;
    readonly description: string;
    readonly statement: string;
}

export interface ExternalUrlOption {
    readonly label: string;
    readonly url: string;
}

function isValueRecord(
    value: Value,
): value is { readonly [key: string]: Value } {
    return (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value)
    );
}

function isExternalUrlDefinition(value: Value): value is ExternalUrlDefinition {
    return (
        isValueRecord(value) &&
        value["marker"] === externalUrlMarker &&
        typeof value["label"] === "string" &&
        typeof value["buildUrl"] === "function"
    );
}

function getDefinitions(value: Value): readonly ExternalUrlDefinition[] {
    if (isExternalUrlDefinition(value)) return [value];
    if (Array.isArray(value)) {
        return value.flatMap((item) => getDefinitions(item));
    }
    throw new Error("External URL settings must be defined with open");
}

function binary(
    operation: (left: Value, right: Value) => Value,
): Value {
    return (left) => done((right) => done(operation(left, right)));
}

function createSalExternalUrlGlobals() {
    const globals = new Map<string, Value>();
    globals.set("fromVoid", () => done(null));
    globals.set("fromMissing", () => done(null));
    globals.set("fromString", (value) => done(value));
    globals.set("fromWord", (value) => done(value));
    globals.set("fromNumber", (value) => done(value));

    globals.set(
        "_seq_",
        binary((left, right) => `${left ?? ""}${right ?? ""}`),
    );
    globals.set(
        "_and_",
        binary((left, right) => [
            ...getDefinitions(left),
            ...getDefinitions(right),
        ]),
    );
    globals.set(
        "open",
        (label) =>
            done((buildUrl) => {
                if (typeof label !== "string") {
                    throw new Error("open expects a string label");
                }
                if (typeof buildUrl !== "function") {
                    throw new Error("open expects a URL-generating function");
                }
                const definition: ExternalUrlDefinition = {
                    marker: externalUrlMarker,
                    label,
                    buildUrl,
                };
                return done(definition);
            }),
    );
    globals.set(
        "get",
        (record) =>
            done((key) => {
                if (
                    !isValueRecord(record) ||
                    typeof key !== "string"
                ) {
                    throw new Error("get expects a record and a string key");
                }
                const value = record[key];
                if (value === undefined) {
                    throw new Error(`Unknown record field: ${key}`);
                }
                return done(value);
            }),
    );
    globals.set(
        "pipe",
        (value) =>
            done((operation) => {
                if (typeof operation !== "function") {
                    throw new Error("pipe expects a function");
                }
                return operation(value);
            }),
    );
    globals.set("json-stringify", (value) => {
        const result = JSON.stringify(value);
        return done(result);
    });
    globals.set("encode-url-component", (value) => {
        if (typeof value !== "string") {
            throw new Error("encode-url-component expects a string");
        }
        return done(encodeURIComponent(value));
    });
    return globals;
}

export async function evaluateExternalUrls(
    source: string,
    data: ExternalUrlData,
    signal: AbortSignal,
): Promise<readonly ExternalUrlOption[]> {
    if (source.trim() === "") return [];

    const globals = createSalExternalUrlGlobals();
    const value = await forceAsPromise(
        evaluateExpression(source, (name) => globals.get(name)),
        signal,
    );
    const definitions = getDefinitions(value);
    const payload: Value = data;
    const options: ExternalUrlOption[] = [];

    for (const definition of definitions) {
        const url = await forceAsPromise(
            definition.buildUrl(payload),
            signal,
        );
        if (typeof url !== "string") {
            throw new Error(
                `URL generator "${definition.label}" must return a string`,
            );
        }
        options.push({ label: definition.label, url });
    }
    return options;
}
