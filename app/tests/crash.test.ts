import { expect, test } from "bun:test";

import { parseCrash, placeFrames } from "../src/engine/crash";

const REPORT = [
  JSON.stringify({ app_name: "PhotoFilter", bug_type: "309" }),
  JSON.stringify({
    procName: "PhotoFilter",
    faultingThread: 1,
    exception: { type: "EXC_BAD_ACCESS", signal: "SIGSEGV", subtype: "KERN_INVALID_ADDRESS at 0x0" },
    usedImages: [{ name: "libsystem_kernel.dylib" }, { name: "PhotoFilter" }],
    threads: [
      { id: 1, frames: [{ imageOffset: 100, imageIndex: 0 }] },
      { id: 2, triggered: true, frames: [{ imageOffset: 0xc80, imageIndex: 1 }, { imageOffset: 52, imageIndex: 0, symbol: "__pthread_kill" }, { imageOffset: 0xe80, imageIndex: 1 }] },
    ],
  }),
].join("\n");

test("a crash report gives the exception and the crashed thread's frames", () => {
  const crash = parseCrash(REPORT);
  expect(crash.app).toBe("PhotoFilter");
  expect(crash.exception).toBe("EXC_BAD_ACCESS SIGSEGV KERN_INVALID_ADDRESS at 0x0");
  expect(crash.thread).toEqual([
    { image: "PhotoFilter", offset: 0xc80, symbol: null },
    { image: "libsystem_kernel.dylib", offset: 52, symbol: "__pthread_kill" },
    { image: "PhotoFilter", offset: 0xe80, symbol: null },
  ]);
  expect(() => parseCrash("not json")).toThrow("isn't a macOS crash report");
});

test("frames in the binary land in the function that contains them; others stay outside", () => {
  const placed = placeFrames(parseCrash(REPORT).thread, "PhotoFilter", 0x100000000n, ["0x100000e74", "0x100000c78", "0x100000a70"]);
  expect(placed.map((frame) => [frame.addr, frame.fn])).toEqual([["0x100000c80", "0x100000c78"], [null, null], ["0x100000e80", "0x100000e74"]]);
});
