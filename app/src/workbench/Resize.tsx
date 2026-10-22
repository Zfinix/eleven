import type { EventPayload, StyleDesc } from "@gpuix/react";
import type { ReactElement } from "react";

import { type PlainId, t } from "../i18n";
import { useTheme } from "../theme";
import { clampSize, type Edge, saveSizes } from "./sizes";
import { useBench } from "./parts";
import { splitAt, type TreePath } from "./paneTree";
import type { PaneDrag } from "./state";

const VERTICAL: Readonly<Record<Edge, boolean>> = { sidebar: false, dock: false, details: true };
const GROWS: Readonly<Record<Edge, 1 | -1>> = { sidebar: 1, dock: -1, details: -1 };
const LABEL: Readonly<Record<Edge, PlainId>> = { sidebar: "workbench.chrome.resize.sidebar", dock: "workbench.chrome.resize.dock", details: "workbench.chrome.resize.details" };
const PLACE = {
  sidebar: { right: -3, top: 0, bottom: 0, width: 6 },
  dock: { left: -3, top: 0, bottom: 0, width: 6 },
  details: { top: -3, left: 0, right: 0, height: 6 },
} as const;

/** A thin grab strip on a panel's inner edge; the panel needs `position: "relative"`. */
export function ResizeHandle({ edge }: { readonly edge: Edge }): ReactElement {
  const { p } = useTheme();
  const { wb } = useBench();
  const vertical = VERTICAL[edge];
  const active = wb.s.resizing?.edge === edge;
  const grab = (event: EventPayload): void => {
    const at = vertical ? event.y : event.x;
    if (at !== undefined) wb.patch({ resizing: { edge, start: at, from: wb.s.sizes[edge] } });
  };
  return (
    <div onMouseDown={grab} aria-label={t(LABEL[edge])} style={{ position: "absolute", ...PLACE[edge], cursor: vertical ? "row-resize" : "col-resize", backgroundColor: active ? p.line3 : "transparent", hover: { backgroundColor: p.line2 } }} />
  );
}

/** No pane gets narrower than this while dragging a divider. */
export const MIN_PANE = 260;

function samePath(a: TreePath, b: TreePath): boolean {
  return a.length === b.length && a.every((step, ix) => step === b[ix]);
}

/** The line between two children of a split; drag it to share the space differently. */
export function PaneDivider({ path, index, vertical, length }: { readonly path: TreePath; readonly index: number; readonly vertical: boolean; readonly length: number }): ReactElement {
  const { p } = useTheme();
  const { wb } = useBench();
  const held = wb.s.paneDrag;
  const active = held !== null && held.index === index && samePath(held.path, path);
  const grab = (event: EventPayload): void => {
    const split = splitAt(wb.s.tree, path);
    const a = split?.weights[index];
    const b = split?.weights[index + 1];
    const at = vertical ? event.y : event.x;
    if (!split || a === undefined || b === undefined || at === undefined || length === 0) return;
    const total = split.weights.reduce((sum, w) => sum + w, 0);
    wb.patch({ paneDrag: { path, index, vertical, start: at, from: [a, b], perPx: total / length } });
  };
  const line = vertical ? { height: 1 } : { width: 1 };
  const grip: StyleDesc = vertical ? { top: -4, left: 0, right: 0, height: 9, cursor: "row-resize" } : { left: -4, top: 0, bottom: 0, width: 9, cursor: "col-resize" };
  return (
    <div onMouseDown={grab} aria-label={t("workbench.chrome.resize.split")} style={{ position: "relative", ...line, flexShrink: 0, backgroundColor: active ? p.line3 : p.fill }}>
      <div style={{ position: "absolute", ...grip, hover: { backgroundColor: p.line2 } }} />
    </div>
  );
}

/** Stacked panes can be shorter than side-by-side ones are narrow. */
const MIN_PANE_HEIGHT = 120;

function dragPanes(drag: PaneDrag, at: number): readonly [number, number] {
  const pair = drag.from[0] + drag.from[1];
  const least = Math.min((drag.vertical ? MIN_PANE_HEIGHT : MIN_PANE) * drag.perPx, pair / 2);
  const left = Math.min(pair - least, Math.max(least, drag.from[0] + (at - drag.start) * drag.perPx));
  return [left, pair - left];
}

/** While a handle is held, a clear layer over the window catches every move and the release. */
export function ResizeOverlay(): ReactElement | null {
  const { wb } = useBench();
  const drag = wb.s.resizing;
  const panes = wb.s.paneDrag;
  if (panes) {
    const move = (event: EventPayload): void => {
      if (event.pressedButton !== 0) return wb.patch({ paneDrag: null });
      const at = panes.vertical ? event.y : event.x;
      if (at !== undefined) wb.resizePanes(panes.path, panes.index, dragPanes(panes, at));
    };
    return <div onMouseMove={move} onMouseUp={() => wb.patch({ paneDrag: null })} style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, pointerEvents: "auto", cursor: panes.vertical ? "row-resize" : "col-resize" }} />;
  }
  if (!drag) return null;
  const finish = (): void => {
    saveSizes(wb.s.sizes);
    wb.patch({ resizing: null });
  };
  const move = (event: EventPayload): void => {
    if (event.pressedButton !== 0) return finish();
    const at = VERTICAL[drag.edge] ? event.y : event.x;
    if (at === undefined) return;
    wb.patch({ sizes: { ...wb.s.sizes, [drag.edge]: clampSize(drag.edge, drag.from + GROWS[drag.edge] * (at - drag.start)) } });
  };
  return <div onMouseMove={move} onMouseUp={finish} style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, pointerEvents: "auto", cursor: VERTICAL[drag.edge] ? "row-resize" : "col-resize" }} />;
}
