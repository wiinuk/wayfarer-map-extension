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
    StateEffect,
    Transaction,
} from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
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

function simpleQuote(text: string) {
    return '"' + text.replaceAll('"', "") + '"';
}

function searchPhotosQuoted(text: string): Effective<ActionCommand> {
    return searchPhotos(simpleQuote(text));
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

function copyQuoted(text: string): Effective<ActionCommand> {
    return copyAction(simpleQuote(text));
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
        opt: (x) => done(`(?:${x})?`),
        chars: (x) => done(`[${escapeRegExp(x as string)}]`),
        "not-chars": (x) => done(`[^${escapeRegExp(x as string)}]`),
        number: "-?\\d+(\\.\\d+)?",
        word: "\\w",
        space: "\\s",
        spaces: "\\s*",
        "not-space": "\\S",
        many0: (x) => done(`(?:${x})*`),
        many1: (x) => done(`(?:${x})+`),
        lookahead: (x) => done(`(?<=${x})`),
        lookbehind: (x) => done(`(?=${x})`),
        case: (x) => done(`(?i:${x})`),
        "ignore-case": (x) => done(`(?-i:${x})`),

        pattern: (x) => done(ruleAsValue(pattern(x as string))),

        "search-photos": actionAsValue({
            execute: searchPhotos,
            description: "search in Google Photos",
        }),
        "search-photos-quoted": actionAsValue({
            execute: searchPhotosQuoted,
            description: 'search in Google Photos ( with "" )',
        }),
        "search-map": actionAsValue({
            execute: searchMap,
            description: "search on Google Maps",
        }),
        copy: actionAsValue({
            execute: copyAction,
            description: "copy text to clipboard",
        }),
        "copy-quoted": actionAsValue({
            execute: copyQuoted,
            description: 'copy text to clipboard ( with "" )',
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

interface ActionMatchRange {
    from: number;
    to: number;
    text: string;
    action: Action;
    command: ActionCommand | undefined;
}
interface ActionDecorations {
    decorations: DecorationSet;
    matches: ActionMatchRange[];
}
async function createDecorations(
    state: EditorState,
    location: ActionLocation,
    signal: AbortSignal,
    ruleSource: string,
    handleAsyncError: (reason: unknown) => void,
): Promise<ActionDecorations> {
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
    const actionMatches: ActionMatchRange[] = [];
    for (const { action, index: start, length } of matches) {
        if (length === 0) continue;

        const end = start + length;
        const matchedText = text.slice(start, end);
        let command: ActionCommand | undefined;
        try {
            command = await forceAsPromise(
                action.execute(matchedText),
                signal,
            );
        } catch (error) {
            if (signal.aborted) throw error;
            handleAsyncError(error);
        }
        actionMatches.push({
            from: start,
            to: end,
            text: matchedText,
            action,
            command,
        });
        builder.add(
            start,
            end,
            Decoration.mark({
                class: classNames["action-link"],
                attributes: {
                    title: action.description,
                },
            }),
        );
    }

    return {
        decorations: builder.finish(),
        matches: actionMatches,
    };
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
export interface SimpleEditorOptions {
    initialDoc: string;
    onInput: (doc: string) => void;
    location: ActionLocation;
    handleAsyncError: (reason: unknown) => void;
    ruleSource: string;
    classNames?: string[];
}

function hasUserChange(update: ViewUpdate) {
    return update.transactions.some(
        (t) => t.annotation(Transaction.userEvent) !== undefined,
    );
}

export function createSimpleEditor(options: SimpleEditorOptions) {
    const editorShell = document.createElement("div");
    editorShell.className = classNames["action-editor"];
    const actionMenu = document.createElement("div");
    actionMenu.className = classNames["action-menu"];
    actionMenu.hidden = true;
    actionMenu.setAttribute("role", "group");
    actionMenu.setAttribute("aria-label", "一致箇所のアクション");
    editorShell.append(actionMenu);

    let actionMatches: ActionMatchRange[] = [];
    let visibleMatches: ActionMatchRange[] = [];
    let menuPosition = 0;

    function closeActionMenu() {
        visibleMatches = [];
        actionMenu.hidden = true;
        actionMenu.replaceChildren();
    }

    function positionActionMenu(position: number) {
        const coords = editor.coordsAtPos(position);
        if (!coords) return;

        const shellRect = editorShell.getBoundingClientRect();
        const menuWidth = actionMenu.offsetWidth;
        const menuHeight = actionMenu.offsetHeight;
        const left = Math.max(
            0,
            Math.min(
                coords.left - shellRect.left,
                editorShell.clientWidth - menuWidth,
            ),
        );
        const below = coords.bottom - shellRect.top + 6;
        const top =
            below + menuHeight <= editorShell.clientHeight
                ? below
                : Math.max(0, coords.top - shellRect.top - menuHeight - 6);
        actionMenu.style.left = `${left}px`;
        actionMenu.style.top = `${top}px`;
    }

    function sameMatches(
        first: readonly ActionMatchRange[],
        second: readonly ActionMatchRange[],
    ) {
        return (
            first.length === second.length &&
            first.every((match, index) => match === second[index])
        );
    }

    function renderActionMenu(
        activeMatches: ActionMatchRange[],
        position: number,
    ) {
        if (activeMatches.length === 0) {
            closeActionMenu();
            return;
        }

        if (sameMatches(visibleMatches, activeMatches) && !actionMenu.hidden) {
            menuPosition = position;
            positionActionMenu(position);
            return;
        }

        visibleMatches = activeMatches;
        menuPosition = position;
        actionMenu.hidden = false;
        actionMenu.replaceChildren();

        activeMatches.forEach((match, index) => {
            const label = document.createElement("span");
            label.className = classNames["action-menu-label"];
            label.textContent = `${activeMatches.length > 1 ? `${index + 1}. ` : ""}${match.action.description}`;

            const matchedText = document.createElement("small");
            matchedText.className = classNames["action-menu-match"];
            matchedText.textContent = `“${match.text}”`;

            if (!match.command) {
                const unavailable = document.createElement("button");
                unavailable.type = "button";
                unavailable.className = classNames["action-menu-item"];
                unavailable.disabled = true;
                label.textContent += " — 実行できません";
                unavailable.append(label, matchedText);
                actionMenu.append(unavailable);
                return;
            }

            if (match.command.type === "open-link") {
                const link = document.createElement("a");
                try {
                    const url = new URL(match.command.url, document.baseURI);
                    if (
                        ["javascript:", "data:", "vbscript:"].includes(
                            url.protocol,
                        )
                    ) {
                        throw new Error(
                            `Unsupported link protocol: ${url.protocol}`,
                        );
                    }
                    link.href = url.href;
                    link.target = "_blank";
                    link.rel = "noopener noreferrer";
                    link.className = classNames["action-menu-item"];
                    link.append(label, matchedText);
                } catch (reason) {
                    options.handleAsyncError(reason);
                    const unavailable = document.createElement("button");
                    unavailable.type = "button";
                    unavailable.className = classNames["action-menu-item"];
                    unavailable.disabled = true;
                    unavailable.append(label, matchedText);
                    actionMenu.append(unavailable);
                    return;
                }
                actionMenu.append(link);
            } else {
                const button = document.createElement("button");
                button.type = "button";
                button.className = classNames["action-menu-item"];
                button.append(label, matchedText);
                const command = match.command;
                button.addEventListener("click", () => {
                    closeActionMenu();
                    void executeCommand(command).catch(
                        options.handleAsyncError,
                    );
                });
                actionMenu.append(button);
            }
        });
        positionActionMenu(menuPosition);
    }

    function showActionsAt(position: number) {
        const activeMatches = actionMatches.filter(
            (match) => match.from <= position && position < match.to,
        );
        renderActionMenu(activeMatches, position);
    }

    const setActionDecorationsEffect =
        StateEffect.define<ActionDecorations>();
    const actionDecorator = ViewPlugin.fromClass(
        class ActionDecorator {
            decorations = Decoration.none;
            ruleSource = options.ruleSource;
            readonly cancelScope = createAsyncCancelScope(
                options.handleAsyncError,
            );

            constructor(readonly view: EditorView) {
                this.notifyDecorationsUpdated(view.state);
            }
            notifyDecorationsUpdated(state: EditorState) {
                this.cancelScope(async (signal) => {
                    const result = await createDecorations(
                        state,
                        options.location,
                        signal,
                        this.ruleSource,
                        options.handleAsyncError,
                    );
                    if (signal.aborted) return;
                    this.view.dispatch({
                        effects: setActionDecorationsEffect.of(result),
                    });
                });
            }
            update(update: ViewUpdate) {
                for (const { effects } of update.transactions) {
                    for (const effect of effects) {
                        if (effect.is(setActionDecorationsEffect)) {
                            this.decorations = effect.value.decorations;
                            actionMatches = effect.value.matches;
                        }
                    }
                }
                if (update.docChanged) {
                    this.decorations = this.decorations.map(update.changes);
                    actionMatches = [];
                    closeActionMenu();
                    this.notifyDecorationsUpdated(update.state);
                }
            }
        },
        {
            decorations: (v) => v.decorations,
        },
    );

    const actionClickHandler = EditorView.domEventHandlers({
        click: (event, view) => {
            const position = view.posAtCoords({
                x: event.clientX,
                y: event.clientY,
            });
            if (position == null) {
                closeActionMenu();
                return;
            }
            showActionsAt(position);
        },
        keydown: (event) => {
            if (event.key === "Escape" && !actionMenu.hidden) {
                closeActionMenu();
                editor.focus();
                return true;
            }
        },
    });

    const CustomClassName = EditorView.editorAttributes.of({
        class: options.classNames?.join(" ") ?? "",
    });

    const extensions: Extension[] = [
        EditorView.lineWrapping,
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.updateListener.of((update) => {
            if (update.docChanged && hasUserChange(update)) {
                options.onInput(update.state.doc.toString());
            }
        }),
        actionDecorator,
        actionClickHandler,
        CustomClassName,
    ];

    const editor = new EditorView({
        state: EditorState.create({ doc: options.initialDoc, extensions }),
    });
    editorShell.append(editor.dom, actionMenu);

    document.addEventListener("pointerdown", (event) => {
        const target = event.target;
        if (
            target instanceof Node &&
            !actionMenu.contains(target) &&
            !editor.dom.contains(target)
        ) {
            closeActionMenu();
        }
    });
    editor.scrollDOM.addEventListener("scroll", () => {
        if (!actionMenu.hidden) {
            positionActionMenu(editor.state.selection.main.head);
        }
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
        element: editorShell,
        dispatchSource,
        updateRuleSource(newRuleSource: string) {
            const plugin = editor.plugin(actionDecorator);
            if (!plugin) return;
            plugin.ruleSource = newRuleSource;
            plugin.notifyDecorationsUpdated(editor.state);
        },
    };
}
