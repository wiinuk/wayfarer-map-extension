grammar Sal;

// 生成ファイルに対する型チェックやリントを抑制
@header {
// @ts-nocheck
/* eslint-disable */
}

// ==========================================
// 構文規則 (Parser Rules)
// ==========================================

sourceFile: expression? EOF;

identifier: AT (WORD | STRING);

// パラメータは @ を省略可能
parameter: identifier | WORD;

expression:
    MINUS expression # NotExpression
    | left= expression COLON right= expression # ApplyExpression
    | left= expression right= expression # SequenceExpression
    | left= expression OR right= expression # OrExpression
    | left= expression AND right= expression # AndExpression
    | left= expression SLASH WORD right= expression # BinaryExpression
    | scope= expression AT 'where' parameter EQUALS value= expression # WhereExpression
    | AT 'lambda' parameter COLON expression # LambdaExpression
    | NUMBER # Number
    | STRING # String
    | identifier # Variable
    | WORD # Word
    | '(' expression ')' # ParenthesizedExpression
;

// ========================================== 
// 字句規則 (Lexer Rules) 
// ==========================================

// キーワード (WORDより先に定義して優先させる)
OR: 'or';
AND: 'and';

// 記号
PAREN_BEGIN: '(';
PAREN_END: ')';
COLON: ':';
SLASH: '/';
AT: '@';
MINUS: '-';
EQUALS: '=';

// 数値
NUMBER: '-'? [0-9]+ ('.' [0-9]+)? ([eE] '-'? [0-9]+)?;

// 文字列
STRING: '"' ( '\\' . | ~[\\"])* '"';

// 空白(Z)・制御文字(C)・特別な記号・文字列の始まり、を除く全ての文字
fragment WORD_START: ~[\p{Z}\p{C}:/@"\-'=.,;(){}<>];
// . - ' は先頭以外で許可
fragment WORD_PART: (WORD_START | [-.']);
WORD: WORD_START WORD_PART*;

// コメント
LINE_COMMENT: '//' ~[\r\n]* -> skip;
BLOCK_COMMENT: '/*' ( BLOCK_COMMENT | .)*? '*/' -> skip;

// 空白
WS: [\p{Z}]+ -> skip;