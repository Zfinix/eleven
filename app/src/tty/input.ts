/** Terminals keep ⌘ for themselves, so in the terminal Ctrl stands in for it. */
const STAND_IN = "cmd";

export type Reply =
  | { readonly kind: "window"; readonly width: number; readonly height: number }
  | { readonly kind: "cell"; readonly width: number; readonly height: number }
  | { readonly kind: "mode"; readonly mode: number; readonly value: number };

export type MouseEvent = {
  readonly button: number;
  readonly x: number;
  readonly y: number;
  readonly released: boolean;
  readonly motion: boolean;
  readonly wheel: boolean;
  readonly modifiers: string;
};

export type TtyEvent =
  | { readonly kind: "key"; readonly keystroke: string }
  | { readonly kind: "mouse"; readonly mouse: MouseEvent }
  | { readonly kind: "reply"; readonly reply: Reply }
  | { readonly kind: "quit" };

const CSI_KEYS: Readonly<Record<string, string>> = {
  A: "up",
  B: "down",
  C: "right",
  D: "left",
  H: "home",
  F: "end",
  P: "f1",
  Q: "f2",
  R: "f3",
  S: "f4",
  Z: "shift-tab",
};

const TILDE_KEYS: Readonly<Record<string, string>> = {
  "1": "home",
  "2": "insert",
  "3": "delete",
  "4": "end",
  "5": "pageup",
  "6": "pagedown",
  "15": "f5",
  "17": "f6",
  "18": "f7",
  "19": "f8",
  "20": "f9",
  "21": "f10",
  "23": "f11",
  "24": "f12",
};

/** xterm's modifier parameter is one more than a shift=1 alt=2 ctrl=4 bitmask. */
function modifierNames(parameter: number): string[] {
  const bits = Math.max(0, parameter - 1);
  const names: string[] = [];
  if (bits & 4) names.push(STAND_IN);
  if (bits & 2) names.push("alt");
  if (bits & 1) names.push("shift");
  return names;
}

function withModifiers(names: readonly string[], key: string): string {
  return [...names, key].join("-");
}

function typed(char: string): string {
  return char === " " ? "space" : char;
}

function controlKey(code: number): TtyEvent | null {
  if (code === 29) return { kind: "quit" };
  if (code === 13 || code === 10) return { kind: "key", keystroke: "enter" };
  if (code === 9) return { kind: "key", keystroke: "tab" };
  if (code === 127 || code === 8) return { kind: "key", keystroke: "backspace" };
  if (code >= 1 && code <= 26) return { kind: "key", keystroke: `${STAND_IN}-${String.fromCharCode(96 + code)}` };
  return null;
}

function mouse(body: string, final: string): TtyEvent | null {
  const [code, x, y] = body.split(";").map(Number);
  if (code === undefined || x === undefined || y === undefined || [code, x, y].some(Number.isNaN)) return null;
  const modifiers = [code & 16 ? "ctrl" : "", code & 8 ? "alt" : "", code & 4 ? "shift" : ""].filter(Boolean).join("-");
  return {
    kind: "mouse",
    mouse: { button: code & 3, x, y, released: final === "m", motion: (code & 32) !== 0, wheel: (code & 64) !== 0, modifiers },
  };
}

function csi(body: string, final: string): TtyEvent | null {
  if (body.startsWith("<") && (final === "M" || final === "m")) return mouse(body.slice(1), final);
  if (final === "y" && body.startsWith("?") && body.endsWith("$")) {
    const [mode, value] = body.slice(1, -1).split(";").map(Number);
    if (mode === undefined || value === undefined) return null;
    return { kind: "reply", reply: { kind: "mode", mode, value } };
  }
  const parameters = body.split(";").map(Number);
  if (final === "t" && parameters.length === 3) {
    const [which, height, width] = parameters;
    if (height === undefined || width === undefined || !(height > 0 && width > 0)) return null;
    if (which === 4) return { kind: "reply", reply: { kind: "window", width, height } };
    if (which === 6) return { kind: "reply", reply: { kind: "cell", width, height } };
    return null;
  }
  const names = modifierNames(parameters[1] ?? 1);
  if (final === "~") {
    const key = TILDE_KEYS[body.split(";")[0] ?? ""];
    return key ? { kind: "key", keystroke: withModifiers(names, key) } : null;
  }
  const key = CSI_KEYS[final];
  return key ? { kind: "key", keystroke: withModifiers(names, key) } : null;
}

/** Turns raw terminal input into keystrokes in GPUI's syntax, mouse reports and replies to our queries. */
export function createTtyInput(): (chunk: string) => TtyEvent[] {
  let pending = "";
  return (chunk) => {
    pending += chunk;
    const events: TtyEvent[] = [];
    while (pending.length > 0) {
      const char = pending[0] ?? "";
      if (char !== "\x1b") {
        const point = pending.codePointAt(0) ?? 0;
        const width = point > 0xffff ? 2 : 1;
        pending = pending.slice(width);
        const event = point < 32 || point === 127 ? controlKey(point) : { kind: "key" as const, keystroke: typed(String.fromCodePoint(point)) };
        if (event) events.push(event);
        continue;
      }
      if (pending.length === 1) {
        pending = "";
        events.push({ kind: "key", keystroke: "escape" });
        break;
      }
      const next = pending[1] ?? "";
      if (next === "[" || next === "O") {
        const match = /^\x1b[[O]([\x20-\x3f]*)([\x40-\x7e])/.exec(pending);
        if (!match) break;
        pending = pending.slice(match[0].length);
        const event = csi(match[1] ?? "", match[2] ?? "");
        if (event) events.push(event);
        continue;
      }
      if (next === "_" || next === "]" || next === "P") {
        const end = pending.search(/\x07|\x1b\\/);
        if (end < 0) break;
        pending = pending.slice(end + (pending[end] === "\x07" ? 1 : 2));
        continue;
      }
      pending = pending.slice(2);
      events.push(next === "\x1b" ? { kind: "key", keystroke: "escape" } : { kind: "key", keystroke: `alt-${typed(next)}` });
    }
    return events;
  };
}
