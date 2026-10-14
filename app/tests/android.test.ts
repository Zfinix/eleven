import "./fixtures/isolate";
import { beforeAll, expect, test } from "bun:test";
import { join } from "node:path";

import { adoptLoginShell } from "../src/agents/detect";
import { engineHint } from "../src/analysis/hint";
import { isAndroidCode, jadxProcedures } from "../src/engine/jadx";
import { projectId } from "../src/engine/project";
import { prepareTarget } from "../src/engine/target";
import { adoptToolchain } from "../src/engine/toolchain";
import { loadProgram } from "../src/workbench/program";
import { Screen } from "./harness";

/** Built from fixtures/android/app/eleven/hello/Greeter.java with javac and d8. */
const APK = join(import.meta.dir, "fixtures", "android", "hello.apk");

beforeAll(async () => {
  await adoptLoginShell();
  adoptToolchain();
});

test("an APK is recognized as Android code, a Mach-O and a plain zip are not", () => {
  expect(isAndroidCode(APK)).toBe(true);
  expect(isAndroidCode("/bin/ls")).toBe(false);
  expect(isAndroidCode(join(import.meta.dir, "fixtures", "PhotoFilter.app"))).toBe(false);
});

test("an APK opens through jadx: methods, Java, bytecode, native methods and the call graph", async () => {
  const target = prepareTarget(APK);
  expect(target.meta).toBe("Android · Dalvik");
  const program = await loadProgram(target);
  const names = program.functions.map((fn) => fn.name);
  expect(names).toContain("app.eleven.hello.Greeter.greet");
  expect(names).toContain("app.eleven.hello.Greeter.shout");
  expect(program.imports).toContainEqual({ a: "app.eleven.hello.Greeter", b: "checksum" });

  const greet = program.functions.find((fn) => fn.name === "app.eleven.hello.Greeter.greet");
  const shout = program.functions.find((fn) => fn.name === "app.eleven.hello.Greeter.shout");
  if (!greet || !shout) throw new Error("methods missing");
  expect(BigInt(greet.addr)).toBeGreaterThan(0n);

  const java = await program.code(greet.addr, "pseudo");
  expect(java).toContain("public String greet() {");
  expect(java).toContain("Hello, ");
  const bytecode = await program.code(shout.addr, "asm");
  expect(bytecode).toMatch(/^0x[0-9a-f]+\s|^\.method /m);

  expect((await program.refs(greet.addr)).callees).toContain(shout.addr);
  expect((await program.refs(shout.addr)).callers.map((caller) => caller.addr)).toContain(greet.addr);
}, 120_000);

test("an APK file opens whole: package, imports, every method, and lines that lead to each method", async () => {
  const program = await loadProgram(prepareTarget(APK));
  const greet = program.functions.find((fn) => fn.name === "app.eleven.hello.Greeter.greet");
  if (!greet?.file || !program.source) throw new Error("no source file for greet");
  expect(greet.file).toBe("app/eleven/hello/Greeter.java");
  const source = await program.source(greet.file);
  const lines = source.text.split("\n");
  expect(lines[0]).toBe("package app.eleven.hello;");
  expect(source.text).toContain("public class Greeter {");
  expect(source.text).toContain("private static native int checksum(int i);");
  expect(source.text).toContain("public static int shout(int i) {");
  const start = source.starts.find((entry) => entry.addr === greet.addr);
  expect(lines[(start?.line ?? 0) - 1]).toContain("public String greet() {");
  expect(lines.at(-1)).toBe("}");
}, 120_000);

test("clicking a .java file in the sidebar opens the whole file, and its method lines open the method", async () => {
  const screen = new Screen().workbench(prepareTarget(APK));
  try {
    await screen.until(() => screen.labelled("Open Greeter.java") !== null, 120_000);
    screen.clickLabel("Open Greeter.java");
    await screen.until(() => screen.texts().includes("loadLibrary") && screen.texts().includes("package"), 30_000);
    expect(screen.labelled("Line 28")).not.toBeNull();
    expect(screen.labelled("Open app.eleven.hello.Greeter.greet")).not.toBeNull();
    screen.clickLabel("Open app.eleven.hello.Greeter.greet");
    await screen.until(() => screen.text().includes("app.eleven.hello.Greeter.greet"), 30_000);
  } finally {
    screen.unmount();
  }
}, 180_000);

test("the chat and the agent's tools read an APK with jadx, never Ghidra", async () => {
  const target = prepareTarget(APK);
  const hint = engineHint(target.path, target.arch);
  expect(hint).toContain("jadx");
  expect(hint).toContain("Don't call open_binary");
  const procedures = await jadxProcedures(target.path, projectId(target));
  expect(procedures.map((p) => p.name)).toContain("app.eleven.hello.Greeter.greet");
});
