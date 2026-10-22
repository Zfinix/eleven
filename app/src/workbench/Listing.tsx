import { type ReactElement, useMemo } from "react";

import { ErrorCard } from "../components/kit";
import { useListWindow } from "../lib/useListWindow";
import { useLoaded } from "../lib/useLoaded";
import { showAddress, useCodeLook } from "../settings/look";
import { useSettings } from "../settings/store";
import { scrollbar, useTheme } from "../theme";
import { t } from "../i18n";
import { subjectMenu } from "./actions";
import { StaticLines } from "./CodeLines";
import type { Fn } from "./model";
import { useBench } from "./parts";

const GUESS_LINES = 24;
const NEARBY = 3;

function Chunk({ fn }: { readonly fn: Fn }): ReactElement {
  const { p } = useTheme();
  const bench = useBench();
  const { program, nameOf, openFn } = bench;
  const addr = showAddress(fn.addr, useSettings().settings);
  const code = useLoaded(() => program.code(fn.addr, "asm"), `${program.id}:${fn.addr}:asm:${bench.wb.s.revision}`);
  const look = useCodeLook();
  return (
    <div style={{ display: "flex", flexDirection: "column", userSelect: "text", paddingBottom: 14, fontFamily: look.family, fontSize: look.size, lineHeight: look.lineHeight }}>
      <div {...subjectMenu(bench, { kind: "function", addr: fn.addr }, () => openFn(fn.addr, false))} role="heading" aria-label={nameOf(fn.addr)} style={{ display: "flex", gap: 12, paddingTop: 6, paddingBottom: 6, paddingLeft: 16, color: p.call, cursor: "pointer" }}>
        <div>{`${nameOf(fn.addr)}:`}</div>
        <div style={{ color: p.faint }}>{fn.kind === "thunk" ? t("workbench.view.listing.stub", { addr }) : addr}</div>
      </div>
      {code.kind === "loading" && <div style={{ paddingLeft: 66, color: p.faint }}>…</div>}
      {code.kind === "failed" && <div style={{ paddingLeft: 16, paddingRight: 16 }}><ErrorCard title={t("workbench.view.listing.readFailed", { name: nameOf(fn.addr) })} detail={t("workbench.view.listing.readFailed.detail")} raw={code.message} /></div>}
      {code.kind === "ready" && <StaticLines fn={fn.addr} lines={code.value.split("\n")} />}
    </div>
  );
}

/** Every function's assembly in address order, as one listing; each function loads as it scrolls into view. */
export function Listing(): ReactElement {
  const { p } = useTheme();
  const { program } = useBench();
  const look = useCodeLook();
  const { lineHeight } = look;
  const fns = useMemo(() => [...program.functions].sort((a, b) => (BigInt(a.addr) < BigInt(b.addr) ? -1 : 1)), [program]);
  const shown = useListWindow(fns.length, NEARBY);
  if (fns.length === 0) return <div style={{ padding: 16, color: p.muted }}>{t("workbench.view.listing.finding")}</div>;
  return (
    <virtual-list itemCount={fns.length} windowStart={shown.start} estimatedItemHeight={lineHeight * GUESS_LINES} onVisibleRange={shown.onVisibleRange} style={{ ...scrollbar(p), flexGrow: 1, minHeight: 0, paddingTop: 10, paddingBottom: 28, fontFamily: look.family, fontSize: look.size, lineHeight }}>
      {fns.slice(shown.start, shown.end).map((fn) => <Chunk key={fn.addr} fn={fn} />)}
    </virtual-list>
  );
}
