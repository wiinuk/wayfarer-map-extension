// spell-checker:words antlr
import {
    CharStreams,
    CommonTokenStream,
    ParserRuleContext,
    Token,
    type ANTLRErrorListener,
} from "antlr4ts";
import { SalLexer } from "./.antlr-generated/SalLexer";
import {
    AndExpressionContext,
    ApplyExpressionContext,
    BinaryExpressionContext,
    ExpressionContext,
    LambdaExpressionContext,
    ListLiteralExpressionContext,
    NotExpressionContext,
    NumberContext,
    OrExpressionContext,
    ParameterContext,
    ParenthesizedExpressionContext,
    RecordLiteralExpressionContext,
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
import { TerminalNode } from "antlr4ts/tree/TerminalNode";
import { ErrorNode } from "antlr4ts/tree/ErrorNode";
import { type ParseTree } from "antlr4ts/tree/ParseTree";
import { type RuleNode } from "antlr4ts/tree/RuleNode";
import { done, type Effective } from "./effective";

export interface SourcePosition {
    readonly line: number;
    readonly column: number;
    readonly index: number;
}
export interface SourceRange {
    readonly start: SourcePosition;
    readonly stop: SourcePosition;
}

interface SalEvaluationErrorOptions extends ErrorOptions {
    readonly range?: SourceRange;
}
export class SalEvaluationError extends Error {
    static {
        this.prototype.name = "SalEvaluationError";
    }
    readonly range?: SourceRange;
    constructor(message: string, options?: SalEvaluationErrorOptions) {
        super(message, options);
        this.range = options?.range;
    }
}
function raiseEvaluationError(
    message: string,
    options?: SalEvaluationErrorOptions,
): never {
    throw new SalEvaluationError(message, options);
}

type LocatableNode = TerminalNode | ParserRuleContext;
export function getNodeRange(node: LocatableNode): SourceRange {
    let start: Token;
    let stop: Token;
    if (node instanceof ParserRuleContext) {
        start = node.start;
        stop = node.stop ?? node.start;
    } else {
        start = node.symbol;
        stop = node.symbol;
    }

    return {
        start: {
            line: start.line,
            column: start.charPositionInLine,
            index: start.startIndex,
        },
        stop: {
            line: stop.line,
            column: stop.charPositionInLine + (stop.text?.length ?? 0),
            index: stop.stopIndex,
        },
    };
}

function raiseWith(message: string, location: LocatableNode) {
    return raiseEvaluationError(message, { range: getNodeRange(location) });
}
const unreachable = (node: LocatableNode | ParseTree) => {
    if (node instanceof TerminalNode || node instanceof ParserRuleContext) {
        return raiseWith(`unreachable: ${node.toString()}`, node);
    }
    return raiseEvaluationError(
        `unreachable: ${(node satisfies ParseTree).toStringTree()}`,
    );
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
function getNameOfWordOrString(
    e: {
        STRING(): TerminalNode | undefined;
        word(): WordContext | undefined;
    } & LocatableNode,
) {
    const v = e.STRING();
    if (v != null) return getStringValue(v);

    const w = e.word();
    if (w != null) return getWordValue(w);

    return unreachable(e);
}
function getParameterName(e: ParameterContext) {
    return getWordValue(e.word());
}

type SalFunction<in T extends Value = Value, out R extends Value = Value> = (
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

function forceAsFunction<T extends Value = Value, R extends Value = Value>(
    x: Value,
    location: LocatableNode,
) {
    if (typeof x !== "function") {
        return raiseWith(`${x} is not function`, location);
    }
    return x as SalFunction<T, R>;
}

function* callWithLocation<T, R>(
    f: (x: T) => Effective<R>,
    value: T,
    location: LocatableNode,
) {
    try {
        return yield* f(value);
    } catch (e) {
        if (e instanceof SalEvaluationError) throw e;

        const message =
            e instanceof Error ? e.message : "sal function call error";
        return raiseEvaluationError(message, {
            range: getNodeRange(location),
            cause: e,
        });
    }
}
function* callWithLocation2<T1, T2, R>(
    f: (x1: T1) => Effective<(x2: T2) => Effective<R>>,
    x1: T1,
    l1: LocatableNode,
    x2: T2,
    l2: LocatableNode,
) {
    return yield* callWithLocation(yield* callWithLocation(f, x1, l1), x2, l2);
}
function* callWithLocation3<T1, T2, T3, R>(
    f: (x1: T1) => Effective<(x2: T2) => Effective<(x3: T3) => Effective<R>>>,
    x1: T1,
    l1: LocatableNode,
    x2: T2,
    l2: LocatableNode,
    x3: T3,
    l3: LocatableNode,
) {
    return yield* callWithLocation(
        yield* callWithLocation(yield* callWithLocation(f, x1, l1), x2, l2),
        x3,
        l3,
    );
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
    resolveVariable(name: string, location: LocatableNode) {
        const v = this.tryResolveVariable(name);
        if (v === undefined)
            return raiseWith(`undefined variable: ${name}`, location);
        return v;
    }
    resolveVariableAsFunction<T extends Value, R extends Value>(
        name: string,
        location: LocatableNode,
    ) {
        return forceAsFunction<T, R>(
            this.resolveVariable(name, location),
            location,
        );
    }
    *evaluateBinaryLikeExpression(
        left: ExpressionContext,
        opName: string,
        op: LocatableNode,
        right: ExpressionContext,
    ) {
        const l = yield* this.visitExpression(left);
        const f = this.resolveVariableAsFunction<Value, SalFunction>(
            opName,
            op,
        );
        const r = yield* this.visitExpression(right);
        return yield* callWithLocation2(f, l, left, r, right);
    }

    *visitExpression(e: ExpressionContext): Effective<Value> {
        // `a or` => `a or fromMissing:null`
        if (e.exception) {
            const fromVoid = this.resolveVariableAsFunction("fromMissing", e);
            return yield* callWithLocation(fromVoid, null, e);
        }
        return yield* e.accept(this);
    }
    visitSourceFile(e: SourceFileContext): Effective<Value> {
        const body = e.expression();
        if (body == null) {
            const fromEmpty = this.resolveVariableAsFunction("fromVoid", e);
            return callWithLocation(fromEmpty, null, e);
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
        const not = this.resolveVariableAsFunction("not_", e.MINUS());
        const operand = e.expression();
        const v = yield* this.visitExpression(operand);
        return yield* callWithLocation(not, v, operand);
    }
    *visitApplyExpression(e: ApplyExpressionContext): Effective<Value> {
        const f = forceAsFunction(
            yield* this.visitExpression(e._left),
            e._left,
        );
        const x = yield* this.evaluateExpressionAsLiteral(e._right);
        return yield* callWithLocation(f, x, e._right);
    }
    visitSequenceExpression(e: SequenceExpressionContext): Effective<Value> {
        return this.evaluateBinaryLikeExpression(e._left, "_seq_", e, e._right);
    }
    visitOrExpression(e: OrExpressionContext): Effective<Value> {
        return this.evaluateBinaryLikeExpression(
            e._left,
            "_or_",
            e.OR(),
            e._right,
        );
    }
    visitAndExpression(e: AndExpressionContext): Effective<Value> {
        return this.evaluateBinaryLikeExpression(
            e._left,
            "_and_",
            e.AND(),
            e._right,
        );
    }
    *visitBinaryExpression(e: BinaryExpressionContext): Effective<Value> {
        const l = yield* this.visitExpression(e._left);
        const f = e.word();
        const op = this.resolveVariableAsFunction<Value, SalFunction>(
            getWordValue(f),
            f,
        );
        const r = yield* this.visitExpression(e._right);
        return yield* callWithLocation2(op, l, e._left, r, e._right);
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
        const number = e.NUMBER();
        const value = getNumberValue(number);
        if (e.AT() != null) return done(value);

        const fromNumber = this.resolveVariableAsFunction<number, Value>(
            "fromNumber",
            e,
        );
        return callWithLocation(fromNumber, value, number);
    }
    visitString(e: StringContext): Effective<Value> {
        const string = e.STRING();
        const value = getStringValue(string);
        if (e.AT() != null) return done(value);

        const fromString = this.resolveVariableAsFunction<string, Value>(
            "fromString",
            e,
        );
        return callWithLocation(fromString, value, string);
    }
    visitVariable(e: VariableContext): Effective<Value> {
        const name = getWordValue(e.word());
        return done(this.resolveVariable(name, e));
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
        const fromWord = this.resolveVariableAsFunction<string, Value>(
            "fromWord",
            e,
        );
        return callWithLocation(fromWord, name, e);
    }
    visitParenthesizedExpression(
        e: ParenthesizedExpressionContext,
    ): Effective<Value> {
        return this.visitExpression(e.expression());
    }

    evaluateExpressionAsLiteral(e: ExpressionContext) {
        if (e instanceof NumberContext) {
            return done(getNumberValue(e.NUMBER()));
        }
        if (e instanceof StringContext) {
            return done(getStringValue(e.STRING()));
        }
        return this.visitExpression(e);
    }
    *visitListLiteralExpression(
        e: ListLiteralExpressionContext,
    ): Effective<Value> {
        // [1, 2] -> consList:(consList:(getEmptyList:null):1):2)
        const getEmptyList = this.resolveVariableAsFunction("getEmptyList", e);

        let list = yield* callWithLocation(getEmptyList, null, e);
        let consList;
        for (const item of e.expression()) {
            const x = yield* this.evaluateExpressionAsLiteral(item);
            consList ??= this.resolveVariableAsFunction<Value, SalFunction>(
                "consList",
                item,
            );
            list = yield* callWithLocation2(consList, list, item, x, item);
        }
        return list;
    }
    *visitRecordLiteralExpression(
        e: RecordLiteralExpressionContext,
    ): Effective<Value> {
        const getEmptyRecord = this.resolveVariableAsFunction(
            "getEmptyRecord",
            e,
        );
        let record = yield* callWithLocation(getEmptyRecord, null, e);
        let consRecord;
        for (const entry of e.entry()) {
            const key = getNameOfWordOrString(entry);
            const value = yield* this.evaluateExpressionAsLiteral(
                entry.expression(),
            );
            consRecord ??= this.resolveVariableAsFunction<
                Value,
                SalFunctionMany<[Value, Value], Value>
            >("consRecord", entry);
            record = yield* callWithLocation3(
                consRecord,
                record,
                entry,
                key,
                entry,
                value,
                entry,
            );
        }
        return record;
    }
}

export function createStandardGlobals() {
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

        getEmptyList(_) {
            return done([]);
        },
        consList(list) {
            return done((item) => {
                (list as Value[]).push(item);
                return done(list);
            });
        },
        getEmptyRecord(_) {
            const x: Value = Object.create(null);
            return done(x);
        },
        consRecord(record) {
            return done((k) => {
                return done((v) => {
                    (record as Record<string, Value>)[k as string] = v;
                    return done(record);
                });
            });
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

export type ErrorReporter = (
    message: string,
    startIndex: number,
    stopIndex: number,
) => void;
export function evaluateExpression(
    source: string,
    resolveGlobal: (key: string) => Value | undefined,
    reportError?: ErrorReporter,
) {
    const chars = CharStreams.fromString(source);
    const lexer = new SalLexer(chars);
    const tokens = new CommonTokenStream(lexer);
    const parser = new SalParser(tokens);

    if (reportError) {
        const errorListener: ANTLRErrorListener<number | Token> = {
            syntaxError(
                recognizer,
                offendingSymbol,
                _line,
                _charPositionInLine,
                message,
                _exception,
            ) {
                if (typeof offendingSymbol !== "number") {
                    if (offendingSymbol != null) {
                        reportError(
                            message,
                            offendingSymbol.startIndex,
                            offendingSymbol.stopIndex,
                        );
                    }
                } else {
                    if (recognizer.inputStream) {
                        const startIndex = recognizer.inputStream.index;
                        reportError(message, startIndex, startIndex + 1);
                    }
                }
            },
        };
        lexer.removeErrorListeners();
        lexer.addErrorListener(errorListener);
        parser.removeErrorListeners();
        parser.addErrorListener(errorListener);
    }
    const tree = parser.sourceFile();

    const globals = createStandardGlobals();
    const tryResolveGlobalVariable = (k: string) => {
        const v = resolveGlobal(k);
        if (v !== undefined) return v;
        return globals.get(k);
    };
    return tree.accept(new SalEvaluationVisitor(tryResolveGlobalVariable));
}
