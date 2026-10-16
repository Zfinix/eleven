import { afterEach, expect, test } from "bun:test";

import { ghidraStartupMs, openProblem, ReaError, reaCallOptions, reaEnv } from "../src/engine/rea";
import { currentSettings } from "../src/settings/store";

const inherited = { timeout: process.env.REA_GHIDRA_STARTUP_TIMEOUT_MS };

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  restore("REA_GHIDRA_STARTUP_TIMEOUT_MS", inherited.timeout);
});

test("the analysis time limit sets ghidra's deadline and every caller waits a little longer", () => {
  delete process.env.REA_GHIDRA_STARTUP_TIMEOUT_MS;
  const s = currentSettings();
  expect(ghidraStartupMs({ ...s, ghidraTimeout: "30 minutes" })).toBe(30 * 60_000);
  const sixHours = { ...s, ghidraTimeout: "6 hours" } as const;
  expect(reaEnv(sixHours).REA_GHIDRA_STARTUP_TIMEOUT_MS).toBe(String(6 * 3_600_000));
  expect(reaCallOptions(sixHours)).toEqual({ timeout: 6 * 3_600_000 + 5 * 60_000, resetTimeoutOnProgress: true });
});

test("a valid REA_GHIDRA_STARTUP_TIMEOUT_MS wins and a broken one is ignored", () => {
  const twoHours = { ...currentSettings(), ghidraTimeout: "2 hours" } as const;
  process.env.REA_GHIDRA_STARTUP_TIMEOUT_MS = "900000";
  expect(reaEnv(twoHours).REA_GHIDRA_STARTUP_TIMEOUT_MS).toBe("900000");
  expect(reaCallOptions(twoHours).timeout).toBe(900_000 + 5 * 60_000);
  for (const bad of ["soon", "-5", "0", "1.5", "99999999999"]) {
    process.env.REA_GHIDRA_STARTUP_TIMEOUT_MS = bad;
    expect(ghidraStartupMs(twoHours)).toBe(2 * 3_600_000);
  }
});

test("ghidra can be given 2 GB", () => {
  expect(reaEnv({ ...currentSettings(), ghidraMemory: "2 GB" }).GHIDRA_MAXMEM).toBe("2G");
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
