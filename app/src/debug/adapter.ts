import { existsSync } from "node:fs";

import { pathSetting } from "../settings/store";
import { findOnPath } from "../agents/detect";
import { OS } from "../lib/platform";
import { runSync } from "../lib/process";

/** Ubuntu and Debian name it after the LLVM version, like lldb-dap-18. */
const LLDB_VERSIONS = [22, 21, 20, 19, 18] as const;

/** Where lldb-dap lives: the lldb-dap chosen in Settings (or ELEVEN_LLDB_DAP), Xcode's copy via xcrun, or one on PATH. Null when none is installed. */
export function findLldbDap(): string | null {
  const override = pathSetting("lldbDap", "ELEVEN_LLDB_DAP");
  if (override) return existsSync(override) ? override : null;
  if (OS === "mac") try {
    const viaXcrun = runSync("xcrun", ["-f", "lldb-dap"]).trim();
    if (viaXcrun && existsSync(viaXcrun)) return viaXcrun;
  } catch {
    // fall through to PATH
  }
  return ["lldb-dap", ...LLDB_VERSIONS.map((v) => `lldb-dap-${v}`)].map((name) => findOnPath(name)).find((found) => found !== null) ?? null;
}
