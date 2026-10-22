import { join } from "node:path";

import type { ReactElement, ReactNode } from "react";

import { type MenuEntry, menuOn } from "../../components/ContextMenu";
import { Icon } from "../../components/ui";
import { t } from "../../i18n";
import { ASSETS } from "../../lib/assets";
import { useTheme } from "../../theme";
import { ELLIPSIS, HOVER } from "../parts";
import { logoFor } from "./model";

const ROW = { display: "flex", alignItems: "center", height: 26, flexShrink: 0, paddingRight: 8, borderRadius: 6, cursor: "pointer", hover: HOVER } as const;
const STEP = 14;
/** A file sits past its folder's chevron, so its logo lines up under the folder's icon. */
export const PAST_CHEVRON = 16;

export function treeIndent(depth: number): number {
  return 8 + depth * STEP;
}

/** Small faint text naming a group of rows: "From file paths in the binary". */
export function TreeCaption({ text, first }: { readonly text: string; readonly first: boolean }): ReactElement {
  const { p } = useTheme();
  return <div style={{ paddingTop: first ? 2 : 8, paddingBottom: 2, paddingLeft: 8, paddingRight: 8, fontSize: 11.5, lineHeight: 17, color: p.faint, ...ELLIPSIS }}>{text}</div>;
}

/** A folder, package or class: chevron, icon, name, count. */
export function TreeFolder({ name, open, depth, count = "", icon = null, iconColor = null, faint = false, onClick }: {
  readonly name: string;
  readonly open: boolean;
  readonly depth: number;
  readonly count?: string;
  readonly icon?: string | null;
  readonly iconColor?: string | null;
  readonly faint?: boolean;
  readonly onClick: () => void;
}): ReactElement {
  const { p } = useTheme();
  return (
    <div onClick={onClick} role="treeitem" aria-expanded={open} aria-label={name} style={{ ...ROW, gap: 6, paddingLeft: treeIndent(depth) }}>
      <Icon name={open ? "disclosure" : "forward"} size={10} color={p.faint} />
      <Icon name={icon ?? (open ? "folder-open" : "folder")} size={14} color={iconColor ?? (faint ? p.faint : p.muted)} />
      <div style={{ flexGrow: 1, minWidth: 0, fontSize: 12.5, color: faint ? p.muted : p.text3, pointerEvents: "none", ...ELLIPSIS }}>{name}</div>
      {count && <div style={{ flexShrink: 0, fontSize: 11.5, color: p.faint, pointerEvents: "none" }}>{count}</div>}
    </div>
  );
}

export function TreeFile({ name, ext, depth, count, on, dim = false, italic = false, recreated = false, mark = null, onClick, menu }: {
  readonly name: string;
  readonly ext: string;
  readonly depth: number;
  readonly count: string;
  readonly on: boolean;
  readonly dim?: boolean;
  readonly italic?: boolean;
  readonly recreated?: boolean;
  /** Drawn just before the count, like the dot for how Arrange placed the file. */
  readonly mark?: ReactNode;
  readonly onClick: () => void;
  readonly menu: () => readonly MenuEntry[];
}): ReactElement {
  const { p } = useTheme();
  return (
    <div {...menuOn(menu, onClick)} role="treeitem" aria-selected={on} aria-label={name} style={{ ...ROW, gap: 7, paddingLeft: treeIndent(depth) + PAST_CHEVRON, ...(on ? { backgroundColor: p.sel } : {}) }}>
      <img src={join(ASSETS, "icons", `${logoFor(ext)}.svg`)} objectFit="contain" style={{ width: 14, height: 14, flexShrink: 0, opacity: dim ? 0.6 : 1, pointerEvents: "none" }} />
      <div style={{ flexGrow: 1, minWidth: 0, fontSize: 12.5, color: on ? p.text : p.text3, pointerEvents: "none", ...(italic ? { fontStyle: "italic" } : {}), ...ELLIPSIS }}>{name}</div>
      {recreated && <div aria-label={t("workbench.side.recreated")} style={{ display: "flex", flexShrink: 0, pointerEvents: "none" }}><Icon name="spark" size={11} color={p.data} /></div>}
      {mark}
      {count && <div style={{ flexShrink: 0, fontSize: 11.5, color: p.faint, pointerEvents: "none" }}>{count}</div>}
    </div>
  );
}

/** "53 more": plain faint text, no icon, so it never reads as a file. */
export function TreeMore({ label, onClick }: { readonly label: string; readonly onClick: () => void }): ReactElement {
  const { p } = useTheme();
  return <div onClick={onClick} role="button" aria-label={label} style={{ display: "flex", alignItems: "center", height: 26, flexShrink: 0, paddingLeft: 8, paddingRight: 8, borderRadius: 6, fontSize: 12, color: p.faint, cursor: "pointer", hover: HOVER }}>{label}</div>;
}
