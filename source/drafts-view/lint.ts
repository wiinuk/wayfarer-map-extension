import {
    createStandardGlobals,
    evaluateExpression,
    type Value,
} from "../sal/evaluator";
import { done, forceAsPromise } from "../sal/effective";
import LintRegexWorker from "./lint-regex.worker.ts?worker";

export type LintLocation = "title" | "description" | "note";
export type LintSeverity = "error" | "warning";

export interface LintInput {
    readonly fields: Readonly<Partial<Record<LintLocation, string>>>;
}

export interface LintMatch {
    readonly from: number;
    readonly to: number;
    readonly text: string;
    readonly captures: Readonly<Record<string, string>>;
}

export interface LintTextEdit {
    readonly location: LintLocation;
    readonly from: number;
    readonly to: number;
    readonly insert: string;
}

export interface LintSuggestion {
    readonly label: string;
    readonly edits: readonly LintTextEdit[];
}

export interface LintDiagnostic {
    readonly location: LintLocation;
    readonly from: number;
    readonly to: number;
    readonly message: string;
    readonly severity: LintSeverity;
    readonly fix?: readonly LintTextEdit[];
    readonly suggestions?: readonly LintSuggestion[];
}

const matcherTag = Symbol("lint-matcher");
const ruleTag = Symbol("lint-rule");
const maxPatternLength = 2048;
const maxTextLength = 100_000;
const maxMatches = 1000;
const regexExecutionTimeoutMs = 250;

export type LintRegexRunner = (
    pattern: string,
    text: string,
    signal: AbortSignal,
) => Promise<readonly LintMatch[]>;

interface RegexRequest {
    readonly id: number;
    readonly pattern: string;
    readonly text: string;
}

interface RegexResponse {
    readonly id: number;
    readonly matches?: readonly LintMatch[];
    readonly error?: string;
}

function createRegexRunner(signal: AbortSignal): {
    readonly run: LintRegexRunner;
    readonly dispose: () => void;
} {
    const worker = new LintRegexWorker();
    const pending = new Map<
        number,
        {
            readonly resolve: (matches: readonly LintMatch[]) => void;
            readonly reject: (reason: unknown) => void;
            readonly timeout: ReturnType<typeof setTimeout>;
        }
    >();
    let nextId = 0;
    let terminated = false;

    function terminate(reason: unknown) {
        if (terminated) return;
        terminated = true;
        worker.terminate();
        for (const request of pending.values()) {
            clearTimeout(request.timeout);
            request.reject(reason);
        }
        pending.clear();
    }

    worker.addEventListener(
        "message",
        ({ data }: MessageEvent<RegexResponse>) => {
            const request = pending.get(data.id);
            if (!request) return;
            pending.delete(data.id);
            clearTimeout(request.timeout);
            if (data.error != null) {
                request.reject(new Error(data.error));
            } else if (data.matches != null) {
                request.resolve(data.matches);
            } else {
                request.reject(
                    new Error("Lint worker returned an invalid response"),
                );
            }
        },
    );
    worker.addEventListener("error", (event) => {
        terminate(event.error ?? new Error(event.message));
    });
    const onAbort = () => terminate(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();

    return {
        run(pattern, text, requestSignal) {
            if (requestSignal.aborted) {
                return Promise.reject(requestSignal.reason);
            }
            if (terminated) {
                return Promise.reject(new Error("Lint worker is unavailable"));
            }
            const id = nextId++;
            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    terminate(
                        new Error(
                            `Lint regular expression exceeded the ${regexExecutionTimeoutMs}ms execution limit`,
                        ),
                    );
                }, regexExecutionTimeoutMs);
                pending.set(id, { resolve, reject, timeout });
                try {
                    worker.postMessage({
                        id,
                        pattern,
                        text,
                    } satisfies RegexRequest);
                } catch (reason) {
                    clearTimeout(timeout);
                    pending.delete(id);
                    reject(reason);
                }
            });
        },
        dispose() {
            signal.removeEventListener("abort", onAbort);
            terminate(new Error("Lint worker disposed"));
        },
    };
}

interface Matcher {
    readonly [matcherTag]: true;
    readonly hasNamedCaptures: boolean;
    match(text: string, signal: AbortSignal): Promise<readonly LintMatch[]>;
}

interface Rule {
    readonly [ruleTag]: true;
    readonly children?: readonly Rule[];
    readonly locations?: ReadonlySet<LintLocation>;
    readonly severity?: LintSeverity;
    readonly message?: string;
    readonly matcher?: Matcher;
    readonly fix?: string;
    readonly suggestionProvider?: Value;
}

function asValue(value: unknown): Value {
    return value as Value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value != null && typeof value === "object" && !Array.isArray(value);
}

function requireString(value: Value, name: string): string {
    if (typeof value !== "string") {
        throw new Error(`${name} must be a string`);
    }
    return value;
}

function requireMatcher(value: Value): Matcher {
    if (value != null && typeof value === "object" && matcherTag in value) {
        return value as unknown as Matcher;
    }
    throw new Error("Expected a Lint Matcher");
}

function requireRule(value: Value): Rule {
    if (value != null && typeof value === "object" && ruleTag in value) {
        return value as unknown as Rule;
    }
    throw new Error("Expected a Lint Rule");
}

function createMatcher(
    match: (
        text: string,
        signal: AbortSignal,
    ) => Promise<readonly LintMatch[]> | readonly LintMatch[],
    hasNamedCaptures = false,
): Matcher {
    return {
        [matcherTag]: true,
        hasNamedCaptures,
        async match(text, signal) {
            if (text.length > maxTextLength) {
                throw new Error(
                    `Lint input exceeds the ${maxTextLength} character limit`,
                );
            }
            const matches = await match(text, signal);
            if (matches.length > maxMatches) {
                throw new Error(
                    `Lint matcher exceeds the ${maxMatches} match limit`,
                );
            }
            return matches;
        },
    };
}

function containsNamedCaptureGroup(pattern: string): boolean {
    let inCharacterClass = false;
    for (let index = 0; index < pattern.length; index++) {
        const char = pattern[index];
        if (char === "\\") {
            index++;
            continue;
        }
        if (char === "[") {
            inCharacterClass = true;
            continue;
        }
        if (char === "]" && inCharacterClass) {
            inCharacterClass = false;
            continue;
        }
        if (
            !inCharacterClass &&
            char === "(" &&
            pattern[index + 1] === "?" &&
            pattern[index + 2] === "<" &&
            pattern[index + 3] !== "=" &&
            pattern[index + 3] !== "!"
        ) {
            return true;
        }
    }
    return false;
}

function createRule(
    matcher: Matcher,
    message: string,
    options: {
        readonly locations?: ReadonlySet<LintLocation>;
        readonly severity?: LintSeverity;
        readonly fix?: string;
        readonly suggestionProvider?: Value;
    } = {},
): Rule {
    return {
        [ruleTag]: true,
        matcher,
        message,
        severity: options.severity,
        locations: options.locations,
        fix: options.fix,
        suggestionProvider: options.suggestionProvider,
    };
}

function cloneRule(
    rule: Rule,
    update: Partial<
        Pick<Rule, "locations" | "severity" | "fix" | "suggestionProvider">
    >,
): Rule {
    return { ...rule, ...update };
}

function matchesForPattern(source: string, runRegex: LintRegexRunner): Matcher {
    if (source.length > maxPatternLength) {
        throw new Error(
            `Lint pattern exceeds the ${maxPatternLength} character limit`,
        );
    }
    new RegExp(source, "gmu");
    return createMatcher(
        (text, signal) => runRegex(source, text, signal),
        containsNamedCaptureGroup(source),
    );
}

function matchesMissingSuffix(suffix: string): Matcher {
    if (suffix === "") {
        throw new Error("missing-suffix requires a non-empty suffix");
    }
    return createMatcher((text) => {
        const matches: LintMatch[] = [];
        let lineStart = 0;
        for (let index = 0; index <= text.length; index++) {
            const char = text[index];
            if (char !== "\r" && char !== "\n" && index !== text.length) {
                continue;
            }
            const line = text.slice(lineStart, index);
            if (line.length > 0 && !line.endsWith(suffix)) {
                matches.push({
                    from: index,
                    to: index,
                    text: "",
                    captures: {},
                });
            }
            if (char === "\r" && text[index + 1] === "\n") index++;
            lineStart = index + 1;
        }
        return matches;
    });
}

function captureKeys(match: LintMatch): string[] {
    const entries = Object.entries(match.captures);
    if (entries.length === 0) {
        throw new Error(
            "unmatched and duplicates require named captures in every match",
        );
    }
    return entries.map(([name, value]) => JSON.stringify([name, value]));
}

function requireCaptureMatcher(matcher: Matcher) {
    if (!matcher.hasNamedCaptures) {
        throw new Error(
            "unmatched and duplicates require a named capture in every Matcher",
        );
    }
}

function allLocations(): ReadonlySet<LintLocation> {
    return new Set(["title", "description", "note"]);
}

function createSalFunction(
    callback: (value: Value) => Value | ((value: Value) => Value),
): Value {
    return (value) => done(asValue(callback(value)));
}

function createSalBinary(
    callback: (left: Value, right: Value) => Value,
): Value {
    return (left) =>
        done((right: Value) => done(asValue(callback(left, right))));
}

function createSalGlobals(runRegex: LintRegexRunner) {
    const globals = createStandardGlobals();
    const additions: Record<string, Value> = {
        fromString: (value) => done(value),
        fromWord: (value) => done(value),
        pattern: createSalFunction((source) =>
            asValue(
                matchesForPattern(requireString(source, "pattern"), runRegex),
            ),
        ),
        "missing-suffix": createSalFunction((suffix) =>
            asValue(
                matchesMissingSuffix(requireString(suffix, "missing-suffix")),
            ),
        ),
        both: createSalBinary((left, right) => {
            const first = requireMatcher(left);
            const second = requireMatcher(right);
            return asValue(
                createMatcher(async (text, signal) => {
                    const firstMatches = await first.match(text, signal);
                    const secondMatches = await second.match(text, signal);
                    return firstMatches.length > 0 && secondMatches.length > 0
                        ? [...firstMatches, ...secondMatches]
                        : [];
                }, first.hasNamedCaptures && second.hasNamedCaptures),
            );
        }),
        unmatched: createSalBinary((left, right) => {
            const first = requireMatcher(left);
            const second = requireMatcher(right);
            requireCaptureMatcher(first);
            requireCaptureMatcher(second);
            return asValue(
                createMatcher(async (text, signal) => {
                    const rightKeys = new Set(
                        (await second.match(text, signal)).flatMap(captureKeys),
                    );
                    return (await first.match(text, signal)).filter((match) =>
                        captureKeys(match).some((key) => !rightKeys.has(key)),
                    );
                }, true),
            );
        }),
        duplicates: createSalFunction((value) => {
            const matcher = requireMatcher(value);
            requireCaptureMatcher(matcher);
            return asValue(
                createMatcher(async (text, signal) => {
                    const seen = new Set<string>();
                    const duplicates: LintMatch[] = [];
                    for (const match of await matcher.match(text, signal)) {
                        const keys = captureKeys(match);
                        if (keys.some((key) => seen.has(key))) {
                            duplicates.push(match);
                        }
                        for (const key of keys) seen.add(key);
                    }
                    return duplicates;
                }, true),
            );
        }),
    };
    additions["_and_"] = createSalBinary((left, right) => {
        const first = requireRule(left);
        const second = requireRule(right);
        return asValue({
            [ruleTag]: true,
            children: [first, second],
        } satisfies Rule);
    });

    additions["report"] = createSalBinary((matcherValue, messageValue) => {
        return asValue(
            createRule(
                requireMatcher(matcherValue),
                requireString(messageValue, "/report message"),
            ),
        );
    });
    additions["fix"] = createSalBinary((ruleValue, fixValue) =>
        asValue(
            cloneRule(requireRule(ruleValue), {
                fix: requireString(fixValue, "/fix"),
            }),
        ),
    );
    additions["in"] = createSalBinary((ruleValue, locationValue) => {
        const rule = requireRule(ruleValue);
        const location = requireString(locationValue, "/in location");
        if (!isLocation(location)) {
            throw new Error(`Unknown Lint location: ${location}`);
        }
        return asValue(
            cloneRule(rule, {
                locations: new Set([...(rule.locations ?? []), location]),
            }),
        );
    });
    additions["severity"] = createSalBinary((ruleValue, severityValue) => {
        const severity = requireString(severityValue, "/severity");
        if (severity !== "error" && severity !== "warning") {
            throw new Error(`Unknown Lint severity: ${severity}`);
        }
        return asValue(cloneRule(requireRule(ruleValue), { severity }));
    });
    additions["suggest"] = createSalBinary((ruleValue, provider) => {
        if (typeof provider !== "function") {
            throw new Error("/suggest requires a suggestion provider function");
        }
        return asValue(
            cloneRule(requireRule(ruleValue), {
                suggestionProvider: provider,
            }),
        );
    });

    for (const [name, value] of Object.entries(additions)) {
        globals.set(name, value);
    }
    return (name: string) => globals.get(name);
}

function isLocation(value: string): value is LintLocation {
    return value === "title" || value === "description" || value === "note";
}

function runRule(
    rule: Rule,
    input: LintInput,
    signal: AbortSignal,
): Promise<readonly LintDiagnostic[]> {
    return runRuleAsync(rule, input, signal);
}

async function runRuleAsync(
    rule: Rule,
    input: LintInput,
    signal: AbortSignal,
): Promise<readonly LintDiagnostic[]> {
    let diagnostics: readonly LintDiagnostic[];
    if (rule.children != null) {
        diagnostics = (
            await Promise.all(
                rule.children.map((child) =>
                    runRuleAsync(child, input, signal),
                ),
            )
        ).flat();
    } else {
        const matcher = rule.matcher;
        if (matcher == null || rule.message == null) {
            throw new Error("Invalid Lint Rule");
        }
        const found: LintDiagnostic[] = [];
        for (const location of allLocations()) {
            const text = input.fields[location];
            if (
                text === undefined ||
                (rule.locations != null && !rule.locations.has(location))
            ) {
                continue;
            }
            for (const match of await matcher.match(text, signal)) {
                found.push({
                    location,
                    from: match.from,
                    to: match.to,
                    message: rule.message,
                    severity: rule.severity ?? "error",
                });
            }
        }
        diagnostics = found;
    }

    const filtered = diagnostics.filter(
        (diagnostic) =>
            rule.locations == null || rule.locations.has(diagnostic.location),
    );
    const result: LintDiagnostic[] = [];
    for (const diagnostic of filtered) {
        const severity = rule.severity ?? diagnostic.severity;
        const fix =
            rule.fix === undefined
                ? diagnostic.fix
                : [
                      {
                          location: diagnostic.location,
                          from: diagnostic.from,
                          to: diagnostic.to,
                          insert: rule.fix,
                      },
                  ];
        let suggestions = diagnostic.suggestions;
        if (rule.suggestionProvider !== undefined) {
            suggestions = await getSuggestions(
                rule.suggestionProvider,
                input,
                { ...diagnostic, severity, fix: undefined },
                signal,
            );
        }
        result.push({
            ...diagnostic,
            severity,
            fix,
            suggestions,
        });
    }
    return result;
}

async function getSuggestions(
    provider: Value,
    input: LintInput,
    diagnostic: Omit<LintDiagnostic, "suggestions">,
    signal: AbortSignal,
): Promise<readonly LintSuggestion[]> {
    const inputValue = asValue({
        fields: Object.fromEntries(
            Object.entries(input.fields).filter(
                (entry): entry is [string, string] =>
                    typeof entry[1] === "string",
            ),
        ),
    });
    const diagnosticValue = asValue(diagnostic);
    if (typeof provider !== "function") {
        throw new Error("/suggest requires a suggestion provider function");
    }
    const next = await forceAsPromise(provider(inputValue), signal);
    if (typeof next !== "function") {
        throw new Error("/suggest provider must accept a diagnostic");
    }
    const value = await forceAsPromise(next(diagnosticValue), signal);
    if (!Array.isArray(value)) {
        throw new Error("/suggest provider must return a list");
    }
    return value.map(parseSuggestion);
}

function parseSuggestion(value: Value): LintSuggestion {
    if (!isRecord(value)) {
        throw new Error("Suggestion must be a record");
    }
    const label = value["label"];
    const edits = value["edits"];
    if (
        typeof label !== "string" ||
        label.trim() === "" ||
        !Array.isArray(edits) ||
        edits.length === 0
    ) {
        throw new Error("Suggestion requires a label and edits list");
    }
    return {
        label,
        edits: edits.map(parseEdit),
    };
}

function parseEdit(value: Value): LintTextEdit {
    if (!isRecord(value)) {
        throw new Error("Text edit must be a record");
    }
    const { location, from, to, insert } = value;
    if (
        typeof location !== "string" ||
        !isLocation(location) ||
        typeof from !== "number" ||
        typeof to !== "number" ||
        typeof insert !== "string"
    ) {
        throw new Error("Text edit has invalid fields");
    }
    return { location, from, to, insert };
}

export async function evaluateLint(
    source: string,
    input: LintInput,
    signal: AbortSignal,
    regexRunner?: LintRegexRunner,
): Promise<readonly LintDiagnostic[]> {
    const worker = regexRunner == null ? createRegexRunner(signal) : undefined;
    try {
        const runRegex = regexRunner ?? worker?.run;
        if (runRegex == null) {
            throw new Error("Lint regular expression runner is unavailable");
        }
        const syntaxErrors: string[] = [];
        const expression = evaluateExpression(
            source,
            createSalGlobals(runRegex),
            (message) => syntaxErrors.push(message),
        );
        if (syntaxErrors.length > 0) {
            throw new Error(
                `Invalid Sal Lint configuration: ${syntaxErrors.join("; ")}`,
            );
        }
        const value = await forceAsPromise(expression, signal);
        const rule = requireRule(value);
        return await runRule(rule, input, signal);
    } finally {
        worker?.dispose();
    }
}
