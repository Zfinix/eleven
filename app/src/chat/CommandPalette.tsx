import type { EventPayload } from "@gpuix/react";
import { type ReactElement, useState } from "react";

import type { OptionChoice, SessionOption, SlashCommand } from "../agents/events";
import { MenuRows } from "../components/MenuRows";
import { t } from "../i18n";
import { type Palette, useTheme } from "../theme";
import { Icon, Row, Switch } from "../components/ui";
import type { Skill } from "../skills/load";
import { isSwitch, modeIcon, switchOn } from "./OptionMenu";
import { useSettings } from "../settings/store";
import { noteTyping } from "../lib/shortcuts";

const MAX_COMMANDS = 40;
const ITEM_ROW = 34;
const DIVIDER = 9;
const ROWS_MAX = 254;

export type PaletteItem =
  | { readonly kind: "mode"; readonly option: SessionOption; readonly choice: OptionChoice }
  | { readonly kind: "skill"; readonly skill: Skill }
  | { readonly kind: "command"; readonly command: SlashCommand }
  | { readonly kind: "switch"; readonly option: SessionOption }
  | { readonly kind: "attach" };

function matches(needle: string, ...fields: readonly (string | null)[]): boolean {
  return fields.some((field) => field?.toLowerCase().includes(needle) ?? false);
}

function paletteItems(options: readonly SessionOption[], commands: readonly SlashCommand[], skills: readonly Skill[], query: string): readonly PaletteItem[] {
  const needle = query.trim().toLowerCase();
  const mode = options.find((option) => option.category === "mode");
  const modes = mode ? mode.choices.filter((choice) => matches(needle, choice.name, choice.description)).map((choice): PaletteItem => ({ kind: "mode", option: mode, choice })) : [];
  const playbooks = skills.filter((skill) => matches(needle, skill.name, skill.description)).map((skill): PaletteItem => ({ kind: "skill", skill }));
  const agentCommands = commands.filter((command) => matches(needle, command.name, command.description)).slice(0, MAX_COMMANDS).map((command): PaletteItem => ({ kind: "command", command }));
  const switches = options.filter(isSwitch).filter((option) => matches(needle, option.name)).map((option): PaletteItem => ({ kind: "switch", option }));
  const attach: readonly PaletteItem[] = matches(needle, "add a file", "files", t("chat.palette.files"), t("chat.palette.files.detail")) ? [{ kind: "attach" }] : [];
  return [...modes, ...playbooks, ...agentCommands, ...switches, ...attach];
}

function modeTone(icon: string, p: Palette): string {
  if (icon === "plan") return p.data;
  if (icon === "shield-alert") return p.error;
  if (icon === "rename") return p.keyword;
  return p.string;
}

function itemKey(item: PaletteItem): string {
  switch (item.kind) {
    case "mode":
      return `mode-${item.choice.value}`;
    case "skill":
      return `skill-${item.skill.name}`;
    case "command":
      return `command-${item.command.name}`;
    case "switch":
      return `switch-${item.option.id}`;
    case "attach":
      return "attach";
    default: {
      const unhandled: never = item;
      return unhandled;
    }
  }
}

function ItemRow({ item, highlighted, onPick }: { readonly item: PaletteItem; readonly highlighted: boolean; readonly onPick: () => void }): ReactElement {
  const { p } = useTheme();
  const look = { display: "flex", alignItems: "center", gap: 10, height: 34, flexShrink: 0, paddingLeft: 10, paddingRight: 10, borderRadius: 8, cursor: "pointer", hover: { opacity: 0.72 }, ...(highlighted ? { backgroundColor: p.sel } : {}) } as const;
  const line = (icon: string, tone: string, name: string, detail: string | null): ReactElement => (
    <>
      <Icon name={icon} size={15} color={tone} />
      <div style={{ color: p.text, whiteSpace: "nowrap", flexShrink: 0 }}>{name}</div>
      {detail && <div style={{ color: p.muted, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden", minWidth: 0 }}>{detail}</div>}
    </>
  );
  switch (item.kind) {
    case "mode": {
      const icon = modeIcon(item.choice);
      const selected = item.choice.value === item.option.current;
      return (
        <div onClick={onPick} style={look}>
          {line(icon, modeTone(icon, p), item.choice.name, item.choice.description)}
          <div style={{ flexGrow: 1 }} />
          {selected && <Icon name="check" size={13} color={p.text3} />}
        </div>
      );
    }
    case "skill":
      return <div onClick={onPick} style={look}>{line("spark", p.data, item.skill.name, item.skill.description)}</div>;
    case "command":
      return <div onClick={onPick} style={look}>{line("slash", p.text3, item.command.name, item.command.description)}</div>;
    case "switch":
      return (
        <div onClick={onPick} style={look}>
          {line("bolt", p.text3, item.option.name, null)}
          <div style={{ flexGrow: 1 }} />
          <Switch on={switchOn(item.option)} />
        </div>
      );
    case "attach":
      return <div onClick={onPick} style={look}>{line("attach", p.text3, t("chat.palette.files"), t("chat.palette.files.detail"))}</div>;
    default: {
      const unhandled: never = item;
      return unhandled;
    }
  }
}

function startsSection(items: readonly PaletteItem[], ix: number): boolean {
  const item = items[ix];
  const before = items[ix - 1];
  return ix > 0 && item !== undefined && before !== undefined && (before.kind === "mode") !== (item.kind === "mode");
}

/** The / palette under the prompt: modes, the agent's skills, on/off settings and files, with its own search. */
export function CommandPalette({ options, commands, skills, onPick, onClose }: {
  readonly options: readonly SessionOption[];
  readonly commands: readonly SlashCommand[];
  readonly skills: readonly Skill[];
  readonly onPick: (item: PaletteItem) => void;
  readonly onClose: () => void;
}): ReactElement {
  const { p } = useTheme();
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const { disabledSkills, skillsInComposer } = useSettings().settings;
  const shown = skillsInComposer ? skills.filter((skill) => !disabledSkills.includes(skill.name)) : [];
  const items = paletteItems(options, commands, shown, query);
  const at = Math.min(highlighted, Math.max(0, items.length - 1));
  const onKeyDown = (event: EventPayload): void => {
    noteTyping(event);
    if (event.key === "escape") onClose();
    else if (event.key === "down") setHighlighted((at + 1) % Math.max(1, items.length));
    else if (event.key === "up") setHighlighted((at - 1 + items.length) % Math.max(1, items.length));
  };
  const submit = (): void => {
    const item = items[at];
    if (item) onPick(item);
  };
  return (
    <div onMouseDownOutside={onClose} style={{ display: "flex", flexDirection: "column", width: "100%", maxHeight: 300, padding: 6, borderWidth: 1, borderColor: p.sel, borderRadius: 16, backgroundColor: p.win }}>
      <Row gap={8} style={{ height: 34, flexShrink: 0, paddingLeft: 10, paddingRight: 10 }}>
        <input autoFocus value={query} placeholder={t("chat.palette.search")} aria-label={t("chat.palette.label")} onChange={(e) => {
          setQuery(e.value ?? "");
          setHighlighted(0);
        }} onKeyDown={onKeyDown} onSubmit={submit} style={{ flexGrow: 1, color: p.text, backgroundColor: p.win }} />
      </Row>
      {items.length === 0 && <div style={{ padding: 10, color: p.faint }}>{t("chat.nothingMatches")}</div>}
      <MenuRows heights={items.map((_, ix) => ITEM_ROW + (startsSection(items, ix) ? DIVIDER : 0))} maxHeight={ROWS_MAX} reveal={at}>
        {items.map((item, ix) => (
          <div key={itemKey(item)} style={{ display: "flex", flexDirection: "column" }}>
            {startsSection(items, ix) && <div style={{ height: 1, marginTop: 4, marginBottom: 4, marginLeft: 10, marginRight: 10, backgroundColor: p.line2 }} />}
            <ItemRow item={item} highlighted={ix === at} onPick={() => onPick(item)} />
          </div>
        ))}
      </MenuRows>
    </div>
  );
}
