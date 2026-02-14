// spell-checker:words antlr
import { CharStreams, CommonTokenStream } from "antlr4ts";
import { SalLexer } from "../.antlr-generated/SalLexer";
import {
    AndExpressionContext,
    ApplyExpressionContext,
    BinaryExpressionContext,
    ExpressionContext,
    LambdaExpressionContext,
    NotExpressionContext,
    NumberContext,
    OrExpressionContext,
    ParenthesizedExpressionContext,
    SalParser,
    SequenceExpressionContext,
    SourceFileContext,
    StringContext,
    VariableContext,
    WhereExpressionContext,
    WordContext,
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

    visitSourceFile(s: SourceFileContext): string {
        const e = s.expression();
        if (!e) return "";
        return e.accept(this);
    }
    visitExpression(e: ExpressionContext): string {
        if (
            e instanceof NumberContext ||
            e instanceof StringContext ||
            e instanceof VariableContext ||
            e instanceof WordContext
        ) {
            return e.accept(this);
        }
        return `(${e.accept(this)})`;
    }

    visitLambdaExpression(e: LambdaExpressionContext): string {
        return `@lambda ${this.visitExpression(e.parameter())}: ${this.visitExpression(e.expression())}`;
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
        return `${this.visitExpression(e._left)} /${e.WORD().accept(this)} ${this.visitExpression(e._right)}`;
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
    visitWord(e: WordContext): string {
        return e.WORD().accept(this);
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
                "(sourceFile (expression (identifier @ identifier)) <EOF>)",
            );
            expect(parseAndPrint("aWord")).toStrictEqual(
                "(sourceFile (expression aWord) <EOF>)",
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
                "(sourceFile (expression - (expression (identifier @ ident))) <EOF>)",
            );
            // 2トークン
            expect(parseAndPrint("-x")).toStrictEqual(
                "(sourceFile (expression - (expression x)) <EOF>)",
            );
        });

        it("should parse applyExpression", () => {
            expect(parseAndPrint("func:arg")).toStrictEqual(
                "(sourceFile (expression (expression func) : (expression arg)) <EOF>)",
            );
            expect(parseAndPrint('"string":"another"')).toStrictEqual(
                '(sourceFile (expression (expression "string") : (expression "another")) <EOF>)',
            );
            expect(parseAndPrint("a:b:c")).toStrictEqual(
                "(sourceFile (expression (expression (expression a) : (expression b)) : (expression c)) <EOF>)",
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
                "(sourceFile (expression (expression a) / b (expression c)) <EOF>)",
            );
        });

        it("should parse sequenceExpression", () => {
            expect(parseAndPrint("a b c")).toStrictEqual(
                "(sourceFile (expression (expression (expression a) (expression b)) (expression c)) <EOF>)",
            );
        });

        it("should parse orExpression", () => {
            expect(parseAndPrint("a or b")).toStrictEqual(
                "(sourceFile (expression (expression a) or (expression b)) <EOF>)",
            );
            expect(parseAndPrint("a or b or c")).toStrictEqual(
                "(sourceFile (expression (expression (expression a) or (expression b)) or (expression c)) <EOF>)",
            );
        });

        it("should parse whereClause", () => {
            expect(parseAndPrint("a @ where x = 1")).toStrictEqual(
                "(sourceFile (expression (expression a) @ where (parameter x) = (expression 1)) <EOF>)",
            );
            expect(parseAndPrint("a @where @x = 1 @where y = 2")).toStrictEqual(
                "(sourceFile (expression (expression (expression a) @ where (parameter (identifier @ x)) = (expression 1)) @ where (parameter y) = (expression 2)) <EOF>)",
            );
            expect(
                parseAndPrint("a @where x = (b @where c = 1) @where y = 2"),
            ).toStrictEqual(
                "(sourceFile (expression (expression (expression a) @ where (parameter x) = (expression ( (expression (expression b) @ where (parameter c) = (expression 1)) ))) @ where (parameter y) = (expression 2)) <EOF>)",
            );
            expect(parseAndPrint("a @where x = y /z w")).toStrictEqual(
                "(sourceFile (expression (expression a) @ where (parameter x) = (expression (expression y) / z (expression w))) <EOF>)",
            );
        });

        it("should parse lambdaExpression", () => {
            expect(parseAndPrint("@lambda x: x")).toStrictEqual(
                "(sourceFile (expression @ lambda (parameter x) : (expression x)) <EOF>)",
            );
            expect(parseAndPrint("@lambda @x: x")).toStrictEqual(
                "(sourceFile (expression @ lambda (parameter (identifier @ x)) : (expression x)) <EOF>)",
            );
            // `@lambda x: (@lambda y: x)`
            expect(parseAndPrint("@lambda x: @lambda y: x")).toStrictEqual(
                "(sourceFile (expression @ lambda (parameter x) : (expression @ lambda (parameter y) : (expression x))) <EOF>)",
            );

            // `a:(@lambda x: x)`
            expect(parseAndPrint("a:@lambda x: x")).toStrictEqual(
                "(sourceFile (expression (expression a) : (expression @ lambda (parameter x) : (expression x))) <EOF>)",
            );
            // `@lambda x: (@x /add 1)`
            expect(parseAndPrint("@lambda x: @x /add 1")).toStrictEqual(
                "(sourceFile (expression @ lambda (parameter x) : (expression (expression (identifier @ x)) / add (expression 1))) <EOF>)",
            );
        });

        it("should parse complex expressions", () => {
            expect(parseAndPrint("a:b /c d or e @where x = 1")).toStrictEqual(
                "(sourceFile (expression (expression (expression (expression a) : (expression b)) / c (expression (expression d) or (expression e))) @ where (parameter x) = (expression 1)) <EOF>)",
            );
            expect(parseAndPrint("(@lambda x: x):1")).toStrictEqual(
                "(sourceFile (expression (expression ( (expression @ lambda (parameter x) : (expression x)) )) : (expression 1)) <EOF>)",
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
