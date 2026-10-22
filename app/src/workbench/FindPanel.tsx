import type { ReactElement } from "react";

import { useLoaded } from "../lib/useLoaded";
import { TYPING } from "../lib/shortcuts";
import { useTheme } from "../theme";
import { goTo } from "./actions";
import { FIND_MODES, lineMatcher } from "./Find";
import { ELLIPSIS, HOVER, MONO_STYLE, SegItem, useBench } from "./parts";
import { t } from "../i18n";

const MAX_ROWS = 200;
const ADDRESS = /\b(?:0x)?([0-9a-f]{6,16})\b/i;

type Hit = { readonly addr: string; readonly where: string; readonly text: string };

/** Find across the file: function names, strings, and the lines of the function in focus. */
export function FindPanel(): ReactElement {
  const { p } = useTheme();
  const bench = useBench();
  const { wb, program, nameOf, focusAddr } = bench;
  const { findQuery, findMode } = wb.s;
  const asm = useLoaded<string>(() => program.code(focusAddr, "asm"), `${program.id}:${focusAddr}:asm`);
  const matcher = lineMatcher(findQuery, findMode);
  const hits: readonly Hit[] = matcher.kind !== "ok" ? [] : [
    ...program.functions.filter((fn) => matcher.test(nameOf(fn.addr))).map((fn) => ({ addr: fn.addr, where: t("workbench.find.function"), text: nameOf(fn.addr) })),
    ...program.strings.filter((row) => matcher.test(row.b)).map((row) => ({ addr: row.a, where: t("workbench.find.string"), text: row.b })),
    ...(asm.kind === "ready" ? asm.value.split("\n").filter((line) => matcher.test(line)).map((line) => ({ addr: `0x${ADDRESS.exec(line)?.[1] ?? focusAddr.replace(/^0x/, "")}`, where: nameOf(focusAddr), text: line.trim() })) : []),
  ];
  const count = matcher.kind === "bad" ? matcher.why : matcher.kind === "empty" ? "" : hits.length === 1 ? t("workbench.find.oneMatch") : t("workbench.find.matches", { count: hits.length.toLocaleString("en-US") });
  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, paddingTop: 4, paddingBottom: 8 }}>
        <input {...TYPING} autoFocus value={findQuery} aria-label={t("workbench.find.inFile")} placeholder={t("workbench.find.panelPlaceholder")} onChange={(e) => wb.patch({ findQuery: e.value ?? "" })} style={{ flexGrow: 1, minWidth: 200, height: 30, paddingLeft: 10, paddingRight: 10, borderWidth: 1, borderColor: p.line3, borderRadius: 8, backgroundColor: p.deep, fontSize: 12, color: p.text, ...MONO_STYLE }} />
        <div role="radiogroup" aria-label={t("workbench.find.mode")} style={{ display: "flex", gap: 2, padding: 2, borderRadius: 8, backgroundColor: p.fill }}>
          {FIND_MODES.map((m) => <SegItem key={m.mode} label={t(m.label)} on={m.mode === findMode} onBg={p.sel2} padding={9} onClick={() => wb.patch({ findMode: m.mode })} />)}
        </div>
        <div style={{ fontSize: 12, color: matcher.kind === "bad" ? p.error : p.muted }}>{count}</div>
      </div>
      {hits.slice(0, MAX_ROWS).map((hit, ix) => (
        <div key={`${hit.addr}:${ix}`} onClick={() => goTo(bench, hit.addr)} role="button" style={{ display: "flex", alignItems: "center", gap: 12, height: 28, flexShrink: 0, paddingLeft: 8, paddingRight: 8, borderRadius: 7, cursor: "pointer", hover: HOVER }}>
          <div style={{ width: 108, flexShrink: 0, fontSize: 12, color: p.faint, ...MONO_STYLE }}>{hit.addr}</div>
          <div style={{ width: 220, flexShrink: 0, fontSize: 12.5, color: p.call, ...ELLIPSIS }}>{hit.where}</div>
          <div style={{ flexGrow: 1, minWidth: 0, fontSize: 12, color: p.text3, userSelect: "text", ...MONO_STYLE, ...ELLIPSIS }}>{hit.text}</div>
        </div>
      ))}
    </div>
  );
}
