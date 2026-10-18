import { afterAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import { CACHE, forgetProcedures, loadProcedures } from "../src/engine/procedures";
import { rea } from "../src/engine/rea";

const key = `test-${randomUUID()}`;

afterAll(async () => {
  await rm(join(CACHE, key), { recursive: true, force: true });
});

test("loads at the same time share one REA listing, and later loads read the cache", async () => {
  let calls = 0;
  const original = rea.listProcedures.bind(rea);
  rea.listProcedures = async (): Promise<readonly unknown[]> => {
    calls += 1;
    await Bun.sleep(20);
    return [{ address: "0x1000", value: "main", procedure: {} }];
  };
  try {
    const [first, second] = await Promise.all([loadProcedures("/bin/echo", key), loadProcedures("/bin/echo", key)]);
    expect(calls).toBe(1);
    expect(second).toBe(first);
    expect(first).toEqual([{ address: "0x1000", name: "main", kind: "Function" }]);
    expect(await loadProcedures("/bin/echo", key)).toEqual(first);
    expect(calls).toBe(1);
    await forgetProcedures(key);
    await loadProcedures("/bin/echo", key);
    expect(calls).toBe(2);
  } finally {
    rea.listProcedures = original;
  }
});

test("a failed load is not shared with the next one", async () => {
  const original = rea.listProcedures.bind(rea);
  rea.listProcedures = async (): Promise<readonly unknown[]> => {
    throw new Error("REA stopped");
  };
  try {
    await forgetProcedures(key);
    await expect(loadProcedures("/bin/echo", key)).rejects.toThrow("REA stopped");
    rea.listProcedures = async (): Promise<readonly unknown[]> => [];
    expect(await loadProcedures("/bin/echo", key)).toEqual([]);
  } finally {
    rea.listProcedures = original;
  }
});
