import type { ReactElement } from "react";

import { CodeView } from "../components/code";
import { type MenuEntry, menuOn } from "../components/ContextMenu";
import type { Target } from "../engine/target";
import { tr, trN, useLanguage } from "../i18n";
import { MONO, useTheme } from "../theme";
import { Icon, Row, Spacer } from "../components/ui";
import type { CanvasTab, CodeState } from "../chat/thread";
import { copyText } from "../chat/useThread";

function TabButton({ tab, active, onSelect, menu }: { readonly tab: CanvasTab; readonly active: boolean; readonly onSelect: () => void; readonly menu: () => readonly MenuEntry[] }): ReactElement {
  const { p } = useTheme();
  return (
    <div {...menuOn(menu, onSelect)} role="tab" aria-label={tab.procedure} style={{ display: "flex", alignItems: "center", gap: 7, paddingLeft: 14, paddingRight: 14, borderRightWidth: 1, borderColor: p.fill, backgroundColor: active ? p.deep2 : p.deep, color: active ? p.text : p.muted, cursor: "pointer" }}>
      <Icon name="pseudocode" size={14} color={active ? p.text : p.muted} />
      <div style={{ fontFamily: MONO, fontSize: 12.5 }}>{tab.procedure}</div>
    </div>
  );
}

function CodeBody({ code, procedure, onLink }: { readonly code: CodeState; readonly procedure: string; readonly onLink: (name: string) => void }): ReactElement {
  const { p } = useTheme();
  useLanguage();
  switch (code.kind) {
    case "loading":
      return <div style={{ padding: 16, fontSize: 12.5, color: p.muted }}>{trN("Ghidra is decompiling {name}. The first open of a file takes a few seconds.", { name: procedure })}</div>;
    case "failed":
      return <div style={{ padding: 16, fontSize: 12.5, color: p.error }}>{trN("Couldn't load {name}: {message}", { name: procedure, message: code.message })}</div>;
    case "ready":
      return <CodeView code={code.text} onLink={onLink} />;
    default: {
      const unhandled: never = code;
      return unhandled;
    }
  }
}

function CanvasBar({ onWorkbench, onClose }: { readonly onWorkbench: (() => void) | null; readonly onClose: () => void }): ReactElement {
  const { p } = useTheme();
  useLanguage();
  return (
    <Row gap={4} style={{ paddingLeft: 8, paddingRight: 8 }}>
      {onWorkbench && (
        <div onClick={onWorkbench} style={{ display: "flex", alignItems: "center", gap: 6, height: 28, paddingLeft: 10, paddingRight: 10, borderWidth: 1, borderColor: p.sel, borderRadius: 8, color: p.text3, fontSize: 12.5, cursor: "pointer", hover: { opacity: 0.72 } }}>
          <Icon name="expand" size={13} color={p.text3} />
          <div>{tr("Workbench")}</div>
        </div>
      )}
      <div onClick={onClose} aria-label="Close canvas" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: 7, cursor: "pointer", hover: { opacity: 0.72 } }}>
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
  useLanguage();
  const tab = tabs[active];
  if (!tab) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, flexBasis: 520, minWidth: 0, borderLeftWidth: 1, borderColor: p.fill, backgroundColor: p.deep2 }}>
      <div style={{ display: "flex", height: 44, flexShrink: 0, borderBottomWidth: 1, borderColor: p.fill }}>
        <div style={{ display: "flex", flexGrow: 1, overflowX: "scroll" }}>
          {tabs.map((t, ix) => {
            const tabMenu = (): readonly MenuEntry[] => [
              ...(onWorkbench ? [{ kind: "action", label: tr("Open in the workbench"), icon: "expand", run: () => { onSelect(ix); onWorkbench(); } } as const] : []),
              { kind: "action", label: tr("Copy name"), icon: "copy", run: () => copyText(t.procedure) },
              { kind: "separator" },
              { kind: "action", label: tr("Close the code panel"), icon: "close", run: onClose },
            ];
            return <TabButton key={t.procedure} tab={t} active={ix === active} onSelect={() => onSelect(ix)} menu={tabMenu} />;
          })}
        </div>
        <CanvasBar onWorkbench={onWorkbench} onClose={onClose} />
      </div>
      <Row gap={8} style={{ height: 32, flexShrink: 0, paddingLeft: 14, paddingRight: 14, borderBottomWidth: 1, borderColor: p.raised2, fontSize: 12, color: p.muted }}>
        <div>{target?.name ?? ""}</div>
        <div>/</div>
        <div>{target?.arch ?? ""}</div>
        <div>/</div>
        <div style={{ fontFamily: MONO, color: p.text3 }}>{tab.procedure}</div>
        <Spacer />
        <div>{tr("Pseudocode from Ghidra")}</div>
      </Row>
      <div style={{ flexGrow: 1, minHeight: 0, overflow: "scroll" }}>
        <CodeBody code={tab.code} procedure={tab.procedure} onLink={onLink} />
      </div>
    </div>
  );
}
