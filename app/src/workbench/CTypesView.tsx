import { type ReactElement, useState } from "react";

import { cTypeName } from "../engine/cTypes";
import { setValue, YOU } from "../engine/edits";
import { updateProject } from "../engine/project";
import { t } from "../i18n";
import { TYPING } from "../lib/shortcuts";
import { scrollbar, useTheme } from "../theme";
import { HOVER, MONO_STYLE, TextButton, useBench } from "./parts";
import { useProject } from "./useProject";

const STARTER = "struct name {\n  int field;\n};";

/** The C types written for this binary: a list on the left, and one declaration being written or changed on the right, with where to place it. */
export function CTypesView({ at }: { readonly at: string | null }): ReactElement {
  const { p } = useTheme();
  const { program, wb } = useBench();
  const project = useProject(program.id);
  const [draft, setDraft] = useState(STARTER);
  const [place, setPlace] = useState(at ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const supported = program.defineCType !== undefined;
  const placedAt = (name: string): readonly string[] => [...project.ctypeAt].filter(([, typeName]) => typeName === name).map(([addr]) => addr);
  const save = (): void => {
    const name = cTypeName(draft);
    const address = place.trim().toLowerCase();
    if (!name) return setProblem(t("workbench.ctype.noName"));
    if (address && !/^0x[0-9a-f]+$/.test(address)) return setProblem(t("workbench.ctype.badAddress"));
    setProblem(null);
    updateProject(program.id, (current) => {
      const typed = setValue(current, "ctypes", name, draft.trim());
      return address ? setValue(typed, "ctypeAt", address, name) : typed;
    }, YOU);
    wb.notify(address ? t("workbench.ctype.placed", { name, address }) : t("workbench.ctype.saved", { name }), null);
  };
  const remove = (name: string): void => {
    updateProject(program.id, (current) => placedAt(name).reduce((next, addr) => setValue(next, "ctypeAt", addr, null), setValue(current, "ctypes", name, null)), YOU);
  };
  const field = { paddingTop: 8, paddingBottom: 8, paddingLeft: 10, paddingRight: 10, borderWidth: 1, borderColor: p.line3, borderRadius: 8, backgroundColor: p.deep, fontSize: 12.5, color: p.text, ...MONO_STYLE } as const;
  return (
    <div style={{ display: "flex", flexGrow: 1, minHeight: 0 }}>
      <div style={{ width: 240, flexShrink: 0, display: "flex", flexDirection: "column", gap: 2, padding: 8, overflow: "scroll", ...scrollbar(p) }}>
        <div style={{ paddingLeft: 6, paddingBottom: 6, fontSize: 12, color: p.muted }}>{t("workbench.ctype.list", { count: project.ctypes.size })}</div>
        {[...project.ctypes].map(([name, declaration]) => (
          <div key={name} onClick={() => setDraft(declaration)} role="option" style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 28, paddingLeft: 6, paddingRight: 6, borderRadius: 6, cursor: "pointer", hover: HOVER }}>
            <div style={{ flexGrow: 1, minWidth: 0, color: p.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", ...MONO_STYLE }}>{name}</div>
            <div style={{ flexShrink: 0, fontSize: 11, color: p.faint }}>{placedAt(name).length > 0 ? t("workbench.ctype.placedCount", { count: placedAt(name).length }) : ""}</div>
            <div onClick={() => remove(name)} role="button" aria-label={t("workbench.ctype.remove", { name })} style={{ flexShrink: 0, fontSize: 11, color: p.link, cursor: "pointer", hover: HOVER }}>{t("workbench.ctype.removeShort")}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, flexGrow: 1, minWidth: 0, padding: 16, borderLeftWidth: 1, borderColor: p.fill, overflow: "scroll", ...scrollbar(p) }}>
        <div style={{ color: p.text }}>{t("workbench.ctype.title")}</div>
        <div style={{ fontSize: 12.5, color: p.muted, maxWidth: 560 }}>{supported ? t("workbench.ctype.intro") : t("workbench.ctype.notThisEngine", { engine: program.engine })}</div>
        <textarea {...TYPING} value={draft} minRows={6} maxRows={24} aria-label={t("workbench.ctype.declaration")} onChange={(e) => setDraft(e.value ?? "")} style={field} />
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ fontSize: 12.5, color: p.muted }}>{t("workbench.ctype.placeAt")}</div>
          <input {...TYPING} value={place} placeholder={t("workbench.ctype.placeHint")} aria-label={t("workbench.ctype.placeAt")} onChange={(e) => setPlace(e.value ?? "")} style={{ ...field, height: 30, paddingTop: 0, paddingBottom: 0, flexGrow: 1, minWidth: 0, maxWidth: 260 }} />
          <TextButton label={t("workbench.ctype.save")} tone="primary" onClick={save} />
        </div>
        {problem && <div role="alert" style={{ fontSize: 12.5, color: p.error }}>{problem}</div>}
      </div>
    </div>
  );
}
