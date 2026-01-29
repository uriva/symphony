const keywords = new Set(["compose", "lazy_compose", "export", "true", "false", "null", "ternary"]);
const operators = new Set(["+", "-", "*", "/", "&", "|", "<", ">", "="]);
class Lexer {
    input;
    pos = 0;
    line = 1;
    col = 1;
    constructor(input) {
        this.input = input;
    }
    next() {
        this.skipWhitespace();
        if (this.pos >= this.input.length) {
            return { type: "eof", value: "", line: this.line, col: this.col };
        }
        const ch = this.input[this.pos];
        if (ch === "-" && this.peek() === ">") {
            this.advance();
            this.advance();
            return { type: "arrow", value: "->", line: this.line, col: this.col - 2 };
        }
        if (operators.has(ch)) {
            this.advance();
            return { type: "operator", value: ch, line: this.line, col: this.col - 1 };
        }
        if ("(){}[],:;\n".includes(ch)) {
            this.advance();
            return { type: "punct", value: ch, line: this.line, col: this.col - 1 };
        }
        if (ch === '"') {
            return this.readString();
        }
        if (this.isDigit(ch) || (ch === "." && this.isDigit(this.peek()))) {
            return this.readNumber();
        }
        if (this.isAlpha(ch)) {
            return this.readIdentifier();
        }
        throw new Error(`Unexpected character '${ch}' at ${this.line}:${this.col}`);
    }
    readString() {
        const startLine = this.line;
        const startCol = this.col;
        this.advance();
        let value = "";
        while (this.pos < this.input.length && this.input[this.pos] !== '"') {
            const ch = this.input[this.pos];
            if (ch === "\\") {
                const next = this.peek();
                if (next === "\"" || next === "\\" || next === "n" || next === "t") {
                    value += this.escape(next);
                    this.advance();
                    this.advance();
                    continue;
                }
            }
            value += ch;
            this.advance();
        }
        if (this.input[this.pos] !== '"') {
            throw new Error(`Unterminated string at ${startLine}:${startCol}`);
        }
        this.advance();
        return { type: "string", value, line: startLine, col: startCol };
    }
    escape(ch) {
        if (ch === "n")
            return "\n";
        if (ch === "t")
            return "\t";
        return ch;
    }
    readNumber() {
        const startLine = this.line;
        const startCol = this.col;
        let value = "";
        while (this.pos < this.input.length && (this.isDigit(this.input[this.pos]) || this.input[this.pos] === ".")) {
            value += this.input[this.pos];
            this.advance();
        }
        return { type: "number", value, line: startLine, col: startCol };
    }
    readIdentifier() {
        const startLine = this.line;
        const startCol = this.col;
        let value = "";
        while (this.pos < this.input.length &&
            (this.isAlphaNum(this.input[this.pos]) || this.input[this.pos] === "_" || this.input[this.pos] === ".")) {
            value += this.input[this.pos];
            this.advance();
        }
        const type = keywords.has(value) ? "keyword" : "identifier";
        return { type, value, line: startLine, col: startCol };
    }
    skipWhitespace() {
        while (this.pos < this.input.length) {
            const ch = this.input[this.pos];
            if (ch === " " || ch === "\t" || ch === "\r") {
                this.advance();
            }
            else if (ch === "\n") {
                this.advance();
                this.line++;
                this.col = 1;
            }
            else if (ch === "/" && this.peek() === "/") {
                while (this.pos < this.input.length && this.input[this.pos] !== "\n") {
                    this.advance();
                }
            }
            else {
                break;
            }
        }
    }
    advance() {
        this.pos++;
        this.col++;
    }
    peek() {
        return this.input[this.pos + 1] ?? "";
    }
    isDigit(ch) {
        return ch >= "0" && ch <= "9";
    }
    isAlpha(ch) {
        return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z");
    }
    isAlphaNum(ch) {
        return this.isAlpha(ch) || this.isDigit(ch);
    }
}
export function parse(source) {
    const lexer = new Lexer(source);
    const tokens = [];
    let tok = lexer.next();
    while (tok.type !== "eof") {
        tokens.push(tok);
        tok = lexer.next();
    }
    tokens.push(tok);
    let index = 0;
    const peek = () => tokens[index];
    const peekNext = () => tokens[index + 1];
    const next = () => tokens[index++];
    const expect = (type, value) => {
        const t = next();
        if (t.type !== type || (value !== undefined && t.value !== value)) {
            throw new Error(`Expected ${value ?? type} at ${t.line}:${t.col}`);
        }
        return t;
    };
    const match = (type, value) => {
        const t = peek();
        if (t.type !== type)
            return false;
        if (value !== undefined && t.value !== value)
            return false;
        return true;
    };
    const parseExpr = () => {
        const t = peek();
        if (t.type === "number") {
            next();
            return { kind: "literal", value: Number(t.value) };
        }
        if (t.type === "string") {
            next();
            return { kind: "literal", value: t.value };
        }
        if (t.type === "keyword" && (t.value === "true" || t.value === "false" || t.value === "null")) {
            next();
            return { kind: "literal", value: t.value === "true" ? true : t.value === "false" ? false : null };
        }
        if (t.type === "keyword" && (t.value === "compose" || t.value === "lazy_compose")) {
            const nameToken = next();
            expect("punct", "(");
            const args = [];
            if (!match("punct", ")")) {
                while (true) {
                    args.push(parseExpr());
                    if (match("punct", ",")) {
                        next();
                        continue;
                    }
                    break;
                }
            }
            expect("punct", ")");
            return { kind: "call", name: nameToken.value, args };
        }
        if (t.type === "identifier" || t.type === "operator" || (t.type === "keyword" && t.value === "ternary")) {
            const nameToken = next();
            if (nameToken.type === "identifier" || nameToken.type === "operator") {
                return { kind: "var", name: nameToken.value };
            }
            if (nameToken.type === "keyword" && nameToken.value === "ternary") {
                return { kind: "var", name: nameToken.value };
            }
            throw new Error(`Unexpected token ${nameToken.value} at ${nameToken.line}:${nameToken.col}`);
        }
        throw new Error(`Unexpected token ${t.type}:${t.value} at ${t.line}:${t.col}`);
    };
    const parseParams = () => {
        const params = [];
        if (match("punct", ")"))
            return params;
        while (true) {
            const name = expect("identifier").value;
            params.push({ name });
            if (match("punct", ",")) {
                next();
                continue;
            }
            break;
        }
        return params;
    };
    const parseBlockExpr = () => {
        const items = [];
        while (!match("punct", "}")) {
            if (match("identifier") &&
                peekNext()?.value === "=" &&
                (peekNext()?.type === "punct" || peekNext()?.type === "operator")) {
                const name = expect("identifier").value;
                if (match("punct", "=")) {
                    next();
                }
                else {
                    expect("operator", "=");
                }
                const expr = parseExpr();
                items.push({ kind: "assign", name, expr });
            }
            else {
                items.push(parseExpr());
            }
            if (match("punct", ";")) {
                next();
            }
        }
        if (items.length === 0)
            throw new Error("Empty block not allowed");
        if (items.length === 1 && items[0].kind !== "assign")
            return items[0];
        return { kind: "block", items };
    };
    const parseBlockFn = () => {
        const name = expect("identifier").value;
        expect("punct", "{");
        const body = parseBlockExpr();
        expect("punct", "}");
        return { kind: "fn", name, params: [], body };
    };
    const parseExport = () => {
        expect("keyword", "export");
        const name = expect("identifier").value;
        if (match("punct", ";"))
            next();
        return { kind: "export", name };
    };
    const statements = [];
    while (!match("eof")) {
        const t = peek();
        if (t.type === "identifier" && peekNext()?.type === "punct" && peekNext()?.value === "{") {
            statements.push(parseBlockFn());
            continue;
        }
        if (t.type === "keyword" && t.value === "export") {
            statements.push(parseExport());
            continue;
        }
        throw new Error(`Unexpected token ${t.type}:${t.value} at ${t.line}:${t.col}`);
    }
    return { statements };
}
