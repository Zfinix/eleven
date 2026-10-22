import type { ReactElement } from "react";

import { showing } from "./state";
import { Tooltip } from "../components/kit";
import { t } from "../i18n";
import { useTheme } from "../theme";
import { pageLabel } from "../gpu/models/facts";
import { CommandKeys, Icon } from "../components/ui";
import { ELLIPSIS, hasCodeBench, HOVER, IconButton, isModelBench, MONO_STYLE, useBench } from "./parts";
import { currentAddr, placeIn, segmentOf } from "./where";
import { shortName } from "../gpu/look";

function Pill({ icon, label, on = false, color, onClick, children }: {
  readonly icon: string;
  readonly label: string;
  readonly on?: boolean;
  readonly color?: string;
  readonly onClick: () => void;
  readonly children?: ReactElement;
}): ReactElement {
  const { p } = useTheme();
  return (
    <div onClick={onClick} role="button" aria-label={label} aria-selected={on} style={{ display: "flex", alignItems: "center", gap: 7, height: 28, flexShrink: 0, paddingLeft: 10, paddingRight: 10, borderWidth: 1, borderColor: p.sel, borderRadius: 8, color: color ?? p.text3, cursor: "pointer", hover: HOVER, ...(on ? { backgroundColor: p.sel } : {}) }}>
      <Icon name={icon} size={14} color={color ?? p.text3} />
      <div style={{ whiteSpace: "nowrap" }}>{label}</div>
      {children}
    </div>
  );
}

/** The card's top bar: history, where you are, find, the debugger and the agent. */
export function Header(): ReactElement {
  const { p } = useTheme();
  const bench = useBench();
  const { wb, program, nameOf, focusAddr, agentName } = bench;
  const { s } = wb;
  const at = currentAddr(bench);
  const segment = segmentOf(program.segments, at);
  const debugging = showing(s, "debug");
  const model = isModelBench(bench);
  const pane = s.panes[s.focus];
  const tab = pane?.tabs[pane.active];
  const crumbs = model && tab?.kind === "model"
    ? [pageLabel(tab.page), ...(tab.page === "tensors" && tab.tensor ? [tab.tensor] : [])]
    : tab?.kind === "shader" && !hasCodeBench(bench) ? [shortName(tab.name)] : null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, height: 44, flexShrink: 0, paddingLeft: 10, paddingRight: 8 }}>
      {!s.sidebarOpen && <IconButton icon="sidebar" label={t("workbench.chrome.showSidebar")} iconSize={16} onClick={() => wb.patch({ sidebarOpen: true })} />}
      <IconButton icon="back" label={t("command.back")} color={s.at > 0 ? p.text3 : p.faint} onClick={wb.back} />
      <IconButton icon="forward" label={t("command.forward")} color={s.at < s.trail.length - 1 ? p.text3 : p.faint} onClick={wb.forward} />
      <div role="navigation" aria-label={t("workbench.chrome.whereYouAre")} style={{ display: "flex", alignItems: "center", gap: 6, flexGrow: 1, flexShrink: 1, minWidth: 0, paddingLeft: 6, color: p.muted, whiteSpace: "nowrap", overflow: "hidden" }}>
        <div style={{ flexShrink: 0 }}>{program.name}</div>
        {crumbs ? crumbs.map((crumb, ix) => (
          <div key={crumb} style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <div style={{ color: p.faint }}>›</div>
            <div style={{ minWidth: 0, color: ix === crumbs.length - 1 ? p.text : p.muted, ...(ix > 0 ? { fontSize: 12, ...MONO_STYLE } : {}), ...ELLIPSIS }}>{crumb}</div>
          </div>
        )) : (
          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            {segment && <div style={{ color: p.faint }}>›</div>}
            {segment && <div style={{ flexShrink: 0 }}>{segment}</div>}
            <div style={{ color: p.faint }}>›</div>
            <div style={{ minWidth: 0, color: p.text, fontSize: 12, ...MONO_STYLE, ...ELLIPSIS }}>{placeIn(nameOf(focusAddr), focusAddr, at)}</div>
          </div>
        )}
      </div>
      <Tooltip label={t("workbench.chrome.find.hint")}>
        <div style={{ display: "flex" }}>
          <Pill icon="search" label={t("workbench.chrome.find")} onClick={() => wb.reveal("find")}>
            <CommandKeys id="find" />
          </Pill>
        </div>
      </Tooltip>
      {hasCodeBench(bench) && (
        <Tooltip label={t("workbench.chrome.debug.hint")}>
          <div style={{ display: "flex" }}>
            <Pill icon="play" label={debugging ? t("workbench.chrome.debugging") : t("workbench.chrome.debug")} on={debugging} {...(debugging ? { color: p.string } : {})} onClick={() => wb.toggleTool("debug")} />
          </div>
        </Tooltip>
      )}
      <Pill icon="spark" label={t("workbench.chrome.ask", { name: agentName })} on={showing(s, "agent")} onClick={() => { wb.patch({ pickerOpen: false }); wb.toggleTool("agent"); }} />
    </div>
  );
}
