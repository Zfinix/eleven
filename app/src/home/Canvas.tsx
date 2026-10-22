import type { ReactElement } from "react";

import { CodeView } from "../components/code";
import { type MenuEntry, menuOn } from "../components/ContextMenu";
import type { Target } from "../engine/target";
import { t } from "../i18n";
import { MONO, scrollbar, useTheme } from "../theme";
import { Icon, Row, Spacer } from "../components/ui";
import type { CanvasTab } from "../chat/thread";
import { copyText } from "../chat/useThread";

function TabButton({ tab, active, onSelect, menu }: { readonly tab: CanvasTab; readonly active: boolean; readonly onSelect: () => void; readonly menu: () => readonly MenuEntry[] }): ReactElement {
  const { p } = useTheme();
  return (
    <div {...menuOn(menu, onSelect)} role="tab" aria-label={tab.procedure} style={{ display: "flex", alignItems: "center", gap: 7, flexShrink: 0, paddingLeft: 14, paddingRight: 14, borderRightWidth: 1, borderColor: p.fill, backgroundColor: active ? p.deep2 : p.deep, color: active ? p.text : p.muted, cursor: "pointer" }}>
      <Icon name={tab.kind === "result" ? "text" : "pseudocode"} size={14} color={active ? p.text : p.muted} />
      <div style={{ maxWidth: 260, fontSize: 12.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", ...(tab.kind === "result" ? {} : { fontFamily: MONO }) }}>{tab.procedure}</div>
    </div>
  );
}

function CodeBody({ tab, onLink }: { readonly tab: CanvasTab; readonly onLink: (name: string) => void }): ReactElement {
  const { code, procedure } = tab;
  const { p } = useTheme();
  switch (code.kind) {
    case "loading":
      return <div style={{ padding: 16, fontSize: 12.5, color: p.muted }}>{t("canvas.decompiling", { name: procedure })}</div>;
    case "failed":
      return <div style={{ padding: 16, fontSize: 12.5, color: p.error }}>{t("canvas.failed", { name: procedure, message: code.message })}</div>;
    case "ready":
      return tab.kind === "result" ? <CodeView code={code.text} syntax="code" /> : <CodeView code={code.text} onLink={onLink} />;
    default: {
      const unhandled: never = code;
      return unhandled;
    }
  }
}

function CanvasBar({ onWorkbench, onClose }: { readonly onWorkbench: (() => void) | null; readonly onClose: () => void }): ReactElement {
  const { p } = useTheme();
  return (
    <Row gap={4} style={{ paddingLeft: 8, paddingRight: 8 }}>
      {onWorkbench && (
        <div onClick={onWorkbench} style={{ display: "flex", alignItems: "center", gap: 6, height: 28, paddingLeft: 10, paddingRight: 10, borderWidth: 1, borderColor: p.sel, borderRadius: 8, color: p.text3, fontSize: 12.5, cursor: "pointer", hover: { opacity: 0.72 } }}>
          <Icon name="expand" size={13} color={p.text3} />
          <div>{t("canvas.workbench")}</div>
        </div>
      )}
      <div onClick={onClose} aria-label={t("canvas.close")} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: 7, cursor: "pointer", hover: { opacity: 0.72 } }}>
        <Icon name="close" size={13} />
      </div>
    </Row>
  );
}

/** The code panel that slides in when the agent reads a function. */
export function Canvas({ tabs, active, target, onSelect, onLink, onWorkbench, onClose }: {
  readonly tabs: readonly CanvasTab[];
  readonly active: number;
  readonly target: Target | null;
  readonly onSelect: (index: number) => void;
  readonly onLink: (name: string) => void;
  readonly onWorkbench: (() => void) | null;
  readonly onClose: () => void;
}): ReactElement | null {
  const { p } = useTheme();
  const tab = tabs[active];
  if (!tab) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, flexBasis: 520, minWidth: 0, borderLeftWidth: 1, borderColor: p.fill, backgroundColor: p.deep2 }}>
      <div style={{ display: "flex", height: 44, flexShrink: 0, borderBottomWidth: 1, borderColor: p.fill }}>
        <div style={{ display: "flex", flexGrow: 1, overflowX: "scroll" }}>
          {tabs.map((item, ix) => {
            const tabMenu = (): readonly MenuEntry[] => [
              ...(onWorkbench ? [{ kind: "action", label: t("canvas.openInWorkbench"), icon: "expand", run: () => { onSelect(ix); onWorkbench(); } } as const] : []),
              { kind: "action", label: item.kind === "result" ? t("canvas.copyTitle") : t("canvas.copyName"), icon: "copy", run: () => copyText(item.procedure) },
              { kind: "separator" },
              { kind: "action", label: t("canvas.closePanel"), icon: "close", run: onClose },
            ];
            return <TabButton key={item.procedure} tab={item} active={ix === active} onSelect={() => onSelect(ix)} menu={tabMenu} />;
          })}
        </div>
        <CanvasBar onWorkbench={onWorkbench} onClose={onClose} />
      </div>
      <Row gap={8} style={{ height: 32, flexShrink: 0, paddingLeft: 14, paddingRight: 14, borderBottomWidth: 1, borderColor: p.raised2, fontSize: 12, color: p.muted }}>
        {[target?.name, target?.arch].filter((crumb): crumb is string => Boolean(crumb)).map((crumb) => (
          <Row key={crumb} gap={8} style={{ flexShrink: 0 }}>
            <div style={{ whiteSpace: "nowrap" }}>{crumb}</div>
            <div>/</div>
          </Row>
        ))}
        <div style={{ flexShrink: 1, minWidth: 0, color: p.text3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", ...(tab.kind === "result" ? {} : { fontFamily: MONO }) }}>{tab.procedure}</div>
        <Spacer />
        <div style={{ flexShrink: 0, whiteSpace: "nowrap" }}>{tab.kind === "result" ? t("canvas.toolResult") : t("canvas.fromGhidra")}</div>
      </Row>
      <div style={{ display: "flex", alignItems: "flex-start", flexGrow: 1, minWidth: 0, minHeight: 0, overflow: "scroll", ...scrollbar(p) }}>
        <CodeBody tab={tab} onLink={onLink} />
      </div>
    </div>
  );
}
