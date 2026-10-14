import { expect, test } from "bun:test";

import { isNewer, newestFirst, versionIn } from "../src/lib/version";

test("versions read out of tool names, folder names and Java's old 1.x scheme", () => {
  expect(versionIn("ghidra_12.1.4_PUBLIC")?.version).toBe("12.1.4");
  expect(versionIn("jadx-1.5.6")?.version).toBe("1.5.6");
  expect(versionIn("1.8.0_402")?.version).toBe("1.8.0");
  expect(versionIn("11.3")?.version).toBe("11.3.0");
  expect(versionIn("no version here")).toBeNull();
});

test("a release is newer only when its version is higher", () => {
  expect(isNewer("0.1.10", "0.1.9")).toBe(true);
  expect(isNewer("11.3.2", "11.3")).toBe(true);
  expect(isNewer("0.1.3", "0.1.3")).toBe(false);
  expect(isNewer("garbage", "0.1.3")).toBe(false);
});

test("sorting puts the newest first and anything without a version last", () => {
  const sorted = ["ghidra_11.3_PUBLIC", "unknown", "ghidra_12.1.4_PUBLIC", "ghidra_11.3.2_PUBLIC"].sort(newestFirst((name) => name));
  expect(sorted).toEqual(["ghidra_12.1.4_PUBLIC", "ghidra_11.3.2_PUBLIC", "ghidra_11.3_PUBLIC", "unknown"]);
});
