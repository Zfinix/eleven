import { existsSync, readdirSync, statfsSync, statSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

import { ASSETS } from "../lib/assets";
import { cacheRoot } from "../lib/platform";

const CACHES = [
  "/System/Volumes/Preboot/Cryptexes/OS/System/Library/dyld/dyld_shared_cache_arm64e",
  "/System/Library/dyld/dyld_shared_cache_arm64e",
  "/System/Volumes/Preboot/Cryptexes/OS/System/Library/dyld/dyld_shared_cache_x86_64",
  "/System/Library/dyld/dyld_shared_cache_x86_64",
] as const;

const DONE = ".unpacked";

/** The system's dyld shared cache, where macOS keeps its libraries instead of as separate files. */
export function systemCache(): string | null {
  return CACHES.find((path) => existsSync(path)) ?? null;
}

/** The cache's own file and its numbered parts, together. */
export function cacheBytes(cache: string): number {
  const dir = dirname(cache);
  const name = cache.slice(dir.length + 1);
  return readdirSync(dir).filter((file) => file === name || file.startsWith(`${name}.`)).reduce((sum, file) => sum + statSync(join(dir, file)).size, 0);
}

/** Unpacked libraries run to about two and a half times the cache's size. */
export function unpackedEstimate(cache: string): number {
  return Math.round(cacheBytes(cache) * 2.7);
}

export function freeBytes(path: string): number {
  const stats = statfsSync(path);
  return stats.bavail * stats.bsize;
}

/** One folder per macOS build, named by when its cache was written, so an update unpacks afresh. */
export function unpackedDir(cache: string): string {
  return join(cacheRoot(), "dyld", `${Math.round(statSync(cache).mtimeMs)}`);
}

export function isUnpacked(cache: string): boolean {
  return existsSync(join(unpackedDir(cache), DONE));
}

/** "12 4115" from the helper: libraries done, out of how many. */
export function progressOf(line: string): { readonly done: number; readonly total: number } | null {
  const match = /^(\d+) (\d+)$/.exec(line.trim());
  return match ? { done: Number(match[1]) + 1, total: Number(match[2]) } : null;
}

/** Builds the small helper that calls macOS's own extractor, once, with Xcode's compiler. */
async function helper(): Promise<string> {
  const out = join(cacheRoot(), "dyld", "extract");
  if (existsSync(out)) return out;
  await mkdir(dirname(out), { recursive: true });
  const proc = Bun.spawn(["xcrun", "clang", "-fblocks", "-O1", "-o", out, join(ASSETS, "dyld", "extract.c")], { stdout: "ignore", stderr: "pipe" });
  const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) throw new Error(`Couldn't build the unpacking helper. Install Xcode's command line tools. ${stderr.trim()}`);
  return out;
}

/** Unpacks every library in the cache into Eleven's cache folder with macOS's own extractor, reporting as it goes. */
export async function unpack(cache: string, onProgress: (done: number, total: number) => void): Promise<string> {
  const dir = unpackedDir(cache);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const proc = Bun.spawn([await helper(), cache, dir], { stdout: "pipe", stderr: "pipe" });
  const decoder = new TextDecoder();
  let rest = "";
  for await (const chunk of proc.stdout) {
    const lines = (rest + decoder.decode(chunk)).split("\n");
    rest = lines.pop() ?? "";
    for (const line of lines) {
      const step = progressOf(line);
      if (step) onProgress(step.done, step.total);
    }
  }
  const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) {
    await rm(dir, { recursive: true, force: true });
    throw new Error(stderr.trim() || `macOS's extractor stopped with code ${code}.`);
  }
  await writeFile(join(dir, DONE), "");
  return dir;
}

export async function removeUnpacked(cache: string): Promise<void> {
  await rm(unpackedDir(cache), { recursive: true, force: true });
}

/** Every unpacked library, as the path it has on a running Mac, like /usr/lib/libz.1.dylib. */
export function systemLibraries(dir: string): readonly string[] {
  const found: string[] = [];
  const walk = (at: string): void => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && entry.name !== DONE) found.push(`/${relative(dir, path)}`);
    }
  };
  walk(dir);
  return found.sort();
}
