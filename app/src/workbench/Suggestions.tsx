import { type ReactElement, useEffect, useState } from "react";

import type { Edit, EditField } from "../engine/edits";
import { accept, decline, undo } from "../engine/history";
import { errorMessage } from "../lib/guards";
import { useTheme } from "../theme";
import { Icon } from "../components/ui";
import { goTo } from "./actions";
import { ELLIPSIS, HOVER, IconButton, MONO_STYLE, TextButton, useBench } from "./parts";
import { useProject } from "./useProject";
import { type PlainId, t } from "../i18n";

const KIND: Readonly<Record<EditField, { readonly label: PlainId; readonly done: PlainId; readonly icon: string }>> = {
  names: { label: "workbench.suggestion.rename", done: "workbench.suggestion.renamed", icon: "rename" },
  notes: { label: "workbench.suggestion.note", done: "workbench.suggestion.noted", icon: "note" },
  comments: { label: "workbench.suggestion.comment", done: "workbench.suggestion.commented", icon: "note" },
  colors: { label: "workbench.suggestion.colour", done: "workbench.suggestion.coloured", icon: "circle" },
  bookmarks: { label: "workbench.suggestion.bookmark", done: "workbench.suggestion.bookmarked", icon: "bookmark" },
  patches: { label: "workbench.suggestion.patch", done: "workbench.suggestion.patched", icon: "hex" },
  groups: { label: "workbench.suggestion.group", done: "workbench.suggestion.grouped", icon: "graph" },
  types: { label: "workbench.suggestion.type", done: "workbench.suggestion.typed", icon: "tag" },
  formats: { label: "workbench.suggestion.format", done: "workbench.suggestion.formatted", icon: "hex" },
  breakpoints: { label: "workbench.suggestion.breakpoint", done: "workbench.suggestion.breakpointAdded", icon: "play" },
};

/** Suggestions decided before this window opened stay out of the chat. */
const OPENED = Date.now();
export const SETTLED_FOR_MS = 6_000;

const dismissed = new Set<string>();

function belongsTo(edit: Edit, chatId: string | null): boolean {
  if (edit.by.kind !== "agent") return false;
  if (edit.status !== "proposed" && edit.changedAt < OPENED) return false;
  return edit.by.chat === null || chatId === null || edit.by.chat === chatId;
}

/** A decided card hides itself after a few seconds, waiting while the pointer is on it. */
function Card({ edit, onDismiss }: { readonly edit: Edit; readonly onDismiss: () => void }): ReactElement {
  const { p } = useTheme();
  const bench = useBench();
  const { program, nameOf, wb } = bench;
  const [problem, setProblem] = useState<string | null>(null);
  const [hovered, setHovered] = useState(false);
  const settled = edit.status !== "proposed";
  useEffect(() => {
    if (!settled || hovered || problem) return;
    const timer = setTimeout(onDismiss, SETTLED_FOR_MS);
    return () => clearTimeout(timer);
  }, [settled, hovered, problem, edit.status]);
  const kind = KIND[edit.field];
  const run = (work: () => void): void => {
    try {
      work();
      setProblem(null);
    } catch (err) {
      setProblem(errorMessage(err));
    }
  };
  const before = edit.field === "names" ? (edit.before ?? nameOf(edit.key)) : (edit.before ?? t("workbench.suggestion.nothing"));
  return (
    <div onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 10, paddingBottom: 10, paddingLeft: 12, paddingRight: 12, borderWidth: 1, borderColor: p.line2, borderRadius: 12, backgroundColor: p.raised }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: p.muted }}>
        <Icon name={kind.icon} size={13} color={p.muted} />
        <div>{t(kind.label)}</div>
        <div style={{ flexGrow: 1 }} />
        <div onClick={() => goTo(bench, edit.key)} role="button" style={{ fontSize: 11.5, color: p.call, cursor: "pointer", hover: HOVER, ...MONO_STYLE }}>{edit.key}</div>
        {settled && <IconButton icon="close" label={t("workbench.suggestion.dismiss")} tip={false} size={20} iconSize={9} onClick={onDismiss} />}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, fontSize: 12, userSelect: "text", ...MONO_STYLE }}>
        <div style={{ color: p.muted, textDecoration: "line-through", ...ELLIPSIS }}>{before}</div>
        <div style={{ color: p.faint }}>→</div>
        <div style={{ color: p.text, ...ELLIPSIS }}>{edit.after ?? t("workbench.suggestion.removed")}</div>
      </div>
      {edit.reason && <div style={{ fontSize: 12.5, color: p.text3, userSelect: "text" }}>{edit.reason}</div>}
      {edit.status === "proposed" && (
        <div style={{ display: "flex", gap: 8 }}>
          <TextButton label={t("workbench.suggestion.accept")} tone="primary" onClick={() => run(() => accept(program.id, [edit.id]))} />
          <TextButton label={t("workbench.suggestion.decline")} tone="outline" onClick={() => run(() => decline(program.id, [edit.id]))} />
        </div>
      )}
      {edit.status === "applied" && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: p.string }}>
          <div>{t(kind.done)}</div>
          <div onClick={() => run(() => { undo(program.id, edit.id); wb.notify(t("workbench.suggestion.undid", { what: t(kind.label).toLowerCase() }), null); })} role="button" style={{ color: p.link, cursor: "pointer", hover: HOVER }}>{t("workbench.undo")}</div>
        </div>
      )}
      {edit.status === "rejected" && <div style={{ fontSize: 12, color: p.muted }}>{t("workbench.suggestion.declined")}</div>}
      {edit.status === "undone" && <div style={{ fontSize: 12, color: p.muted }}>{t("workbench.suggestion.undone")}</div>}
      {problem && <div role="alert" style={{ fontSize: 12, color: p.error }}>{t("workbench.couldNotDo", { message: problem })}</div>}
    </div>
  );
}

/** The agent's suggestions for this chat, each with Accept and Decline, then Undo once accepted. Decided ones can be dismissed. */
export function Suggestions({ chatId }: { readonly chatId: string | null }): ReactElement | null {
  const { program } = useBench();
  const [, setHidden] = useState(0);
  const edits = useProject(program.id).edits.filter((edit) => belongsTo(edit, chatId) && !(edit.status !== "proposed" && dismissed.has(edit.id)));
  if (edits.length === 0) return null;
  const dismiss = (id: string): void => {
    dismissed.add(id);
    setHidden((n) => n + 1);
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {edits.map((edit) => <Card key={edit.id} edit={edit} onDismiss={() => dismiss(edit.id)} />)}
    </div>
  );
}
