const numberType = { kind: "number" };
const booleanType = { kind: "boolean" };
const builtins = [
    builtin("+", ["a", "b"], [numberType, numberType], numberType),
    builtin("-", ["a", "b"], [numberType, numberType], numberType),
    builtin("*", ["a", "b"], [numberType, numberType], numberType),
    builtin("/", ["a", "b"], [numberType, numberType], numberType),
    builtin("<", ["a", "b"], [numberType, numberType], booleanType),
    builtin(">", ["a", "b"], [numberType, numberType], booleanType),
    builtin("=", ["a", "b"], [numberType, numberType], booleanType),
    builtin("&", ["a", "b"], [booleanType, booleanType], booleanType),
    builtin("|", ["a", "b"], [booleanType, booleanType], booleanType),
    builtin("ternary", ["cond", "t", "f"], [booleanType, numberType, numberType], numberType)
];
function slot(type) {
    return { type: type ?? null };
}
function paramSlot(name, type) {
    return { name, slot: slot(type) };
}
function builtin(name, paramNames, params, result) {
    return {
        name,
        params: params.map((type, i) => paramSlot(paramNames[i], type)),
        returnType: slot(result),
        isBuiltin: true,
        locals: new Map()
    };
}
export function typecheck(program) {
    const functions = new Map();
    for (const b of builtins)
        functions.set(b.name, b);
    const exports = [];
    for (const stmt of program.statements) {
        if (stmt.kind === "fn") {
            if (functions.has(stmt.name))
                throw new Error(`Duplicate function ${stmt.name}`);
            const paramNames = stmt.params.length > 0 ? stmt.params.map((p) => p.name) : collectFreeVars(stmt.body);
            const params = paramNames.map((name) => paramSlot(name));
            const info = {
                name: stmt.name,
                params,
                returnType: slot(),
                body: stmt.body,
                locals: new Map()
            };
            functions.set(stmt.name, info);
            continue;
        }
        if (stmt.kind === "export") {
            exports.push(stmt.name);
        }
    }
    inferAll(functions);
    validateComposeTypes(functions);
    enforceAcyclic(functions);
    const typedFunctions = new Map();
    for (const [name, fn] of functions) {
        const params = fn.params.map((p) => {
            if (!p.slot.type)
                throw new Error(`Could not infer type for parameter ${p.name} of ${name}`);
            return { name: p.name, type: p.slot.type };
        });
        if (!fn.returnType.type)
            throw new Error(`Could not infer return type for ${name}`);
        const locals = new Map();
        for (const [localName, localSlot] of fn.locals) {
            if (!localSlot.type)
                throw new Error(`Could not infer type for local ${localName} of ${name}`);
            locals.set(localName, localSlot.type);
        }
        typedFunctions.set(name, {
            name,
            params,
            returnType: fn.returnType.type,
            body: fn.body,
            isBuiltin: fn.isBuiltin,
            locals
        });
    }
    return { functions: typedFunctions, exports };
}
function buildCompose(name, a, b, key, lazy) {
    const index = a.params.findIndex((param) => param.name === key);
    if (index < 0)
        throw new Error(`Compose key '${key}' not found on ${a.name}`);
    const combined = [
        ...a.params.filter((p) => p.name !== key).map((p) => ({ param: p, origin: a.name })),
        ...b.params.map((p) => ({ param: p, origin: b.name }))
    ];
    const baseName = (name) => (name.includes(".") ? name.split(".").pop() : name);
    const baseCounts = new Map();
    for (const item of combined) {
        const base = baseName(item.param.name);
        baseCounts.set(base, (baseCounts.get(base) ?? 0) + 1);
    }
    const newParams = [];
    const used = new Set();
    for (const item of combined) {
        const base = baseName(item.param.name);
        let finalName = item.param.name;
        if ((baseCounts.get(base) ?? 0) > 1 && !finalName.includes(".")) {
            finalName = `${item.origin}.${base}`;
        }
        if (used.has(finalName))
            throw new Error(`Duplicate param ${finalName}`);
        used.add(finalName);
        newParams.push({ name: finalName, slot: item.param.slot });
    }
    const slotNameMap = new Map();
    for (const param of newParams) {
        slotNameMap.set(param.slot, param.name);
    }
    const bArgs = b.params.map((param) => ({
        kind: "var",
        name: slotNameMap.get(param.slot) ?? param.name
    }));
    const bCall = { kind: "call", name: b.name, args: bArgs };
    const aArgs = a.params.map((param) => {
        if (param.name === key)
            return bCall;
        return { kind: "var", name: slotNameMap.get(param.slot) ?? param.name };
    });
    const body = { kind: "call", name: a.name, args: aArgs };
    return {
        name,
        params: newParams,
        returnType: a.returnType,
        body,
        locals: new Map(),
        composedFrom: { a: a.name, b: b.name, key, lazy }
    };
}
function resolveKey(fn, key) {
    if (key.includes(".")) {
        const match = fn.params.find((p) => p.name === key);
        if (!match)
            throw new Error(`Compose key '${key}' not found on ${fn.name}`);
        return match.name;
    }
    const matches = fn.params.filter((p) => p.name === key || p.name.endsWith(`.${key}`));
    if (matches.length === 0)
        throw new Error(`Compose key '${key}' not found on ${fn.name}`);
    if (matches.length > 1) {
        const options = matches.map((m) => m.name).join(" or ");
        throw new Error(`Ambiguous key '${key}' on ${fn.name}; use ${options}`);
    }
    return matches[0].name;
}
function inferAll(functions) {
    let changed = true;
    while (changed) {
        changed = false;
        for (const [name, fn] of functions) {
            if (fn.isBuiltin || !fn.body)
                continue;
            changed = inferFunction(fn, functions) || changed;
        }
    }
}
function inferFunction(fn, functions) {
    if (fn.body && isComposeCall(fn.body)) {
        return applyComposeBody(fn, fn.body, functions);
    }
    if (fn.body && fn.body.kind === "var" && functions.has(fn.body.name)) {
        const target = functions.get(fn.body.name);
        fn.params = target.params.map((p) => paramSlot(p.name, p.slot.type ?? undefined));
        fn.returnType = slot(target.returnType.type ?? undefined);
        fn.body = {
            kind: "call",
            name: target.name,
            args: fn.params.map((p) => ({ kind: "var", name: p.name }))
        };
        return true;
    }
    const env = new Map(fn.params.map((param) => [param.name, param.slot]));
    const state = { changed: false };
    const bodyType = inferExpr(fn.body, env, functions, fn.returnType.type, state, fn);
    if (bodyType)
        unifySlot(fn.returnType, bodyType, state, `return type of ${fn.name}`);
    return state.changed;
}
function inferExpr(expr, env, functions, expected, state, owner) {
    if (expr.kind === "literal") {
        const literalType = literalToType(expr.value);
        if (expected && !typeEquals(expected, literalType)) {
            throw new Error(`Expected ${typeToString(expected)} but got ${typeToString(literalType)}`);
        }
        return literalType;
    }
    if (expr.kind === "var") {
        const slot = env.get(expr.name);
        if (!slot)
            throw new Error(`Unknown variable ${expr.name}`);
        if (expected)
            unifySlot(slot, expected, state, `variable ${expr.name}`);
        return slot.type ?? expected;
    }
    if (expr.kind === "block") {
        const exprItems = expr.items.filter((item) => item.kind !== "assign");
        if (exprItems.length !== 1) {
            throw new Error("Blocks must contain exactly one expression");
        }
        for (const item of expr.items) {
            if (item.kind !== "assign")
                continue;
            if (isComposeCall(item.expr)) {
                const existing = functions.get(item.name);
                if (existing?.fromBlockCompose) {
                    continue;
                }
                if (existing || env.has(item.name)) {
                    throw new Error(`Duplicate name ${item.name}`);
                }
                const { a, b, key, lazy, hasKey } = parseComposeCall(item.expr);
                const fa = functions.get(a);
                const fb = functions.get(b);
                if (!fa || !fb)
                    throw new Error(`Unknown function in compose ${a} or ${b}`);
                if (fa.params.length === 1 && hasKey) {
                    throw new Error(`compose on unary function ${a} must omit key`);
                }
                if (fa.params.length !== 1 && !hasKey) {
                    throw new Error(`compose on non-unary function ${a} must include key`);
                }
                const resolvedKey = hasKey ? resolveKey(fa, key) : fa.params[0].name;
                const composed = buildCompose(item.name, fa, fb, resolvedKey, lazy);
                composed.fromBlockCompose = true;
                functions.set(composed.name, composed);
                continue;
            }
            if (env.has(item.name)) {
                if (owner?.locals.has(item.name)) {
                    continue;
                }
                throw new Error(`Duplicate name ${item.name}`);
            }
            if (functions.has(item.name)) {
                throw new Error(`Duplicate name ${item.name}`);
            }
            const slot = { type: null };
            const valueType = inferExpr(item.expr, env, functions, null, state, owner);
            if (valueType)
                slot.type = valueType;
            env.set(item.name, slot);
            if (owner)
                owner.locals.set(item.name, slot);
        }
        if (isComposeCall(exprItems[0])) {
            if (!owner)
                throw new Error("compose must be used in a function body");
            applyComposeBody(owner, exprItems[0], functions);
            return owner.returnType.type ?? expected;
        }
        return inferExpr(exprItems[0], env, functions, expected, state, owner);
    }
    if (expr.kind === "call") {
        if (expr.name === "compose" || expr.name === "lazy_compose") {
            throw new Error("compose must be used as a function body or assignment");
        }
        if (expr.name === "ternary") {
            if (expr.args.length !== 3)
                throw new Error(`ternary expects 3 args`);
            const condType = inferExpr(expr.args[0], env, functions, booleanType, state, owner);
            if (condType && !typeEquals(condType, booleanType))
                throw new Error(`ternary condition must be boolean`);
            const tType = inferExpr(expr.args[1], env, functions, expected, state, owner);
            const fType = inferExpr(expr.args[2], env, functions, expected, state, owner);
            const merged = mergeTypes(tType, fType, expected);
            if (merged && expected && !typeEquals(merged, expected)) {
                throw new Error(`ternary branches must match ${typeToString(expected)}`);
            }
            return merged ?? expected;
        }
        const fn = functions.get(expr.name);
        if (!fn)
            throw new Error(`Unknown function ${expr.name}`);
        if (expr.args.length !== fn.params.length) {
            throw new Error(`Function ${fn.name} expects ${fn.params.length} args`);
        }
        for (let i = 0; i < fn.params.length; i++) {
            const paramSlot = fn.params[i].slot;
            const argType = inferExpr(expr.args[i], env, functions, paramSlot.type, state, owner);
            if (argType && !paramSlot.type) {
                unifySlot(paramSlot, argType, state, `argument ${i + 1} of ${fn.name}`);
            }
            else if (argType && paramSlot.type && !typeEquals(argType, paramSlot.type)) {
                throw new Error(`Argument ${i + 1} of ${fn.name} must be ${typeToString(paramSlot.type)}`);
            }
        }
        if (expected) {
            if (fn.returnType.type && !typeEquals(fn.returnType.type, expected)) {
                throw new Error(`return type of ${fn.name} must be ${typeToString(expected)}`);
            }
            unifySlot(fn.returnType, expected, state, `return type of ${fn.name}`);
        }
        return fn.returnType.type ?? expected;
    }
    throw new Error(`Unknown expression kind`);
}
function applyComposeBody(fn, expr, functions) {
    const { a, b, key, lazy, hasKey } = parseComposeCall(expr);
    const fa = functions.get(a);
    const fb = functions.get(b);
    if (!fa || !fb)
        throw new Error(`Unknown function in compose ${a} or ${b}`);
    if (fa.params.length === 1 && hasKey) {
        throw new Error(`compose on unary function ${a} must omit key`);
    }
    if (fa.params.length !== 1 && !hasKey) {
        throw new Error(`compose on non-unary function ${a} must include key`);
    }
    const resolvedKey = hasKey ? resolveKey(fa, key) : fa.params[0].name;
    const composed = buildCompose(fn.name, fa, fb, resolvedKey, lazy);
    fn.params = composed.params;
    fn.returnType = composed.returnType;
    fn.body = composed.body;
    fn.composedFrom = composed.composedFrom;
    return true;
}
function isComposeCall(expr) {
    return (expr.kind === "call" &&
        (expr.name === "compose" || expr.name === "lazy_compose") &&
        (expr.args.length === 2 || expr.args.length === 3));
}
function parseComposeCall(expr) {
    if (!isComposeCall(expr))
        throw new Error("Invalid compose call");
    const call = expr;
    const [aExpr, bExpr, keyExpr] = call.args;
    if (aExpr.kind !== "var" || bExpr.kind !== "var") {
        throw new Error("compose expects compose(fnA, fnB, \"key\") or compose(fnA, fnB)");
    }
    if (call.args.length === 2) {
        return { a: aExpr.name, b: bExpr.name, lazy: call.name === "lazy_compose", hasKey: false };
    }
    if (keyExpr?.kind !== "var") {
        throw new Error("compose expects compose(fnA, fnB, key) or compose(fnA, fnB)");
    }
    return { a: aExpr.name, b: bExpr.name, key: keyExpr.name, lazy: call.name === "lazy_compose", hasKey: true };
}
function validateComposeTypes(functions) {
    for (const fn of functions.values()) {
        if (!fn.composedFrom)
            continue;
        const a = functions.get(fn.composedFrom.a);
        const b = functions.get(fn.composedFrom.b);
        if (!a || !b)
            continue;
        const aParam = a.params.find((p) => p.name === fn.composedFrom.key);
        if (!aParam?.slot.type || !b.returnType.type) {
            throw new Error(`Could not infer types for compose ${fn.name}`);
        }
        if (fn.composedFrom.lazy) {
            if (b.returnType.type.kind === "array") {
                if (!typeEquals(b.returnType.type.element, aParam.slot.type)) {
                    throw new Error(`lazy_compose type mismatch: ${fn.composedFrom.a}.${fn.composedFrom.key} expects ${typeToString(aParam.slot.type)} but ${fn.composedFrom.b} returns ${typeToString(b.returnType.type)}`);
                }
            }
            else if (!typeEquals(aParam.slot.type, b.returnType.type)) {
                throw new Error(`lazy_compose type mismatch: ${fn.composedFrom.a}.${fn.composedFrom.key} expects ${typeToString(aParam.slot.type)} but ${fn.composedFrom.b} returns ${typeToString(b.returnType.type)}`);
            }
        }
        else if (!typeEquals(aParam.slot.type, b.returnType.type)) {
            throw new Error(`compose type mismatch: ${fn.composedFrom.a}.${fn.composedFrom.key} expects ${typeToString(aParam.slot.type)} but ${fn.composedFrom.b} returns ${typeToString(b.returnType.type)}`);
        }
    }
}
function unifySlot(slot, type, state, label) {
    if (!slot.type) {
        slot.type = type;
        state.changed = true;
        return;
    }
    if (!typeEquals(slot.type, type)) {
        throw new Error(`${label} must be ${typeToString(slot.type)}`);
    }
}
function mergeTypes(a, b, expected) {
    if (a && b) {
        if (!typeEquals(a, b))
            throw new Error(`Type mismatch: ${typeToString(a)} vs ${typeToString(b)}`);
        return a;
    }
    return a ?? b ?? expected ?? null;
}
function literalToType(value) {
    if (typeof value === "number")
        return { kind: "number" };
    if (typeof value === "boolean")
        return { kind: "boolean" };
    if (typeof value === "string")
        return { kind: "string" };
    return { kind: "null" };
}
function enforceAcyclic(functions) {
    const visiting = new Set();
    const visited = new Set();
    const visit = (name) => {
        if (visited.has(name))
            return;
        if (visiting.has(name))
            throw new Error(`Recursion not allowed: ${name}`);
        visiting.add(name);
        const fn = functions.get(name);
        if (fn?.body) {
            for (const dep of collectDeps(fn.body)) {
                if (functions.get(dep)?.isBuiltin)
                    continue;
                visit(dep);
            }
        }
        visiting.delete(name);
        visited.add(name);
    };
    for (const [name, fn] of functions) {
        if (fn.isBuiltin)
            continue;
        visit(name);
    }
}
function collectDeps(expr) {
    const deps = new Set();
    const walk = (e) => {
        if (e.kind === "block") {
            for (const item of e.items) {
                if (item.kind === "assign") {
                    if (isComposeCall(item.expr))
                        continue;
                    walk(item.expr);
                    continue;
                }
                walk(item);
            }
            return;
        }
        if (e.kind === "call") {
            if (e.name === "compose" || e.name === "lazy_compose")
                return;
            deps.add(e.name);
            for (const arg of e.args)
                walk(arg);
        }
    };
    walk(expr);
    return deps;
}
function collectFreeVars(expr) {
    const seen = new Set();
    const ordered = [];
    const walk = (e) => {
        if (e.kind === "block") {
            for (const item of e.items) {
                if (item.kind === "assign") {
                    if (isComposeCall(item.expr))
                        continue;
                    walk(item.expr);
                    continue;
                }
                walk(item);
            }
            return;
        }
        if (e.kind === "var") {
            if (!seen.has(e.name)) {
                seen.add(e.name);
                ordered.push(e.name);
            }
            return;
        }
        if (e.kind === "call") {
            if (e.name === "compose" || e.name === "lazy_compose")
                return;
            for (const arg of e.args)
                walk(arg);
        }
    };
    walk(expr);
    return ordered;
}
export function typeEquals(a, b) {
    if (a.kind !== b.kind)
        return false;
    if (a.kind === "array" && b.kind === "array")
        return typeEquals(a.element, b.element);
    if (a.kind === "object" && b.kind === "object") {
        const aKeys = Object.keys(a.fields).sort();
        const bKeys = Object.keys(b.fields).sort();
        if (aKeys.length !== bKeys.length)
            return false;
        for (const key of aKeys) {
            if (!b.fields[key])
                return false;
            if (!typeEquals(a.fields[key], b.fields[key]))
                return false;
        }
        return true;
    }
    return true;
}
export function typeToString(type) {
    if (type.kind === "array")
        return `[${typeToString(type.element)}]`;
    if (type.kind === "object") {
        return `{ ${Object.entries(type.fields)
            .map(([k, v]) => `${k}: ${typeToString(v)}`)
            .join(", ")} }`;
    }
    return type.kind;
}
