//spell:words antlr keymap Kaku
import { styleSetter } from "../../dom-extensions";
import {
    createTypedCustomEvent,
    createTypedEventTarget,
} from "../../typed-event-target";
import classNames, { cssText } from "./editor.module.css";
import {
    EditorView,
    Decoration,
    ViewPlugin,
    ViewUpdate,
    keymap,
    highlightSpecialChars,
    drawSelection,
    dropCursor,
    rectangularSelection,
    crosshairCursor,
    highlightActiveLine,
    highlightActiveLineGutter,
} from "@codemirror/view";
import {
    EditorState,
    RangeSet,
    RangeSetBuilder,
    type Extension,
} from "@codemirror/state";
import { defaultKeymap, indentWithTab, history } from "@codemirror/commands";
import {
    bracketMatching,
    defaultHighlightStyle,
    foldGutter,
    indentOnInput,
    indentUnit,
    syntaxHighlighting,
} from "@codemirror/language";
import { autocompletion, closeBrackets } from "@codemirror/autocomplete";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { linter, lintKeymap, type Diagnostic } from "@codemirror/lint";
import { SalLexer } from "../../sal/.antlr-generated/SalLexer";
import { CharStreams, Token } from "antlr4ts";
import type { SourceRange } from "../../sal/evaluator";

const setStyle = styleSetter(cssText);

type Styles = ReturnType<typeof createStyles>;
function createStyles() {
    function tips(className: string) {
        return classNames["token-tips"] + " " + className;
    }
    return {
        keyword: Decoration.mark({
            class: classNames["token-keyword"],
        }),
        special: Decoration.mark({ class: classNames["token-special"] }),
        number: Decoration.mark({
            class: classNames["token-number"],
        }),
        comment: Decoration.mark({
            class: tips(classNames["token-tips-comment"]),
        }),
        string: Decoration.mark({
            class: tips(classNames["token-tips-string"]),
        }),
        word: Decoration.mark({ class: tips(classNames["token-tips-word"]) }),
    };
}

function tokenTypeToDecoration(token: Token, styles: Styles) {
    switch (token.type) {
        case SalLexer.LINE_COMMENT:
        case SalLexer.BLOCK_COMMENT:
            return styles.comment;

        case SalLexer.STRING:
            return styles.string;

        case SalLexer.NUMBER:
            return styles.number;

        case SalLexer.AND:
        case SalLexer.OR:
        case SalLexer.WHERE:
        case SalLexer.FUNCTION:
            return styles.keyword;

        case SalLexer.AT:
        case SalLexer.COLON:
        case SalLexer.EQUALS:
        case SalLexer.MINUS:
        case SalLexer.PAREN_BEGIN:
        case SalLexer.PAREN_END:
        case SalLexer.SLASH:
            return styles.special;

        case SalLexer.WORD:
            return styles.word;
        default:
            break;
    }
}

function createDiffs(docString: string) {
    const diffs: [codePoint: number, cumulativeDiff: number][] = [];
    let diff = 0;
    let codePointIdx = 0;

    for (let i = 0; i < docString.length; i++, codePointIdx++) {
        // サロゲートペア（上位サロゲート）を見つけた場合
        if (
            docString.charCodeAt(i) >= 0xd800 &&
            docString.charCodeAt(i) <= 0xdbff
        ) {
            diff++; // 次のコードポイントで JS index は +1 ズレる
            diffs.push([codePointIdx + 1, diff]);
            i++; // 下位サロゲートをスキップ
        }
    }
    return diffs;
}

/** JS文字列インデックスからコードポイント列インデックスへの変換 */
class PosConverter {
    private _diffs: [codePoint: number, cumulativeDiff: number][] | undefined;
    constructor(private _docString: string) {}

    toCodeUnit(codePointPos: number) {
        this._diffs ??= createDiffs(this._docString);
        if (this._diffs.length === 0) return codePointPos;

        let low = 0,
            high = this._diffs.length - 1;
        let bestDiff = 0;

        while (low <= high) {
            const mid = (low + high) >> 1;
            if (this._diffs[mid]![0] <= codePointPos) {
                bestDiff = this._diffs[mid]![1];
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }
        return codePointPos + bestDiff;
    }
}
class SalTokenizerPlugin {
    readonly lexer = new SalLexer(CharStreams.fromString(""));
    readonly styles = createStyles();
    decorations: RangeSet<Decoration>;
    constructor(view: EditorView) {
        this.decorations = this.tokenize(view);
    }

    // ドキュメントが変更されたら再解析する
    update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
            this.decorations = this.tokenize(update.view);
        }
    }

    tokenize(view: EditorView) {
        const { styles, lexer } = this;
        const { doc } = view.state;
        const builder = new RangeSetBuilder<Decoration>();

        for (const { from, to } of view.visibleRanges) {
            const text = doc.sliceString(from, to);
            const slicePositionMap = new PosConverter(text);
            lexer.inputStream = CharStreams.fromString(text);

            for (
                let token = lexer.nextToken();
                token.type !== Token.EOF;
                token = lexer.nextToken()
            ) {
                const decoration = tokenTypeToDecoration(token, styles);
                if (decoration) {
                    const relativeTokenFrom = slicePositionMap.toCodeUnit(
                        token.startIndex,
                    );
                    const relativeTokenTo = slicePositionMap.toCodeUnit(
                        token.stopIndex + 1,
                    );

                    const absoluteTokenFrom = from + relativeTokenFrom;
                    const absoluteTokenTo = from + relativeTokenTo;
                    builder.add(absoluteTokenFrom, absoluteTokenTo, decoration);
                }
            }
        }
        return builder.finish();
    }
}
function createSalTokenHighlighter() {
    return ViewPlugin.fromClass(SalTokenizerPlugin, {
        decorations: (v) => v.decorations,
    });
}

export async function createEditor({
    initialFileName,
    initialText,
}: {
    initialFileName: string;
    initialText: string;
}) {
    setStyle();
    const fileErrors = new Map<
        string,
        { message: string; range: SourceRange | undefined }
    >();

    let currentFileName = initialFileName;
    const errorLinter = linter((view) => {
        const diagnostics: Diagnostic[] = [];
        const error = fileErrors.get(currentFileName);
        if (!error) return diagnostics;

        const { message, range } = error;
        const doc = view.state.doc;

        let from = 0;
        let to = doc.length;

        if (range) {
            const startLine = doc.line(range.start.line);
            const startOffset = startLine.from + range.start.column;

            const stopLine = doc.line(range.stop.line);
            const stopOffset = stopLine.from + range.stop.column;

            from = startOffset;
            to = stopOffset;
        }

        diagnostics.push({
            from,
            to,
            severity: "error",
            message,
        });
        return diagnostics;
    });

    const events = createTypedEventTarget<{ input: string }>();

    let isDispatching = false;
    const notifyInputPlugin = EditorView.updateListener.of((update) => {
        if (isDispatching) return;
        if (update.docChanged) {
            fileErrors.delete(currentFileName);
            try {
                isDispatching = true;
                events.dispatchEvent(
                    createTypedCustomEvent(
                        "input",
                        update.state.doc.toString(),
                    ),
                );
            } finally {
                isDispatching = false;
            }
        }
    });

    const basicSetup: Extension = [
        keymap.of(defaultKeymap),
        // lineNumbers()
        highlightSpecialChars(),
        history(),
        foldGutter(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        syntaxHighlighting(defaultHighlightStyle),
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        highlightSelectionMatches(),
        keymap.of(searchKeymap),
        keymap.of(lintKeymap),
    ];
    const extensions = [
        basicSetup,

        // シンタックスハイライト
        createSalTokenHighlighter(),

        // エラーに波線
        errorLinter,

        // 行折り返し
        EditorView.lineWrapping,

        // Tabで2スペースインデント
        keymap.of([indentWithTab]),
        indentUnit.of("  "),

        EditorView.theme(
            {
                "&": { height: "100%" },

                // モバイルでのズーム防止
                ".cm-content": {
                    fontSize: "16px",
                    fontFamily: `font-family: ui-monospace, "Cascadia Code", "JetBrains Mono", "SF Mono", "Hiragino Kaku Gothic ProN", "Hiragino Sans", "BIZ UDGothic", "Segoe UI Mono", "Roboto Mono", monospace;
`,
                },
                // 選択色
                ".cm-selectionBackground": {
                    backgroundColor: "#1890ff !important",
                },
                // 行番号
                ".cm-gutters": {
                    fontFamily: "inherit",
                },

                ".cm-lintRange-error": {
                    backgroundImage: "none",
                    textDecoration: "underline wavy #e74c3c",
                },
            },
            { dark: false },
        ),

        // 優先順位を確実にするためのベーステーマ設定
        EditorView.baseTheme({
            ".cm-lintRange-error": {
                textDecoration: "underline wavy #e74c3c !important",
            },
        }),
        notifyInputPlugin,
    ];

    const element = <div class={classNames.container}></div>;
    const view = new EditorView({
        doc: initialText,
        extensions,
        parent: element,
    });

    const fileStates = new Map<string, EditorState>();
    function switchFile(newFileName: string, newContent: string) {
        const cachedState = fileStates.get(newFileName);
        if (cachedState != null) {
            if (cachedState.doc.toString() === newContent) {
                view.setState(cachedState);
                return;
            }

            const transaction = cachedState.update({
                changes: {
                    from: 0,
                    to: cachedState.doc.length,
                    insert: newContent,
                },
            });
            const updatedState = transaction.state;
            fileStates.set(newFileName, updatedState);
            view.setState(updatedState);
            return;
        }

        const newState = EditorState.create({
            doc: newContent,
            extensions,
        });
        fileStates.set(newFileName, newState);
        view.setState(newState);
    }

    function setSource(fileName: string, value: string) {
        if (currentFileName === fileName) {
            view.dispatch({
                changes: {
                    from: 0,
                    to: view.state.doc.length,
                    insert: value,
                },
            });
            return;
        }
        currentFileName = fileName;
        switchFile(fileName, value);
    }
    function setError(
        fileName: string,
        message: string,
        range: SourceRange | undefined,
    ) {
        if (message) {
            fileErrors.set(fileName, { message, range });
        } else {
            fileErrors.delete(fileName);
        }
    }
    return {
        element,
        events,
        setSource,
        setError,
    };
}
