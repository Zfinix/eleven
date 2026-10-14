import type { EventPayload } from "@gpuix/react";
import { type ReactElement, useEffect, useState } from "react";

import { noteTyping } from "../lib/shortcuts";
import { useSize } from "../lib/useSize";
import { MONO, useTheme } from "../theme";
import { type Run, type Screen, shellIn } from "./shell";
import { OS, readClipboard } from "../lib/platform";

const FONT_SIZE = 12;
const LINE_HEIGHT = 18;
/** JetBrains Mono advances 600/1000 of an em per character. */
const CHAR_WIDTH = FONT_SIZE * 0.6;
const PAD = 10;
const CURSOR = "#e5c07b";

function RunText({ run, focused, ink }: { readonly run: Run; readonly focused: boolean; readonly ink: string }): ReactElement {
  const cursor = run.cursor ? (focused ? { backgroundColor: CURSOR, color: ink } : { backgroundColor: "rgba(229,192,123,0.35)" }) : {};
  return (
    <div style={{
      whiteSpace: "nowrap",
      ...(run.fg ? { color: run.fg } : {}),
      ...(run.bg ? { backgroundColor: run.bg } : {}),
      ...(run.bold ? { fontWeight: 700 } : {}),
      ...(run.italic ? { fontStyle: "italic" } : {}),
      ...(run.underline ? { textDecoration: "underline" } : {}),
      ...cursor,
    }}>
      {run.text}
    </div>
  );
}

/** A real terminal: the user's login shell in the opened file's folder. */
export function TerminalView({ cwd }: { readonly cwd: string }): ReactElement {
  const { p } = useTheme();
  const shell = shellIn(cwd);
  const { ref, width, height } = useSize();
  const [screen, setScreen] = useState<Screen>(() => shell.screen());
  const [focused, setFocused] = useState(true);
  const [wheel, setWheel] = useState(0);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = shell.onChange(() => {
      timer ??= setTimeout(() => {
        timer = null;
        setScreen(shell.screen());
      }, 12);
    });
    setScreen(shell.screen());
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [shell]);
  useEffect(() => {
    if (width > 0 && height > 0) shell.resize(Math.floor((width - PAD * 2) / CHAR_WIDTH), Math.floor((height - PAD * 2) / LINE_HEIGHT));
  }, [shell, width, height]);
  const onKeyDown = (event: EventPayload): void => {
    noteTyping(event);
    const key = event.key?.toLowerCase();
    if (!key) return;
    const mods = { ctrl: event.modifiers?.ctrl ?? false, alt: event.modifiers?.alt ?? false, shift: event.modifiers?.shift ?? false, cmd: event.modifiers?.cmd ?? false };
    const command = OS === "mac" ? mods.cmd : mods.ctrl && mods.shift;
    if (command && key === "v") return shell.paste(readClipboard());
    if (command && key === "k") return shell.clear();
    shell.key(key, event.keyChar, mods);
  };
  const onScroll = (event: EventPayload): void => {
    const total = wheel + (event.precise ? (event.deltaY ?? 0) / LINE_HEIGHT : (event.deltaY ?? 0));
    const lines = Math.trunc(total);
    setWheel(total - lines);
    if (lines !== 0) shell.scroll(-lines);
  };
  return (
    <div
      ref={ref}
      tabIndex={0}
      autoFocus
      role="log"
      aria-label="Terminal"
      onKeyDown={onKeyDown}
      onScroll={onScroll}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, padding: PAD, overflow: "hidden", userSelect: "text", backgroundColor: p.deep, color: p.text, fontFamily: MONO, fontSize: FONT_SIZE, lineHeight: LINE_HEIGHT, cursor: "text" }}
    >
      {screen.rows.map((runs, y) => (
        <div key={y} style={{ display: "flex", height: LINE_HEIGHT, flexShrink: 0 }}>
          {runs.map((run, x) => <RunText key={x} run={run} focused={focused} ink={p.deep} />)}
        </div>
      ))}
    </div>
  );
}
