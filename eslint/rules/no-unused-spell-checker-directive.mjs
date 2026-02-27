// spell-checker: ignore TSESLint TSESTree
//@ts-check

/**
 * @param {RegExp} pattern
 * @param {string} target
 * @param {number} startIndex
 */
function test(pattern, target, startIndex = 0) {
    pattern.lastIndex = startIndex;
    if (pattern.test(target)) {
        const nextIndex = pattern.lastIndex;
        pattern.lastIndex = startIndex;
        return nextIndex;
    } else {
        pattern.lastIndex = startIndex;
        return false;
    }
}
/**
 * @param {RegExp} pattern
 * @param {string} target
 * @param {number=} startIndex
 */
function next(pattern, target, startIndex) {
    let indexOrFalse = test(pattern, target, startIndex);
    return indexOrFalse === false ? pattern.lastIndex : indexOrFalse;
}
/**
 * @param {string} target
 */
function escapeRegExp(target) {
    return target.replace(/[.*+?^=!:${}()|[\]\/\\]/g, "\\$&");
}

const TokenKinds = Object.freeze({
    IgnoreDirective: "IgnoreDirective",
    IgnoreRegExpDirective: "IgnoreRegExpDirective",
});
const CodePoints = Object.freeze({
    p: "p".codePointAt(0),
    P: "P".codePointAt(0),
});
/**
 * @typedef {import("@typescript-eslint/utils").TSESTree.Comment} Comment
 * @typedef {{ kind: TokenKinds[keyof TokenKinds], start: number, end: number, triviaStart: number }} Word
 * @typedef {{ kind: TokenKinds["IgnoreDirective"], start: number, end: number, words: Word[] }} IgnoreDirective
 * @typedef {{ kind: TokenKinds["IgnoreRegExpDirective"], start: number, end: number, words: Word[] }} IgnoreRegExpDirective
 * @typedef {IgnoreDirective | IgnoreRegExpDirective} Directive
 * @typedef {{ comment: Comment, directives: Directive[] }} MagicComment
 * @typedef {{ magicComments: MagicComment[] }} MagicCommentsInProgram
 */
/**
 * @template {string} T
 * @typedef {import("@typescript-eslint/utils").TSESLint.ReportDescriptor<T>} ReportDescriptor
 */
/**
 * @typedef {Object} MagicCommentsVisitor
 * @property {(node: Word) => void} [Word]
 * @property {(node: MagicComment) => void} [MagicComment]
 * @property {(node: IgnoreDirective) => void} [IgnoreDirective]
 * @property {(node: IgnoreRegExpDirective) => void} [IgnoreRegExpDirective]
 */
/**
 * @param {readonly Comment[]} comments
 */
function parseMagicComments(comments) {
    const space = `[^\\S\\n\\r]`;
    const spaces0 = `${space}*`;
    const headerStart = `(spell-checker|spell|spellcheck|cspell)${spaces0}:${spaces0}`;
    const headerStartPattern = new RegExp(headerStart, "gi");
    const kindPattern = new RegExp(`ignoreRegExp|ignore|words`, "gi");
    const triviaPattern = new RegExp(spaces0, "yi");
    const wordPattern = /\S+/iy;

    /** @type {MagicComment[]} */
    const magicComments = [];
    for (const comment of comments) {
        const { value, range } = comment;
        const commentStart = range[0] + 2;

        /** @type {Directive[] | null} */
        let directives = null;
        /** @type {false | number} */
        let index = 0;

        while (true) {
            const directiveStart = index;
            index = test(headerStartPattern, value, index);
            if (index === false) break;

            index = test(kindPattern, value, index);
            if (index === false) break;

            const kindLastChar = value.codePointAt(index - 1);
            const kind =
                kindLastChar === CodePoints.p || kindLastChar === CodePoints.P
                    ? TokenKinds.IgnoreRegExpDirective
                    : TokenKinds.IgnoreDirective;

            let triviaStart = index;
            index = next(triviaPattern, value, index);

            /** @type {Word[]} */
            let words = [];
            for (
                let wordStart = index;
                (index = test(wordPattern, value, index)) !== false;
                wordStart = index
            ) {
                const wordEnd = index;

                words.push({
                    kind,
                    triviaStart: commentStart + triviaStart,
                    start: commentStart + wordStart,
                    end: commentStart + wordEnd,
                });

                triviaStart = index;
                index = next(triviaPattern, value, index);
            }
            (directives ??= []).push({
                kind,
                start: commentStart + directiveStart,
                end: commentStart + triviaStart,
                words,
            });
            index = wordPattern.lastIndex;
        }
        if (directives != null) {
            magicComments.push({
                comment,
                directives,
            });
        }
    }
    return { magicComments };
}
/**
 * @param {never} x
 */
function assertNever(x) {
    throw new Error(x);
}

/**
 *
 * @param {MagicCommentsInProgram} program
 * @param {MagicCommentsVisitor} visitor
 */
function visitMagicComments(program, visitor) {
    const { magicComments } = program;
    for (const magicComment of magicComments) {
        visitor.MagicComment?.(magicComment);
        const { directives } = magicComment;
        for (const directive of directives) {
            const { kind } = directive;
            switch (kind) {
                case TokenKinds.IgnoreDirective: {
                    visitor.IgnoreDirective?.(directive);
                    const { words } = directive;
                    for (const word of words) {
                        visitor.Word?.(word);
                    }
                    break;
                }
                case TokenKinds.IgnoreRegExpDirective: {
                    visitor.IgnoreRegExpDirective?.(directive);
                    const { words } = directive;
                    for (const word of words) {
                        visitor.Word?.(word);
                    }
                    break;
                }
                default:
                    return assertNever(kind);
            }
        }
    }
}

/**
 * @typedef {
    | "this_ignore_word_is_unused"
    | "empty_directive_is_unused"
    | "remove_word"
    | "remove_comment"
    | "remove_directive"
    | "message"
    | "invalid_regex_pattern"
   } MessageIds
 */

/** @type {import("@typescript-eslint/utils").TSESLint.RuleModule<MessageIds>} */
const rule = {
    meta: {
        docs: {
            description: "Remove unused spell checker directives.",
            recommended: "warn",
            suggestion: true,
        },
        fixable: "code",
        hasSuggestions: true,
        messages: {
            this_ignore_word_is_unused: "Ignore word '{{ name }}' is unused.",
            empty_directive_is_unused: "Empty directive is unused.",
            invalid_regex_pattern:
                "Invalid regex pattern '{{ name }}'. {{ error }}",
            remove_comment: "Remove comment with directive.",
            remove_directive: "Remove directive",
            remove_word: "Remove word",
            message: "{{ message }}",
        },
        schema: [],
        type: "suggestion",
    },
    defaultOptions: [],
    create(context) {
        const sourceCode = context.getSourceCode();
        const comments = sourceCode.getAllComments();
        const sourceText = sourceCode.text;
        const nonTrivialCommentPattern = /[^*\/\s]/gi;
        /**
         * @param {RegExp} pattern
         * @param {string} source
         * @param {number} start
         * @param {number} end
         * @returns
         */
        function testInRange(pattern, source, start, end) {
            const nextIndex = test(pattern, source, start);
            return nextIndex !== false && nextIndex <= end;
        }
        return {
            Program() {
                const all = parseMagicComments(comments);
                const { magicComments } = all;

                /** @type {Set<number>} */
                const ignoreDirectiveWordEnds = new Set();
                for (const { directives } of magicComments) {
                    for (const { kind, words } of directives) {
                        if (
                            kind === TokenKinds.IgnoreDirective ||
                            kind === TokenKinds.IgnoreRegExpDirective
                        ) {
                            for (const { end } of words) {
                                ignoreDirectiveWordEnds.add(end);
                            }
                        }
                    }
                }
                visitMagicComments(all, {
                    Word({ kind, triviaStart, start, end }) {
                        const ignoreWord = sourceCode.text.slice(start, end);

                        let ignoreWordPattern;
                        switch (kind) {
                            case TokenKinds.IgnoreDirective:
                                ignoreWordPattern = new RegExp(
                                    escapeRegExp(ignoreWord),
                                    "gi",
                                );
                                break;
                            case TokenKinds.IgnoreRegExpDirective:
                                try {
                                    ignoreWordPattern = new RegExp(
                                        ignoreWord,
                                        "g",
                                    );
                                } catch (e) {
                                    if (!(e instanceof SyntaxError)) throw e;
                                    return context.report({
                                        loc: {
                                            start: sourceCode.getLocFromIndex(
                                                start,
                                            ),
                                            end: sourceCode.getLocFromIndex(
                                                end,
                                            ),
                                        },
                                        messageId: "invalid_regex_pattern",
                                        data: {
                                            name: ignoreWord,
                                            error: e.message,
                                        },
                                    });
                                }
                        }

                        /** @type {number | false} */
                        let index = 0;
                        while (
                            (index = test(
                                ignoreWordPattern,
                                sourceText,
                                index,
                            )) !== false &&
                            ignoreDirectiveWordEnds.has(index)
                        ) {}
                        if (index !== false) return;

                        /** @type {import("@typescript-eslint/utils").TSESLint.ReportFixFunction} */
                        const fix = (fixer) =>
                            fixer.removeRange([triviaStart, end]);

                        context.report({
                            loc: {
                                start: sourceCode.getLocFromIndex(start),
                                end: sourceCode.getLocFromIndex(end),
                            },
                            messageId: "this_ignore_word_is_unused",
                            data: {
                                name: ignoreWord,
                            },
                            suggest: [
                                {
                                    messageId: "remove_word",
                                    fix,
                                },
                            ],
                            // 複雑な RegExp は復元が難しいかもしれないので自動削除しない
                            fix:
                                kind === TokenKinds.IgnoreRegExpDirective
                                    ? undefined
                                    : fix,
                        });
                    },
                    MagicComment({ directives, comment }) {
                        const [commentStart, commentEnd] = comment.range;
                        if (directives.length === 1) {
                            const directive = directives[0];
                            if (directive.words.length === 0) {
                                // `// spell-checker ignore:` のようなとき

                                /** @param {import("@typescript-eslint/utils").TSESLint.RuleFixer} fixer */
                                const fix = (fixer) =>
                                    // コメント全体を取り除く
                                    fixer.remove(comment);

                                /** @type {ReportDescriptor<MessageIds>} */
                                const reporter = {
                                    loc: comment.loc,
                                    messageId: "empty_directive_is_unused",
                                    data: {
                                        message: JSON.stringify({
                                            directive: {
                                                start: directive.start,
                                                end: directive.end,
                                            },
                                            comment: {
                                                start: commentStart,
                                                end: commentEnd,
                                            },
                                        }),
                                    },
                                    suggest: [
                                        {
                                            messageId: "remove_comment",
                                            fix,
                                        },
                                    ],
                                };

                                // 余分なコメントがないなら自動で削除する
                                let isAutoFix =
                                    !testInRange(
                                        nonTrivialCommentPattern,
                                        sourceText,
                                        commentStart,
                                        directive.start,
                                    ) &&
                                    !testInRange(
                                        nonTrivialCommentPattern,
                                        sourceText,
                                        directive.end,
                                        commentEnd,
                                    );
                                context.report(
                                    isAutoFix ? { ...reporter, fix } : reporter,
                                );
                            }
                            return;
                        }
                        for (const directive of directives) {
                            const { words } = directive;
                            if (words.length === 0) {
                                // `spell-checker ignore:` のようなとき

                                /** @type {ReportDescriptor<MessageIds>} */
                                context.report({
                                    loc: {
                                        start: sourceCode.getLocFromIndex(
                                            directive.start,
                                        ),
                                        end: sourceCode.getLocFromIndex(
                                            directive.end,
                                        ),
                                    },
                                    messageId: "empty_directive_is_unused",
                                    suggest: [
                                        {
                                            messageId: "remove_directive",
                                            fix(fixer) {
                                                // Directive を取り除く
                                                return fixer.removeRange([
                                                    directive.start,
                                                    directive.end,
                                                ]);
                                            },
                                        },
                                    ],
                                });
                            }
                        }
                    },
                });
            },
        };
    },
};
export default rule;
