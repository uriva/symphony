# Symphony Language (Wasm)

A tiny, typed, graph-style language that compiles to WebAssembly.

## Syntax (current subset)

```symphony
one {
	1
}
add {
	+
}
inc {
	compose(+, one, b)
}

addThenInc {
	compose(inc, add)
}
export addThenInc
```

Blocks contain a single expression (one output):

```symphony
f {
	+
}
```

Blocks can include compose assignments before the final expression:

```symphony
one {
	1
}
add {
	+
}
inc {
	compose(+, one, b)
}
main {
	c = compose(inc, add)
	compose(inc, c)
}
```

`compose(a, b, "key")` composes `b -> a` on parameter `key` of `a`.

## Current limitations

- Types are inferred from usage (no type annotations in the syntax).
- The Wasm backend supports `number` and `boolean` only.
- `string`, `null`, object, and array types are inferred in the checker but not yet compiled to Wasm.
- `lazy_compose` is parsed and type-checked but will fail in the Wasm backend if arrays are involved.
- No loops are allowed (direct or indirect recursion is rejected).

## Commands

- Build: `npm run build`
- Compile a source file: `node dist/cli.js compile path/to/file.sym -o out.wasm`
- Run tests: `npm test`

## Tests

Each test consists of a .sym file and a matching .json spec in [tests](tests).
The JSON spec defines the exported function, arguments, and expected result.
