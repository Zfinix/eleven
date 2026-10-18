import type { Fn } from "../model";

/** Where a module came from: a source path, a module symbol, or the functions on either side of it (a guess). */
export type FunctionModule = { readonly name: string; readonly evidence: "source" | "symbol" | "layout" };

export type FunctionModules = ReadonlyMap<string, FunctionModule>;

type Marker = { readonly name: string | null; readonly evidence: "source" | "symbol" };

const MODULE_REGISTRATION = /^_?RegisterModule_([A-Za-z][A-Za-z0-9]*)$/;
const REGISTRATION = /^_?(?:RegisterModule(?:ICalls|ClassesGenerated)?|(?:Internal)?(?:Initialize|Cleanup)Module)_([A-Za-z][A-Za-z0-9]*)(?:$|::)/;
const SCRIPTING_CLASSES = /^_?(?:Initialize|Cleanup)([A-Za-z][A-Za-z0-9]*)ScriptingClasses$/;
const MODULE_SPEC = /^_?Get([A-Za-z][A-Za-z0-9]*)ModuleSpec$/;
const COMPILATION_UNIT = /^_+GLOBAL__sub_I_(.+)$/;
const SOURCE_MODULE = /(?:^|\/)Modules\/([^/]+)\//;

/** Unity engine builds register each module with a `RegisterModule_<Name>` function. */
export function hasFunctionModules(functions: readonly Fn[]): boolean {
  return functions.some((fn) => fn.kind === "function" && MODULE_REGISTRATION.test(fn.name));
}

function registeredModules(functions: readonly Fn[]): ReadonlySet<string> {
  const modules = new Set<string>();
  for (const fn of functions) {
    const name = fn.kind === "function" ? MODULE_REGISTRATION.exec(fn.name)?.[1] : undefined;
    if (name) modules.add(name);
  }
  return modules;
}

function compilationModule(unit: string, modules: ReadonlySet<string>): string | null {
  const module = /^Modules_([A-Za-z][A-Za-z0-9]*)_/.exec(unit)?.[1];
  if (module) return modules.has(module) ? module : null;
  const scripting = /^([A-Za-z][A-Za-z0-9]*)ScriptingClasses\./.exec(unit)?.[1];
  if (scripting && modules.has(scripting)) return scripting;
  if (unit.startsWith("Runtime_") && modules.has("Core")) return "Core";
  if (unit.startsWith("Editor_") && modules.has("Editor")) return "Editor";
  return null;
}

/** A compilation unit of an unknown module still counts as a marker, so no guess crosses it. */
function markerOf(name: string, modules: ReadonlySet<string>): Marker | null {
  const unit = COMPILATION_UNIT.exec(name)?.[1];
  if (unit) {
    const module = compilationModule(unit, modules);
    return module || unit.startsWith("Modules_") ? { name: module, evidence: "source" } : null;
  }
  const module = REGISTRATION.exec(name)?.[1] ?? SCRIPTING_CLASSES.exec(name)?.[1] ?? MODULE_SPEC.exec(name)?.[1];
  return module && modules.has(module) ? { name: module, evidence: "symbol" } : null;
}

function byAddress(functions: readonly Fn[]): readonly Fn[] {
  return functions
    .filter((fn) => fn.kind === "function" && /^(?:0x[\da-f]+|\d+)$/i.test(fn.addr))
    .map((fn) => ({ fn, at: BigInt(fn.addr) }))
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
    .map(({ fn }) => fn);
}

/** Functions between two markers of the same module are guessed to belong to it. */
function fillBetween(functions: readonly Fn[], markers: ReadonlyMap<string, Marker>, out: Map<string, FunctionModule>): void {
  const ordered = byAddress(functions);
  let previous: { readonly index: number; readonly name: string | null } | null = null;
  ordered.forEach((fn, index) => {
    const marker = markers.get(fn.addr);
    if (!marker) return;
    if (previous && marker.name && previous.name === marker.name) {
      const guess: FunctionModule = { name: marker.name, evidence: "layout" };
      for (const member of ordered.slice(previous.index + 1, index)) if (!out.has(member.addr)) out.set(member.addr, guess);
    }
    previous = { index, name: marker.name };
  });
}

/** Indexed from the original names of every function, so renames and filters never move a function. */
export function indexFunctionModules(functions: readonly Fn[]): FunctionModules {
  const modules = registeredModules(functions);
  const out = new Map<string, FunctionModule>();
  const markers = new Map<string, Marker>();
  for (const fn of functions) {
    if (fn.kind !== "function") continue;
    const source = fn.file ? (SOURCE_MODULE.exec(fn.file.replaceAll("\\", "/"))?.[1] ?? null) : null;
    if (source) out.set(fn.addr, { name: source, evidence: "source" });
    const marker = modules.size > 0 ? markerOf(fn.name, modules) : null;
    if (!marker) continue;
    markers.set(fn.addr, marker);
    if (marker.name && !source) out.set(fn.addr, { name: marker.name, evidence: marker.evidence });
  }
  if (markers.size > 1) fillBetween(functions, markers, out);
  return out;
}
