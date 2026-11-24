import { existsSync } from "node:fs";
import { mkdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";

import { cacheRoot } from "../lib/platform";

/** Bytecode versions hermes-dec 0.1.8 has opcode tables for. */
const SUPPORTED = new Set([51, 58, 59, 61, 62, 68, 69, 70, 72, 73, 76, 80, 81, 82, 83, 84, 85, 86, 87, 89, 90, 92, 95, 96, 97, 98, 99]);

const PREVIEW_LINES = 4000;
const TIMEOUT_MS = 10 * 60_000;

export function hermesSupported(version: number): boolean {
  return SUPPORTED.has(version);
}

/** hermes-dec's decompiler: the uv or pipx install first, then Homebrew, then anything on PATH. */
export function hbcDecompiler(): string | null {
  const candidates = [join(homedir(), ".local", "bin", "hbc-decompiler"), "/opt/homebrew/bin/hbc-decompiler", "/usr/local/bin/hbc-decompiler"];
  return candidates.find((path) => existsSync(path)) ?? Bun.which("hbc-decompiler");
}

/** The useful line of a Python failure: its last one, not the traceback above it. */
export function failureLine(stderr: string): string {
  const lines = stderr.trim().split("\n").map((line) => line.trim()).filter(Boolean);
  return lines.at(-1) ?? "hermes-dec stopped without saying why.";
}

export type Decompiled = { readonly file: string; readonly preview: string; readonly lines: number };

/** Decompiles a Hermes bundle to JavaScript once, kept in the cache; the preview is the first lines, the file holds all of it. */
export async function decompileHermes(bundle: string): Promise<Decompiled> {
  const tool = hbcDecompiler();
  if (!tool) throw new Error("Install hermes-dec to decompile Hermes bytecode, for example with: uv tool install hermes-dec");
  const { size, mtimeMs } = await stat(bundle);
  const dir = join(cacheRoot(), "hermes");
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${basename(bundle)}-${size}-${Math.round(mtimeMs)}.js`);
  if (!existsSync(file)) {
    const proc = Bun.spawn([tool, bundle, file], { stdout: "ignore", stderr: "pipe" });
    const timer = setTimeout(() => proc.kill(), TIMEOUT_MS);
    const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
    clearTimeout(timer);
    if (code !== 0) throw new Error(failureLine(stderr));
  }
  const text = await readFile(file, "utf8");
  const all = text.split("\n");
  return { file, preview: all.slice(0, PREVIEW_LINES).join("\n"), lines: all.length };
}
