//spell:words antlr
import { styleSetter } from "../../dom-extensions";
import {
    createTypedCustomEvent,
    createTypedEventTarget,
} from "../../typed-event-target";
import classNames, { cssText } from "./editor.module.css";
import { basicSetup } from "codemirror";
import {
    EditorView,
    Decoration,
    ViewPlugin,
    ViewUpdate,
} from "@codemirror/view";
import { EditorState, RangeSet, RangeSetBuilder } from "@codemirror/state";
import { SalLexer } from "../../sal/.antlr-generated/SalLexer";
import { CharStreams } from "antlr4ts";

const setStyle = styleSetter(cssText);

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
    positionMap: PosConverter;
    decorations: RangeSet<Decoration>;
    constructor(view: EditorView) {
        this.positionMap = new PosConverter(view.state.doc.toString());
        this.decorations = this.tokenize(view);
    }

    // ドキュメントが変更されたら再解析する
    update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
            this.positionMap = new PosConverter(
                update.view.state.doc.toString(),
            );
            this.decorations = this.tokenize(update.view);
        }
    }

    tokenize(view: EditorView) {
        const { styles, lexer } = this;
        const { doc } = view.state;
        const builder = new RangeSetBuilder<Decoration>();

        for (const { from, to } of view.visibleRanges) {
            const text = doc.sliceString(from, to);
            lexer.inputStream = CharStreams.fromString(text);
            for (const token of lexer.getAllTokens()) {
                let decoration;
                switch (token.type) {
                    case SalLexer.LINE_COMMENT:
                    case SalLexer.BLOCK_COMMENT:
                        decoration = styles.comment;
                        break;

                    case SalLexer.STRING:
                        decoration = styles.string;
                        break;

                    case SalLexer.NUMBER:
                        decoration = styles.number;
                        break;

                    case SalLexer.AND:
                    case SalLexer.OR:
                    case SalLexer.WHERE:
                    case SalLexer.FUNCTION:
                        decoration = styles.keyword;
                        break;

                    case SalLexer.AT:
                    case SalLexer.COLON:
                    case SalLexer.EQUALS:
                    case SalLexer.MINUS:
                    case SalLexer.PAREN_BEGIN:
                    case SalLexer.PAREN_END:
                    case SalLexer.SLASH:
                        decoration = styles.special;
                        break;

                    case SalLexer.WORD:
                        decoration = styles.word;
                        break;
                    default:
                        break;
                }
                if (decoration) {
                    const from = this.positionMap.toCodeUnit(token.startIndex);
                    const to = this.positionMap.toCodeUnit(token.stopIndex + 1);
                    builder.add(from, to, decoration);
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
    const events = createTypedEventTarget<{ input: string }>();

    let isDispatching = false;
    const notifyInputPlugin = EditorView.updateListener.of((update) => {
        if (isDispatching) return;
        if (update.docChanged) {
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
    const extensions = [
        basicSetup,

        // シンタックスハイライト
        createSalTokenHighlighter(),

        // 行折り返し
        EditorView.lineWrapping,

        EditorView.theme({
            "&": { height: "100%" },

            // モバイルでのズーム防止
            ".cm-content": { fontSize: "16px" },
            ".cm-lintRange-error": {
                backgroundImage: "none",
                textDecoration: "underline wavy #e74c3c",
            },
        }),

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

    let currentFileName = initialFileName;
    const fileStates = new Map<string, EditorState>();
    function switchFile(newFileName: string, newContent: string) {
        const status = fileStates.get(newFileName);
        if (status != null) {
            view.setState(status);
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
    return {
        element,
        events,
        setSource,
    };
}
