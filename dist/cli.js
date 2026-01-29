#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { compile } from "./compiler.js";
async function main() {
    const [, , command, inputPath, ...rest] = process.argv;
    if (command !== "compile" || !inputPath) {
        console.error("Usage: symphonyc compile <input.sym> -o <output.wasm>");
        process.exit(1);
    }
    const outputFlagIndex = rest.findIndex((arg) => arg === "-o" || arg === "--out");
    const outputPath = outputFlagIndex >= 0 ? rest[outputFlagIndex + 1] : null;
    if (!outputPath) {
        console.error("Missing output path. Use -o <output.wasm>");
        process.exit(1);
    }
    const source = fs.readFileSync(inputPath, "utf-8");
    const wasm = await compile(source);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, wasm);
    console.log(`Wrote ${outputPath}`);
}
main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
});
