import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import type { Binding, FunctionKind, ShaderFunction, ShaderLibrary } from "./types";
import { cacheRoot, OS } from "../lib/platform";
import { run } from "../lib/process";

const CACHE = cacheRoot();
const MAX_FUNCTIONS = 400;
const MAX_IR_LINES = 400;

async function disassemble(path: string): Promise<string> {
  const sha = createHash("sha256").update(await readFile(path)).digest("hex");
  const file = join(CACHE, sha, "metal", "disassembly.ll");
  try {
    return await readFile(file, "utf8");
  } catch {
    if (OS !== "mac") throw new Error("Reading Metal shaders needs Apple's Metal tools, which only run on macOS.");
    const { stdout: tool } = await run("xcrun", ["--find", "metal-objdump"]);
    const { stdout } = await run(tool.trim(), ["--disassemble", path], { maxBuffer: 512 * 1024 * 1024 });
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, stdout);
    return stdout;
  }
}

function kindOf(section: string): FunctionKind {
  if (/^!air\.vertex\b/m.test(section)) return "vertex";
  if (/^!air\.fragment\b/m.test(section)) return "fragment";
  return "compute";
}

function shortType(type: string): string {
  if (/texture_2d|texture2d/.test(type)) return "texture2d";
  if (/texture_3d|texture3d/.test(type)) return "texture3d";
  if (/sampler/.test(type)) return "sampler";
  if (/addrspace\(2\)/.test(type)) return "constant buffer";
  if (/addrspace\(1\)/.test(type)) return "device buffer";
  if (/addrspace\(3\)/.test(type)) return "threadgroup memory";
  return type.replace(/\s+noundef|\s+nocapture|\s+readonly|"[^"]*"/g, "").trim();
}

function paramList(define: string, name: string): string {
  const open = define.indexOf("(", define.indexOf(`@${name}`));
  let depth = 0;
  for (let ix = open; ix < define.length; ix++) {
    if (define[ix] === "(") depth++;
    if (define[ix] === ")" && --depth === 0) return define.slice(open + 1, ix);
  }
  return "";
}

function splitParams(list: string): readonly string[] {
  const params: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of list) {
    if ("(<{[".includes(char)) depth++;
    if (")>}]".includes(char)) depth--;
    if (char === "," && depth === 0) {
      params.push(current.trim());
      current = "";
    } else current += char;
  }
  return current.trim() ? [...params, current.trim()] : params;
}

function bindings(define: string, name: string): readonly Binding[] {
  return splitParams(paramList(define, name)).map((param, ix) => ({ slot: `arg(${ix})`, type: shortType(param.replace(/%\S+$/, "")) }));
}

function parse(text: string): readonly ShaderFunction[] {
  const sections = text.split(/^(?=source_filename = )/m);
  return sections.flatMap((section): ShaderFunction[] => {
    const define = section.split("\n").find((line) => line.startsWith("define "));
    const name = define ? /@([\w$.]+)\(/.exec(define)?.[1] : undefined;
    if (!define || !name) return [];
    const lines = section.split("\n");
    const start = lines.indexOf(define);
    const end = lines.findIndex((line, ix) => ix > start && line === "}");
    const body = lines.slice(start, end < 0 ? start + MAX_IR_LINES : end + 1);
    const ir = body.length > MAX_IR_LINES ? [...body.slice(0, MAX_IR_LINES), `; … ${body.length - MAX_IR_LINES} more lines`].join("\n") : body.join("\n");
    return [{ name, symbol: name, kind: kindOf(section), ir, bindings: bindings(define, name), loadedBy: null, stats: [] }];
  }).slice(0, MAX_FUNCTIONS);
}

/** A .metallib's functions, read through Apple's metal-objdump as AIR (LLVM IR). */
export async function readMetalLibrary(path: string): Promise<ShaderLibrary> {
  const functions = parse(await disassemble(path));
  return { name: basename(path), format: "Metal library · AIR, readable as LLVM IR", api: "metal", functions };
}
