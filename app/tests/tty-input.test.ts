import { expect, test } from "bun:test";

import { placeFrame } from "../src/tty/graphics";
import { createTtyInput, type TtyEvent } from "../src/tty/input";

function keys(events: readonly TtyEvent[]): string[] {
  return events.flatMap((event) => (event.kind === "key" ? [event.keystroke] : []));
}

test("typing, control keys and Ctrl standing in for cmd", () => {
  const parse = createTtyInput();
  expect(keys(parse("aB é\r\t\x7f"))).toEqual(["a", "B", "space", "é", "enter", "tab", "backspace"]);
  expect(keys(parse("\x0b\x03"))).toEqual(["cmd-k", "cmd-c"]);
  expect(parse("\x1d")).toEqual([{ kind: "quit" }]);
});

test("arrows, modifiers, alt and a lone escape", () => {
  const parse = createTtyInput();
  expect(keys(parse("\x1b[A\x1b[1;2D\x1b[1;5C\x1b[3~\x1b[Z\x1bf\x1b"))).toEqual(["up", "shift-left", "cmd-right", "delete", "shift-tab", "alt-f", "escape"]);
});

test("sequences split across reads wait for the rest", () => {
  const parse = createTtyInput();
  expect(parse("\x1b[<0;10")).toEqual([]);
  expect(parse(";20M")).toEqual([
    { kind: "mouse", mouse: { button: 0, x: 10, y: 20, released: false, motion: false, wheel: false, modifiers: "" } },
  ]);
});

test("mouse motion, wheel and modifiers", () => {
  const parse = createTtyInput();
  const [drag, wheel, shiftClick] = parse("\x1b[<32;5;6M\x1b[<65;5;6M\x1b[<4;1;1m");
  expect(drag).toMatchObject({ mouse: { motion: true, button: 0 } });
  expect(wheel).toMatchObject({ mouse: { wheel: true, button: 1 } });
  expect(shiftClick).toMatchObject({ mouse: { released: true, modifiers: "shift" } });
});

test("terminal replies are reported, graphics replies are dropped", () => {
  const parse = createTtyInput();
  expect(parse("\x1b[4;1800;2880t\x1b[6;36;18t\x1b[?1016;2$y\x1b_Gi=2;OK\x1b\\")).toEqual([
    { kind: "reply", reply: { kind: "window", width: 2880, height: 1800 } },
    { kind: "reply", reply: { kind: "cell", width: 18, height: 36 } },
    { kind: "reply", reply: { kind: "mode", mode: 1016, value: 2 } },
  ]);
});

test("frames replace the previous image and inline PNGs come in chunks", () => {
  const box = { columns: 80, rows: 24 };
  const file = placeFrame("kitty-file", new Uint8Array(), "/tmp/x.png", 3, 2, box);
  expect(file).toContain("a=T,f=100,i=3,q=2,C=1,c=80,r=24,t=t;");
  expect(file.endsWith("\x1b_Ga=d,d=I,i=2,q=2;\x1b\\")).toBe(true);
  const inline = placeFrame("kitty-inline", new Uint8Array(5000), "", 2, null, box);
  expect(inline.match(/\x1b_G/g)?.length).toBe(2);
  expect(inline).toContain("m=0;");
});
