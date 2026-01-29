import { Expr, Program, Type } from "./ast.js";
export interface FunctionInfo {
    name: string;
    params: {
        name: string;
        type: Type;
    }[];
    returnType: Type;
    body?: Expr;
    isBuiltin?: boolean;
    locals?: Map<string, Type>;
}
export interface TypedProgram {
    functions: Map<string, FunctionInfo>;
    exports: string[];
}
export declare function typecheck(program: Program): TypedProgram;
export declare function typeEquals(a: Type, b: Type): boolean;
export declare function typeToString(type: Type): string;
