import type { Fn } from "../model";

export type FunctionModule = {
  readonly name: string;
  readonly evidence: "source" | "symbol" | "layout";
};

export type FunctionModules = ReadonlyMap<string, FunctionModule>;

type ModuleMarker = {
  readonly name: string | null;
  readonly evidence: "source" | "symbol";
};

type ModuleAnchor = {
  readonly index: number;
  readonly name: string | null;
};

const REGISTRATION =
  /^_?(?:RegisterModule(?:ICalls|ClassesGenerated)?|(?:Internal)?(?:Initialize|Cleanup)Module)_([A-Za-z][A-Za-z0-9]*)(?:$|::)/;
const SCRIPTING_CLASSES = /^_?(?:Initialize|Cleanup)([A-Za-z][A-Za-z0-9]*)ScriptingClasses$/;
const MODULE_SPEC = /^_?Get([A-Za-z][A-Za-z0-9]*)ModuleSpec$/;
const COMPILATION_UNIT = /^_+GLOBAL__sub_I_(.+)$/;
const MODULE_REGISTRATION = /^_?RegisterModule_([A-Za-z][A-Za-z0-9]*)$/;

export function hasFunctionModules(functions: readonly Fn[]): boolean {
  return functions.some((fn) => fn.kind === "function" && MODULE_REGISTRATION.test(fn.name));
}

function sourceModule(file: string): string | null {
  return /(?:^|\/)Modules\/([^/]+)\//.exec(file.replaceAll("\\", "/"))?.[1] ?? null;
}

function registeredModules(functions: readonly Fn[]): ReadonlySet<string> {
  const modules = new Set<string>();
  for (const fn of functions) {
    const name = MODULE_REGISTRATION.exec(fn.name)?.[1];
    if (name && fn.kind === "function") modules.add(name);
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

/** A different module's compilation unit stops layout inference across that boundary. */
function moduleMarker(name: string, modules: ReadonlySet<string>): ModuleMarker | null {
  const unit = COMPILATION_UNIT.exec(name)?.[1];
  if (unit) {
    const module = compilationModule(unit, modules);
    return module || unit.startsWith("Modules_") ? { name: module, evidence: "source" } : null;
  }

  const module =
    REGISTRATION.exec(name)?.[1] ??
    SCRIPTING_CLASSES.exec(name)?.[1] ??
    MODULE_SPEC.exec(name)?.[1];
  return module && modules.has(module) ? { name: module, evidence: "symbol" } : null;
}

function nativeOrder(functions: readonly Fn[]): readonly Fn[] {
  return functions
    .filter((fn) => fn.kind === "function" && /^(?:0x[\da-f]+|\d+)$/i.test(fn.addr))
    .map((fn) => ({ fn, address: BigInt(fn.addr) }))
    .sort((a, b) => (a.address < b.address ? -1 : a.address > b.address ? 1 : 0))
    .map(({ fn }) => fn);
}

/** Only fill a gap when both surrounding markers identify the same module. */
function inferModuleRanges(
  functions: readonly Fn[],
  markers: ReadonlyMap<string, ModuleMarker>,
  assignments: Map<string, FunctionModule>,
): void {
  const ordered = nativeOrder(functions);
  const anchors: ModuleAnchor[] = [];

  for (let index = 0; index < ordered.length; index++) {
    const fn = ordered[index];
    if (!fn) continue;
    const marker = markers.get(fn.addr);
    if (marker) anchors.push({ index, name: marker.name });
  }

  for (let index = 1; index < anchors.length; index++) {
    const previous = anchors[index - 1];
    const current = anchors[index];
    if (!previous || !current?.name || previous.name !== current.name) continue;

    const assignment: FunctionModule = { name: current.name, evidence: "layout" };
    for (let inside = previous.index + 1; inside < current.index; inside++) {
      const member = ordered[inside];
      if (member && !assignments.has(member.addr)) assignments.set(member.addr, assignment);
    }
  }
}

/** Use original names and the full inventory, independent of filtering and user renames. */
export function indexFunctionModules(functions: readonly Fn[]): FunctionModules {
  const modules = registeredModules(functions);
  const assignments = new Map<string, FunctionModule>();
  const markers = new Map<string, ModuleMarker>();

  for (const fn of functions) {
    if (fn.kind !== "function") continue;
    const source = fn.file ? sourceModule(fn.file) : null;
    if (source) assignments.set(fn.addr, { name: source, evidence: "source" });

    if (modules.size === 0) continue;
    const marker = moduleMarker(fn.name, modules);
    if (!marker) continue;
    markers.set(fn.addr, marker);
    if (marker.name && !source) {
      assignments.set(fn.addr, { name: marker.name, evidence: marker.evidence });
    }
  }

  if (markers.size > 1) inferModuleRanges(functions, markers, assignments);
  return assignments;
}
