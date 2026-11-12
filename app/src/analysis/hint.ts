import { DALVIK, jadxCommand } from "../engine/jadx";
import { binjaCommand } from "../engine/binja";
import { openCutterSessions } from "../engine/cutter";
import { pipeCommand } from "../engine/rizin";
import { activeEngine, activeProvider } from "./engines";

const CUTTER_HINT = "Cutter is open and connected: when the user talks about Cutter, list_cutter_sessions and cutter_command reach the Cutter they have open. Running a Cutter command closes REA's open file, so call open_binary again afterwards.";

/** How the agent should read a binary with the engine chosen in Settings, so it never starts Ghidra behind a Rizin choice. */
export function engineHint(path: string, arch: string): string {
  if (arch === DALVIK) return androidHint(path);
  const hint = readingHint(path);
  return openCutterSessions() > 0 ? `${hint} ${CUTTER_HINT}` : hint;
}

function readingHint(path: string): string {
  const engine = activeEngine();
  if (engine?.backend === "pipe") {
    return `Eleven reads this with ${engine.name}, not Ghidra. Don't call open_binary, which would start Ghidra. Run the ${engine.name} command line instead, for example: ${pipeCommand(path)}`;
  }
  if (engine?.backend === "binja") {
    return `Eleven reads this with Binary Ninja, not Ghidra. Don't call open_binary, which would start Ghidra. Use the eleven tools to show functions to the user, and Binary Ninja's Python API to read code, for example: ${binjaCommand(path)}`;
  }
  const provider = activeProvider();
  if (!provider) return "No analysis engine is on in Eleven. Ask the user to turn one on in Settings before reading the file.";
  return `Use the eleven-rea MCP tools (REA): call open_binary with ${path} and provider_id "${provider}" first.`;
}

/** Android apps are read with jadx, the way the workbench reads them, never Ghidra. */
export function androidHint(path: string): string {
  const jadx = jadxCommand() ?? "jadx";
  return `Eleven reads this Android app with jadx, not Ghidra. Don't call open_binary on it, which would start Ghidra. Use the eleven tools to show methods to the user, and run the jadx command line to read code, for example: ${jadx} -d <output folder> ${path}. Only native .so libraries unpacked from the app go to open_binary.`;
}
