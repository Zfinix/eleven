import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "eleven-paid-"));
process.env.ELEVEN_SUPPORT = home;
delete process.env.REA_IDA_MCP_CONFIG;

const { headlessRegistration, idaRegistration } = await import("../src/engine/ida");
const { loadSettings, saveSettings } = await import("../src/settings/store");
const { binjaInstalled } = await import("../src/engine/binja");
const { ASSETS } = await import("../src/lib/assets");

function fakeApp(name: string): string {
  const app = join(home, name);
  mkdirSync(join(app, "Contents", "MacOS"), { recursive: true });
  return app;
}

test("ida: the headless registration runs ida-pro-mcp's supervisor on one worker, pointed at IDA's own folder", () => {
  const parsed: unknown = JSON.parse(headlessRegistration("/bin/idalib-mcp", "/Applications/IDA Professional 9.1.app"));
  expect(parsed).toEqual({ command: "/bin/idalib-mcp", args: ["--stdio", "--max-workers", "1"], mode: "headless", env: { IDADIR: "/Applications/IDA Professional 9.1.app/Contents/MacOS" } });
});

test("ida: a registration you pick wins, and IDA alone without ida-pro-mcp isn't enough", () => {
  const app = fakeApp("IDA Professional 9.1.app");
  saveSettings({ ...loadSettings(), idaPath: app });
  const before = process.env.PATH;
  process.env.PATH = "/usr/bin:/bin";
  try {
    expect(idaRegistration()).toBeNull();
  } finally {
    process.env.PATH = before;
  }
  const mine = join(home, "my-ida.json");
  writeFileSync(mine, "{}");
  saveSettings({ ...loadSettings(), idaPath: mine });
  expect(idaRegistration()).toBe(mine);
});

test("ida: with IDA and idalib-mcp installed, Eleven writes the registration REA reads", () => {
  const app = fakeApp("IDA Pro 9.2.app");
  const bin = join(home, "bin");
  mkdirSync(bin, { recursive: true });
  const server = join(bin, "idalib-mcp");
  writeFileSync(server, "#!/bin/sh\n");
  chmodSync(server, 0o755);
  saveSettings({ ...loadSettings(), idaPath: app });
  const before = process.env.PATH;
  process.env.PATH = `${bin}:/usr/bin:/bin`;
  try {
    const written = idaRegistration();
    if (!written) throw new Error("no registration written");
    expect(readFileSync(written, "utf8")).toBe(headlessRegistration(server, app));
  } finally {
    process.env.PATH = before;
  }
});

test("binary ninja: installed only when its app has the Python module", () => {
  const app = fakeApp("Binary Ninja.app");
  saveSettings({ ...loadSettings(), binjaPath: app });
  expect(binjaInstalled()).toBe(false);
  mkdirSync(join(app, "Contents", "Resources", "python"), { recursive: true });
  expect(binjaInstalled()).toBe(true);
});

test("binary ninja: the helper answers with a plain error when Binary Ninja's module is missing", () => {
  const helper = join(ASSETS, "binja", "eleven_binja.py");
  execFileSync("python3", ["-m", "py_compile", helper]);
  let said = "";
  try {
    execFileSync("python3", [helper, "/bin/ls"], { env: { PATH: process.env.PATH ?? "", PYTHONPATH: home }, stdio: "pipe" });
  } catch (err) {
    said = err instanceof Error && "stdout" in err ? String(err.stdout) : "";
  }
  const reply: unknown = JSON.parse(said);
  expect(reply).toEqual({ error: expect.stringContaining("Binary Ninja's module") });
});

test("binary ninja: the workbench reads functions, sections, code, bytes and callers through the helper", async () => {
  const { chooseEngine, ENGINES, setEnabled } = await import("../src/analysis/engines");
  const { loadProgram } = await import("../src/workbench/program");
  const { prepareTarget } = await import("../src/engine/target");
  const { binjaClose } = await import("../src/engine/binja");
  const app = fakeApp("Binary Ninja Fake.app");
  const resources = join(app, "Contents", "Resources");
  mkdirSync(resources, { recursive: true });
  cpSync(join(import.meta.dir, "fixtures", "binja"), join(resources, "python"), { recursive: true });
  saveSettings({ ...loadSettings(), binjaPath: app });
  for (const engine of ENGINES) setEnabled(engine.id, false);
  chooseEngine("binaryninja");
  const binary = join(home, "sample.bin");
  writeFileSync(binary, Buffer.alloc(64));
  const program = await loadProgram(prepareTarget(binary));
  try {
    expect(program.engine).toBe("Binary Ninja");
    expect(program.functions.map((fn) => [fn.addr, fn.name, fn.kind])).toEqual([["0x1000", "main", "function"], ["0x2000", "helper", "function"], ["0x3000", "printf", "thunk"]]);
    expect(program.imports).toEqual([{ a: "", b: "printf" }]);
    expect(program.strings).toEqual([{ a: "0x4000", b: "hello" }, { a: "0x4010", b: "world" }]);
    expect(program.segments).toEqual([{ a: ".text", b: "0x1000 · 12288 bytes" }, { a: ".data", b: "0x4000 · 256 bytes" }]);
    expect(await program.code("0x1000", "asm")).toBe("0x1000  push rbp\n0x1004  mov rbp, rsp\n0x1008  call helper\n0x100c  ret");
    expect(await program.code("0x1000", "pseudo")).toContain("return helper();");
    expect((await program.hex("0x1000"))[0]?.bytes).toBe("00 01 02 03 04 05 06 07 08 09 0a 0b 0c 0d 0e 0f");
    expect(await program.refs("0x2000")).toEqual({ callers: [{ addr: "0x1000", at: "0x1008" }], callees: [] });
    expect(await program.refs("0x1000")).toEqual({ callers: [], callees: ["0x2000"] });
    await program.retype?.("0x1100", "procedure", null);
    await expect(program.code("0x9999", "asm")).rejects.toThrow("no function starts at 0x9999");
  } finally {
    await binjaClose(binary);
  }
}, 60_000);
