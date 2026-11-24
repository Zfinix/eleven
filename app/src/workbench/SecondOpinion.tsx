import type { ReactElement } from "react";

import { CodeView } from "../components/code";
import { pipeTool, rizinPseudocode } from "../engine/rizin";
import { t } from "../i18n";
import { useLoaded } from "../lib/useLoaded";
import { scrollbar, useTheme } from "../theme";
import { ask } from "./actions";
import { TextButton, useBench } from "./parts";

const ASK_CHARS = 5000;

function Column({ title, code, failed }: { readonly title: string; readonly code: string | null; readonly failed: string | null }): ReactElement {
  const { p } = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, flexBasis: 0, minWidth: 0, minHeight: 0 }}>
      <div style={{ flexShrink: 0, height: 30, display: "flex", alignItems: "center", paddingLeft: 12, color: p.muted, fontSize: 12 }}>{title}</div>
      <div style={{ display: "flex", alignItems: "flex-start", flexGrow: 1, minHeight: 0, overflow: "scroll", ...scrollbar(p) }}>
        {code !== null ? <CodeView code={code} /> : <div style={{ padding: 12, color: failed ? p.error : p.muted }}>{failed ?? t("workbench.second.reading")}</div>}
      </div>
    </div>
  );
}

/** One function as two decompilers read it, side by side, so their disagreements show and the agent can weigh them. */
export function SecondOpinion({ addr }: { readonly addr: string }): ReactElement {
  const { p } = useTheme();
  const bench = useBench();
  const { program, nameOf } = bench;
  const other = pipeTool() === "radare2" ? "radare2" : "Rizin";
  const mine = useLoaded(() => program.code(addr, "pseudo"), `${program.id}:${addr}:second:mine`);
  const theirs = useLoaded(() => rizinPseudocode(program.path, addr), `${program.id}:${addr}:second:theirs`);
  const both = mine.kind === "ready" && theirs.kind === "ready" ? { mine: mine.value, theirs: theirs.value } : null;
  const askBoth = (): void => {
    if (!both) return;
    ask(bench, t("workbench.second.askPrompt", { name: nameOf(addr), address: addr, first: program.engine, second: other, one: both.mine.slice(0, ASK_CHARS), two: both.theirs.slice(0, ASK_CHARS) }));
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, height: 40, flexShrink: 0, paddingLeft: 12, paddingRight: 12 }}>
        <div style={{ flexGrow: 1, minWidth: 0, color: p.text }}>{t("workbench.second.title", { name: nameOf(addr) })}</div>
        {both && <TextButton label={t("workbench.second.ask")} tone="outline" onClick={askBoth} />}
      </div>
      <div style={{ display: "flex", flexGrow: 1, minHeight: 0, gap: 1, backgroundColor: p.fill }}>
        <div style={{ display: "flex", flexGrow: 1, flexBasis: 0, minWidth: 0, backgroundColor: p.card }}>
          <Column title={program.engine} code={mine.kind === "ready" ? mine.value : null} failed={mine.kind === "failed" ? mine.message : null} />
        </div>
        <div style={{ display: "flex", flexGrow: 1, flexBasis: 0, minWidth: 0, backgroundColor: p.card }}>
          <Column title={other} code={theirs.kind === "ready" ? theirs.value : null} failed={theirs.kind === "failed" ? theirs.message : null} />
        </div>
      </div>
    </div>
  );
}
