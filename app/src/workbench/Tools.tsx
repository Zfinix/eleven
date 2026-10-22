import { type EventPayload, type PublicInstance, useGpuix } from "@gpuix/react";
import { Fragment, type ReactElement, useRef, useState } from "react";

import { menuOn } from "../components/ContextMenu";
import { loadProject } from "../engine/project";
import { t } from "../i18n";
import { scrollbar, useTheme } from "../theme";
import { toolMenu } from "./actions";
import { AgentTab } from "./AgentPanel";
import { DebugView } from "./DebugView";
import { Patches, References, Terminal } from "./Details";
import { moveDockTab, type Tool, TOOL_LABEL, type Zone } from "./dockOrder";
import { FindPanel } from "./FindPanel";
import { Inspector } from "./Inspector";
import { IconButton, useBench } from "./parts";
import { ResizeHandle } from "./Resize";

/** A tool's content, the same wherever the tool sits. */
export function ToolBody({ tool }: { readonly tool: Tool }): ReactElement {
  switch (tool) {
    case "agent":
      return <AgentTab />;
    case "inspector":
      return <Inspector />;
    case "refs":
      return <References />;
    case "find":
      return <FindPanel />;
    case "debug":
      return <DebugView />;
    case "terminal":
      return <Terminal />;
    case "patches":
      return <Patches />;
    default: {
      const unhandled: never = tool;
      return unhandled;
    }
  }
}

/** Tools that fill their space and scroll themselves; the rest get padding and a scroll. */
export function fillsSpace(tool: Tool): boolean {
  return tool === "terminal" || tool === "agent" || tool === "inspector";
}

/** A tab held down: where the press started, and once it has moved, the tab it would land before (null for the end). */
type Drag = { readonly tab: Tool; readonly startX: number; readonly before: Tool | null | undefined };

/** Drags shorter than this are clicks. */
const DRAG_FROM = 4;

/** A dock's tab row: click to switch, drag to reorder, right-click to move a tool elsewhere. */
export function DockTabs({ zone, trailing }: { readonly zone: Zone; readonly trailing: ReactElement | null }): ReactElement {
  const { p } = useTheme();
  const bench = useBench();
  const { wb, program } = bench;
  const { renderer } = useGpuix();
  const [drag, setDrag] = useState<Drag | null>(null);
  const boxes = useRef(new Map<Tool, PublicInstance>());
  const order = wb.s.docks[zone];
  const active = zone === "right" ? wb.s.right : wb.s.bottom;
  const patches = loadProject(program.id).patches.length;
  const landing = (tab: Tool, x: number): Tool | null => {
    for (const other of order) {
      const id = boxes.current.get(other)?.id;
      const box = id === undefined ? null : renderer?.getElementBounds?.(id);
      if (other !== tab && box && x < box.x + box.width / 2) return other;
    }
    return null;
  };
  const move = (event: EventPayload): void => {
    if (!drag || event.x === undefined) return;
    if (event.pressedButton !== 0) return setDrag(null);
    if (drag.before === undefined && Math.abs(event.x - drag.startX) < DRAG_FROM) return;
    setDrag({ ...drag, before: landing(drag.tab, event.x) });
  };
  const drop = (): void => {
    if (drag && drag.before !== undefined) wb.orderDock(zone, moveDockTab(order, drag.tab, drag.before));
    else if (drag) wb.reveal(drag.tab);
    setDrag(null);
  };
  const marker = <div style={{ width: 2, height: 18, flexShrink: 0, borderRadius: 1, backgroundColor: p.link }} />;
  return (
    <div role="tablist" aria-label={zone === "right" ? t("workbench.chrome.rightPanel") : t("workbench.chrome.details")} style={{ position: "relative", display: "flex", alignItems: "center", gap: 2, height: 34, flexShrink: 0, paddingLeft: 8, paddingRight: 8 }}>
      {order.map((tab) => {
        const on = active === tab;
        const keep = (node: PublicInstance | null): void => {
          if (node) boxes.current.set(tab, node);
          else boxes.current.delete(tab);
        };
        const menu = menuOn(() => toolMenu(bench, tab));
        return (
          <Fragment key={tab}>
            {drag?.before === tab && marker}
            <div ref={keep} onAuxClick={menu.onAuxClick} onMouseDown={(event) => event.x !== undefined && (event.button ?? 0) === 0 && setDrag({ tab, startX: event.x, before: undefined })} onMouseUp={drop} onClick={() => wb.reveal(tab)} role="tab" aria-selected={on} aria-label={t(TOOL_LABEL[tab])} style={{ display: "flex", alignItems: "center", gap: 6, height: 26, paddingLeft: 10, paddingRight: 10, borderRadius: 7, fontSize: 12.5, color: on ? p.text : p.muted, cursor: "pointer", opacity: drag?.tab === tab && drag.before !== undefined ? 0.5 : 1, ...(on ? { backgroundColor: p.sel } : {}) }}>
              <div style={{ whiteSpace: "nowrap", pointerEvents: "none" }}>{t(TOOL_LABEL[tab])}</div>
              {tab === "patches" && patches > 0 && <div style={{ fontSize: 11, color: p.faint, pointerEvents: "none" }}>{`${patches}`}</div>}
            </div>
          </Fragment>
        );
      })}
      {drag?.before === null && marker}
      <div style={{ flexGrow: 1, alignSelf: "stretch" }} />
      {trailing}
      {drag && <div onMouseMove={move} onMouseUp={drop} style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, pointerEvents: "auto", cursor: drag.before === undefined ? "pointer" : "grabbing" }} />}
    </div>
  );
}

/** The bottom dock: its tools as tabs, in the order you dragged them. */
export function BottomDock(): ReactElement {
  const { p } = useTheme();
  const { wb } = useBench();
  const tool = wb.s.bottom;
  return (
    <div role="region" aria-label={t("workbench.chrome.details")} style={{ position: "relative", display: "flex", flexDirection: "column", height: wb.s.sizes.details, flexShrink: 0, borderTopWidth: 1, borderColor: p.fill }}>
      <ResizeHandle edge="details" />
      <DockTabs zone="bottom" trailing={<IconButton icon="arrow-down" label={t("workbench.chrome.hideDetails")} size={24} iconSize={12} onClick={() => wb.patch({ bottomOpen: false })} />} />
      <div style={fillsSpace(tool) ? { display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0 } : { display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, overflow: "scroll", ...scrollbar(p), paddingTop: 4, paddingLeft: 8, paddingRight: 8, paddingBottom: 10 }}>
        <ToolBody tool={tool} />
      </div>
    </div>
  );
}
