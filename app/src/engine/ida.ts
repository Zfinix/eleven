import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { findOnPath } from "../agents/detect";
import { cacheRoot } from "../lib/platform";
import { currentSettings } from "../settings/store";

const APPS = [join(homedir(), "Applications"), "/Applications"];
const TOOL_DIRS = [join(homedir(), ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin"];

/** The IDA app picked in Settings, else the first IDA in Applications. */
export function idaApp(): string | null {
  const chosen = currentSettings().idaPath;
  if (chosen.endsWith(".app")) return existsSync(chosen) ? chosen : null;
  for (const dir of APPS) {
    try {
      const app = readdirSync(dir).find((name) => /^IDA.*\.app$/i.test(name));
      if (app) return join(dir, app);
    } catch {
      continue;
    }
  }
  return null;
}

/** REA's headless registration for ida-pro-mcp's database supervisor, which runs IDA through idalib. */
export function headlessRegistration(server: string, app: string): string {
  const registration = { command: server, args: ["--stdio", "--max-workers", "1"], mode: "headless", env: { IDADIR: join(app, "Contents", "MacOS") } };
  return `${JSON.stringify(registration, null, 2)}\n`;
}

function written(file: string, text: string): string {
  try {
    if (readFileSync(file, "utf8") === text) return file;
  } catch {
    // not written yet
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
  return file;
}

/**
 * The IDA MCP registration REA reads: one picked in Settings, REA_IDA_MCP_CONFIG,
 * or one Eleven writes when IDA and ida-pro-mcp's idalib-mcp are both installed.
 */
export function idaRegistration(): string | null {
  const picked = [currentSettings().idaPath, process.env.REA_IDA_MCP_CONFIG ?? ""].find((path) => path.endsWith(".json") && existsSync(path));
  if (picked) return picked;
  const app = idaApp();
  const server = findOnPath("idalib-mcp", TOOL_DIRS);
  if (!app || !server) return null;
  return written(join(cacheRoot(), "ida", "ida-mcp.json"), headlessRegistration(server, app));
}
