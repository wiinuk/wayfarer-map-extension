grammar Sal;

// ========================================== 構文規則 (Parser Rules) ==========================================

sourceFile: expression EOF;

atEnd: AT 'end';

identifier: AT (WORD | STRING);

// @ を省略可能なパラメータ
simpleParameter: identifier | WORD;

declaration: identifier EQUALS expression;
whereClause:
	AT 'where' simpleParameter EQUALS expression declaration* atEnd?;

expression:

	// LambdaExpression
	AT 'lambda' simpleParameter COLON expression atEnd?
	// NotExpression
	| MINUS expression
	// ApplyExpression
	| expression COLON expression
	// SequenceExpression
	| expression expression
	// OrExpression
	| expression OR expression
	// BinaryExpression
	| expression SLASH WORD expression

	// PrimaryExpression
	| NUMBER
	| STRING
	| identifier
	| WORD
	| '(' expression ')'

	// WhereExpression
	| expression whereClause;

// ========================================== 字句規則 (Lexer Rules) ==========================================

// キーワード (WORDより先に定義して優先させる)
OR: 'or';

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

// \p{L} : あらゆる言語の「文字」(Letter)、\p{N} : あらゆる言語の「数字」(Number)、\p{M} : 結合文字 (アクセント記号など) 
fragment WORD_START: [\p{L}\p{N}\p{M}+.?!,;];
fragment WORD_PART: [\p{L}\p{N}\p{M}+.?!,;\-];
WORD: WORD_START WORD_PART*;

// コメント
LINE_COMMENT: '//' ~[\r\n]* -> skip;
BLOCK_COMMENT: '/*' ( BLOCK_COMMENT | .)*? '*/' -> skip;