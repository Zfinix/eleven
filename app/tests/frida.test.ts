import { expect, test } from "bun:test";

import { hookScript, imageBase } from "../src/workbench/frida";

test("the image base is __TEXT for Mach-O and the lowest loaded segment otherwise", () => {
  expect(imageBase([{ a: "__PAGEZERO", b: "0x0 to 0x100000000" }, { a: "__TEXT", b: "0x100000000 to 0x100008000" }])).toBe(0x100000000n);
  expect(imageBase([{ a: ".data", b: "0x140003000 to 0x140004000" }, { a: "Headers", b: "0x140000000 to 0x140001000" }, { a: ".text", b: "0x140001000 to 0x140003000" }])).toBe(0x140000000n);
});

test("a hook finds the function from the module base and logs calls and returns", () => {
  const script = hookScript("PhotoFilter", 0xc78n, "FUN_100000c78", "0x100000c78");
  expect(script).toContain('Process.findModuleByName("PhotoFilter") ?? Process.mainModule');
  expect(script).toContain('module.base.add("0xc78")');
  expect(script).toContain("Interceptor.attach(target, {");
  expect(script).toContain("returned ${retval}");
  expect(hookScript("PhotoFilter", 0xc78n, "BlurFilter::encode", "0x100000c78")).toContain("ObjC.selectorAsString(args[1])");
});
