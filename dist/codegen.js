export function emitWat(functions, exportsList) {
    const lowered = [];
    const returnTypes = new Map();
    for (const [name, fn] of functions) {
        if (fn.isBuiltin)
            continue;
        if (!fn.body)
            continue;
        ensureWasmType(fn.returnType);
        for (const param of fn.params)
            ensureWasmType(param.type);
        returnTypes.set(name, fn.returnType);
        lowered.push({
            name,
            params: fn.params.map((p) => p.type),
            paramNames: fn.params.map((p) => p.name),
            locals: fn.locals ?? new Map(),
            returnType: fn.returnType,
            body: fn.body
        });
    }
    const lines = ["(module"];
    for (const fn of lowered) {
        const params = fn.paramNames
            .map((name, i) => `(param $${name} ${mapWatType(fn.params[i])})`)
            .join(" ");
        const result = `(result ${mapWatType(fn.returnType)})`;
        const locals = Array.from(fn.locals.entries())
            .map(([name, type]) => `(local $${name} ${mapWatType(type)})`)
            .join(" ");
        const header = [params, result, locals].filter((part) => part.length > 0).join(" ");
        lines.push(`  (func $${fn.name} ${header}`.trimEnd());
        const bodyLines = emitExpr(fn.body, fn, returnTypes).map((line) => `    ${line}`);
        lines.push(...bodyLines);
        lines.push("  )");
    }
    for (const name of exportsList) {
        lines.push(`  (export \"${name}\" (func $${name}))`);
    }
    lines.push(")");
    return lines.join("\n");
}
function emitExpr(expr, fn, returnTypes) {
    if (expr.kind === "literal") {
        if (typeof expr.value === "number")
            return [`f64.const ${expr.value}`];
        if (typeof expr.value === "boolean")
            return [`i32.const ${expr.value ? 1 : 0}`];
        throw new Error(`Literal type not supported in Wasm`);
    }
    if (expr.kind === "var") {
        const index = fn.paramNames.findIndex((name) => name === expr.name);
        if (index >= 0) {
            return [`local.get $${expr.name}`];
        }
        if (fn.locals.has(expr.name)) {
            return [`local.get $${expr.name}`];
        }
        throw new Error(`Unknown variable ${expr.name}`);
    }
    if (expr.kind === "block") {
        const exprItems = expr.items.filter((item) => item.kind !== "assign");
        if (exprItems.length !== 1) {
            throw new Error("Blocks must contain exactly one expression");
        }
        const lines = [];
        for (const item of expr.items) {
            if (item.kind !== "assign")
                continue;
            if (item.expr.kind === "call" &&
                (item.expr.name === "compose" || item.expr.name === "lazy_compose")) {
                continue;
            }
            const valueLines = emitExpr(item.expr, fn, returnTypes);
            lines.push(...valueLines);
            lines.push(`local.set $${item.name}`);
        }
        lines.push(...emitExpr(exprItems[0], fn, returnTypes));
        return lines;
    }
    if (expr.kind === "call") {
        if (expr.name === "ternary") {
            const cond = emitExpr(expr.args[0], fn, returnTypes);
            const tBranch = emitExpr(expr.args[1], fn, returnTypes);
            const fBranch = emitExpr(expr.args[2], fn, returnTypes);
            const resultType = inferWatType(expr.args[1], fn, returnTypes);
            return [
                ...cond,
                `(if (result ${resultType})`,
                `  (then`,
                ...indentLines(tBranch, 4),
                `  )`,
                `  (else`,
                ...indentLines(fBranch, 4),
                `  )`,
                `)`
            ];
        }
        if (expr.name === "+" || expr.name === "-" || expr.name === "*" || expr.name === "/") {
            const left = emitExpr(expr.args[0], fn, returnTypes);
            const right = emitExpr(expr.args[1], fn, returnTypes);
            const op = expr.name === "+"
                ? "f64.add"
                : expr.name === "-"
                    ? "f64.sub"
                    : expr.name === "*"
                        ? "f64.mul"
                        : "f64.div";
            return [...left, ...right, op];
        }
        if (expr.name === "<" || expr.name === ">" || expr.name === "=") {
            const left = emitExpr(expr.args[0], fn, returnTypes);
            const right = emitExpr(expr.args[1], fn, returnTypes);
            const op = expr.name === "<" ? "f64.lt" : expr.name === ">" ? "f64.gt" : "f64.eq";
            return [...left, ...right, op];
        }
        if (expr.name === "&" || expr.name === "|") {
            const left = emitExpr(expr.args[0], fn, returnTypes);
            const right = emitExpr(expr.args[1], fn, returnTypes);
            const op = expr.name === "&" ? "i32.and" : "i32.or";
            return [...left, ...right, op];
        }
        const args = expr.args.flatMap((arg) => emitExpr(arg, fn, returnTypes));
        return [...args, `call $${expr.name}`];
    }
    throw new Error(`Unhandled expression`);
}
function mapWatType(type) {
    if (type.kind === "number")
        return "f64";
    if (type.kind === "boolean")
        return "i32";
    throw new Error(`Type ${type.kind} not supported in Wasm backend`);
}
function ensureWasmType(type) {
    if (type.kind === "number" || type.kind === "boolean")
        return;
    throw new Error(`Type ${type.kind} not supported in Wasm backend`);
}
function inferWatType(expr, fn, returnTypes) {
    if (expr.kind === "literal") {
        if (typeof expr.value === "number")
            return "f64";
        if (typeof expr.value === "boolean")
            return "i32";
        throw new Error(`Literal type not supported`);
    }
    if (expr.kind === "var") {
        const index = fn.paramNames.findIndex((name) => name === expr.name);
        if (index < 0)
            throw new Error(`Unknown variable ${expr.name}`);
        return mapWatType(fn.params[index]);
    }
    if (expr.kind === "call") {
        if (expr.name === "&" || expr.name === "|" || expr.name === "<" || expr.name === ">" || expr.name === "=") {
            return "i32";
        }
        if (expr.name === "+" || expr.name === "-" || expr.name === "*" || expr.name === "/")
            return "f64";
        if (expr.name === "ternary")
            return inferWatType(expr.args[1], fn, returnTypes);
        const ret = returnTypes.get(expr.name);
        if (!ret)
            throw new Error(`Unknown function ${expr.name}`);
        return mapWatType(ret);
    }
    throw new Error(`Unable to infer Wasm type`);
}
function indentLines(lines, spaces) {
    const pad = " ".repeat(spaces);
    return lines.map((line) => `${pad}${line}`);
}
