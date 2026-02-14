// spell-checker:words antlr
import { CharStreams, CommonTokenStream } from "antlr4ts";
import { SalLexer } from "../.antlr-generated/SalLexer";
import {
    AndExpressionContext,
    ApplyExpressionContext,
    BinaryExpressionContext,
    ExpressionContext,
    IdentifierContext,
    LambdaExpressionContext,
    NotExpressionContext,
    NumberContext,
    OrExpressionContext,
    ParameterContext,
    ParenthesizedExpressionContext,
    SalParser,
    SequenceExpressionContext,
    SourceFileContext,
    StringContext,
    VariableContext,
    WhereExpressionContext,
    WordContext,
    WordExpressionContext,
} from "../.antlr-generated/SalParser";
import { describe, it, expect } from "vitest";
import { ignore, raise } from "../../standard-extensions";
import type { SalVisitor } from "../.antlr-generated/SalVisitor";
import type { ParseTree } from "antlr4ts/tree/ParseTree";
import type { RuleNode } from "antlr4ts/tree/RuleNode";
import type { ErrorNode } from "antlr4ts/tree/ErrorNode";
import type { TerminalNode } from "antlr4ts/tree/TerminalNode";

function createParser(input: string) {
    const inputStream = CharStreams.fromString(input);
    const lexer = new SalLexer(inputStream);
    const tokenStream = new CommonTokenStream(lexer);
    return new SalParser(tokenStream);
}
function parseAndPrint(input: string) {
    const parser = createParser(input);
    return parser.sourceFile().toStringTree(parser);
}
function printWithParen(input: string) {
    const parser = createParser(input);
    const printer = new PrintWithParenVisitor();
    return parser.sourceFile().accept(printer);
}

class PrintWithParenVisitor implements SalVisitor<string> {
    visit(_tree: ParseTree): string {
        return raise``;
    }
    visitChildren(_node: RuleNode): string {
        return raise``;
    }
    visitErrorNode(_node: ErrorNode): string {
        return raise``;
    }
    visitTerminal(node: TerminalNode): string {
        return node.text;
    }

    visitWord(e: WordContext): string {
        const w = e.WORD();
        if (w != null) return w.accept(this);
        return e.text;
    }
    visitIdentifier(e: IdentifierContext): string {
        const w = e.word();
        const name =
            w != null ? w.accept(this) : (e.STRING()?.accept(this) ?? raise``);
        return `${e.AT().text}${name}`;
    }
    visitParameter(e: ParameterContext): string {
        const i = e.identifier();
        if (i != null) return i.accept(this);
        return e.word()?.accept(this) ?? raise``;
    }
    visitSourceFile(s: SourceFileContext): string {
        const e = s.expression();
        if (!e) return "";
        return e.accept(this);
    }
    visitExpression(e: ExpressionContext): string {
        if (
            e instanceof NumberContext ||
            e instanceof StringContext ||
            e instanceof WordExpressionContext ||
            e instanceof VariableContext
        ) {
            return e.accept(this);
        }
        return `(${e.accept(this)})`;
    }

    visitLambdaExpression(e: LambdaExpressionContext): string {
        return `${e.AT().text}${e.FUNCTION().text} ${e.parameter().accept(this)}: ${this.visitExpression(e.expression())}`;
    }
    visitNotExpression(e: NotExpressionContext): string {
        return `-${this.visitExpression(e.expression())}`;
    }

    binaryLike(
        e: { _left: ExpressionContext; _right: ExpressionContext },
        op: string,
    ) {
        return `${this.visitExpression(e._left)}${op}${this.visitExpression(e._right)}`;
    }
    visitApplyExpression(e: ApplyExpressionContext): string {
        return this.binaryLike(e, ":");
    }
    visitSequenceExpression(e: SequenceExpressionContext): string {
        return this.binaryLike(e, " ");
    }
    visitOrExpression(e: OrExpressionContext): string {
        return this.binaryLike(e, " or ");
    }
    visitAndExpression(e: AndExpressionContext): string {
        return this.binaryLike(e, " and ");
    }
    visitBinaryExpression(e: BinaryExpressionContext): string {
        return `${this.visitExpression(e._left)} /${e.word().accept(this)} ${this.visitExpression(e._right)}`;
    }
    visitWhereExpression(e: WhereExpressionContext): string {
        return `${this.visitExpression(e._scope)} @where ${e.parameter().accept(this)} = ${this.visitExpression(e._value)}`;
    }
    visitNumber(e: NumberContext): string {
        return e.NUMBER().accept(this);
    }
    visitString(e: StringContext): string {
        return e.STRING().accept(this);
    }
    visitVariable(e: VariableContext): string {
        return e.identifier().accept(this);
    }
    visitWordExpression(e: WordExpressionContext): string {
        return this.visitWord(e.word());
    }
    visitParenthesizedExpression(e: ParenthesizedExpressionContext): string {
        return `(${this.visitExpression(e.expression())})`;
    }
}

describe("Sal Parser", () => {
    describe("Lexer", () => {
        it("should handle numbers", () => {
            const tokens = new SalLexer(
                CharStreams.fromString("123 -45 0.5 1.2e3 -0.5e-2"),
            ).getAllTokens();
            expect(tokens.map((t) => t.text)).toEqual([
                "123",
                "-45",
                "0.5",
                "1.2e3",
                "-0.5e-2",
            ]);
            expect(tokens.map((t) => t.type)).toEqual([
                SalLexer.NUMBER,
                SalLexer.NUMBER,
                SalLexer.NUMBER,
                SalLexer.NUMBER,
                SalLexer.NUMBER,
            ]);
        });

        it("should handle strings", () => {
            const tokens = new SalLexer(
                CharStreams.fromString('"hello" "escaped \\\\ \\" char" ""'),
            ).getAllTokens();
            expect(tokens.map((t) => t.text)).toEqual([
                '"hello"',
                // lexer 側でエスケープ解除はしない
                '"escaped \\\\ \\" char"',
                '""',
            ]);
            expect(tokens.map((t) => t.type)).toEqual([
                SalLexer.STRING,
                SalLexer.STRING,
                SalLexer.STRING,
            ]);
        });

        it("should handle words", () => {
            const tokens = new SalLexer(
                CharStreams.fromString("word a1 with.dot with-hyphen"),
            ).getAllTokens();
            expect(tokens.map((t) => t.text)).toEqual([
                "word",
                "a1",
                "with.dot",
                "with-hyphen",
            ]);
            expect(tokens.map((t) => t.type)).toEqual([
                SalLexer.WORD,
                SalLexer.WORD,
                SalLexer.WORD,
                SalLexer.WORD,
            ]);
        });

        it("should skip comments", () => {
            const code = `
        // line comment
        a
        /* block
           comment */
        b
      `;
            const tokens = new SalLexer(
                CharStreams.fromString(code),
            ).getAllTokens();
            expect(tokens.map((t) => t.text)).toEqual(["a", "b"]);
        });

        it("should parse nested comments", () => {
            const code = `
        a
        /* block
           comment /* nested */ */
        b
      `;
            const tokens = new SalLexer(
                CharStreams.fromString(code),
            ).getAllTokens();
            expect(tokens.map((t) => t.text)).toEqual(["a", "b"]);
        });
    });

    describe("Parse and print", () => {
        it("should parse primary expressions", () => {
            expect(parseAndPrint("123")).toStrictEqual(
                "(sourceFile (expression 123) <EOF>)",
            );
            expect(parseAndPrint('"a string"')).toStrictEqual(
                `(sourceFile (expression "a string") <EOF>)`,
            );
            expect(parseAndPrint("@identifier")).toStrictEqual(
                "(sourceFile (expression (identifier @ (word identifier))) <EOF>)",
            );
            expect(parseAndPrint("aWord")).toStrictEqual(
                "(sourceFile (expression (word aWord)) <EOF>)",
            );
        });

        it("pseudo reserved word", () => {
            expect(parseAndPrint("where fn function")).toStrictEqual(
                "(sourceFile (expression (expression (expression (word where)) (expression (word fn))) (expression (word function))) <EOF>)",
            );
        });

        it("should parse parentheses", () => {
            expect(parseAndPrint("(123)")).toStrictEqual(
                "(sourceFile (expression ( (expression 123) )) <EOF>)",
            );
        });

        it("should parse notExpression", () => {
            // 1トークン
            expect(parseAndPrint("-123")).toStrictEqual(
                "(sourceFile (expression -123) <EOF>)",
            );
            // 3トークン
            expect(parseAndPrint("-@ident")).toStrictEqual(
                "(sourceFile (expression - (expression (identifier @ (word ident)))) <EOF>)",
            );
            // 2トークン
            expect(parseAndPrint("-x")).toStrictEqual(
                "(sourceFile (expression - (expression (word x))) <EOF>)",
            );
        });

        it("should parse applyExpression", () => {
            expect(parseAndPrint("func:arg")).toStrictEqual(
                "(sourceFile (expression (expression (word func)) : (expression (word arg))) <EOF>)",
            );
            expect(parseAndPrint('"string":"another"')).toStrictEqual(
                '(sourceFile (expression (expression "string") : (expression "another")) <EOF>)',
            );
            expect(parseAndPrint("a:b:c")).toStrictEqual(
                "(sourceFile (expression (expression (expression (word a)) : (expression (word b))) : (expression (word c))) <EOF>)",
            );
        });

        it("apply vs sequence", () => {
            expect(printWithParen("f : x g : y")).toStrictEqual("(f:x) (g:y)");
        });

        it("apply vs binary", () => {
            expect(printWithParen("f : x /add g : y")).toStrictEqual(
                "(f:x) /add (g:y)",
            );
        });
        it("binary vs sequence", () => {
            expect(printWithParen("a b /add c d")).toStrictEqual(
                "(a b) /add (c d)",
            );
        });

        it("should parse binaryExpression", () => {
            expect(parseAndPrint("a /b c")).toStrictEqual(
                "(sourceFile (expression (expression (word a)) / (word b) (expression (word c))) <EOF>)",
            );
        });

        it("should parse sequenceExpression", () => {
            expect(parseAndPrint("a b c")).toStrictEqual(
                "(sourceFile (expression (expression (expression (word a)) (expression (word b))) (expression (word c))) <EOF>)",
            );
        });

        it("should parse orExpression", () => {
            expect(parseAndPrint("a or b")).toStrictEqual(
                "(sourceFile (expression (expression (word a)) or (expression (word b))) <EOF>)",
            );
            expect(parseAndPrint("a or b or c")).toStrictEqual(
                "(sourceFile (expression (expression (expression (word a)) or (expression (word b))) or (expression (word c))) <EOF>)",
            );
        });

        it("should parse whereClause", () => {
            expect(parseAndPrint("a @ where x = 1")).toStrictEqual(
                "(sourceFile (expression (expression (word a)) @ where (parameter (word x)) = (expression 1)) <EOF>)",
            );
            expect(parseAndPrint("a @where @x = 1 @where y = 2")).toStrictEqual(
                "(sourceFile (expression (expression (expression (word a)) @ where (parameter (identifier @ (word x))) = (expression 1)) @ where (parameter (word y)) = (expression 2)) <EOF>)",
            );
            expect(
                parseAndPrint("a @where x = (b @where c = 1) @where y = 2"),
            ).toStrictEqual(
                "(sourceFile (expression (expression (expression (word a)) @ where (parameter (word x)) = (expression ( (expression (expression (word b)) @ where (parameter (word c)) = (expression 1)) ))) @ where (parameter (word y)) = (expression 2)) <EOF>)",
            );
            expect(parseAndPrint("a @where x = y /z w")).toStrictEqual(
                "(sourceFile (expression (expression (word a)) @ where (parameter (word x)) = (expression (expression (word y)) / (word z) (expression (word w)))) <EOF>)",
            );
        });

        it("should parse lambdaExpression", () => {
            expect(parseAndPrint("@function x: x")).toStrictEqual(
                "(sourceFile (expression @ function (parameter (word x)) : (expression (word x))) <EOF>)",
            );
            expect(parseAndPrint("@fn x: x")).toStrictEqual(
                "(sourceFile (expression @ fn (parameter (word x)) : (expression (word x))) <EOF>)",
            );
            expect(parseAndPrint("@fn @x: x")).toStrictEqual(
                "(sourceFile (expression @ fn (parameter (identifier @ (word x))) : (expression (word x))) <EOF>)",
            );
            expect(printWithParen("@fn x: @fn y: x")).toStrictEqual(
                "@fn x: (@fn y: x)",
            );
            expect(printWithParen("a:@fn x: x")).toStrictEqual("a:(@fn x: x)");
            expect(printWithParen("@fn x: @x /add 1")).toStrictEqual(
                "@fn x: (@x /add 1)",
            );
        });

        it("should parse complex expressions", () => {
            expect(parseAndPrint("a:b /c d or e @where x = 1")).toStrictEqual(
                "(sourceFile (expression (expression (expression (expression (word a)) : (expression (word b))) / (word c) (expression (expression (word d)) or (expression (word e)))) @ where (parameter (word x)) = (expression 1)) <EOF>)",
            );
            expect(parseAndPrint("(@fn x: x):1")).toStrictEqual(
                "(sourceFile (expression (expression ( (expression @ fn (parameter (word x)) : (expression (word x))) )) : (expression 1)) <EOF>)",
            );
        });

        function errorCount(source: string) {
            const parser = new SalParser(
                new CommonTokenStream(
                    new SalLexer(CharStreams.fromString(source)),
                ),
            );
            // Suppress console.error from ANTLR
            const errorListener = {
                syntaxError: ignore,
                reportAmbiguity: ignore,
                reportAttemptingFullContext: ignore,
                reportContextSensitivity: ignore,
            };
            parser.removeErrorListeners();
            parser.addErrorListener(errorListener);
            parser.sourceFile();
            return parser.numberOfSyntaxErrors;
        }
        it("should throw error on invalid syntax", () => {
            expect(errorCount("(a")).toBeGreaterThan(0);
            expect(errorCount("(1 /add 2")).toBeGreaterThan(0);
        });

        it("empty input", () => {
            expect(parseAndPrint("")).toBe("(sourceFile <EOF>)");
        });
    });
});
