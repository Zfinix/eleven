import { type ReactElement, useEffect, useState } from "react";

import { fieldLook, StepProgress } from "../components/kit";
import { seconds, useNow } from "../lib/useNow";
import { onReaStep } from "../engine/rea";

import { TYPING, useCommand } from "../lib/shortcuts";
import { useTheme } from "../theme";
import { runCommand } from "./actions";
import { HOVER, MONO_STYLE, TextButton, useBench } from "./parts";
import { t } from "../i18n";

const TOAST_MS = 5000;

/** The inline comment strip under the editor, for one instruction or address. */
export function CommentBar({ addr }: { readonly addr: string }): ReactElement {
  const { p } = useTheme();
  const { wb } = useBench();
  const [focused, setFocused] = useState(true);
  const close = (): void => wb.patch({ commenting: null, commentDraft: "" });
  const save = (): void => {
    const before = wb.s.comments.get(addr) ?? "";
    const text = wb.s.commentDraft.trim();
    close();
    if (text === before) return;
    wb.setComment(addr, text);
    wb.notify(text ? t("workbench.annotate.commented", { address: addr }) : t("workbench.annotate.uncommented", { address: addr }), () => wb.setComment(addr, before));
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 8, paddingBottom: 8, paddingLeft: 12, paddingRight: 12, borderTopWidth: 1, borderColor: p.fill, backgroundColor: p.raised }}>
      <div style={{ color: p.muted, whiteSpace: "nowrap" }}>{t("workbench.annotate.commentAt", { address: addr })}</div>
      <input autoFocus value={wb.s.commentDraft} placeholder={t("workbench.annotate.commentPlaceholder")} aria-label={t("workbench.annotate.comment")} {...TYPING} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onChange={(e) => wb.patch({ commentDraft: e.value ?? "" })} onSubmit={save} style={{ flexGrow: 1, height: 28, paddingLeft: 10, paddingRight: 10, borderRadius: 7, backgroundColor: p.deep, fontSize: 12.5, color: p.text, ...MONO_STYLE, ...fieldLook(p, focused, false) }} />
      <TextButton label={t("workbench.save")} tone="primary" onClick={save} />
      <TextButton label={t("workbench.cancel")} tone="ghost" onClick={close} />
    </div>
  );
}

/** Names a group of graph blocks; the name shows on the folded node and in the PDF. */
export function LabelBar({ fn, start }: { readonly fn: string; readonly start: string }): ReactElement {
  const { p } = useTheme();
  const { wb } = useBench();
  const [focused, setFocused] = useState(true);
  const close = (): void => wb.patch({ labelling: null, labelDraft: "" });
  const save = (): void => {
    const label = wb.s.labelDraft.trim();
    close();
    if (!label) return;
    wb.patch({ groups: wb.s.groups.map((g) => (g.fn === fn && g.blocks.includes(start) ? { ...g, label } : g)) });
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 8, paddingBottom: 8, paddingLeft: 12, paddingRight: 12, borderTopWidth: 1, borderColor: p.fill, backgroundColor: p.raised }}>
      <div style={{ color: p.muted, whiteSpace: "nowrap" }}>{t("workbench.annotate.nameGroup")}</div>
      <input autoFocus value={wb.s.labelDraft} placeholder={t("workbench.annotate.groupPlaceholder")} aria-label={t("workbench.annotate.groupName")} {...TYPING} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onChange={(e) => wb.patch({ labelDraft: e.value ?? "" })} onSubmit={save} style={{ flexGrow: 1, height: 28, paddingLeft: 10, paddingRight: 10, borderRadius: 7, backgroundColor: p.deep, fontSize: 12.5, color: p.text, ...fieldLook(p, focused, false) }} />
      <TextButton label={t("workbench.save")} tone="primary" onClick={save} />
      <TextButton label={t("workbench.cancel")} tone="ghost" onClick={close} />
    </div>
  );
}

/** A short confirmation at the bottom of the editor, with Undo when the change can be taken back. */
export function UndoToast(): ReactElement | null {
  const { p } = useTheme();
  const { wb } = useBench();
  const toast = wb.s.toast;
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => wb.patch({ toast: null }), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast?.seq]);
  const editing = wb.s.renaming !== null || wb.s.patching !== null || wb.s.commenting !== null || wb.s.labelling !== null;
  if (!toast || editing) return null;
  const undo = toast.undo;
  const shadow = { offsetX: 0, offsetY: 12, blurRadius: 30, spreadRadius: 0, color: "rgba(0,0,0,0.4)" };
  return (
    <div role="status" style={{ position: "absolute", left: 0, right: 0, bottom: 40, display: "flex", justifyContent: "center" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, maxWidth: 520, paddingTop: 10, paddingBottom: 10, paddingLeft: 12, paddingRight: 12, borderWidth: 1, borderColor: p.sel2, borderRadius: 10, backgroundColor: p.raised2, boxShadow: shadow }}>
        <div style={{ width: 7, height: 7, borderRadius: 4, flexShrink: 0, backgroundColor: p.string }} />
        <div style={{ flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{toast.text}</div>
        {undo && (
          <div onClick={() => { undo(); wb.patch({ toast: null }); }} role="button" style={{ color: p.link, cursor: "pointer", hover: HOVER }}>
            <div>{t("workbench.undo")}</div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Rename, comment, references and bookmark act on what you last clicked, else the open function; find opens over the view. */
export function useSubjectCommands(): void {
  const bench = useBench();
  useCommand("rename", () => runCommand(bench, "rename"));
  useCommand("comment", () => runCommand(bench, "comment"));
  useCommand("xrefs", () => runCommand(bench, "xrefs"));
  useCommand("bookmark", () => runCommand(bench, "bookmark"));
  useCommand("markCode", () => runCommand(bench, "markCode"));
  useCommand("markProcedure", () => runCommand(bench, "markProcedure"));
  useCommand("markData", () => runCommand(bench, "markData"));
  useCommand("markString", () => runCommand(bench, "markString"));
  useCommand("markUndefined", () => runCommand(bench, "markUndefined"));
  useCommand("showHex", () => runCommand(bench, "showHex"));
  useCommand("showDecimal", () => runCommand(bench, "showDecimal"));
  useCommand("showCharacter", () => runCommand(bench, "showCharacter"));
  useCommand("showOffset", () => runCommand(bench, "showOffset"));
  useCommand("showAddress", () => runCommand(bench, "showAddress"));
  useCommand("patch", () => bench.wb.patch({ patching: bench.focusAddr, patchDraft: "" }));
  useCommand("debug", () => bench.wb.reveal("debug"));
  useCommand("find", () => bench.wb.reveal("find"));
  useCommand("findNext", () => bench.wb.patch({ finding: true, findAt: bench.wb.s.findAt + 1 }));
  useCommand("findPrevious", () => bench.wb.patch({ finding: true, findAt: bench.wb.s.findAt - 1 }));
}

/** The first open of a file, step by step, over the code until Ghidra has listed the functions. */
export function OpeningProgress({ since }: { readonly since: number }): ReactElement {
  const { program } = useBench();
  const now = useNow(true);
  const [step, setStep] = useState<string | null>(null);
  useEffect(() => onReaStep(setStep), []);
  return (
    <div style={{ position: "absolute", left: 16, right: 16, bottom: 16, display: "flex", justifyContent: "flex-end" }}>
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, maxWidth: 520 }}>
        <StepProgress
          title={t("workbench.annotate.analyzing", { name: program.name })}
          steps={[
            { label: t("workbench.annotate.readFile"), state: "done" },
            { label: `${step ?? t("workbench.annotate.findingFunctions")} · ${seconds(now - since)}`, state: "now" },
            { label: t("workbench.annotate.ready"), state: "next" },
          ]}
          note={t("workbench.annotate.cacheNote")}
        />
      </div>
    </div>
  );
}
