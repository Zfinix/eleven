import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, join } from "node:path";

import { isRecord, stringField } from "../lib/guards";
import { OS } from "../lib/platform";
import { AGENT_ACP_CLI, AGENT_CLI } from "./clis";
import type { AgentEntry } from "./registry";
import { run } from "../lib/process";


export type NativeCommand = { readonly path: string; readonly args: readonly string[] };

const SHELL_VARS = ["PATH", "GHIDRA_INSTALL_DIR", "JAVA_HOME", "ELEVEN_REA"] as const;
const GENERIC_WORDS = new Set(["cli", "code", "agent", "acp", "build"]);

function parseShellVars(output: string): ReadonlyMap<string, string> {
  const pairs = SHELL_VARS.flatMap((name) => {
    const match = output.match(new RegExp(`__${name}__(.*?)__END__`));
    return match?.[1] ? [[name, match[1]] as const] : [];
  });
  return new Map(pairs);
}

/** Apps opened from Finder get a bare environment; take PATH and Eleven's settings from the login shell. */
export async function adoptLoginShell(): Promise<void> {
  if (OS === "windows") return;
  const script = SHELL_VARS.map((name) => `printf "__${name}__%s__END__" "$${name}"`).join(";");
  try {
    const { stdout } = await run(process.env.SHELL ?? "/bin/zsh", ["-ilc", script], { timeout: 5000 });
    const vars = parseShellVars(stdout);
    for (const [name, value] of vars) process.env[name] ??= value;
    const shellPath = vars.get("PATH");
    if (shellPath) process.env.PATH = shellPath;
  } catch {
    return;
  }
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Where agent installers put their tools, for when Eleven starts without the login shell's PATH. */
const AGENT_BIN_DIRS = OS === "windows" ? [] : [join(homedir(), ".grok", "bin"), join(homedir(), ".local", "bin"), join(homedir(), ".bun", "bin"), join(homedir(), ".cargo", "bin"), "/opt/homebrew/bin", "/usr/local/bin"];

/** Looks a command up on PATH directly, so shell functions and aliases never match. */
export function findOnPath(name: string, extra: readonly string[] = []): string | null {
  const dirs = [...new Set([...(process.env.PATH ?? "").split(delimiter).filter(Boolean), ...extra])];
  const names = OS === "windows" && !/\.[a-z]+$/i.test(name) ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").filter(Boolean).map((ext) => `${name}${ext.toLowerCase()}`) : [name];
  return dirs.flatMap((dir) => names.map((file) => join(dir, file))).find(OS === "windows" ? existsSync : isExecutable) ?? null;
}

function binNames(packageJson: unknown, pkg: string): readonly string[] {
  if (!isRecord(packageJson)) return [];
  const bin = packageJson.bin;
  if (typeof bin === "string") return [basename(pkg)];
  return isRecord(bin) ? Object.keys(bin) : [];
}

async function globalRoots(): Promise<readonly string[]> {
  const bun = join(homedir(), ".bun", "install", "global", "node_modules");
  try {
    const { stdout } = await run("npm", ["root", "-g"], { timeout: 5000 });
    return [stdout.trim(), bun];
  } catch {
    return [bun];
  }
}

function globalPackageBin(pkg: string, roots: readonly string[]): string | null {
  for (const root of roots) {
    try {
      const manifest: unknown = JSON.parse(readFileSync(join(root, pkg, "package.json"), "utf8"));
      const found = binNames(manifest, pkg).map((name) => findOnPath(name)).find((path) => path !== null);
      if (found) return found;
    } catch {
      continue;
    }
  }
  return null;
}

function keywords(agent: AgentEntry, command: string): readonly string[] {
  const words = [...agent.name.toLowerCase().split(/\s+/), ...agent.id.toLowerCase().split("-")];
  return [...new Set(words)].filter((word) => word.length > 2 && word !== command && !GENERIC_WORDS.has(word));
}

/** A name match alone isn't proof (`vibe` might be another tool), so check the binary's own help. */
async function looksLike(agent: AgentEntry, path: string): Promise<boolean> {
  const expected = keywords(agent, basename(path).toLowerCase());
  if (expected.length === 0) return true;
  try {
    const { stdout, stderr } = await run(path, ["--help"], { timeout: 4000 });
    const text = `${stdout}${stderr}`.toLowerCase();
    return expected.some((word) => text.includes(word));
  } catch (err) {
    const text = (isRecord(err) ? `${stringField(err, "stdout") ?? ""}${stringField(err, "stderr") ?? ""}` : "").toLowerCase();
    return expected.some((word) => text.includes(word));
  }
}

function unpinnedPackage(pkg: string): string {
  return pkg.replace(/(.)@[^@/]+$/, "$1");
}

/** The agent's standalone install, when its installer put one in its usual place under home. */
export function standaloneAcp(id: string, home: string = homedir()): NativeCommand | null {
  const own = AGENT_ACP_CLI[id];
  const path = own && OS !== "windows" ? join(home, ...own.home) : null;
  return own && path && isExecutable(path) ? { path, args: own.args } : null;
}

function findAgentTool(name: string): string | null {
  return findOnPath(name, AGENT_BIN_DIRS);
}

async function detectOne(agent: AgentEntry, roots: readonly string[]): Promise<NativeCommand | null> {
  const own = standaloneAcp(agent.id);
  if (own) return own;
  const dist = agent.distribution;
  switch (dist.kind) {
    case "binary": {
      const path = findAgentTool(basename(dist.build.cmd));
      return path && (await looksLike(agent, path)) ? { path, args: dist.build.args } : null;
    }
    case "npx": {
      const path = globalPackageBin(unpinnedPackage(dist.run.package), roots);
      return path ? { path, args: dist.run.args } : null;
    }
    case "uvx": {
      const path = findAgentTool(unpinnedPackage(dist.run.package).replace(/[=<>].*$/, ""));
      return path ? { path, args: dist.run.args } : null;
    }
    case "command": {
      const path = findAgentTool(dist.command);
      return path ? { path, args: dist.args } : null;
    }
    default: {
      const unhandled: never = dist;
      return unhandled;
    }
  }
}

export type Presence = {
  /** How Eleven starts this agent's ACP session, or null when it still has to fetch the adapter. */
  readonly command: NativeCommand | null;
  /** The agent's own tool on this Mac, such as `claude` for Claude, when the user installed it. */
  readonly cli: string | null;
};

/** The agent's own CLI on PATH, such as `claude` for Claude, or null when it has none or isn't installed. */
function ownCli(agent: AgentEntry): string | null {
  const name = AGENT_CLI[agent.id];
  return name ? findAgentTool(name) : null;
}

/** Agents on this Mac, keyed by registry id: their ACP command, their own CLI, or both. */
export async function detectInstalled(agents: readonly AgentEntry[]): Promise<ReadonlyMap<string, Presence>> {
  const roots = await globalRoots();
  const found = await Promise.all(agents.map(async (agent): Promise<readonly [string, Presence]> => {
    const command = await detectOne(agent, roots);
    const cli = ownCli(agent);
    return [agent.id, { command, cli }];
  }));
  return new Map(found.filter((pair) => pair[1].command !== null || pair[1].cli !== null));
}
