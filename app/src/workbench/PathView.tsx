import type { ReactElement } from "react";

import { type CallPath, searchCallPath } from "../engine/callPath";
import { t } from "../i18n";
import { useLoaded } from "../lib/useLoaded";
import { scrollbar, useTheme } from "../theme";
import { ask } from "./actions";
import type { Program } from "./model";
import { HOVER, MONO_STYLE, TextButton, useBench } from "./parts";

function findPath(program: Program, from: string, to: string): Promise<CallPath> {
  if (program.callPath) return program.callPath(from, to);
  return searchCallPath(from, to, async (addr) => (await program.refs(addr)).callees);
}

/** How one function reaches another through direct calls, each step a row that opens it. */
export function PathView({ from, to }: { readonly from: string; readonly to: string }): ReactElement {
  const { p } = useTheme();
  const bench = useBench();
  const { program, nameOf, openFn } = bench;
  const found = useLoaded(() => findPath(program, from, to), `${program.id}:${from}:${to}:path`);
  const askPath = (path: CallPath): void =>
    ask(bench, t("workbench.path.askPrompt", { steps: path.steps.map((addr) => `${nameOf(addr)} (${addr})`).join(" → ") }));
  const status = (text: string, color: string): ReactElement => <div style={{ color, maxWidth: 560 }}>{text}</div>;
  const body = ((): ReactElement => {
    if (found.kind === "loading") return status(t("workbench.path.searching"), p.muted);
    if (found.kind === "failed") return status(t("workbench.path.failed", { error: found.message }), p.error);
    const path = found.value;
    if (path.steps.length === 0) {
      return status(path.complete ? t("workbench.path.none", { from: nameOf(from), to: nameOf(to), count: path.searched }) : t("workbench.path.gaveUp", { count: path.searched }), p.muted);
    }
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {path.steps.map((addr, ix) => (
          <div key={addr} onClick={() => openFn(addr, false)} role="link" style={{ display: "flex", alignItems: "center", gap: 12, height: 30, paddingLeft: 8, paddingRight: 8, borderRadius: 6, cursor: "pointer", hover: HOVER }}>
            <div style={{ width: 22, flexShrink: 0, color: p.faint, ...MONO_STYLE }}>{String(ix + 1)}</div>
            <div style={{ flexShrink: 0, color: ix === 0 ? p.muted : p.call }}>{ix === 0 ? "" : "↳"}</div>
            <div style={{ flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: p.text, ...MONO_STYLE }}>{nameOf(addr)}</div>
            <div style={{ flexShrink: 0, color: p.faint, ...MONO_STYLE }}>{addr}</div>
          </div>
        ))}
        <div style={{ display: "flex", marginTop: 10 }}>
          <TextButton label={t("workbench.path.ask")} tone="outline" onClick={() => askPath(path)} />
        </div>
      </div>
    );
  })();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 16, flexGrow: 1, minHeight: 0, overflow: "scroll", ...scrollbar(p) }}>
      <div style={{ color: p.text }}>{t("workbench.path.title", { from: nameOf(from), to: nameOf(to) })}</div>
      {body}
      <div style={{ color: p.faint, fontSize: 11.5, maxWidth: 560 }}>{t("workbench.path.note")}</div>
    </div>
  );
}
