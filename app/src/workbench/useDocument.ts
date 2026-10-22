import { basename } from "node:path";

import { useGpuix } from "@gpuix/react";
import { useEffect, useRef } from "react";

import { onThreadsChange } from "../chat/history";
import { askSavePath, documentPath, saveDocument } from "../engine/document";
import type { Target } from "../engine/target";
import { errorMessage } from "../lib/guards";
import { useCommand } from "../lib/shortcuts";
import type { Bench } from "./parts";
import { pickToOpen } from "../lib/pick";
import { t } from "../i18n";

const AUTOSAVE_MS = 2000;

/** Opens a file or `.eleven` project in this window: the chat and the workbench move to it together. */
export function useOpenInWorkbench(bench: Bench): (path: string) => void {
  const { chat, openTarget, wb } = bench;
  const { renderer } = useGpuix();
  const open = (path: string): void => {
    try {
      const show = (target: Target): void => {
        if (target.kind === "binary" || target.kind === "app") openTarget(target);
      };
      const target = chat.choose(path, show);
      if (target) show(target);
    } catch (err) {
      wb.notify(t("workbench.document.openFailed", { message: errorMessage(err) }), null);
    }
  };
  useCommand("open", () => {
    void (async (): Promise<void> => {
      try {
        const first = await pickToOpen(renderer, t("workbench.document.open"));
        if (first) open(first);
      } catch (err) {
        wb.notify(t("workbench.document.pickerFailed", { message: errorMessage(err) }), null);
      }
    })();
  });
  return open;
}

/** Nothing is written to a `.eleven` file until you press ⌘S; after that first save it keeps that file up to date. */
export function useDocument(bench: Bench): void {
  const { chat, program, wb } = bench;
  const { s } = wb;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ready = program.functions.length > 0 && chat.target !== null;
  const save = async (asking: boolean): Promise<void> => {
    const target = chat.target;
    if (!target || !ready) return;
    const path = documentPath(program.id) ?? (asking ? await askSavePath(program.name) : null);
    if (!path) return;
    try {
      await saveDocument(target, program.id, path);
      if (asking) wb.notify(t("workbench.document.saved", { name: basename(path) }), null);
    } catch (err) {
      wb.notify(t("workbench.document.saveFailed", { message: errorMessage(err) }), null);
    }
  };
  const later = (): void => {
    if (!ready || !documentPath(program.id)) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void save(false);
    }, AUTOSAVE_MS);
  };
  useCommand("save", () => void save(true));
  useEffect(later, [s.names, s.bookmarks, s.notes, s.comments, s.colors, s.groups]);
  useEffect(() => onThreadsChange(later), [program.id, ready]);
  const flush = useRef(save);
  flush.current = save;
  useEffect(() => () => {
    if (!timer.current) return;
    clearTimeout(timer.current);
    void flush.current(false);
  }, []);
}
