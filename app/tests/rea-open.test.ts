import { afterEach, expect, test } from "bun:test";

import { GHIDRA_STARTUP_MS, openProblem, ReaError, reaEnv } from "../src/engine/rea";
import { currentSettings } from "../src/settings/store";

const inherited = process.env.REA_GHIDRA_STARTUP_TIMEOUT_MS;

afterEach(() => {
  if (inherited === undefined) delete process.env.REA_GHIDRA_STARTUP_TIMEOUT_MS;
  else process.env.REA_GHIDRA_STARTUP_TIMEOUT_MS = inherited;
});

test("ghidra gets longer than REA's default to analyze a big app", () => {
  delete process.env.REA_GHIDRA_STARTUP_TIMEOUT_MS;
  expect(reaEnv().REA_GHIDRA_STARTUP_TIMEOUT_MS).toBe(String(GHIDRA_STARTUP_MS));
  process.env.REA_GHIDRA_STARTUP_TIMEOUT_MS = "900000";
  expect(reaEnv().REA_GHIDRA_STARTUP_TIMEOUT_MS).toBe("900000");
});

test("turning off swift names skips ghidra's swift demangler", () => {
  const on = currentSettings();
  expect(reaEnv({ ...on, swiftNames: true }).REA_GHIDRA_DISABLED_ANALYZERS ?? "").not.toContain("Demangler Swift");
  expect(reaEnv({ ...on, swiftNames: false }).REA_GHIDRA_DISABLED_ANALYZERS).toContain("Demangler Swift");
});

test("a timeout says so instead of pointing at Setup", () => {
  expect(openProblem(new ReaError("Analysis took too long.", "timeout")).advice).toContain("ran out of time");
  expect(openProblem(new ReaError("Analysis could not complete.\ncode execution_failure, during list_procedures", "execution_failure")).advice).toContain("details below");
  expect(openProblem(new Error("spawn rea ENOENT")).advice).toContain("Setup");
});
