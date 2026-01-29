import { AssignItem, CallExpr, Expr, FunctionDef, Param, Program, Statement } from "./ast.js";

type TokenType = "identifier" | "number" | "string" | "operator" | "punct" | "arrow" | "keyword" | "eof";

interface Token {
  type: TokenType;
  value: string;
  line: number;
  col: number;
}

const keywords = new Set(["compose", "lazy_compose", "export", "true", "false", "null", "ternary"]);
const operators = new Set(["+", "-", "*", "/", "&", "|", "<", ">", "="]);

class Lexer {
  private pos = 0;
  private line = 1;
  private col = 1;

  constructor(private input: string) {}

  next(): Token {
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

  private readString(): Token {
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

  private escape(ch: string): string {
    if (ch === "n") return "\n";
    if (ch === "t") return "\t";
    return ch;
  }

  private readNumber(): Token {
    const startLine = this.line;
    const startCol = this.col;
    let value = "";
    while (this.pos < this.input.length && (this.isDigit(this.input[this.pos]) || this.input[this.pos] === ".")) {
      value += this.input[this.pos];
      this.advance();
    }
    return { type: "number", value, line: startLine, col: startCol };
  }

  private readIdentifier(): Token {
    const startLine = this.line;
    const startCol = this.col;
    let value = "";
    while (
      this.pos < this.input.length &&
      (this.isAlphaNum(this.input[this.pos]) || this.input[this.pos] === "_" || this.input[this.pos] === ".")
    ) {
      value += this.input[this.pos];
      this.advance();
    }
    const type: TokenType = keywords.has(value) ? "keyword" : "identifier";
    return { type, value, line: startLine, col: startCol };
  }

  private skipWhitespace() {
    while (this.pos < this.input.length) {
      const ch = this.input[this.pos];
      if (ch === " " || ch === "\t" || ch === "\r") {
        this.advance();
      } else if (ch === "\n") {
        this.advance();
        this.line++;
        this.col = 1;
      } else if (ch === "/" && this.peek() === "/") {
        while (this.pos < this.input.length && this.input[this.pos] !== "\n") {
          this.advance();
        }
      } else {
        break;
      }
    }
  }

  private advance() {
    this.pos++;
    this.col++;
  }

  private peek(): string {
    return this.input[this.pos + 1] ?? "";
  }

  private isDigit(ch: string): boolean {
    return ch >= "0" && ch <= "9";
  }

  private isAlpha(ch: string): boolean {
    return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z");
  }

  private isAlphaNum(ch: string): boolean {
    return this.isAlpha(ch) || this.isDigit(ch);
  }
}

export function parse(source: string): Program {
  const lexer = new Lexer(source);
  const tokens: Token[] = [];
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

  const expect = (type: TokenType, value?: string): Token => {
    const t = next();
    if (t.type !== type || (value !== undefined && t.value !== value)) {
      throw new Error(`Expected ${value ?? type} at ${t.line}:${t.col}`);
    }
    return t;
  };

  const match = (type: TokenType, value?: string): boolean => {
    const t = peek();
    if (t.type !== type) return false;
    if (value !== undefined && t.value !== value) return false;
    return true;
  };

  const parseExpr = (): Expr => {
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
      const args: Expr[] = [];
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
      return { kind: "call", name: nameToken.value, args } as CallExpr;
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

  const parseParams = (): Param[] => {
    const params: Param[] = [];
    if (match("punct", ")")) return params;
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

  const parseBlockExpr = (): Expr => {
    const items: (Expr | AssignItem)[] = [];
    while (!match("punct", "}")) {
      if (
        match("identifier") &&
        peekNext()?.value === "=" &&
        (peekNext()?.type === "punct" || peekNext()?.type === "operator")
      ) {
        const name = expect("identifier").value;
        if (match("punct", "=")) {
          next();
        } else {
          expect("operator", "=");
        }
        const expr = parseExpr();
        items.push({ kind: "assign", name, expr } as AssignItem);
      } else {
        items.push(parseExpr());
      }
      if (match("punct", ";")) {
        next();
      }
    }
    if (items.length === 0) throw new Error("Empty block not allowed");
    if (items.length === 1 && items[0].kind !== "assign") return items[0] as Expr;
    return { kind: "block", items };
  };

  const parseBlockFn = (): FunctionDef => {
    const name = expect("identifier").value;
    expect("punct", "{");
    const body = parseBlockExpr();
    expect("punct", "}");
    return { kind: "fn", name, params: [], body };
  };

  const parseExport = (): Statement => {
    expect("keyword", "export");
    const name = expect("identifier").value;
    if (match("punct", ";")) next();
    return { kind: "export", name };
  };

  const statements: Statement[] = [];
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
