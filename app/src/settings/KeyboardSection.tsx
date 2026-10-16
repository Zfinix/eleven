import { useGpuix } from "@gpuix/react";
import { type ReactElement, useEffect, useState } from "react";

import { type CommandId, COMMANDS, GROUPS } from "../keys/commands";
import { KeymapIcon } from "../components/KeymapIcon";
import { type Combo, comboFor, comboText, commandFor, type KeymapId, KEYMAPS, type Overrides } from "../keys/keymaps";
import { importShortcutFile, type Imported } from "../keys/tools";
import { type KeyTools, useKeyTools } from "../keys/useKeyTools";
import { recordNextCombo, TYPING } from "../lib/shortcuts";
import { tr, trN, useLanguage } from "../i18n";
import { useTheme } from "../theme";
import { Icon, Keys, MenuSurface, Popover, usePopover } from "../components/ui";
import { GroupLabel, PageHeader, Select, washes } from "./controls";
import type { Option } from "./model";
import { pageIntro, pageTitle } from "./pages";
import type { SettingsHandle } from "./store";
import { THIS_DEVICE } from "../lib/platform";

type Clash = { readonly id: CommandId; readonly combo: Combo; readonly other: CommandId };

const BOARD_KEYMAPS: readonly KeymapId[] = ["eleven", "hopper", "ghidra", "vscode", "zed", "xcode"];

function keymapOptions(tools: KeyTools, current: KeymapId): readonly (Option & { readonly lead: ReactElement })[] {
  return KEYMAPS.filter((map) => BOARD_KEYMAPS.includes(map.id) || map.id === current).map((map) => ({ value: map.id, label: map.name, lead: <KeymapIcon id={map.id} tools={tools} size={16} /> }));
}

function without(overrides: Overrides, id: CommandId): Overrides {
  return Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== id));
}

function ImportMenu({ tools, onImport }: { readonly tools: KeyTools; readonly onImport: (imported: Imported | null) => void }): ReactElement {
  const { p } = useTheme();
  useLanguage();
  const { renderer } = useGpuix();
  const menu = usePopover();
  const pick = (imported: Imported): void => {
    menu.close();
    onImport(imported);
  };
  const choose = async (): Promise<void> => {
    menu.close();
    const paths = await renderer?.promptForPaths?.({ files: true, directories: false, prompt: "Import" });
    const first = paths?.[0];
    if (first) onImport(await importShortcutFile(first));
  };
  const row = { display: "flex", alignItems: "center", gap: 10, minHeight: 40, paddingTop: 4, paddingBottom: 4, paddingLeft: 8, paddingRight: 8, borderRadius: 8, cursor: "pointer", hover: { opacity: 0.72 } } as const;
  return (
    <div onMouseDown={menu.onTriggerDown} style={{ display: "flex", position: "relative" }}>
      <div onClick={menu.onTriggerClick} role="button" aria-label={tr("Import shortcuts")} style={{ display: "flex", alignItems: "center", gap: 7, height: 30, paddingLeft: 12, paddingRight: 12, borderWidth: 1, borderColor: p.line3, borderRadius: 8, cursor: "pointer", hover: { opacity: 0.72 } }}>
        <Icon name="download" size={13} color={p.text3} />
        <div>{tr("Import")}</div>
      </div>
      {menu.open && (
        <Popover side="bottom" align="end" gap={6} onDismiss={menu.dismiss}>
          <MenuSurface width={280}>
            {tools.custom.length > 0 && <div style={{ paddingTop: 4, paddingBottom: 6, paddingLeft: 8, fontSize: 11.5, color: p.muted }}>{trN("Found on {device}", { device: tr(THIS_DEVICE) })}</div>}
            {tools.custom.map((item) => (
              <div key={item.file} onClick={() => pick(item)} role="button" style={row}>
                <KeymapIcon id={item.from === "Cursor" || item.from === "VS Code" ? "vscode" : item.from === "Zed" ? "zed" : item.from === "Xcode" ? "xcode" : "ghidra"} tools={tools} size={22} />
                <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 }}>
                  <div>{item.from}</div>
                  <div style={{ fontSize: 11.5, color: p.muted }}>{item.total > 0 ? trN(item.total === 1 ? "{n} shortcut you changed" : "{n} shortcuts you changed", { n: item.total }) : tr("No changes, uses its defaults")}</div>
                </div>
              </div>
            ))}
            <div onClick={() => void choose()} role="button" style={{ ...row, marginTop: tools.custom.length > 0 ? 6 : 0, flexDirection: "column", alignItems: "flex-start", justifyContent: "center", gap: 0 }}>
              <div>{tr("Choose a file")}</div>
              <div style={{ fontSize: 11.5, color: p.muted }}>{tr("IDA, Ghidra, Binary Ninja, Xcode or VS Code")}</div>
            </div>
          </MenuSurface>
        </Popover>
      )}
    </div>
  );
}

function ShortcutRow({ id, label, combo, changed, recording, clash, first, onRecord, onReset, onCancel, onReplace }: {
  readonly id: CommandId;
  readonly label: string;
  readonly combo: Combo;
  readonly changed: boolean;
  readonly recording: boolean;
  readonly clash: Clash | null;
  readonly first: boolean;
  readonly onRecord: () => void;
  readonly onReset: () => void;
  readonly onCancel: () => void;
  readonly onReplace: () => void;
}): ReactElement {
  const { p } = useTheme();
  useLanguage();
  const other = clash ? tr(COMMANDS.find((command) => command.id === clash.other)?.label ?? clash.other) : "";
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {!first && <div style={{ height: 1, marginLeft: 18, marginRight: 18, backgroundColor: p.line2 }} />}
      <div style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 46, paddingLeft: 18, paddingRight: 10 }}>
        <div style={{ flexGrow: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{tr(label)}</div>
        {changed && (
          <div onClick={onReset} role="button" aria-label={trN("Reset {name}", { name: tr(label) })} style={{ display: "flex", alignItems: "center", height: 24, paddingLeft: 8, paddingRight: 8, borderRadius: 6, fontSize: 12, color: p.muted, cursor: "pointer", hover: { opacity: 0.72 } }}>{tr("Reset")}</div>
        )}
        <div onClick={onRecord} role="button" aria-label={trN("Change shortcut for {name}", { name: tr(label) })} data-command={id} style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 3, minWidth: 96, height: 30, paddingLeft: 6, paddingRight: 6, borderWidth: 1, borderColor: recording || clash ? p.link : "transparent", borderRadius: 8, cursor: "pointer", hover: { opacity: 0.72 } }}>
          {recording ? <div style={{ fontSize: 12, color: p.link }}>{tr("Press keys…")}</div> : combo ? <Keys combo={combo} /> : <div style={{ fontSize: 12, color: p.faint }}>{tr("Add")}</div>}
        </div>
      </div>
      {clash && (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginLeft: 18, marginRight: 10, marginBottom: 10, paddingTop: 8, paddingBottom: 8, paddingLeft: 10, paddingRight: 10, borderRadius: 10, backgroundColor: washes(p).warn, fontSize: 12.5 }}>
          <div style={{ flexGrow: 1, flexBasis: 220, color: p.text2 }}>{trN("{combo} is already {other}. Use it here and leave {other} without a shortcut?", { combo: comboText(clash.combo), other })}</div>
          <div onClick={onCancel} role="button" aria-label={tr("Cancel")} style={{ display: "flex", alignItems: "center", height: 26, paddingLeft: 10, paddingRight: 10, borderWidth: 1, borderColor: p.line3, borderRadius: 7, cursor: "pointer", hover: { opacity: 0.72 } }}>{tr("Cancel")}</div>
          <div onClick={onReplace} role="button" aria-label={tr("Use here")} style={{ display: "flex", alignItems: "center", height: 26, paddingLeft: 10, paddingRight: 10, borderRadius: 7, backgroundColor: p.primary, color: p.onPrimary, fontWeight: 600, cursor: "pointer", hover: { opacity: 0.72 } }}>{tr("Use here")}</div>
        </div>
      )}
    </div>
  );
}

/** Every shortcut in one place: start from another tool's set, import your own changes, or record new keys. */
export function KeyboardSection({ store }: { readonly store: SettingsHandle }): ReactElement {
  const { p } = useTheme();
  useLanguage();
  const { renderer } = useGpuix();
  const tools = useKeyTools();
  const { settings, update } = store;
  const keymap = settings.keymap ?? "eleven";
  const overrides = settings.shortcuts;
  const [query, setQuery] = useState("");
  const [recording, setRecording] = useState<CommandId | null>(null);
  const [clash, setClash] = useState<Clash | null>(null);
  const [notice, setNotice] = useState("");
  const changed = Object.keys(overrides).length;

  useEffect(() => {
    if (!recording) return;
    return recordNextCombo((combo) => {
      setRecording(null);
      if (!combo) return;
      const other = commandFor(combo, keymap, overrides);
      if (other && other !== recording) setClash({ id: recording, combo, other });
      else if (other !== recording) update({ shortcuts: { ...overrides, [recording]: combo } });
    });
  }, [recording, keymap, overrides]);

  const imported = (item: Imported | null): void => {
    if (!item) {
      setNotice(tr("Eleven couldn't read shortcuts from that file."));
      return;
    }
    const count = Object.keys(item.overrides).length;
    update({ shortcuts: { ...overrides, ...item.overrides } });
    setNotice(count > 0 ? trN(count === 1 ? "Brought in {n} shortcut from {app}." : "Brought in {n} shortcuts from {app}.", { n: count, app: item.from }) : trN("None of the shortcuts in {app} match Eleven's commands.", { app: item.from }));
  };
  const needle = query.trim().toLowerCase();
  const matches = (id: CommandId, label: string): boolean => !needle || label.toLowerCase().includes(needle) || comboText(comboFor(id, keymap, overrides)).toLowerCase().includes(needle);

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <PageHeader title={pageTitle("keyboard")} intro={pageIntro("keyboard")} />
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <div style={{ color: p.text4 }}>{tr("Based on")}</div>
        <Select label={tr("Based on")} value={keymap} options={keymapOptions(tools, keymap)} lead={<KeymapIcon id={keymap} tools={tools} size={18} />} minWidth={0} onPick={(next) => {
          const map = KEYMAPS.find((candidate) => candidate.id === next);
          if (map) update({ keymap: map.id });
        }} />
        {changed > 0 && <div style={{ color: p.muted }}>{trN(changed === 1 ? "{n} change" : "{n} changes", { n: changed })}</div>}
        <div style={{ flexGrow: 1 }} />
        {changed > 0 && <div onClick={() => update({ shortcuts: {} })} role="button" aria-label={tr("Reset all")} style={{ display: "flex", alignItems: "center", height: 30, paddingLeft: 12, paddingRight: 12, borderRadius: 8, color: p.muted, cursor: "pointer", hover: { opacity: 0.72 } }}>{tr("Reset all")}</div>}
        <ImportMenu tools={tools} onImport={imported} />
      </div>
      {notice && <div style={{ marginBottom: 14, fontSize: 12.5, color: p.muted }}>{notice}</div>}
      <div style={{ display: "flex", alignItems: "center", gap: 8, height: 34, marginBottom: 22, paddingLeft: 10, paddingRight: 10, borderRadius: 9, backgroundColor: p.fill }}>
        <Icon name="search" size={14} color={p.muted} />
        <input {...TYPING} value={query} placeholder={tr("Search by name or keys")} aria-label={tr("Search shortcuts")} onChange={(e) => setQuery(e.value ?? "")} style={{ flexGrow: 1, color: p.text, backgroundColor: p.fill }} />
      </div>
      {GROUPS.map((group) => {
        const rows = COMMANDS.filter((command) => command.group === group && matches(command.id, command.label));
        if (rows.length === 0) return null;
        return (
          <div key={group} aria-label={group} style={{ display: "flex", flexDirection: "column", marginBottom: 26 }}>
            <GroupLabel label={tr(group)} />
            <div style={{ display: "flex", flexDirection: "column", borderRadius: 14, backgroundColor: p.raised2 }}>
              {rows.map((command, index) => (
                <ShortcutRow
                  key={command.id}
                  id={command.id}
                  label={command.label}
                  combo={comboFor(command.id, keymap, overrides)}
                  changed={overrides[command.id] !== undefined}
                  recording={recording === command.id}
                  clash={clash?.id === command.id ? clash : null}
                  first={index === 0}
                  onRecord={() => {
                    renderer?.blur?.();
                    setClash(null);
                    setRecording(recording === command.id ? null : command.id);
                  }}
                  onReset={() => update({ shortcuts: without(overrides, command.id) })}
                  onCancel={() => setClash(null)}
                  onReplace={() => {
                    if (clash) update({ shortcuts: { ...overrides, [clash.id]: clash.combo, [clash.other]: "" } });
                    setClash(null);
                  }}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
