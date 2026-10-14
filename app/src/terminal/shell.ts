import { type IBufferCell, Terminal } from "@xterm/headless";
import type { Subprocess } from "bun";
import { OS } from "../lib/platform";

export type Run = {
  readonly text: string;
  readonly fg: string | null;
  readonly bg: string | null;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
  readonly cursor: boolean;
};

export type Screen = { readonly rows: readonly (readonly Run[])[]; readonly scrolledBack: boolean; readonly exited: boolean };

export type Keys = { readonly ctrl: boolean; readonly alt: boolean; readonly shift: boolean; readonly cmd: boolean };

/** The 16 ANSI colours, tuned for the dark terminal background. */
const ANSI: readonly string[] = [
  "#3f4451", "#e06c75", "#98c379", "#e5c07b", "#61afef", "#c678dd", "#56b6c2", "#d7dae0",
  "#5c6370", "#ef7c86", "#a9d48a", "#f0cd8a", "#74bdf7", "#d48ae6", "#56d4b8", "#ffffff",
];

const CUBE = [0, 95, 135, 175, 215, 255];

function hex(n: number): string {
  return n.toString(16).padStart(2, "0");
}

function paletteColor(index: number): string {
  if (index < 16) return ANSI[index] ?? "#d7dae0";
  if (index >= 232) {
    const level = 8 + (index - 232) * 10;
    return `#${hex(level)}${hex(level)}${hex(level)}`;
  }
  const n = index - 16;
  return `#${hex(CUBE[Math.floor(n / 36)] ?? 0)}${hex(CUBE[Math.floor(n / 6) % 6] ?? 0)}${hex(CUBE[n % 6] ?? 0)}`;
}

function rgb(value: number): string {
  return `#${value.toString(16).padStart(6, "0")}`;
}

function foreground(cell: IBufferCell): string | null {
  if (cell.isFgRGB()) return rgb(cell.getFgColor());
  if (cell.isFgPalette()) return paletteColor(cell.isBold() && cell.getFgColor() < 8 ? cell.getFgColor() + 8 : cell.getFgColor());
  return null;
}

function background(cell: IBufferCell): string | null {
  if (cell.isBgRGB()) return rgb(cell.getBgColor());
  if (cell.isBgPalette()) return paletteColor(cell.getBgColor());
  return null;
}

const ARROWS: Readonly<Record<string, string>> = { up: "A", down: "B", right: "C", left: "D" };

const SPECIAL: Readonly<Record<string, string>> = {
  enter: "\r", backspace: "\x7f", escape: "\x1b", space: " ",
  home: "\x1b[H", end: "\x1b[F", delete: "\x1b[3~", pageup: "\x1b[5~", pagedown: "\x1b[6~",
  f1: "\x1bOP", f2: "\x1bOQ", f3: "\x1bOR", f4: "\x1bOS",
};

/** What a key press sends to the shell, or null when it isn't the terminal's to handle (⌘ shortcuts). */
export function keyBytes(key: string, char: string | undefined, mods: Keys, appCursor: boolean): string | null {
  if (mods.cmd) return null;
  const arrow = ARROWS[key];
  if (arrow) {
    if (mods.alt && (key === "left" || key === "right")) return key === "left" ? "\x1bb" : "\x1bf";
    return appCursor ? `\x1bO${arrow}` : `\x1b[${arrow}`;
  }
  if (key === "tab") return mods.shift ? "\x1b[Z" : "\t";
  if (mods.ctrl && key === "space") return "\0";
  const special = SPECIAL[key];
  if (special) return mods.alt ? `\x1b${special}` : special;
  if (mods.ctrl && key.length === 1) {
    const code = key.toLowerCase().charCodeAt(0);
    if (code >= 97 && code <= 122) return String.fromCharCode(code - 96);
    if (key === "[") return "\x1b";
    if (key === "\\") return "\x1c";
    if (key === "]") return "\x1d";
    return null;
  }
  if (mods.alt && key.length === 1) return `\x1b${mods.shift ? key.toUpperCase() : key}`;
  if (char) return char;
  return key.length === 1 ? key : null;
}

/** A login shell running in a pseudo-terminal, with its screen kept by a headless xterm. */
export class Shell {
  private readonly term: Terminal;
  private proc: Subprocess | null = null;
  private exited = false;
  private readonly listeners = new Set<() => void>();
  private cols = 80;
  private rows = 24;

  constructor(private readonly cwd: string) {
    this.term = new Terminal({ cols: this.cols, rows: this.rows, scrollback: 5000, allowProposedApi: true });
    this.term.onData((reply) => this.proc?.terminal?.write(reply));
    this.term.onBinary((reply) => this.proc?.terminal?.write(Buffer.from(reply, "binary")));
    this.start();
  }

  private start(): void {
    this.exited = false;
    this.term.reset();
    const shell = process.env.SHELL ?? (OS === "mac" ? "/bin/zsh" : "/bin/sh");
    this.proc = Bun.spawn([shell, "-l"], {
      windowsHide: true,
      cwd: this.cwd,
      env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor", TERM_PROGRAM: "Eleven" },
      terminal: {
        cols: this.cols,
        rows: this.rows,
        data: (_, data) => this.term.write(data, () => this.changed()),
      },
    });
    void (async (): Promise<void> => {
      await this.proc?.exited;
      this.exited = true;
      this.changed();
    })();
  }

  private changed(): void {
    for (const listener of this.listeners) listener();
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Sends text to the shell; after the shell has exited, any key starts a new one. */
  send(text: string): void {
    if (this.exited) return this.start();
    this.term.scrollToBottom();
    this.proc?.terminal?.write(text);
  }

  paste(text: string): void {
    this.send(this.term.modes.bracketedPasteMode ? `\x1b[200~${text}\x1b[201~` : text);
  }

  key(key: string, char: string | undefined, mods: Keys): boolean {
    const bytes = keyBytes(key, char, mods, this.term.modes.applicationCursorKeysMode);
    if (bytes === null) return false;
    this.send(bytes);
    return true;
  }

  clear(): void {
    this.term.clear();
    this.send("\x0c");
  }

  scroll(lines: number): void {
    this.term.scrollLines(lines);
    this.changed();
  }

  resize(cols: number, rows: number): void {
    if (cols < 2 || rows < 1 || (cols === this.cols && rows === this.rows)) return;
    this.cols = cols;
    this.rows = rows;
    this.term.resize(cols, rows);
    this.proc?.terminal?.resize(cols, rows);
    this.changed();
  }

  screen(): Screen {
    const buffer = this.term.buffer.active;
    const atBottom = buffer.viewportY === buffer.baseY;
    const cursorY = atBottom && !this.exited ? buffer.cursorY : -1;
    const rows: Run[][] = [];
    const cell = buffer.getNullCell();
    for (let y = 0; y < this.term.rows; y += 1) {
      const line = buffer.getLine(buffer.viewportY + y);
      const runs: Run[] = [];
      for (let x = 0; line && x < this.term.cols; x += 1) {
        line.getCell(x, cell);
        if (cell.getWidth() === 0) continue;
        const inverse = cell.isInverse() !== 0;
        const fg = foreground(cell);
        const bg = background(cell);
        const style = {
          fg: inverse ? (bg ?? "#11131a") : fg,
          bg: inverse ? (fg ?? "#d7dae0") : bg,
          bold: cell.isBold() !== 0,
          italic: cell.isItalic() !== 0,
          underline: cell.isUnderline() !== 0,
          cursor: y === cursorY && x === buffer.cursorX,
        };
        const text = cell.getChars() || " ";
        const last = runs[runs.length - 1];
        const same = last && !last.cursor && !style.cursor && last.fg === style.fg && last.bg === style.bg && last.bold === style.bold && last.italic === style.italic && last.underline === style.underline;
        if (last && same) runs[runs.length - 1] = { ...last, text: last.text + text };
        else runs.push({ text, ...style });
      }
      while (runs.length > 0 && runs[runs.length - 1]?.text.trim() === "" && !runs[runs.length - 1]?.bg && !runs[runs.length - 1]?.cursor) runs.pop();
      const last = runs[runs.length - 1];
      if (last && !last.bg && !last.cursor) runs[runs.length - 1] = { ...last, text: last.text.trimEnd() };
      rows.push(runs);
    }
    return { rows, scrolledBack: !atBottom, exited: this.exited };
  }

  dispose(): void {
    this.listeners.clear();
    this.proc?.kill();
    this.term.dispose();
  }
}

const shells = new Map<string, Shell>();

/** One shell per folder for the life of the app, so switching tabs keeps its history. */
export function shellIn(cwd: string): Shell {
  const found = shells.get(cwd);
  if (found) return found;
  const shell = new Shell(cwd);
  shells.set(cwd, shell);
  return shell;
}

process.on("exit", () => {
  for (const shell of shells.values()) shell.dispose();
});
