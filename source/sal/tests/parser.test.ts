// spell-checker:words antlr
import { CharStreams, CommonTokenStream } from "antlr4ts";
import { SalLexer } from "../.antlr-generated/SalLexer";
import { SalParser } from "../.antlr-generated/SalParser";
import { describe, it, expect } from "vitest";
import { ignore } from "../../standard-extensions";

function parseAndPrint(input: string) {
    const inputStream = CharStreams.fromString(input);
    const lexer = new SalLexer(inputStream);
    const tokenStream = new CommonTokenStream(lexer);
    const parser = new SalParser(tokenStream);
    return parser.sourceFile().toStringTree(parser);
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
            expect(parseAndPrint("-123")).toStrictEqual(
                "(sourceFile (expression -123) <EOF>)",
            );
            expect(parseAndPrint("-@ident")).toStrictEqual(
                "(sourceFile (expression - (expression (identifier @ ident))) <EOF>)",
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
            expect(parseAndPrint("a @where x = 1")).toStrictEqual(
                "(sourceFile (expression (expression a) (whereClause @ where (simpleParameter x) = (expression 1))) <EOF>)",
            );
            expect(parseAndPrint("a @ where x = 1")).toStrictEqual(
                "(sourceFile (expression (expression a) (whereClause @ where (simpleParameter x) = (expression 1))) <EOF>)",
            );
            expect(parseAndPrint("a @where @x = 1")).toStrictEqual(
                "(sourceFile (expression (expression a) (whereClause @ where (simpleParameter (identifier @ x)) = (expression 1))) <EOF>)",
            );
            expect(parseAndPrint("a @where x = 1 @y = 2")).toStrictEqual(
                "(sourceFile (expression (expression a) (whereClause @ where (simpleParameter x) = (expression 1) (declaration (identifier @ y) = (expression 2)))) <EOF>)",
            );
            expect(parseAndPrint("a @where x = 1 @y = 2 @end")).toStrictEqual(
                "(sourceFile (expression (expression a) (whereClause @ where (simpleParameter x) = (expression 1) (declaration (identifier @ y) = (expression 2)) (atEnd @ end))) <EOF>)",
            );
            expect(parseAndPrint("a @where x = y /z w")).toStrictEqual(
                "(sourceFile (expression (expression a) (whereClause @ where (simpleParameter x) = (expression (expression y) / z (expression w)))) <EOF>)",
            );
        });

        it("should parse lambdaExpression", () => {
            expect(parseAndPrint("@lambda x: x")).toStrictEqual(
                "(sourceFile (expression @ lambda (simpleParameter x) : (expression x)) <EOF>)",
            );
            expect(parseAndPrint("@lambda x: x+1 @end")).toStrictEqual(
                "(sourceFile (expression @ lambda (simpleParameter x) : (expression x+1) (atEnd @ end)) <EOF>)",
            );
            expect(parseAndPrint("a:@lambda x:x")).toStrictEqual(
                "(sourceFile (expression (expression a) : (expression @ lambda (simpleParameter x) : (expression x))) <EOF>)",
            );
        });

        it("should parse complex expressions", () => {
            expect(parseAndPrint("a:b /c d or e @where x = 1")).toStrictEqual(
                "(sourceFile (expression (expression (expression (expression a) : (expression b)) / c (expression (expression d) or (expression e))) (whereClause @ where (simpleParameter x) = (expression 1))) <EOF>)",
            );
            expect(parseAndPrint("(@lambda x: x):1")).toStrictEqual(
                "(sourceFile (expression (expression ( (expression @ lambda (simpleParameter x) : (expression x)) )) : (expression 1)) <EOF>)",
            );
        });

        it("should throw error on invalid syntax", () => {
            const parser = new SalParser(
                new CommonTokenStream(
                    new SalLexer(CharStreams.fromString("(a")),
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
            expect(parser.numberOfSyntaxErrors).toBeGreaterThan(0);
        });

        it("should handle empty input", () => {
            const parser = new SalParser(
                new CommonTokenStream(new SalLexer(CharStreams.fromString(""))),
            );
            parser.sourceFile();
            expect(parser.numberOfSyntaxErrors).toBe(1);
        });
    });
});
