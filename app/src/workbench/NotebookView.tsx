import type { ReactElement } from "react";

import { setValue, YOU } from "../engine/edits";
import { updateProject } from "../engine/project";
import { t } from "../i18n";
import { TYPING } from "../lib/shortcuts";
import { scrollbar, useTheme } from "../theme";
import { goTo } from "./actions";
import { HOVER, MONO_STYLE, useBench } from "./parts";
import { useProject } from "./useProject";

export const NOTEBOOK = "notebook";

const ADDRESS = /\b0x[0-9a-f]{4,}\b/gi;
const MAX_LINKS = 40;

/** Every address written in the page, once each, in the order they appear. */
export function addressesIn(text: string): readonly string[] {
  return [...new Set((text.match(ADDRESS) ?? []).map((addr) => addr.toLowerCase()))].slice(0, MAX_LINKS);
}

/** One page of findings for the project, yours and the agents'; the addresses in it link to the code. */
export function NotebookView(): ReactElement {
  const { p } = useTheme();
  const bench = useBench();
  const { program, nameOf } = bench;
  const text = useProject(program.id).pages.get(NOTEBOOK) ?? "";
  const write = (next: string): void => {
    updateProject(program.id, (project) => setValue(project, "pages", NOTEBOOK, next.trim() ? next : null), YOU);
  };
  const links = addressesIn(text);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 16, flexGrow: 1, minHeight: 0, overflow: "scroll", ...scrollbar(p) }}>
      <div style={{ color: p.text }}>{t("workbench.notebook.title", { name: program.name })}</div>
      <div style={{ fontSize: 12.5, color: p.muted, maxWidth: 560 }}>{t("workbench.notebook.intro")}</div>
      <textarea {...TYPING} value={text} minRows={12} maxRows={40} placeholder={t("workbench.notebook.placeholder")} aria-label={t("workbench.notebook.title", { name: program.name })} onChange={(e) => write(e.value ?? "")} style={{ paddingTop: 10, paddingBottom: 10, paddingLeft: 12, paddingRight: 12, borderWidth: 1, borderColor: p.line3, borderRadius: 8, backgroundColor: p.deep, fontSize: 13, color: p.text, userSelect: "text" }} />
      {links.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 12, color: p.faint }}>{t("workbench.notebook.links")}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {links.map((addr) => (
              <div key={addr} onClick={() => goTo(bench, addr)} role="link" style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 3, paddingBottom: 3, borderRadius: 6, backgroundColor: p.fill, fontSize: 11.5, color: p.call, cursor: "pointer", hover: HOVER, ...MONO_STYLE }}>{nameOf(addr) === addr ? addr : `${nameOf(addr)} ${addr}`}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
