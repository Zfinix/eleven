import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";

import { prepareTarget, type Target } from "../engine/target";
import { findLoaders } from "./loaders";
import { listRuns, readGpuRun, recordGpuRun, runTitle } from "./trace";
import { readMetalLibrary } from "./metal";
import { cudaKernelIr, readComputeLibraries } from "./compute";
import { MODEL_FILE, readModel } from "./models";
import type { LoadedBy, ModelInfo, Recording, ShaderLibrary } from "./types";
import type { GpuSource } from "./source";
import { runSync } from "../lib/process";
import { t } from "../i18n";

const MAX_FILES = 40;
const MAX_DEPTH = 6;

function appRoot(path: string): string | null {
  const at = path.indexOf(".app/");
  if (at >= 0) return path.slice(0, at + 4);
  return path.endsWith(".app") ? path : null;
}

export function bundleExecutable(app: string): string | null {
  try {
    const name = runSync("plutil", ["-extract", "CFBundleExecutable", "raw", join(app, "Contents", "Info.plist")]).trim();
    const path = join(app, "Contents", "MacOS", name);
    return existsSync(path) ? path : null;
  } catch {
    return null;
  }
}

function scan(dir: string, depth: number, found: string[]): void {
  if (depth > MAX_DEPTH || found.length >= MAX_FILES) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (/\.metallib$/i.test(entry.name) || MODEL_FILE.test(entry.name)) found.push(path);
    else if (entry.isDirectory() && !entry.isSymbolicLink()) scan(path, depth + 1, found);
    if (found.length >= MAX_FILES) return;
  }
}

function objcName(name: string): string {
  const [owner, method] = name.split("::");
  return method ? `-[${owner} ${method}]` : name;
}

/** The GPU screen backed by the real files: Apple's metal-objdump, Eleven's model readers and REA for callers. */
export class LiveSource implements GpuSource {
  readonly live = true;
  private readonly app: string | null;
  private readonly files: readonly string[];

  constructor(private readonly target: Target) {
    this.app = appRoot(target.original);
    const found: string[] = [];
    if (this.app) scan(join(this.app, "Contents"), 0, found);
    this.files = found.length > 0 ? found : [target.original];
  }

  executable(): Promise<string> {
    const exe = this.app ? bundleExecutable(this.app) : null;
    return Promise.resolve(exe ? basename(exe) : this.target.name);
  }

  private libraries: Promise<readonly ShaderLibrary[]> | null = null;
  private readonly sources = new Map<string, string>();

  /** Metal libraries, and CUDA or HIP kernels in the file itself; read once, since a CUDA library can hold thousands. */
  listLibraries(): Promise<readonly ShaderLibrary[]> {
    this.libraries ??= this.readLibraries();
    return this.libraries;
  }

  private async readLibraries(): Promise<readonly ShaderLibrary[]> {
    const metal = await Promise.all(this.files.filter((file) => /\.metallib$/i.test(file)).map(readMetalLibrary));
    const compute = await Promise.all(this.files.filter((file) => !/\.metallib$/i.test(file) && !MODEL_FILE.test(file) && statSync(file).isFile()).map(async (file) => {
      const libs = await readComputeLibraries(file);
      for (const lib of libs) this.sources.set(lib.name, file);
      return libs;
    }));
    return [...metal, ...compute.flat()];
  }

  async functionIr(library: string, name: string): Promise<string> {
    const lib = (await this.listLibraries()).find((l) => l.name === library);
    const fn = lib?.functions.find((f) => f.name === name);
    if (!lib || !fn) throw new Error(`${library} has no function named ${name}.`);
    const source = this.sources.get(library);
    return lib.api === "cuda" && source ? cudaKernelIr(source, library, fn) : fn.ir;
  }

  async loadedBy(_library: string, name: string): Promise<LoadedBy | null> {
    const exe = this.app ? bundleExecutable(this.app) : null;
    if (!exe) return null;
    const loaders = await findLoaders(prepareTarget(exe).path, name);
    const first = loaders[0];
    if (!first) return null;
    const others = loaders.length - 1;
    const note = others === 0 ? t("gpu.loadedBy.byName", { name }) : others === 1 ? t("gpu.loadedBy.byNameOther", { name }) : t("gpu.loadedBy.byNameOthers", { name, count: others });
    return { symbol: objcName(first.name), note };
  }

  async listModels(): Promise<readonly ModelInfo[]> {
    const models = this.files.filter((file) => MODEL_FILE.test(file) && (statSync(file).isFile() || /\.mlmodelc$/i.test(file)));
    return Promise.all(models.map(readModel));
  }

  async listRecordings(): Promise<readonly Recording[]> {
    const exe = this.app ? bundleExecutable(this.app) : null;
    if (!exe) return [];
    const runs = await Promise.all(listRuns(basename(exe)).map(async (trace) => (await readGpuRun(trace, runTitle(trace))).recording));
    return runs;
  }

  async record(): Promise<void> {
    const exe = this.app ? bundleExecutable(this.app) : null;
    if (!exe) throw new Error("Only apps can be recorded. Open the .app, not a file inside it.");
    await recordGpuRun(exe, []);
  }
}
