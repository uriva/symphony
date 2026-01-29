i'd like to build a programming languaeg that compiles to wasm

the basic syntax is

compose(a, b, "key")

which means we compose b->a on "key"

this way we can compose non unary functions, creating new, non unary functions

the lagnuage is type safe, so each function variable has a type

types are plain serializable json only

built-in functions:
+, -, *, /
& |
ternary (three inputs, one output)

connections are either simple compose, lazy compose (so you can compose T[] output into T input)

i.e. lazy_compose

let's assume for starters we only deal with graphs with no loops

---

make a test framework that we can run and write the first test

compose  increment over addition. test with 2, 3  should be 6

---

types are completely inferrable, users don't (can't) write them

--- 