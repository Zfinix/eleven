import { useGpuix } from "@gpuix/react";
import { type ReactElement, useEffect, useState } from "react";

import { type CommandGroup, type CommandId, commandLabel, COMMANDS, GROUPS } from "../keys/commands";
import { KeymapIcon } from "../components/KeymapIcon";
import { type Combo, comboFor, comboText, commandFor, type KeymapId, KEYMAPS, type Overrides } from "../keys/keymaps";
import { importShortcutFile, type Imported } from "../keys/tools";
import { type KeyTools, useKeyTools } from "../keys/useKeyTools";
import { type PlainId, t, thisDevice } from "../i18n";
import { recordNextCombo, TYPING } from "../lib/shortcuts";
import { useTheme } from "../theme";
import { Icon, Keys, MenuSurface, Popover, usePopover } from "../components/ui";
import { GroupLabel, PageHeader, Select, washes } from "./controls";
import type { Option } from "./model";
import { pageIntro, pageTitle } from "./pages";
import type { SettingsHandle } from "./store";

type Clash = { readonly id: CommandId; readonly combo: Combo; readonly other: CommandId };

const GROUP_LABELS: Readonly<Record<CommandGroup, PlainId>> = {
  Navigate: "keyboard.group.navigate",
  Annotate: "keyboard.group.annotate",
  View: "keyboard.group.view",
  Agent: "keyboard.group.agent",
  Debugger: "keyboard.group.debugger",
};

const BOARD_KEYMAPS: readonly KeymapId[] = ["eleven", "hopper", "ghidra", "vscode", "zed", "xcode"];

function keymapOptions(tools: KeyTools, current: KeymapId): readonly (Option & { readonly lead: ReactElement })[] {
  return KEYMAPS.filter((map) => BOARD_KEYMAPS.includes(map.id) || map.id === current).map((map) => ({ value: map.id, label: map.name, lead: <KeymapIcon id={map.id} tools={tools} size={16} /> }));
}

function without(overrides: Overrides, id: CommandId): Overrides {
  return Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== id));
}

function ImportMenu({ tools, onImport }: { readonly tools: KeyTools; readonly onImport: (imported: Imported | null) => void }): ReactElement {
  const { p } = useTheme();
  const { renderer } = useGpuix();
  const menu = usePopover();
  const pick = (imported: Imported): void => {
    menu.close();
    onImport(imported);
  };
  const choose = async (): Promise<void> => {
    menu.close();
    const paths = await renderer?.promptForPaths?.({ files: true, directories: false, prompt: t("keyboard.import") });
    const first = paths?.[0];
    if (first) onImport(await importShortcutFile(first));
  };
  const row = { display: "flex", alignItems: "center", gap: 10, minHeight: 40, paddingTop: 4, paddingBottom: 4, paddingLeft: 8, paddingRight: 8, borderRadius: 8, cursor: "pointer", hover: { opacity: 0.72 } } as const;
  return (
    <div onMouseDown={menu.onTriggerDown} style={{ display: "flex", position: "relative" }}>
      <div onClick={menu.onTriggerClick} role="button" aria-label={t("keyboard.importShortcuts")} style={{ display: "flex", alignItems: "center", gap: 7, height: 30, paddingLeft: 12, paddingRight: 12, borderWidth: 1, borderColor: p.line3, borderRadius: 8, cursor: "pointer", hover: { opacity: 0.72 } }}>
        <Icon name="download" size={13} color={p.text3} />
        <div>{t("keyboard.import")}</div>
      </div>
      {menu.open && (
        <Popover side="bottom" align="end" gap={6} onDismiss={menu.dismiss}>
          <MenuSurface width={280}>
            {tools.custom.length > 0 && <div style={{ paddingTop: 4, paddingBottom: 6, paddingLeft: 8, fontSize: 11.5, color: p.muted }}>{t("keyboard.foundOn", { device: thisDevice() })}</div>}
            {tools.custom.map((item) => (
              <div key={item.file} onClick={() => pick(item)} role="button" style={row}>
                <KeymapIcon id={item.from === "Cursor" || item.from === "VS Code" ? "vscode" : item.from === "Zed" ? "zed" : item.from === "Xcode" ? "xcode" : "ghidra"} tools={tools} size={22} />
                <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 }}>
                  <div>{item.from}</div>
                  <div style={{ fontSize: 11.5, color: p.muted }}>{item.total === 0 ? t("keyboard.noChanges") : item.total === 1 ? t("keyboard.changedOne") : t("keyboard.changedMany", { count: item.total })}</div>
                </div>
              </div>
            ))}
            <div onClick={() => void choose()} role="button" style={{ ...row, marginTop: tools.custom.length > 0 ? 6 : 0, flexDirection: "column", alignItems: "flex-start", justifyContent: "center", gap: 0 }}>
              <div>{t("keyboard.chooseFile")}</div>
              <div style={{ fontSize: 11.5, color: p.muted }}>{t("keyboard.chooseFile.desc")}</div>
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
  const other = clash ? commandLabel(clash.other) : "";
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {!first && <div style={{ height: 1, marginLeft: 18, marginRight: 18, backgroundColor: p.line2 }} />}
      <div style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 46, paddingLeft: 18, paddingRight: 10 }}>
        <div style={{ flexGrow: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</div>
        {changed && (
          <div onClick={onReset} role="button" aria-label={t("keyboard.resetOne", { name: label })} style={{ display: "flex", alignItems: "center", height: 24, paddingLeft: 8, paddingRight: 8, borderRadius: 6, fontSize: 12, color: p.muted, cursor: "pointer", hover: { opacity: 0.72 } }}>{t("keyboard.reset")}</div>
        )}
        <div onClick={onRecord} role="button" aria-label={t("keyboard.change", { name: label })} data-command={id} style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 3, minWidth: 96, height: 30, paddingLeft: 6, paddingRight: 6, borderWidth: 1, borderColor: recording || clash ? p.link : "transparent", borderRadius: 8, cursor: "pointer", hover: { opacity: 0.72 } }}>
          {recording ? <div style={{ fontSize: 12, color: p.link }}>{t("keyboard.pressKeys")}</div> : combo ? <Keys combo={combo} /> : <div style={{ fontSize: 12, color: p.faint }}>{t("keyboard.add")}</div>}
        </div>
      </div>
      {clash && (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginLeft: 18, marginRight: 10, marginBottom: 10, paddingTop: 8, paddingBottom: 8, paddingLeft: 10, paddingRight: 10, borderRadius: 10, backgroundColor: washes(p).warn, fontSize: 12.5 }}>
          <div style={{ flexGrow: 1, flexBasis: 220, color: p.text2 }}>{t("keyboard.clash", { combo: comboText(clash.combo), other })}</div>
          <div onClick={onCancel} role="button" aria-label={t("settings.cancel")} style={{ display: "flex", alignItems: "center", height: 26, paddingLeft: 10, paddingRight: 10, borderWidth: 1, borderColor: p.line3, borderRadius: 7, cursor: "pointer", hover: { opacity: 0.72 } }}>{t("settings.cancel")}</div>
          <div onClick={onReplace} role="button" aria-label={t("keyboard.useHere")} style={{ display: "flex", alignItems: "center", height: 26, paddingLeft: 10, paddingRight: 10, borderRadius: 7, backgroundColor: p.primary, color: p.onPrimary, fontWeight: 600, cursor: "pointer", hover: { opacity: 0.72 } }}>{t("keyboard.useHere")}</div>
        </div>
      )}
    </div>
  );
}

/** Every shortcut in one place: start from another tool's set, import your own changes, or record new keys. */
export function KeyboardSection({ store }: { readonly store: SettingsHandle }): ReactElement {
  const { p } = useTheme();
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
      setNotice(t("keyboard.importFailed"));
      return;
    }
    const count = Object.keys(item.overrides).length;
    update({ shortcuts: { ...overrides, ...item.overrides } });
    setNotice(count === 0 ? t("keyboard.importedNone", { app: item.from }) : count === 1 ? t("keyboard.importedOne", { app: item.from }) : t("keyboard.importedMany", { count, app: item.from }));
  };
  const needle = query.trim().toLowerCase();
  const matches = (id: CommandId, label: string): boolean => !needle || label.toLowerCase().includes(needle) || comboText(comboFor(id, keymap, overrides)).toLowerCase().includes(needle);

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <PageHeader title={pageTitle("keyboard")} intro={pageIntro("keyboard")} />
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <div style={{ color: p.text4 }}>{t("keyboard.basedOn")}</div>
        <Select label={t("keyboard.basedOn")} value={keymap} options={keymapOptions(tools, keymap)} lead={<KeymapIcon id={keymap} tools={tools} size={18} />} minWidth={0} onPick={(next) => {
          const map = KEYMAPS.find((candidate) => candidate.id === next);
          if (map) update({ keymap: map.id });
        }} />
        {changed > 0 && <div style={{ color: p.muted }}>{changed === 1 ? t("keyboard.oneChange") : t("keyboard.changes", { count: changed })}</div>}
        <div style={{ flexGrow: 1 }} />
        {changed > 0 && <div onClick={() => update({ shortcuts: {} })} role="button" aria-label={t("keyboard.resetAll")} style={{ display: "flex", alignItems: "center", height: 30, paddingLeft: 12, paddingRight: 12, borderRadius: 8, color: p.muted, cursor: "pointer", hover: { opacity: 0.72 } }}>{t("keyboard.resetAll")}</div>}
        <ImportMenu tools={tools} onImport={imported} />
      </div>
      {notice && <div style={{ marginBottom: 14, fontSize: 12.5, color: p.muted }}>{notice}</div>}
      <div style={{ display: "flex", alignItems: "center", gap: 8, height: 34, marginBottom: 22, paddingLeft: 10, paddingRight: 10, borderRadius: 9, backgroundColor: p.fill }}>
        <Icon name="search" size={14} color={p.muted} />
        <input {...TYPING} value={query} placeholder={t("keyboard.search.placeholder")} aria-label={t("keyboard.search")} onChange={(e) => setQuery(e.value ?? "")} style={{ flexGrow: 1, color: p.text, backgroundColor: p.fill }} />
      </div>
      {GROUPS.map((group) => {
        const rows = COMMANDS.filter((command) => command.group === group && matches(command.id, commandLabel(command.id)));
        if (rows.length === 0) return null;
        return (
          <div key={group} aria-label={t(GROUP_LABELS[group])} style={{ display: "flex", flexDirection: "column", marginBottom: 26 }}>
            <GroupLabel label={t(GROUP_LABELS[group])} />
            <div style={{ display: "flex", flexDirection: "column", borderRadius: 14, backgroundColor: p.raised2 }}>
              {rows.map((command, index) => (
                <ShortcutRow
                  key={command.id}
                  id={command.id}
                  label={commandLabel(command.id)}
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
