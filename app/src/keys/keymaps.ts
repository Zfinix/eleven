import { OS } from "../lib/platform";
import { COMMANDS, type CommandId } from "./commands";

/** A key combo written as modifiers in Apple's order then the key, like "shift-cmd-p" or "g". "" means no shortcut. */
export type Combo = string;

export const KEYMAP_IDS = ["eleven", "hopper", "ida", "ghidra", "binja", "vscode", "zed", "xcode"] as const;

export type KeymapId = (typeof KEYMAP_IDS)[number];

export type Keymap = {
  readonly id: KeymapId;
  readonly name: string;
  readonly letters: string;
  readonly keys: Partial<Record<CommandId, Combo>>;
};

export const ELEVEN_KEYS: Readonly<Record<CommandId, Combo>> = {
  goto: "g",
  palette: "cmd-k",
  open: "cmd-o",
  save: "cmd-s",
  back: "cmd-[",
  forward: "cmd-]",
  find: "cmd-f",
  findNext: "cmd-g",
  findPrevious: "shift-cmd-g",
  rename: "n",
  comment: ";",
  xrefs: "x",
  bookmark: "cmd-d",
  undo: "cmd-z",
  redo: "shift-cmd-z",
  graph: "space",
  pseudo: "alt-enter",
  strings: "shift-cmd-s",
  split: "cmd-\\",
  splitDown: "shift-cmd-\\",
  terminal: "ctrl-`",
  details: "cmd-j",
  agent: "cmd-l",
  thread: "cmd-n",
  stop: "",
  settings: "cmd-,",
  patch: "shift-cmd-b",
  debug: "cmd-r",
  continue: "ctrl-cmd-y",
  stepOver: "f6",
  stepIn: "f7",
  stepOut: "f8",
  confirm: "enter",
  dismiss: "escape",
  selectAll: "cmd-a",
  copy: "cmd-c",
  markCode: "c",
  markProcedure: "p",
  markData: "d",
  markString: "a",
  markUndefined: "u",
  showHex: "shift-h",
  showDecimal: "shift-q",
  showCharacter: "shift-r",
  showOffset: "alt-z",
  showAddress: "shift-z",
};

export const KEYMAPS: readonly Keymap[] = [
  { id: "eleven", name: "Eleven", letters: "11", keys: {} },
  { id: "hopper", name: "Hopper", letters: "H", keys: { palette: "shift-cmd-p", back: "backspace", bookmark: "cmd-f6" } },
  { id: "ida", name: "IDA Pro", letters: "IDA", keys: { palette: "shift-cmd-p", back: "escape", forward: "cmd-enter", find: "alt-t", findNext: "cmd-t", comment: "shift-;", pseudo: "f5", strings: "shift-f12", bookmark: "alt-m" } },
  { id: "ghidra", name: "Ghidra", letters: "G", keys: { palette: "cmd-3", back: "alt-left", forward: "alt-right", rename: "l", xrefs: "shift-cmd-f", graph: "cmd-space", pseudo: "cmd-e" } },
  { id: "binja", name: "Binary Ninja", letters: "BN", keys: { palette: "cmd-p", back: "escape", pseudo: "tab" } },
  { id: "vscode", name: "Cursor or VS Code", letters: "VS", keys: { goto: "shift-cmd-o", palette: "shift-cmd-p", back: "ctrl--", forward: "ctrl-shift--", rename: "f2", comment: "cmd-/", xrefs: "shift-f12", details: "cmd-j" } },
  { id: "zed", name: "Zed", letters: "Z", keys: { goto: "shift-cmd-o", palette: "shift-cmd-p", back: "ctrl--", forward: "ctrl-shift--", rename: "f2", comment: "cmd-/", xrefs: "alt-shift-f12", details: "cmd-j" } },
  { id: "xcode", name: "Xcode", letters: "X", keys: { goto: "shift-cmd-o", palette: "shift-cmd-a", agent: "alt-cmd-a", back: "ctrl-cmd-left", forward: "ctrl-cmd-right", comment: "cmd-/" } },
];

export function isKeymapId(value: unknown): value is KeymapId {
  return KEYMAP_IDS.some((id) => id === value);
}

export function keymapOf(id: KeymapId): Keymap {
  return KEYMAPS.find((map) => map.id === id) ?? { id: "eleven", name: "Eleven", letters: "11", keys: {} };
}

export type Overrides = Readonly<Partial<Record<CommandId, Combo>>>;

/** The shortcut a command has under a keymap, after your own changes. */
export function comboFor(id: CommandId, keymap: KeymapId, overrides: Overrides): Combo {
  return overrides[id] ?? keymapOf(keymap).keys[id] ?? ELEVEN_KEYS[id];
}

export function commandFor(combo: Combo, keymap: KeymapId, overrides: Overrides): CommandId | null {
  if (!combo) return null;
  return COMMANDS.find((command) => comboFor(command.id, keymap, overrides) === combo)?.id ?? null;
}

const MODIFIERS = ["ctrl", "alt", "shift", "cmd"] as const;

type Modifier = (typeof MODIFIERS)[number];

const MODIFIER_GLYPH: Readonly<Record<Modifier, string>> = OS === "mac" ? { ctrl: "⌃", alt: "⌥", shift: "⇧", cmd: "⌘" } : { ctrl: "Super", alt: "Alt", shift: "Shift", cmd: "Ctrl" };

const KEY_GLYPH: Readonly<Record<string, string>> = {
  enter: "↩", backspace: "⌫", delete: "⌦", escape: "Esc", space: "Space", tab: "Tab",
  left: "←", right: "→", up: "↑", down: "↓",
};

function isModifier(part: string): part is Modifier {
  return MODIFIERS.some((mod) => mod === part);
}

/** Splits "ctrl-shift--" into its modifiers and key; the key itself may be "-". */
export function parseCombo(combo: Combo): { readonly mods: readonly Modifier[]; readonly key: string } {
  const mods: Modifier[] = [];
  let rest = combo;
  for (;;) {
    const dash = rest.indexOf("-");
    const head = dash > 0 ? rest.slice(0, dash) : "";
    if (!isModifier(head)) break;
    mods.push(head);
    rest = rest.slice(dash + 1);
  }
  return { mods, key: rest };
}

export function makeCombo(mods: readonly Modifier[], key: string): Combo {
  return [...MODIFIERS.filter((mod) => mods.includes(mod)), key.toLowerCase()].join("-");
}

/** The keycaps for a combo, like ["⇧", "⌘", "P"]. */
export function comboKeys(combo: Combo): readonly string[] {
  if (!combo) return [];
  const { mods, key } = parseCombo(combo);
  const cap = KEY_GLYPH[key] ?? (/^f\d+$/.test(key) ? key.toUpperCase() : key.length === 1 ? key.toUpperCase() : key);
  const order: readonly Modifier[] = OS === "mac" ? MODIFIERS : ["cmd", "ctrl", "alt", "shift"];
  return [...order.filter((mod) => mods.includes(mod)).map((mod) => MODIFIER_GLYPH[mod]), cap];
}

export function comboText(combo: Combo): string {
  return comboKeys(combo).join(OS === "mac" ? "" : "+");
}

/** A combo with no ⌘ or ⌃ fires on its own key, so it must not fire while you type in a field. */
export function isBareCombo(combo: Combo): boolean {
  const { mods } = parseCombo(combo);
  return !mods.includes("cmd") && !mods.includes("ctrl");
}
