// spell-checker:words antlr
import { CharStreams, CommonTokenStream } from "antlr4ts";
import { SalLexer } from "./.antlr-generated/SalLexer";
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
} from "./.antlr-generated/SalParser";
import { type SalVisitor } from "./.antlr-generated/SalVisitor";
import { raise } from "../standard-extensions";
import { TerminalNode } from "antlr4ts/tree/TerminalNode";
import { ErrorNode } from "antlr4ts/tree/ErrorNode";
import { type ParseTree } from "antlr4ts/tree/ParseTree";
import { type RuleNode } from "antlr4ts/tree/RuleNode";
import { done, type Effective } from "./effective";

const unreachable = (node: TerminalNode | ParseTree | RuleNode) => {
    if (node instanceof TerminalNode) {
        const symbol = node.symbol;
        const position = {
            line: symbol.line,
            column: symbol.charPositionInLine,
        };
        return raise`unreachable: ${JSON.stringify(position)}, ${node.toString()}`;
    }
    return raise`unreachable: ${(node satisfies ParseTree | RuleNode).toStringTree()}`;
};

function getNumberValue(v: TerminalNode): number {
    return JSON.parse(v.text); // TODO:
}
function getStringValue(v: TerminalNode): string {
    return JSON.parse(v.text); // TODO:
}
function getWordValue(v: WordContext) {
    return v.text;
}
function getIdentifierName(e: IdentifierContext) {
    const v = e.STRING();
    if (v != null) return getStringValue(v);

    const w = e.word();
    if (w != null) return getWordValue(w);

    return unreachable(e);
}
function getParameterName(e: ParameterContext) {
    const w = e.word();
    if (w != null) return getWordValue(w);

    const id = e.identifier();
    if (id != null) return getIdentifierName(id);
    return unreachable(e);
}

type SalFunction<T extends Value = Value, R extends Value = Value> = (
    x: T,
) => Effective<R>;

type SalFunctionMany<
    TArgs extends readonly [Value, ...Value[]],
    R extends Value,
> = TArgs extends [infer head extends Value, ...infer rest]
    ? rest extends readonly [Value, ...Value[]]
        ? SalFunction<head, SalFunctionMany<rest, R>>
        : SalFunction<head, R>
    : never;

export type Value =
    | null
    | boolean
    | number
    | string
    | readonly Value[]
    | { readonly [k: string]: Value }
    | ((v: Value) => Effective<Value>);

function createNestedFunctionOrValue(
    scope: SalEvaluationVisitor,
    parameterNames: readonly string[],
    body: ExpressionContext,
) {
    const [p, ...ps] = parameterNames;
    if (p == undefined) return scope.visitExpression(body);

    return done((v: Value): Effective<Value> => {
        scope.environment.set(p, v);
        return createNestedFunctionOrValue(scope, ps, body);
    });
}

class SalEvaluationVisitor implements SalVisitor<Effective<Value>> {
    visit: (tree: ParseTree) => Effective<Value> = unreachable;
    visitChildren: (node: RuleNode) => Effective<Value> = unreachable;
    visitTerminal: (node: TerminalNode) => Effective<Value> = unreachable;
    visitErrorNode: (node: ErrorNode) => Effective<Value> = unreachable;

    readonly environment = new Map<string, Value>();
    readonly tryResolveVariable: (k: string) => Value | undefined;
    constructor(
        readonly tryResolveParentVariable: (k: string) => Value | undefined,
    ) {
        this.tryResolveVariable = (k) => {
            const v = this.environment.get(k);
            return v === undefined ? tryResolveParentVariable(k) : v;
        };
    }
    resolveVariable(name: string) {
        const v = this.tryResolveVariable(name);
        if (v === undefined) throw new Error(`undefined variable: ${name}`);
        return v;
    }
    *evaluateBinaryLikeExpression(
        left: ExpressionContext,
        opName: string,
        right: ExpressionContext,
    ) {
        const l = yield* this.visitExpression(left);
        const f = this.resolveVariable(opName) as SalFunctionMany<
            [Value, Value],
            Value
        >;
        const r = yield* this.visitExpression(right);
        return yield* (yield* f(l))(r);
    }

    visitExpression(e: ExpressionContext): Effective<Value> {
        // `a or` => `a or fromMissing:null`
        if (e.exception) {
            const fromVoid = this.resolveVariable("fromMissing") as (
                x: Value,
            ) => Effective<Value>;
            return fromVoid(null);
        }
        return e.accept(this);
    }
    visitSourceFile(e: SourceFileContext): Effective<Value> {
        const body = e.expression();
        if (body == null) {
            const fromEmpty = this.resolveVariable("fromVoid") as SalFunction;
            return fromEmpty(null);
        }
        return this.visitExpression(body);
    }
    visitLambdaExpression(e: LambdaExpressionContext): Effective<Value> {
        const newScope = new SalEvaluationVisitor(this.tryResolveVariable);
        const ps = e.parameter().map(getParameterName);
        const body = e.expression();
        return createNestedFunctionOrValue(newScope, ps, body);
    }
    *visitNotExpression(e: NotExpressionContext): Effective<Value> {
        const not = this.resolveVariable("not_") as SalFunction;
        const v = yield* this.visitExpression(e.expression());
        return yield* not(v);
    }
    *visitApplyExpression(e: ApplyExpressionContext): Effective<Value> {
        const f = (yield* this.visitExpression(e._left)) as SalFunction;
        const x = yield* this.visitExpression(e._right);
        return yield* f(x);
    }
    visitSequenceExpression(e: SequenceExpressionContext): Effective<Value> {
        return this.evaluateBinaryLikeExpression(e._left, "_seq_", e._right);
    }
    visitOrExpression(e: OrExpressionContext): Effective<Value> {
        return this.evaluateBinaryLikeExpression(e._left, "_or_", e._right);
    }
    visitAndExpression(e: AndExpressionContext): Effective<Value> {
        return this.evaluateBinaryLikeExpression(e._left, "_and_", e._right);
    }
    *visitBinaryExpression(e: BinaryExpressionContext): Effective<Value> {
        const l = yield* this.visitExpression(e._left);
        const op = this.resolveVariable(
            getWordValue(e.word()),
        ) as SalFunctionMany<[Value, Value], Value>;
        const r = yield* this.visitExpression(e._right);
        return yield* (yield* op(l))(r);
    }
    *visitWhereExpression(e: WhereExpressionContext): Effective<Value> {
        const newScope = new SalEvaluationVisitor(this.tryResolveVariable);

        const [param0, ...params] = e.parameter() as [
            ParameterContext,
            ...ParameterContext[],
        ];
        const id = getParameterName(param0);
        const ps = params.map(getParameterName);
        const value = yield* createNestedFunctionOrValue(
            newScope,
            ps,
            e._value,
        );
        newScope.environment.set(id, value);
        return yield* newScope.visitExpression(e._scope);
    }
    visitNumber(e: NumberContext): Effective<Value> {
        const value = getNumberValue(e.NUMBER());
        const fromNumber = this.resolveVariable("fromNumber") as SalFunction<
            number,
            Value
        >;
        return fromNumber(value);
    }
    visitString(e: StringContext): Effective<Value> {
        const value = getStringValue(e.STRING());
        const fromString = this.resolveVariable("fromString") as SalFunction<
            string,
            Value
        >;
        return fromString(value);
    }
    visitVariable(e: VariableContext): Effective<Value> {
        const name = getIdentifierName(e.identifier());
        return done(this.resolveVariable(name));
    }
    visitWordExpression(e: WordExpressionContext): Effective<Value> {
        return e.word().accept(this);
    }
    visitWord(e: WordContext): Effective<Value> {
        const name = getWordValue(e);

        // 変数が存在するか
        const value = this.tryResolveVariable(name);
        if (value !== undefined) return done(value);

        // 存在しないなら文字列
        const fromWord = this.resolveVariable("fromWord") as SalFunction<
            string,
            Value
        >;
        return fromWord(name);
    }
    visitParenthesizedExpression(
        e: ParenthesizedExpressionContext,
    ): Effective<Value> {
        return this.visitExpression(e.expression());
    }
}

function createStandardGlobals() {
    const globals: Readonly<Record<string, Value>> = {
        fromVoid(_) {
            return done("fromVoid");
        },
        fromMissing(_) {
            return done("fromMissing");
        },
        fromWord(x) {
            return done(`fromWord(${x})`);
        },
        fromString(x) {
            return done(`fromString(${x})`);
        },
        fromNumber(x) {
            return done(`fromNumber(${x})`);
        },
        not_(x) {
            return done(`not(${x})`);
        },
        _seq_(x) {
            return done((y) => done(`seq(${x}, ${y})`));
        },
        _or_(x) {
            return done((y) => done(`or(${x}, ${y})`));
        },
        _and_(x) {
            return done((y) => done(`and(${x}, ${y})`));
        },
    };
    return new Map<string, Value>(Object.entries(globals));
}

export function evaluateExpression(
    source: string,
    resolveGlobal: (key: string) => Value | undefined,
) {
    const chars = CharStreams.fromString(source);
    const lexer = new SalLexer(chars);
    const tokens = new CommonTokenStream(lexer);
    const parser = new SalParser(tokens);
    const tree = parser.sourceFile();

    const globals = createStandardGlobals();
    const tryResolveGlobalVariable = (k: string) => {
        const v = resolveGlobal(k);
        if (v !== undefined) return v;
        return globals.get(k);
    };
    return tree.accept(new SalEvaluationVisitor(tryResolveGlobalVariable));
}
