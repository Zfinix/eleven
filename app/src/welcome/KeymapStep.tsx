import { type ReactNode, type ReactElement, useState } from "react";

import { commandLabel, type CommandId } from "../keys/commands";
import { KeymapIcon } from "../components/KeymapIcon";
import { t, thisDevice } from "../i18n";
import { comboFor, type KeymapId, KEYMAPS } from "../keys/keymaps";
import { customFor, type KeyTools, useKeyTools } from "../keys/useKeyTools";
import { useSettings } from "../settings/store";
import { useTheme } from "../theme";
import { Icon, Keys } from "../components/ui";
import { glass, HOVER, lineHeight } from "./look";
import { StepHeading } from "./SetupParts";

const PREVIEW: readonly CommandId[] = ["goto", "rename", "palette", "comment", "back", "xrefs", "forward", "graph", "bookmark", "pseudo"];

function noteFor(id: KeymapId, tools: KeyTools): string {
  if (id === "eleven") return t("setup.keys.default");
  const custom = customFor(tools, id);
  if (custom) return t("setup.keys.changesFound", { count: Object.keys(custom.overrides).length });
  return tools.installed.has(id) ? t("setup.keys.onDevice", { device: thisDevice() }) : "";
}

function Tile({ id, tools, on, onPick }: { readonly id: KeymapId; readonly tools: KeyTools; readonly on: boolean; readonly onPick: () => void }): ReactElement {
  const { p } = useTheme();
  const g = glass(p);
  const map = KEYMAPS.find((keymap) => keymap.id === id);
  return (
    <div onClick={onPick} role="radio" aria-selected={on} aria-label={map?.name ?? id} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, minWidth: 0, paddingTop: 16, paddingBottom: 12, paddingLeft: 10, paddingRight: 10, borderWidth: 1, borderColor: on ? "transparent" : g.edge, borderRadius: 14, backgroundColor: on ? p.sel2 : g.card, cursor: "pointer", hover: HOVER }}>
      <KeymapIcon id={id} tools={tools} size={40} />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%", minWidth: 0 }}>
        <div style={{ fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{map?.name ?? id}</div>
        <div style={{ minHeight: lineHeight(12), fontSize: 12, lineHeight: lineHeight(12), color: p.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{noteFor(id, tools)}</div>
      </div>
    </div>
  );
}

function Preview({ keymap }: { readonly keymap: KeymapId }): ReactElement {
  const { p } = useTheme();
  const g = glass(p);
  const name = KEYMAPS.find((map) => map.id === keymap)?.name ?? "Eleven";
  return (
    <div style={{ display: "flex", flexDirection: "column", borderWidth: 1, borderColor: g.edge, borderRadius: 14, backgroundColor: g.card, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", height: 44, paddingLeft: 16, paddingRight: 16, fontWeight: 600 }}>{t("setup.keys.with", { name })}</div>
      <div style={{ display: "grid", gridTemplateColumns: 2 }}>
        {PREVIEW.map((id) => (
          <div key={id} style={{ display: "flex", alignItems: "center", gap: 10, height: 40, paddingLeft: 16, paddingRight: 16, borderTopWidth: 1, borderColor: g.line }}>
            <div style={{ flexGrow: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{commandLabel(id)}</div>
            <Keys combo={comboFor(id, keymap, {})} />
          </div>
        ))}
      </div>
    </div>
  );
}

function Checkbox({ on }: { readonly on: boolean }): ReactElement {
  const { p } = useTheme();
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 16, height: 16, borderRadius: 4, flexShrink: 0, borderWidth: on ? 0 : 1, borderColor: p.line3, backgroundColor: on ? p.primary : "transparent", pointerEvents: "none" }}>
      {on && <Icon name="check" size={12} color={p.onPrimary} />}
    </div>
  );
}

/** Step three: pick the tool whose shortcuts your hands already know, and bring your own changes from it. */
export function KeymapStep({ onDone, onBack, pill }: { readonly onDone: () => void; readonly onBack: () => void; readonly pill: ReactNode }): ReactElement {
  const { p } = useTheme();
  const g = glass(p);
  const tools = useKeyTools();
  const { update } = useSettings();
  const [keymap, setKeymap] = useState<KeymapId>("eleven");
  const [bring, setBring] = useState(true);
  const custom = customFor(tools, keymap);
  const finish = (): void => {
    update({ keymap, shortcuts: bring && custom ? custom.overrides : {} });
    onDone();
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <StepHeading title={t("setup.keys.title")} detail={t("setup.keys.detail")} />
      <div role="radiogroup" aria-label={t("setup.keys.keymap")} style={{ display: "grid", gridTemplateColumns: 4, gap: 10 }}>
        {KEYMAPS.map((map) => (
          <Tile key={map.id} id={map.id} tools={tools} on={map.id === keymap} onPick={() => setKeymap(map.id)} />
        ))}
      </div>
      <Preview keymap={keymap} />
      {custom && (
        <div onClick={() => setBring(!bring)} role="checkbox" aria-selected={bring} aria-label={t("setup.keys.bring")} style={{ display: "flex", alignItems: "center", gap: 12, paddingTop: 12, paddingBottom: 12, paddingLeft: 16, paddingRight: 16, borderWidth: 1, borderColor: g.edge, borderRadius: 14, backgroundColor: g.card, cursor: "pointer" }}>
          <Checkbox on={bring} />
          <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 500 }}>{t("setup.keys.bring")}</div>
            <div style={{ fontSize: 12, lineHeight: lineHeight(12), color: p.muted }}>{t("setup.keys.bring.desc", { matched: Object.keys(custom.overrides).length, total: custom.total, app: custom.from })}</div>
          </div>
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 4 }}>
        <div onClick={onBack} role="button" aria-label={t("setup.back")} style={{ color: p.muted, cursor: "pointer", hover: HOVER }}>{t("setup.back")}</div>
        <div style={{ flexGrow: 1 }} />
        {pill}
        <div onClick={finish} role="button" aria-label={t("setup.continue")} style={{ display: "flex", alignItems: "center", height: 36, paddingLeft: 18, paddingRight: 18, borderRadius: 9, backgroundColor: p.primary, color: p.onPrimary, fontWeight: 600, cursor: "pointer", hover: HOVER }}>{t("setup.continue")}</div>
      </div>
    </div>
  );
}
