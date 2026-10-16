import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test } from "bun:test";

import { CACHE, loadProcedures, type Procedure } from "../src/engine/procedures";

test("concurrent consumers share a procedure inventory without retaining a stale cache", async () => {
  const id = `procedure-loading-test-${randomUUID()}`;
  const directory = join(CACHE, id, "ghidra");
  const file = join(directory, "procedures.json");
  const original: readonly Procedure[] = [{ address: "0x1000", name: "entry", kind: "Function" }];
  const updated: readonly Procedure[] = [{ address: "0x1000", name: "renamed_entry", kind: "Function" }];

  try {
    await mkdir(directory, { recursive: true });
    await writeFile(file, JSON.stringify(original));
    const [workbench, chat] = await Promise.all([
      loadProcedures("unused-cached-binary", id),
      loadProcedures("unused-cached-binary", id),
    ]);

    expect(workbench).toEqual(original);
    expect(chat).toBe(workbench);

    await writeFile(file, JSON.stringify(updated));
    expect(await loadProcedures("unused-cached-binary", id)).toEqual(updated);

    await writeFile(file, "invalid json");
    await expect(loadProcedures("unused-cached-binary", id)).rejects.toThrow();
    await writeFile(file, JSON.stringify(original));
    expect(await loadProcedures("unused-cached-binary", id)).toEqual(original);
  } finally {
    await rm(join(CACHE, id), { recursive: true, force: true });
  }
});
