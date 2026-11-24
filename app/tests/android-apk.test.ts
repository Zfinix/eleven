import "./fixtures/isolate";
import { beforeAll, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { adoptLoginShell } from "../src/agents/detect";
import { apktoolCommand, dartSnapshot, hermesVersion, hexDump, il2cppMetadata, isFlutterCode, resourceKind, resourceStrings, smaliFile, smaliMethod } from "../src/engine/apk";
import { prepareTarget } from "../src/engine/target";
import { adoptToolchain } from "../src/engine/toolchain";
import { runSync } from "../src/lib/process";
import { loadProgram } from "../src/workbench/program";

const APK = join(import.meta.dir, "fixtures", "android", "hello.apk");
const ELF = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]);

beforeAll(async () => {
  await adoptLoginShell();
  adoptToolchain();
});

test("string resources read with their names, entities and escapes undone", () => {
  const xml = `<resources>
    <string name="app_name">Oniru</string>
    <string name="welcome" formatted="false">Tom &amp; Jerry\\'s \\"place\\"</string>
    <string name="quoted">"  spaced  "</string>
  </resources>`;
  expect(resourceStrings(xml)).toEqual([
    { a: "app_name", b: "Oniru" },
    { a: "welcome", b: "Tom & Jerry's \"place\"" },
    { a: "quoted", b: "  spaced  " },
  ]);
});

test("smali: each dex has its own folder, and one method reads from .method to .end method", () => {
  expect(smaliFile(1n, "com.example.Main")).toBe(join("smali", "com/example/Main.smali"));
  expect(smaliFile(3n, "com.example.Main$Inner")).toBe(join("smali_classes3", "com/example/Main$Inner.smali"));
  const text = [".class public Lcom/example/Main;", "", ".method public constructor <init>()V", "    return-void", ".end method", "", ".method public static run(I)I", "    .locals 1", "    return p0", ".end method"].join("\n");
  expect(smaliMethod(text, "run(I)I")).toBe([".method public static run(I)I", "    .locals 1", "    return p0", ".end method"].join("\n"));
  expect(smaliMethod(text, "missing()V")).toBe("");
});

test("files in an app are told apart by name and first bytes", () => {
  expect(resourceKind("res/drawable/icon.png", Buffer.from("anything"))).toBe("image");
  expect(resourceKind("lib/arm64-v8a/libapp.so", ELF)).toBe("native");
  expect(resourceKind("assets/index.android.bundle", Buffer.from([0xc6, 0x1f, 0xbc, 0x03, 0xc1, 0x03, 0x19, 0x1f, 0x60]))).toBe("hermes");
  expect(resourceKind("AndroidManifest.xml", Buffer.from("<?xml version=\"1.0\"?>"))).toBe("text");
  expect(resourceKind("resources.arsc", Buffer.from([2, 0, 12, 0]))).toBe("binary");
  expect(hexDump(Buffer.from("Hello\0"))).toBe(`00000000  48 65 6c 6c 6f 00${" ".repeat(30)}  Hello.`);
});

test("an APK's methods read as smali when apktool is installed", async () => {
  const program = await loadProgram(prepareTarget(APK));
  const shout = program.functions.find((fn) => fn.name === "app.eleven.hello.Greeter.shout");
  if (!shout) throw new Error("shout missing");
  const code = await program.code(shout.addr, "asm");
  if (apktoolCommand()) {
    expect(code.split("\n")[0]).toBe(".method public static shout(I)I");
    expect(code.trimEnd().endsWith(".end method")).toBe(true);
  } else {
    expect(code).toMatch(/^0x[0-9a-f]+\s/m);
  }
}, 120_000);

test("a bundle of split APKs opens its base APK and lists the native libraries from the splits", async () => {
  const work = mkdtempSync(join(tmpdir(), "eleven-xapk-"));
  copyFileSync(APK, join(work, "base.apk"));
  mkdirSync(join(work, "split", "lib", "arm64-v8a"), { recursive: true });
  writeFileSync(join(work, "split", "lib", "arm64-v8a", "libgreeter.so"), Buffer.concat([ELF, Buffer.alloc(64)]));
  runSync("zip", ["-q", "-r", join(work, "config.arm64_v8a.apk"), "lib"], { cwd: join(work, "split") });
  const bundle = join(work, "hello.xapk");
  runSync("zip", ["-q", "-j", bundle, join(work, "base.apk"), join(work, "config.arm64_v8a.apk")]);

  const target = prepareTarget(bundle);
  expect(target.meta).toBe("Android · Dalvik · split app");
  expect(basename(target.path)).toBe("base.apk");
  const program = await loadProgram(target);
  expect(program.functions.map((fn) => fn.name)).toContain("app.eleven.hello.Greeter.greet");
  const files = program.resources;
  if (!files) throw new Error("no resources");
  expect(files.files).toContain("lib/arm64-v8a/libgreeter.so");
  const unpacked = await files.local("lib/arm64-v8a/libgreeter.so");
  expect(readFileSync(unpacked).subarray(0, 4).equals(ELF.subarray(0, 4))).toBe(true);
}, 180_000);

test("Unity metadata shows its version, or that it is encrypted; Flutter's Dart code is recognised", () => {
  const plain = Buffer.alloc(8);
  plain.writeUInt32LE(0xfab11baf, 0);
  plain.writeInt32LE(31, 4);
  expect(resourceKind("assets/bin/Data/Managed/Metadata/global-metadata.dat", plain)).toBe("il2cpp");
  expect(il2cppMetadata(plain)).toEqual({ kind: "plain", version: 31 });
  expect(il2cppMetadata(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]))).toEqual({ kind: "encrypted" });
  expect(isFlutterCode("lib/arm64-v8a/libapp.so")).toBe(true);
  expect(isFlutterCode("Frameworks/App.framework/App")).toBe(true);
  expect(isFlutterCode("lib/arm64-v8a/libflutter.so")).toBe(false);
});

test("Hermes bytecode says its version, and a Dart snapshot its hash and features", () => {
  const hermes = Buffer.alloc(12);
  Buffer.from([0xc6, 0x1f, 0xbc, 0x03, 0xc1, 0x03, 0x19, 0x1f]).copy(hermes);
  hermes.writeUInt32LE(96, 8);
  expect(hermesVersion(hermes)).toBe(96);
  expect(hermesVersion(Buffer.from("not hermes bytes"))).toBeNull();
  const hash = "0123456789abcdef0123456789abcdef";
  const snapshot = Buffer.concat([Buffer.from("ELF junk"), Buffer.from([0xf5, 0xf5, 0xdc, 0xdc]), Buffer.alloc(16), Buffer.from(hash), Buffer.from("product no-code_comments arm64 android"), Buffer.from([0])]);
  expect(dartSnapshot(snapshot)).toEqual({ hash, features: "product no-code_comments arm64 android" });
  expect(dartSnapshot(Buffer.from("nothing here"))).toBeNull();
});
