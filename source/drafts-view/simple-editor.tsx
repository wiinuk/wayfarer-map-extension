/* eslint-disable require-yield */
// spell: words Keymap
import {
    createStandardGlobals,
    evaluateExpression,
    type Value,
} from "../sal/evaluator";
import {
    EditorView,
    keymap,
    Decoration,
    ViewPlugin,
    type ViewUpdate,
    type DecorationSet,
} from "@codemirror/view";
import {
    RangeSetBuilder,
    EditorState,
    type Extension,
    RangeSet,
} from "@codemirror/state";
import { defaultKeymap, history, indentWithTab } from "@codemirror/commands";
import type { LatLng } from "../s2";
import { parseCoordinates } from "../geometry";
import classNames from "./draft-list.module.css";
import { done, forceAsPromise, type Effective } from "../sal/effective";
import { createAsyncCancelScope, raise } from "../standard-extensions";
import {
    bindAction,
    mergeRule,
    pattern,
    withLocation,
    type ActionRule,
    type Action,
    type ActionLocation,
    type ActionCommand,
    createCopyCommand,
} from "./simple-editor-actions";

function openUrlAction(text: string): Effective<ActionCommand> {
    return done({
        type: "open-link",
        url: text,
    });
}

function searchPhotos(text: string): Effective<ActionCommand> {
    const url = `https://photos.google.com/search/${encodeURIComponent(text)}`;
    return openUrlAction(url);
}

function searchMap(text: string): Effective<ActionCommand> {
    return done({
        ...parseCoordinates(text)[0]!,
        type: "open-map",
        title: "",
    });
}

function copyAction(text: string): Effective<ActionCommand> {
    return done(createCopyCommand(text));
}

function ruleAsValue(x: ActionRule) {
    return x as unknown as Value;
}
function valueAsRule(x: Value) {
    return x as unknown as ActionRule;
}
function actionAsValue(x: Action) {
    return x as unknown as Value;
}
function valueAsAction(x: Value) {
    return x as unknown as Action;
}

function binary(f: (x: Value, y: Value) => Effective<Value>): Value {
    return function* (x) {
        return function (y) {
            return f(x, y);
        };
    };
}

let regexpPattern;
function escapeRegExp(target: string) {
    return target.replace((regexpPattern ??= /[.*+?^${}()|[\]\\]/g), "\\$&");
}

export function createSalGlobals() {
    const globals = createStandardGlobals();

    const fromString = (x: Value) => done(escapeRegExp(x as string));
    const salGlobals: Record<string, Value> = {
        digits: "\\d+",
        repeat: binary((pattern, count) =>
            done(`(${pattern as string}){${count as number}`),
        ),
        chars: (x) => done(`[${escapeRegExp(x as string)}]`),
        number: "-?\\d+(\\.\\d+)?",
        word: "\\w",
        space: "\\s",
        spaces: "\\s*",
        "not-space": "\\S",
        many0: (x) => done(`(?:${x})*`),
        many1: (x) => done(`(?:${x})+`),

        pattern: (x) => done(ruleAsValue(pattern(x as string))),

        "search-photos": actionAsValue({
            execute: searchPhotos,
            description: "search in Google Photos",
        }),
        "search-map": actionAsValue({
            execute: searchMap,
            description: "search on Google Maps",
        }),
        copy: actionAsValue({
            execute: copyAction,
            description: "copy text to clipboard",
        }),
        open: actionAsValue({
            execute: openUrlAction,
            description: "open URL in browser",
        }),

        to: binary((x, y) =>
            done(ruleAsValue(bindAction(valueAsRule(x), valueAsAction(y)))),
        ),
        location: binary((x, y) =>
            done(
                ruleAsValue(withLocation(valueAsRule(x), y as ActionLocation)),
            ),
        ),

        fromString,
        fromWord: fromString,
        fromNumber: (x) => fromString(String(x)),
        _seq_: binary((x, y) => done((x as string) + y)),
        _and_: binary((x, y) =>
            done(ruleAsValue(mergeRule(valueAsRule(x), valueAsRule(y)))),
        ),
        _or_: binary((x, y) => done(`(?:${x})|(?:${y})`)),

        // "fromVoid": () => "",
        // "fromMissing": () => "",
        // "not_": (x: Value) => `not(${x})`,
    };

    for (const [k, v] of Object.entries(salGlobals)) {
        globals.set(k, v);
    }

    return (key: string) => globals.get(key);
}

interface ActionDecorationSpec {
    text: string;
    action: Action;
}
async function createDecorations(
    state: EditorState,
    location: ActionLocation,
    signal: AbortSignal,
    ruleSource: string,
): Promise<DecorationSet> {
    const builder = new RangeSetBuilder<Decoration>();
    const resolveGlobal = createSalGlobals();

    const r = await forceAsPromise(
        evaluateExpression(ruleSource, resolveGlobal),
        signal,
    );
    const rule = valueAsRule(r);
    const text = state.doc.toString();
    const matches = [
        ...(await forceAsPromise(rule.match({ text, location }), signal)),
    ];
    matches.sort((a, b) => a.index - b.index);
    for (const { action, index: start, length } of matches) {
        if (length === 0) continue;

        const end = start + length;
        const matchedText = text.slice(start, end);
        builder.add(
            start,
            end,
            Decoration.mark({
                class: classNames["action-link"],
                attributes: {
                    title: action.description,
                    "data-action-text": matchedText,
                },
                spec: {
                    action,
                    text: matchedText,
                } satisfies ActionDecorationSpec,
            }),
        );
    }

    return builder.finish();
}
function openLink(url: string) {
    window.open(url, "_blank");
}
function isAndroid(): boolean {
    return /android/i.test(navigator.userAgent);
}

function openGoogleMaps({ lat, lng }: LatLng, title: string) {
    const url = isAndroid()
        ? // &z=${zoom}
          `intent://0,0?q=${lat},${lng}%20(${encodeURIComponent(title)})#Intent;scheme=geo;package=com.google.android.apps.maps;end`
        : `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
    window.open(url, "_blank");
}

function copyToClipboard(text: string) {
    return navigator.clipboard.writeText(text);
}

async function executeCommand(command: ActionCommand) {
    switch (command.type) {
        case "copy":
            return await copyToClipboard(command.text);
        case "open-link":
            return openLink(command.url);
        case "open-map":
            return openGoogleMaps(command, command.title);
        default:
            return raise`unreachable: '${command satisfies never}'`;
    }
}
async function executeAction(action: Action, matchedText: string) {
    const command = await forceAsPromise(
        action.execute(matchedText),
        new AbortController().signal,
    );
    await executeCommand(command);
}

export interface SimpleEditorOptions {
    initialDoc: string;
    onInput: (doc: string) => void;
    location: ActionLocation;
    handleAsyncError: (reason: unknown) => void;
    ruleSource: string;
    classNames?: string[];
}

export function createSimpleEditor(options: SimpleEditorOptions) {
    const actionLinkDecorator = ViewPlugin.fromClass(
        class ActionLinkDecorator {
            decorations: DecorationSet;
            cancelScope = createAsyncCancelScope(options.handleAsyncError);
            ruleSource: string;

            constructor(view: EditorView) {
                this.decorations = RangeSet.empty;
                this.ruleSource = options.ruleSource;
                this.notifyDecorationsUpdated(view.state);
            }
            notifyDecorationsUpdated(state: EditorState) {
                this.cancelScope(async (signal) => {
                    this.decorations = await createDecorations(
                        state,
                        options.location,
                        signal,
                        this.ruleSource,
                    );
                });
            }
            update(update: ViewUpdate) {
                if (update.docChanged) {
                    this.notifyDecorationsUpdated(update.state);
                }
            }
        },
        {
            decorations: (v) => v.decorations,
        },
    );

    const actionClickHandler = EditorView.domEventHandlers({
        mousedown: (event, view) => {
            const target = event.target as HTMLElement;
            if (target.classList.contains(classNames["action-link"])) {
                event.preventDefault();
                const pos = view.posAtDOM(target);
                const plugin = view.plugin(actionLinkDecorator);
                if (!plugin) return;

                const foundSpecs: ActionDecorationSpec[] = [];
                plugin.decorations.between(pos, pos, (from, to, value) => {
                    foundSpecs.push(value.spec.spec);
                });
                for (const { action, text } of foundSpecs) {
                    executeAction(action, text).catch(options.handleAsyncError);
                }
            }
        },
    });

    const CustomClassName = EditorView.editorAttributes.of({
        class: options.classNames?.join(" ") ?? "",
    });

    const extensions: Extension[] = [
        EditorView.lineWrapping,
        history(),
        keymap.of([...defaultKeymap, indentWithTab]),
        EditorView.updateListener.of((update) => {
            if (
                update.docChanged &&
                update.transactions.some((t) => t.isUserEvent("input"))
            ) {
                options.onInput(update.state.doc.toString());
            }
        }),
        actionLinkDecorator,
        actionClickHandler,
        CustomClassName,
    ];

    const editor = new EditorView({
        state: EditorState.create({ doc: options.initialDoc, extensions }),
    });

    function dispatchSource(source: string) {
        editor.dispatch({
            changes: {
                from: 0,
                to: editor.state.doc.length,
                insert: source,
            },
        });
    }
    return {
        editor,
        get element() {
            return editor.dom;
        },
        dispatchSource,
        updateRuleSource(newRuleSource: string) {
            const plugin = editor.plugin(actionLinkDecorator);
            if (!plugin) return;
            plugin.ruleSource = newRuleSource;
            plugin.notifyDecorationsUpdated(editor.state);
        },
    };
}
