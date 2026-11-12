import "./quiet";

import { mkdtemp, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRenderer, type GpuixRenderer, render, startFrameLoop } from "@gpuix/react";

import { adoptLoginShell } from "../agents/detect";
import { App } from "../App";
import { startAppBridge } from "../bridge/live";
import { Fonts } from "../components/Fonts";
import { prepareTarget, type Target } from "../engine/target";
import { adoptToolchain } from "../engine/toolchain";
import { adoptLanguage } from "../i18n";
import { dispatchShortcut } from "../lib/shortcuts";
import { startTelemetry } from "../lib/telemetry";
import { currentSettings } from "../settings/store";
import { type Box, deleteImage, KITTY_TEMP_MARKER, pickTransport, placeFrame } from "./graphics";
import { createTtyInput, type MouseEvent, type Reply, type TtyEvent } from "./input";

type Size = { readonly width: number; readonly height: number };
type Layout = Box & { readonly pixels: Size };

const FRAME_MS = 50;
const WHEEL_STEP = 48;
const PIXEL_MOUSE = 1016;
const ENTER = "\x1b[?1049h\x1b[?25l\x1b[?1003h\x1b[?1006h";
const QUERIES = `\x1b[14t\x1b[16t\x1b[?${PIXEL_MOUSE}$p`;
const STATUS = "Eleven in your terminal   Ctrl works as ⌘   Ctrl+] quits";

const out = process.stdout;

function write(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (out.write(text)) resolve();
    else out.once("drain", () => resolve());
  });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function until(done: () => boolean, ms: number): Promise<void> {
  const deadline = performance.now() + ms;
  while (!done() && performance.now() < deadline) await wait(10);
}

function cellSize(replies: readonly Reply[]): Size {
  for (const reply of replies) if (reply.kind === "cell") return reply;
  for (const reply of replies) {
    if (reply.kind === "window") return { width: reply.width / out.columns, height: reply.height / out.rows };
  }
  return { width: 16, height: 34 };
}

function pixelMouse(replies: readonly Reply[]): boolean {
  return replies.some((reply) => reply.kind === "mode" && reply.mode === PIXEL_MOUSE && (reply.value === 1 || reply.value === 2));
}

function layout(cell: Size): Layout {
  const columns = Math.max(1, out.columns);
  const rows = Math.max(1, out.rows - 1);
  return { columns, rows, pixels: { width: columns * cell.width, height: rows * cell.height } };
}

let status = STATUS;

function statusLine(): string {
  return `\x1b[${out.rows};1H\x1b[2K\x1b[2m ${status.slice(0, Math.max(0, out.columns - 2))}\x1b[0m`;
}

await adoptLoginShell();
adoptLanguage(currentSettings().language);
adoptToolchain();
startAppBridge();
startTelemetry();

const parse = createTtyInput();
const replies: Reply[] = [];
let handle: (event: TtyEvent) => void = (event) => {
  if (event.kind === "reply") replies.push(event.reply);
};
process.stdin.setRawMode(true);
process.stdin.on("data", (chunk: Buffer) => {
  for (const event of parse(chunk.toString("utf8"))) handle(event);
});
process.stdin.resume();

await write(ENTER + QUERIES);
await until(() => replies.some((reply) => reply.kind === "cell") && replies.some((reply) => reply.kind === "mode"), 400);

const cell = cellSize(replies);
const pixelReports = pixelMouse(replies);
if (pixelReports) await write(`\x1b[?${PIXEL_MOUSE}h`);
let box = layout(cell);
const scale = Number(process.env.ELEVEN_TTY_SCALE) || 2;
const windowSize: Size = { width: Math.floor(box.pixels.width / scale), height: Math.floor(box.pixels.height / scale) };

const renderer: GpuixRenderer = createRenderer();
renderer.init({
  title: "Eleven",
  appName: "Eleven",
  appId: "eleven",
  width: windowSize.width,
  height: windowSize.height,
  show: false,
  focus: false,
  windowBackground: "opaque",
});
startFrameLoop(renderer, { onTerminated: () => void quit() });

const initialPath = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
const initial: Target | null = initialPath ? prepareTarget(initialPath) : null;
render(<Fonts><App initial={initial} /></Fonts>, { renderer, onKeyDown: dispatchShortcut });

const transport = pickTransport(process.env);
const frames = await mkdtemp(join(tmpdir(), "eleven-tty-"));
let running = true;
let shown: number | null = null;
let lastHash: number | bigint | null = null;
let force = true;
let sequence = 0;
let pressed: number | null = null;

function toWindow(mouse: MouseEvent): { readonly x: number; readonly y: number } | null {
  const px = pixelReports ? mouse.x : (mouse.x - 0.5) * cell.width;
  const py = pixelReports ? mouse.y : (mouse.y - 0.5) * cell.height;
  if (py > box.pixels.height) return null;
  return { x: (px * windowSize.width) / box.pixels.width, y: (py * windowSize.height) / box.pixels.height };
}

function onMouse(mouse: MouseEvent): void {
  const at = toWindow(mouse);
  if (!at) return;
  const modifiers = mouse.modifiers || undefined;
  if (mouse.wheel) {
    const deltaX = mouse.button === 2 ? WHEEL_STEP : mouse.button === 3 ? -WHEEL_STEP : 0;
    const deltaY = mouse.button === 0 ? WHEEL_STEP : mouse.button === 1 ? -WHEEL_STEP : 0;
    renderer.simulateScrollWheel(at.x, at.y, deltaX, deltaY, modifiers);
  } else if (mouse.motion) {
    renderer.simulateMouseMove(at.x, at.y, pressed ?? undefined, modifiers);
  } else if (mouse.released) {
    renderer.simulateMouseUp(at.x, at.y, pressed ?? mouse.button, modifiers);
    pressed = null;
  } else {
    pressed = mouse.button;
    renderer.simulateMouseDown(at.x, at.y, mouse.button, modifiers);
  }
  force = true;
}

handle = (event) => {
  switch (event.kind) {
    case "quit":
      void quit();
      return;
    case "key":
      renderer.simulateKeystrokes(event.keystroke);
      return;
    case "mouse":
      onMouse(event.mouse);
      return;
    case "reply":
      return;
  }
};

async function pump(): Promise<void> {
  const path = join(frames, `${KITTY_TEMP_MARKER}-${sequence++}.png`);
  renderer.captureScreenshot(path);
  const png = await Bun.file(path).bytes();
  const hash = Bun.hash(png);
  if (hash === lastHash && !force) {
    await unlink(path);
    return;
  }
  lastHash = hash;
  force = false;
  const id = shown === 2 ? 3 : 2;
  await write(placeFrame(transport, png, path, id, shown, box));
  shown = id;
  if (transport !== "kitty-file") await unlink(path);
}

async function quit(): Promise<void> {
  if (!running) return;
  running = false;
  await write(`${deleteImage(2)}${deleteImage(3)}\x1b[?${PIXEL_MOUSE}l\x1b[?1006l\x1b[?1003l\x1b[?25h\x1b[?1049l`);
  process.stdin.setRawMode(false);
  await rm(frames, { recursive: true, force: true });
  process.exit(0);
}

out.on("resize", () => {
  box = layout(cell);
  force = true;
  void write(`\x1b[2J${statusLine()}`);
});
process.on("SIGTERM", () => void quit());
process.on("SIGHUP", () => void quit());

await write(statusLine());
while (running) {
  const started = performance.now();
  try {
    await pump();
  } catch (error) {
    console.error("[tty] frame failed", error);
    const why = `Eleven can't draw here: ${error instanceof Error ? error.message : String(error)}. Ctrl+] quits`;
    if (status !== why) {
      status = why;
      await write(statusLine());
    }
  }
  await wait(Math.max(0, FRAME_MS - (performance.now() - started)));
}
