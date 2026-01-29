import wabt from "wabt";
import { parse } from "./parser.js";
import { emitWat } from "./codegen.js";
import { typecheck } from "./typecheck.js";

export async function compile(source: string): Promise<Uint8Array> {
  const program = parse(source);
  const typed = typecheck(program);
  const wat = emitWat(typed.functions, typed.exports);
  const wabtInterface = await wabt();
  const module = wabtInterface.parseWat("module.wat", wat);
  const { buffer } = module.toBinary({ log: false, write_debug_names: true });
  module.destroy();
  return new Uint8Array(buffer);
}
