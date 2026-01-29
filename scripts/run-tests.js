import fs from "node:fs";
import path from "node:path";
import { compile } from "../dist/compiler.js";
import { parse } from "../dist/parser.js";
import { typecheck } from "../dist/typecheck.js";

const root = path.resolve(".");
const testsDir = path.join(root, "tests");

function listTestCases() {
  return fs
    .readdirSync(testsDir)
    .filter((name) => name.endsWith(".sym"))
    .map((name) => name.replace(/\.sym$/, ""));
}

async function runCase(name) {
  const symPath = path.join(testsDir, `${name}.sym`);
  const jsonPath = path.join(testsDir, `${name}.json`);
  const source = fs.readFileSync(symPath, "utf-8");
  const spec = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));

  if (spec.expectCompileError) {
    try {
      await compile(source);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes(spec.expectCompileError)) {
        throw new Error(`Expected compile error containing '${spec.expectCompileError}', got '${message}'`);
      }
      return;
    }
    throw new Error(`Expected compile error but compilation succeeded`);
  }

  const wasm = await compile(source);
  const { instance } = await WebAssembly.instantiate(wasm);

  const fn = instance.exports[spec.export];
  if (typeof fn !== "function") {
    throw new Error(`Export ${spec.export} not found in ${name}`);
  }
  const typed = typecheck(parse(source));
  const fnInfo = typed.functions.get(spec.export);
  if (!fnInfo) throw new Error(`Missing function info for ${spec.export}`);

  let args = spec.args;
  if (args && !Array.isArray(args) && typeof args === "object") {
    const ordered = [];
    for (const param of fnInfo.params) {
      if (!(param.name in args)) {
        throw new Error(`Missing argument '${param.name}' for ${spec.export}`);
      }
      ordered.push(args[param.name]);
    }
    const extraKeys = Object.keys(args).filter((key) => !fnInfo.params.find((p) => p.name === key));
    if (extraKeys.length > 0) {
      throw new Error(`Unknown arguments for ${spec.export}: ${extraKeys.join(", ")}`);
    }
    args = ordered;
  }
  if (!args) args = [];
  const result = fn(...args);
  if (!Object.is(result, spec.expected)) {
    throw new Error(`Expected ${spec.expected} but got ${result} in ${name}`);
  }
}

async function main() {
  if (!fs.existsSync(testsDir)) {
    console.error("No tests directory found.");
    process.exit(1);
  }

  const cases = listTestCases();
  if (cases.length === 0) {
    console.error("No test cases found.");
    process.exit(1);
  }

  let failed = 0;
  for (const name of cases) {
    try {
      await runCase(name);
      console.log(`PASS ${name}`);
    } catch (err) {
      failed++;
      console.error(`FAIL ${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
