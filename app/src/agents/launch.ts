import { createHash } from "node:crypto";
import { access, chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { findOnPath, type NativeCommand } from "./detect";
import type { AgentEntry, BinaryBuild, Env } from "./registry";
import { cacheRoot, OS, unzip } from "../lib/platform";
import { npxCommand } from "../engine/toolchain";
import { run } from "../lib/process";

const INSTALL_DIR = join(cacheRoot(), "agents", "bin");

export type Launch = { readonly command: string; readonly args: readonly string[]; readonly env: Env };

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function fetchArchive(build: BinaryBuild): Promise<Buffer> {
  const response = await fetch(build.archive);
  if (!response.ok) throw new Error(`Download failed (${response.status}) for ${build.archive}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (build.sha256 && build.sha256 !== digest) throw new Error("The downloaded agent didn't match its checksum, so Eleven didn't run it.");
  return bytes;
}

async function unpack(bytes: Buffer, archive: string, dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const file = join(dir, archive.split("/").pop() ?? "agent-archive");
  await writeFile(file, bytes);
  if (file.endsWith(".zip")) await unzip(file, dir);
  else await run("tar", ["-xf", file, "-C", dir]);
  await rm(file);
}

function binaryCommand(agent: AgentEntry, build: BinaryBuild): string {
  return join(INSTALL_DIR, agent.id, agent.version || "latest", build.cmd);
}

/** Whether a downloadable agent is already on disk, so it starts without a download. */
export async function binaryInstalled(agent: AgentEntry): Promise<boolean> {
  return agent.distribution.kind !== "binary" || (await exists(binaryCommand(agent, agent.distribution.build)));
}

/** Downloads a binary agent once, verifies it and returns the path to run. */
async function installBinary(agent: AgentEntry, build: BinaryBuild): Promise<string> {
  const cmd = binaryCommand(agent, build);
  const dir = join(INSTALL_DIR, agent.id, agent.version || "latest");
  if (await exists(cmd)) return cmd;
  await unpack(await fetchArchive(build), build.archive, dir);
  await chmod(cmd, 0o755);
  return cmd;
}

/**
 * Drops the registry's pinned version so npm picks the newest release the user's own
 * npm policy allows (for example a `before` quarantine on fresh packages).
 */
function unpinned(pkg: string): string {
  return pkg.replace(/(.)@[^@/]+$/, "$1");
}

/** Prefers the copy already installed on this Mac; otherwise runs what the registry describes. */
export async function resolveLaunch(agent: AgentEntry, native: NativeCommand | null): Promise<Launch> {
  if (native) return { command: native.path, args: native.args, env: {} };
  const dist = agent.distribution;
  const npx = npxCommand();
  switch (dist.kind) {
    case "npx":
      return { command: npx.command, args: [...npx.args, "-y", unpinned(dist.run.package), ...dist.run.args], env: dist.run.env };
    case "uvx":
      return { command: "uvx", args: [dist.run.package, ...dist.run.args], env: dist.run.env };
    case "binary":
      return { command: await installBinary(agent, dist.build), args: dist.build.args, env: dist.build.env };
    case "command":
      return { command: dist.command, args: dist.args, env: {} };
    default: {
      const unhandled: never = dist;
      throw new Error(`Unknown agent distribution: ${JSON.stringify(unhandled)}`);
    }
  }
}

export function installHint(agent: AgentEntry, native: NativeCommand | null): string {
  if (native) return OS === "mac" ? "Installed on this Mac" : "Installed on this computer";
  switch (agent.distribution.kind) {
    case "npx":
      return "Runs with npx";
    case "uvx":
      return "Runs with uvx";
    case "binary":
      return "Downloads on first use";
    case "command":
      return OS === "mac" ? "Not found on this Mac" : "Not found on this computer";
    default: {
      const unhandled: never = agent.distribution;
      return String(unhandled);
    }
  }
}

/** Whether Eleven can start this agent right now without the user installing anything. */
export function readyToRun(agent: AgentEntry, native: NativeCommand | null): boolean {
  if (native) return true;
  switch (agent.distribution.kind) {
    case "npx":
      return npxCommand().command !== "npx" || findOnPath("npx") !== null;
    case "uvx":
      return findOnPath("uvx") !== null;
    case "binary":
      return true;
    case "command":
      return false;
    default: {
      const unhandled: never = agent.distribution;
      return unhandled;
    }
  }
}

export async function readCachedText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}
