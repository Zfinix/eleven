import { basename } from "node:path";

import { bundleExecutable } from "../gpu/live";
import type { Program, TableRow } from "./model";
import { exportPath } from "./export";
import { writeFile } from "node:fs/promises";

export type Hook = { readonly script: string; readonly file: string; readonly command: string };

/** Where the binary is loaded in the analysis: __TEXT for Mach-O, otherwise the lowest segment that isn't empty space at zero. */
export function imageBase(segments: readonly TableRow[]): bigint {
  const starts = segments.flatMap((row) => {
    const start = /^0x[0-9a-f]+/i.exec(row.b)?.[0];
    return start ? [{ name: row.a, start: BigInt(start) }] : [];
  });
  const text = starts.find((segment) => segment.name === "__TEXT");
  if (text) return text.start;
  const loaded = starts.filter((segment) => segment.start > 0n && segment.name !== "__PAGEZERO");
  return loaded.reduce((low, segment) => (segment.start < low ? segment.start : low), loaded[0]?.start ?? 0n);
}

function quoted(text: string): string {
  return JSON.stringify(text);
}

/** A Frida script that logs each call to one function: its first arguments, and what it returns. Frida 17 API. */
export function hookScript(module: string, offset: bigint, name: string, addr: string): string {
  const objc = /^[-+]\[|::/.test(name);
  const enter = objc
    ? "    console.log(`→ ${NAME} ${ObjC.selectorAsString(args[1])} self=${args[0]} ${args[2]} ${args[3]}`);"
    : "    console.log(`→ ${NAME}(${args[0]}, ${args[1]}, ${args[2]}, ${args[3]})`);";
  return [
    `// Logs every call to ${name} (${addr}). Written by Eleven.`,
    `const NAME = ${quoted(name)};`,
    `const module = Process.findModuleByName(${quoted(module)}) ?? Process.mainModule;`,
    `const target = module.base.add(${quoted(`0x${offset.toString(16)}`)});`,
    "",
    "Interceptor.attach(target, {",
    "  onEnter(args) {",
    enter,
    "  },",
    "  onLeave(retval) {",
    "    console.log(`← ${NAME} returned ${retval}`);",
    "  },",
    "});",
    "",
  ].join("\n");
}

function launchPath(program: Program): string {
  return program.origin.endsWith(".app") ? (bundleExecutable(program.origin) ?? program.origin) : program.origin;
}

/** Writes a hook for one function beside the other exports, with the command that runs it. */
export async function writeHook(program: Program, addr: string, name: string): Promise<Hook> {
  const launch = launchPath(program);
  const script = hookScript(basename(launch), BigInt(addr) - imageBase(program.segments), name, addr);
  const file = await exportPath(program, `hook-${name.replace(/[^\w.-]/g, "_").slice(0, 60)}.js`);
  await writeFile(file, script);
  return { script, file, command: `frida -f ${quoted(launch)} -l ${quoted(file)}` };
}
