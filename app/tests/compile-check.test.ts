import { expect, test } from "bun:test";

import { checkCommand, compileCheck, errorLines } from "../src/engine/compileCheck";

test("each language gets the check it can take", () => {
  expect(checkCommand("Sources/App/Model.swift", "/t/Model.swift")).toEqual({ args: ["xcrun", "swiftc", "-parse", "/t/Model.swift"], depth: "syntax" });
  expect(checkCommand("blur.m", "/t/blur.m")?.args).toContain("-fobjc-arc");
  expect(checkCommand("parse.c", "/t/parse.c")?.depth).toBe("types");
  expect(checkCommand("Main.kt", "/t/Main.kt")).toBeNull();
  expect(errorLines("/t/x/parse.c:3:9: error: use of undeclared identifier 'y'\nwarning: ok\n  | `- error: use of undeclared identifier 'y'", "/t/x/parse.c", "src/parse.c")).toEqual(["parse.c:3:9: error: use of undeclared identifier 'y'"]);
});

const run = process.platform === "darwin" ? test : test.skip;

run("Xcode's compiler passes good C and reports bad C by line", async () => {
  expect(await compileCheck("ok.c", "int twice(int x) { return x * 2; }\n")).toEqual({ depth: "types", errors: [] });
  const bad = await compileCheck("bad.c", "int twice(int x) {\n  return y * 2;\n}\n");
  expect(bad?.errors).toHaveLength(1);
  expect(bad?.errors[0]).toStartWith("bad.c:2:");
}, 60_000);
