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
} from "./simple-editor-actions";

function openUrlAction(text: string): Effective<ActionCommand> {
    return done({
        type: "open-link",
        url: text,
    });
}

function searchPhotos(text: string): Effective<ActionCommand> {
    const url = `https://photos.google.com/search/${encodeURIComponent(text)}`;
    return done({
        type: "open-link",
        url,
    });
}

function searchMap(text: string): Effective<ActionCommand> {
    return done({
        ...parseCoordinates(text)[0]!,
        type: "open-map",
        title: "",
    });
}

function copyAction(text: string): Effective<ActionCommand> {
    return done({
        type: "copy",
        text,
    });
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
        number: "-?\\d+(\\.\\d+)?",
        spaces: "\\s*",
        "not-space": "\\S",
        many0: (x) => done(`(?:${x})*`),
        many1: (x) => done(`(?:${x})+`),

        pattern: (x) => done(ruleAsValue(pattern(x as string))),

        "search-photos": actionAsValue(searchPhotos),
        "search-map": actionAsValue(searchMap),
        copy: actionAsValue(copyAction),
        open: actionAsValue(openUrlAction),

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
): Promise<DecorationSet> {
    const builder = new RangeSetBuilder<Decoration>();
    const resolveGlobal = createSalGlobals();

    // TODO:
    const salSource = `
        date and coords and url

        @where date = pattern:(digits "-" digits "-" digits) /to search-photos
        @where coords = pattern:(number spaces "," spaces number) /to search-map
        @where url = pattern:("https://" many1:(not-space)) /to open
    `;

    const r = await forceAsPromise(
        evaluateExpression(salSource, resolveGlobal),
        signal,
    );
    const rule = valueAsRule(r);
    const text = state.doc.toString();
    const matches = await forceAsPromise(
        rule.match({ text, location }),
        signal,
    );
    for (const { action, index: start, length } of matches) {
        if (length === 0) continue;

        const end = start + length;
        const matchedText = text.slice(start, end);
        builder.add(
            start,
            end,
            Decoration.mark({
                class: classNames["action-link"],
                attributes: { "data-action-text": matchedText },
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
        action(matchedText),
        new AbortController().signal,
    );
    await executeCommand(command);
}

export function createSimpleEditor(
    initialDoc: string,
    onUpdate: (doc: string) => void,
    location: ActionLocation,
    handleAsyncError: (reason: unknown) => void,
) {
    const actionLinkPlugin = ViewPlugin.fromClass(
        class ActionLinkDecorator {
            decorations: DecorationSet;
            cancelScope = createAsyncCancelScope(handleAsyncError);

            constructor(view: EditorView) {
                this.decorations = RangeSet.empty;
                this.notifyDecorationsUpdated(view.state);
            }
            notifyDecorationsUpdated(state: EditorState) {
                this.cancelScope(async (signal) => {
                    this.decorations = await createDecorations(
                        state,
                        location,
                        signal,
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
                const plugin = view.plugin(actionLinkPlugin);
                if (!plugin) return;

                plugin.decorations.between(pos, pos, (from, to, value) => {
                    const found: ActionDecorationSpec = value.spec.spec;
                    executeAction(found.action, found.text).catch(
                        handleAsyncError,
                    );
                });
            }
        },
    });

    const extensions: Extension[] = [
        EditorView.lineWrapping,
        history(),
        keymap.of([...defaultKeymap, indentWithTab]),
        EditorView.updateListener.of((update) => {
            if (update.docChanged) {
                onUpdate(update.state.doc.toString());
            }
        }),
        actionLinkPlugin,
        actionClickHandler,
    ];

    const editor = new EditorView({
        state: EditorState.create({ doc: initialDoc, extensions }),
    });

    editor.dom.classList.add(
        classNames["detail-description"],
        classNames["input-field"],
    );
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
    };
}
