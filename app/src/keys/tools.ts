import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

import { isRecord } from "../lib/guards";
import type { CommandId } from "./commands";
import { type Combo, type KeymapId, makeCombo, type Overrides } from "./keymaps";
import { run } from "../lib/process";

const HOME = homedir();
const APP_DIRS = ["/Applications", join(HOME, "Applications")];

type Modifier = "ctrl" | "alt" | "shift" | "cmd";

/** Shortcuts read from another tool's own settings file, already turned into Eleven commands. */
export type Imported = {
  readonly from: string;
  readonly file: string;
  readonly total: number;
  readonly overrides: Overrides;
};

/** Where a keymap's tool lives on this Mac, if it does: an app bundle, or Ghidra's icon file. */
export type ToolFound = { readonly keymap: KeymapId; readonly iconSource: string; readonly name: string };

const APP_NAMES: Readonly<Record<Exclude<KeymapId, "eleven" | "ghidra">, RegExp>> = {
  hopper: /^Hopper Disassembler.*\.app$/,
  ida: /^IDA.*\.app$/,
  binja: /^Binary Ninja.*\.app$/,
  vscode: /^(Cursor|Visual Studio Code)\.app$/,
  zed: /^Zed( Preview)?\.app$/,
  xcode: /^Xcode\.app$/,
};

function list(dir: string): readonly string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function findApp(pattern: RegExp): string | null {
  for (const dir of APP_DIRS) {
    const hit = list(dir).find((name) => pattern.test(name));
    if (hit) return join(dir, hit);
  }
  return null;
}

/** The tools whose shortcuts Eleven can copy that are installed here. */
export function findTools(): readonly ToolFound[] {
  const found: ToolFound[] = [];
  for (const [keymap, pattern] of Object.entries(APP_NAMES)) {
    const app = findApp(pattern);
    if (app && (keymap === "hopper" || keymap === "ida" || keymap === "binja" || keymap === "vscode" || keymap === "zed" || keymap === "xcode")) {
      found.push({ keymap, iconSource: app, name: basename(app, ".app") });
    }
  }
  const ghidra = process.env.GHIDRA_INSTALL_DIR;
  const ico = ghidra ? join(ghidra, "support", "ghidra.ico") : null;
  if (ico && existsSync(ico)) found.push({ keymap: "ghidra", iconSource: ico, name: "Ghidra" });
  return found;
}

function stripJsonComments(text: string): string {
  return text.replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (_match, str: string | undefined) => str ?? "").replace(/,(\s*[\]}])/g, "$1");
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(stripJsonComments(readFileSync(file, "utf8")));
  } catch {
    return null;
  }
}

function isModifierName(token: string): Modifier | null {
  switch (token) {
    case "cmd":
    case "meta":
    case "super":
      return "cmd";
    case "ctrl":
      return "ctrl";
    case "alt":
      return "alt";
    case "shift":
      return "shift";
    default:
      return null;
  }
}

/** "cmd+shift+p" (VS Code) or "cmd-shift-p" (Zed) as an Eleven combo; chords like "cmd+k cmd+s" have no equivalent. */
function editorCombo(key: string, joiner: "+" | "-"): Combo | null {
  if (key.trim().includes(" ")) return null;
  const parts = key.toLowerCase().split(joiner);
  const last = parts.at(-1) === "" ? joiner : parts.at(-1);
  const head = parts.at(-1) === "" ? parts.slice(0, -2) : parts.slice(0, -1);
  const mods = head.map(isModifierName);
  if (!last || mods.some((mod) => mod === null)) return null;
  return makeCombo(mods.filter((mod): mod is Modifier => mod !== null), last);
}

const VSCODE_COMMANDS: Readonly<Record<string, CommandId>> = {
  "workbench.action.showCommands": "palette",
  "workbench.action.quickOpen": "palette",
  "workbench.action.gotoSymbol": "goto",
  "workbench.action.showAllSymbols": "goto",
  "workbench.action.navigateBack": "back",
  "workbench.action.navigateForward": "forward",
  "editor.action.rename": "rename",
  "editor.action.commentLine": "comment",
  "editor.action.goToReferences": "xrefs",
  "references-view.findReferences": "xrefs",
  "workbench.action.files.openFileFolder": "open",
  "workbench.action.files.openFile": "open",
  "workbench.action.splitEditor": "split",
  "workbench.action.togglePanel": "details",
  "workbench.action.terminal.toggleTerminal": "terminal",
  "workbench.action.openSettings": "settings",
  "actions.find": "find",
  "editor.action.nextMatchFindAction": "findNext",
  "editor.action.previousMatchFindAction": "findPrevious",
};

const ZED_ACTIONS: Readonly<Record<string, CommandId>> = {
  "command_palette::Toggle": "palette",
  "file_finder::Toggle": "palette",
  "project_symbols::Toggle": "goto",
  "outline::Toggle": "goto",
  "pane::GoBack": "back",
  "pane::GoForward": "forward",
  "editor::Rename": "rename",
  "editor::ToggleComments": "comment",
  "editor::FindAllReferences": "xrefs",
  "workspace::Open": "open",
  "pane::SplitRight": "split",
  "workspace::ToggleBottomDock": "details",
  "terminal_panel::ToggleFocus": "terminal",
  "zed::OpenSettings": "settings",
  "buffer_search::Deploy": "find",
  "search::SelectNextMatch": "findNext",
  "search::SelectPreviousMatch": "findPrevious",
};

const XCODE_COMMANDS: Readonly<Record<string, CommandId>> = {
  "Xcode.IDEKit.CmdDefinition.OpenQuickly": "goto",
  "Xcode.IDEKit.CmdDefinition.ShowQuickActions": "palette",
  "Xcode.IDEKit.CmdDefinition.GoBack": "back",
  "Xcode.IDEKit.CmdDefinition.GoForward": "forward",
};

const GHIDRA_ACTIONS: Readonly<Record<string, CommandId>> = {
  "Go To Address/Label": "goto",
  "Show Action Chooser Dialog": "palette",
  "Previous Location in History": "back",
  "Next Location in History": "forward",
  "Add Label": "rename",
  "Edit Label": "rename",
  "Rename Function": "rename",
  "Edit Comments": "comment",
  "Find References To": "xrefs",
  "Show References To Address": "xrefs",
  "Add Bookmark": "bookmark",
  "Toggle Listing and Function Graph": "graph",
  "Display Decompiler": "pseudo",
  "Search Text": "find",
  "Repeat Text Search": "findNext",
};

function vscodeShortcuts(json: unknown): { readonly total: number; readonly overrides: Overrides } | null {
  if (!Array.isArray(json)) return null;
  const overrides: Partial<Record<CommandId, Combo>> = {};
  let total = 0;
  for (const entry of json) {
    if (!isRecord(entry) || typeof entry.key !== "string" || typeof entry.command !== "string" || entry.command.startsWith("-")) continue;
    total += 1;
    const id = VSCODE_COMMANDS[entry.command];
    const combo = editorCombo(entry.key, "+");
    if (id && combo) overrides[id] = combo;
  }
  return { total, overrides };
}

function zedShortcuts(json: unknown): { readonly total: number; readonly overrides: Overrides } | null {
  if (!Array.isArray(json)) return null;
  const overrides: Partial<Record<CommandId, Combo>> = {};
  let total = 0;
  for (const block of json) {
    const bindings = isRecord(block) ? block.bindings : null;
    if (!isRecord(bindings)) continue;
    for (const [key, action] of Object.entries(bindings)) {
      total += 1;
      const name = typeof action === "string" ? action : Array.isArray(action) && typeof action[0] === "string" ? action[0] : null;
      const id = name ? ZED_ACTIONS[name] : undefined;
      const combo = editorCombo(key, "-");
      if (id && combo) overrides[id] = combo;
    }
  }
  return { total, overrides };
}

/** Xcode writes "$@o": $ is ⇧, @ is ⌘, ^ is ⌃, ~ is ⌥, then the key. */
function xcodeCombo(text: string): Combo | null {
  const mods: Modifier[] = [];
  let rest = text;
  const codes: Readonly<Record<string, Modifier>> = { $: "shift", "@": "cmd", "^": "ctrl", "~": "alt" };
  while (rest.length > 1 && codes[rest.charAt(0)]) {
    const mod = codes[rest.charAt(0)];
    if (mod) mods.push(mod);
    rest = rest.slice(1);
  }
  return rest ? makeCombo(mods, rest) : null;
}

async function xcodeShortcuts(file: string): Promise<{ readonly total: number; readonly overrides: Overrides } | null> {
  try {
    const { stdout } = await run("plutil", ["-convert", "json", "-o", "-", file]);
    const json: unknown = JSON.parse(stdout);
    const menu = isRecord(json) && isRecord(json["Menu Key Bindings"]) ? json["Menu Key Bindings"]["Key Bindings"] : null;
    if (!Array.isArray(menu)) return { total: 0, overrides: {} };
    const overrides: Partial<Record<CommandId, Combo>> = {};
    for (const entry of menu) {
      if (!isRecord(entry) || typeof entry.CommandID !== "string" || typeof entry["Keyboard Shortcut"] !== "string") continue;
      const id = XCODE_COMMANDS[entry.CommandID];
      const combo = xcodeCombo(entry["Keyboard Shortcut"]);
      if (id && combo) overrides[id] = combo;
    }
    return { total: menu.length, overrides };
  } catch {
    return null;
  }
}

const JAVA_KEYS: Readonly<Record<number, string>> = {
  8: "backspace", 9: "tab", 10: "enter", 27: "escape", 32: "space", 37: "left", 38: "up", 39: "right", 40: "down",
  44: ",", 45: "-", 46: ".", 47: "/", 59: ";", 91: "[", 92: "\\", 93: "]", 127: "delete",
};

function javaKey(code: number): string | null {
  if (code >= 65 && code <= 90) return String.fromCharCode(code).toLowerCase();
  if (code >= 48 && code <= 57) return String.fromCharCode(code);
  if (code >= 112 && code <= 123) return `f${code - 111}`;
  return JAVA_KEYS[code] ?? null;
}

/** Java modifier masks, old and new style; Ghidra stores ⌘ as META on a Mac. */
function javaModifiers(mask: number): readonly Modifier[] {
  const mods: Modifier[] = [];
  if (mask & (1 | 64)) mods.push("shift");
  if (mask & (2 | 128)) mods.push("ctrl");
  if (mask & (4 | 256)) mods.push("cmd");
  if (mask & (8 | 512)) mods.push("alt");
  return mods;
}

function ghidraShortcuts(text: string): { readonly total: number; readonly overrides: Overrides } {
  const overrides: Partial<Record<CommandId, Combo>> = {};
  let total = 0;
  for (const match of text.matchAll(/<WRAPPED_OPTION NAME="([^"]+)"[^>]*>([\s\S]*?)<\/WRAPPED_OPTION>/g)) {
    const body = match[2] ?? "";
    const code = Number(/NAME="KeyCode"[^>]*VALUE="(\d+)"/.exec(body)?.[1]);
    const mask = Number(/NAME="Modifiers"[^>]*VALUE="(\d+)"/.exec(body)?.[1] ?? 0);
    const key = Number.isFinite(code) ? javaKey(code) : null;
    if (!key) continue;
    total += 1;
    const action = (match[1] ?? "").replace(/\s*\([^)]*\)\s*$/, "");
    const id = GHIDRA_ACTIONS[action];
    if (id) overrides[id] = makeCombo(javaModifiers(mask), key);
  }
  return { total, overrides };
}

function newest(paths: readonly string[]): string | null {
  return paths.filter((path) => existsSync(path)).sort().at(-1) ?? null;
}

function ghidraToolFile(): string | null {
  const roots = [join(HOME, "Library", "ghidra"), join(HOME, ".ghidra")];
  return newest(roots.flatMap((root) => list(root).map((dir) => join(root, dir, "tools", "_code_browser.tcd"))));
}

async function readFile(file: string, from: string): Promise<Imported | null> {
  const name = file.toLowerCase();
  if (name.endsWith(".idekeybindings")) {
    const read = await xcodeShortcuts(file);
    return read ? { from, file, ...read } : null;
  }
  if (/\.(kbxml|tcd|xml)$/.test(name)) {
    try {
      return { from, file, ...ghidraShortcuts(readFileSync(file, "utf8")) };
    } catch {
      return null;
    }
  }
  const json = readJson(file);
  const first: unknown = Array.isArray(json) ? json[0] : null;
  const read = isRecord(first) && "bindings" in first ? zedShortcuts(json) : vscodeShortcuts(json);
  return read ? { from, file, ...read } : null;
}

/** Shortcuts you changed in the editors and tools installed here, newest settings file first. */
export async function findCustomShortcuts(): Promise<readonly Imported[]> {
  const support = join(HOME, "Library", "Application Support");
  const candidates: readonly (readonly [string, string | null])[] = [
    ["Cursor", join(support, "Cursor", "User", "keybindings.json")],
    ["VS Code", join(support, "Code", "User", "keybindings.json")],
    ["Zed", join(HOME, ".config", "zed", "keymap.json")],
    ["Xcode", newest(list(join(HOME, "Library", "Developer", "Xcode", "UserData", "KeyBindings")).map((file) => join(HOME, "Library", "Developer", "Xcode", "UserData", "KeyBindings", file)))],
    ["Ghidra", ghidraToolFile()],
  ];
  const read = await Promise.all(candidates.map(([from, file]) => (file && existsSync(file) ? readFile(file, from) : Promise.resolve(null))));
  return read.filter((item): item is Imported => item !== null && item.total > 0);
}

/** A shortcuts file you picked: VS Code or Cursor, Zed, Xcode, or a Ghidra key bindings export. */
export function importShortcutFile(file: string): Promise<Imported | null> {
  return readFile(file, basename(file));
}
