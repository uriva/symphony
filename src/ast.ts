export type Type =
  | { kind: "number" }
  | { kind: "boolean" }
  | { kind: "string" }
  | { kind: "null" }
  | { kind: "array"; element: Type }
  | { kind: "object"; fields: Record<string, Type> };

export interface Param {
  name: string;
}

export type Expr = LiteralExpr | VarExpr | CallExpr | BlockExpr;

export interface LiteralExpr {
  kind: "literal";
  value: number | boolean | string | null;
}

export interface VarExpr {
  kind: "var";
  name: string;
}

export interface CallExpr {
  kind: "call";
  name: string;
  args: Expr[];
}

export interface BlockExpr {
  kind: "block";
  items: BlockItem[];
}

export interface AssignItem {
  kind: "assign";
  name: string;
  expr: Expr;
}

export type BlockItem = Expr | AssignItem;

export interface FunctionDef {
  kind: "fn";
  name: string;
  params: Param[];
  body: Expr;
}

export interface ComposeDef {
  kind: "compose";
  name: string;
  a: string;
  b: string;
  key: string;
  lazy: boolean;
}

export interface ExportDef {
  kind: "export";
  name: string;
}

export type Statement = FunctionDef | ComposeDef | ExportDef;

export interface Program {
  statements: Statement[];
}
