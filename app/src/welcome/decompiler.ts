import { execFile, spawn } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { findOnPath } from "../agents/detect";
import { t, thisDevice } from "../i18n";
import { exe, OS, type Os } from "../lib/platform";

const run = promisify(execFile);
const BUILD_MS = 30 * 60_000;

/** Ghidra's folder name for this machine's native tools, e.g. `mac_arm_64`. */
export function nativeDir(os: Os = OS, arch: string = process.arch): string {
  const cpu = arch === "arm64" ? "arm_64" : "x86_64";
  switch (os) {
    case "mac":
      return `mac_${cpu}`;
    case "linux":
      return `linux_${cpu}`;
    case "windows":
      return "win_x86_64";
    default: {
      const unhandled: never = os;
      return unhandled;
    }
  }
}

function decompilerRoot(home: string): string {
  return join(home, "Ghidra", "Features", "Decompiler");
}

/** The official Ghidra zip has no Mac or Linux ARM decompiler, so those have to build their own. */
export function hasDecompiler(home: string, dir: string = nativeDir()): boolean {
  return existsSync(join(decompilerRoot(home), "os", dir, exe("decompile")));
}

async function ensureCompiler(): Promise<void> {
  if (OS === "mac") {
    try {
      await run("xcode-select", ["-p"]);
      return;
    } catch {
      spawn("xcode-select", ["--install"], { stdio: "ignore", detached: true }).unref();
      throw new Error(t("setup.error.commandLineTools"));
    }
  }
  if (!findOnPath("make") || !findOnPath("g++")) throw new Error(t("setup.error.make"));
}

/** Builds `decompile` and `sleigh` from the C++ source Ghidra ships, into its `os/<platform>` folder. */
export async function buildDecompiler(home: string): Promise<void> {
  if (OS === "windows") throw new Error(t("setup.error.noDecompiler"));
  const source = join(decompilerRoot(home), "src", "decompile", "cpp");
  if (!existsSync(join(source, "Makefile"))) throw new Error(t("setup.error.noSource"));
  await ensureCompiler();
  const arch = OS === "mac" ? `-arch ${process.arch === "arm64" ? "arm64" : "x86_64"}` : "";
  try {
    for (const goal of ["ghidra_opt", "sleigh_opt"]) await run("make", [`-j${availableParallelism()}`, goal, `ARCH_TYPE=${arch}`], { cwd: source, timeout: BUILD_MS, maxBuffer: 1 << 26 });
  } catch {
    throw new Error(t("setup.error.buildFailed", { device: thisDevice() }));
  }
  const target = join(decompilerRoot(home), "os", nativeDir());
  mkdirSync(target, { recursive: true });
  for (const [built, name] of [["ghidra_opt", "decompile"], ["sleigh_opt", "sleigh"]] as const) {
    copyFileSync(join(source, built), join(target, name));
    chmodSync(join(target, name), 0o755);
  }
}
