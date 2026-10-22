import { type ReactElement, useState } from "react";

import type { OptionChoice, SessionOption } from "../agents/events";
import { t } from "../i18n";
import { scrollbar, useTheme } from "../theme";
import { Chip, Icon, MenuSurface, Popover, Row, usePopover } from "../components/ui";
import { TYPING } from "../lib/shortcuts";

const SEARCH_ABOVE = 8;
const MAX_SHOWN = 60;

const ON = new Set(["on", "true", "enabled", "yes"]);
const OFF = new Set(["off", "false", "disabled", "no"]);

/** An agent setting with just an on and an off choice, shown as a switch rather than a menu. */
export function isSwitch(option: SessionOption): boolean {
  const values = option.choices.map((choice) => choice.value.toLowerCase());
  return option.category === "other" && values.length === 2 && values.some((v) => ON.has(v)) && values.some((v) => OFF.has(v));
}

export function switchOn(option: SessionOption): boolean {
  return ON.has(option.current.toLowerCase());
}

export function flipped(option: SessionOption): string {
  return option.choices.find((choice) => choice.value !== option.current)?.value ?? option.current;
}

export function modeIcon(choice: OptionChoice): string {
  const id = `${choice.value} ${choice.name}`.toLowerCase();
  if (id.includes("plan")) return "plan";
  if (id.includes("bypass") || id.includes("full") || id.includes("yolo") || id.includes("dontask")) return "shield-alert";
  if (id.includes("accept") || id.includes("edit")) return "rename";
  if (id.includes("auto")) return "bolt";
  return "asks";
}

export function currentChoice(option: SessionOption): OptionChoice | null {
  return option.choices.find((choice) => choice.value === option.current) ?? null;
}

export function modelName(id: string): string {
  const claude = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-|$)/.exec(id);
  if (!claude?.[1] || !claude[2]) return id;
  const family = claude[1].charAt(0).toUpperCase() + claude[1].slice(1);
  return claude[3] ? `${family} ${claude[2]}.${claude[3]}` : `${family} ${claude[2]}`;
}

function chipLabel(option: SessionOption, choice: OptionChoice | null): string {
  if (!choice) return option.current ? modelName(option.current) : option.name;
  return choice.name;
}

/** Some agents describe a choice with its endpoint URL, which tells the user nothing. */
function readable(description: string | null): boolean {
  return description !== null && description.length > 0 && !/^https?:\/\//.test(description.trim());
}

function ChoiceRow({ choice, icon, selected, onPick }: {
  readonly icon: string | null;
  readonly choice: OptionChoice;
  readonly selected: boolean;
  readonly onPick: () => void;
}): ReactElement {
  const { p } = useTheme();
  return (
    <div onClick={onPick} style={{ display: "flex", alignItems: "flex-start", gap: 10, flexShrink: 0, paddingTop: 8, paddingBottom: 8, paddingLeft: 9, paddingRight: 9, borderRadius: 8, cursor: "pointer", hover: { opacity: 0.72 }, ...(selected ? { backgroundColor: p.sel } : {}) }}>
      {icon && (
        <div style={{ display: "flex", paddingTop: 2 }}>
          <Icon name={icon} size={15} color={p.text3} />
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 1, flexGrow: 1, minWidth: 0 }}>
        <div style={{ color: p.text }}>{choice.name}</div>
        {readable(choice.description) && <div style={{ fontSize: 11.5, lineHeight: 16, color: p.muted }}>{choice.description}</div>}
      </div>
      <div style={{ display: "flex", width: 16, paddingTop: 2 }}>{selected && <Icon name="check" size={14} color={p.text} />}</div>
    </div>
  );
}

/** A choice list that stays fast with hundreds of options: a search box, and at most MAX_SHOWN rows rendered. */
function SearchableChoices({ option, onPick }: { readonly option: SessionOption; readonly onPick: (value: string) => void }): ReactElement {
  const { p } = useTheme();
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const matches = needle ? option.choices.filter((choice) => `${choice.name} ${choice.value}`.toLowerCase().includes(needle)) : option.choices;
  const shown = matches.slice(0, MAX_SHOWN);
  return (
    <>
      {option.choices.length > SEARCH_ABOVE && (
        <Row gap={8} style={{ height: 30, flexShrink: 0, paddingLeft: 9, paddingRight: 9, marginBottom: 4, borderRadius: 8, backgroundColor: p.fill }}>
          <Icon name="search" size={13} />
          <input {...TYPING} autoFocus value={query} placeholder={t("chat.option.search", { count: option.choices.length })} onChange={(e) => setQuery(e.value ?? "")} style={{ flexGrow: 1, fontSize: 12.5, color: p.text, backgroundColor: p.fill }} />
        </Row>
      )}
      <div style={{ display: "flex", flexDirection: "column", overflowY: "scroll", ...scrollbar(p), flexGrow: 1, minHeight: 0 }}>
        {shown.map((choice) => (
          <ChoiceRow key={choice.value} icon={option.category === "mode" ? modeIcon(choice) : null} choice={choice} selected={choice.value === option.current} onPick={() => onPick(choice.value)} />
        ))}
        {matches.length > shown.length && <div style={{ paddingTop: 4, paddingLeft: 9, paddingBottom: 2, fontSize: 11.5, color: p.faint }}>{t("chat.option.more", { count: matches.length - shown.length })}</div>}
        {matches.length === 0 && <div style={{ padding: 9, color: p.muted }}>{t("chat.nothingMatches")}</div>}
      </div>
    </>
  );
}

function OptionList({ option, onPick }: { readonly option: SessionOption; readonly onPick: (value: string) => void }): ReactElement {
  const { p } = useTheme();
  return (
    <MenuSurface width={option.category === "mode" ? 280 : 260}>
      <div style={{ paddingTop: 4, paddingLeft: 9, paddingBottom: 6, fontSize: 11.5, color: p.muted }}>{option.name}</div>
      <SearchableChoices option={option} onPick={onPick} />
    </MenuSurface>
  );
}

/** One agent setting as a composer chip that opens a menu of its choices. */
export function OptionChip({ option, disabled, onPick }: {
  readonly option: SessionOption;
  readonly disabled: boolean;
  readonly onPick: (value: string) => void;
}): ReactElement {
  const menu = usePopover();
  const choice = currentChoice(option);
  const pick = (value: string): void => {
    menu.close();
    if (value !== option.current) onPick(value);
  };
  return (
    <div onMouseDown={menu.onTriggerDown} style={{ display: "flex", position: "relative" }}>
      <Chip icon={option.category === "mode" && choice ? modeIcon(choice) : null} label={chipLabel(option, choice)} caret active={menu.open} onClick={disabled ? null : menu.onTriggerClick} />
      {menu.open && (
        <Popover side="top" align="start" onDismiss={menu.dismiss}>
          <OptionList option={option} onPick={pick} />
        </Popover>
      )}
    </div>
  );
}

/** Model and effort as one quiet label, like "Opus High", opening one menu with both lists. */
export function ModelChip({ model, effort, onPick }: {
  readonly model: SessionOption | null;
  readonly effort: SessionOption | null;
  readonly onPick: (option: SessionOption, value: string) => void;
}): ReactElement | null {
  const { p } = useTheme();
  const menu = usePopover();
  if (!model && !effort) return null;
  const parts = [model ? chipLabel(model, currentChoice(model)) : null, effort ? chipLabel(effort, currentChoice(effort)) : null];
  const pick = (option: SessionOption, value: string): void => {
    menu.close();
    if (value !== option.current) onPick(option, value);
  };
  return (
    <div onMouseDown={menu.onTriggerDown} style={{ display: "flex", position: "relative" }}>
      <Chip label={parts.filter(Boolean).join(" ")} caret active={menu.open} onClick={menu.onTriggerClick} />
      {menu.open && (
        <Popover side="top" align="start" onDismiss={menu.dismiss}>
          <MenuSurface width={280}>
            {model && <div style={{ paddingTop: 4, paddingLeft: 9, paddingBottom: 6, fontSize: 11.5, color: p.muted }}>{model.name}</div>}
            {model && <SearchableChoices option={model} onPick={(value) => pick(model, value)} />}
            {effort && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, height: 36, marginTop: model ? 6 : 0, paddingLeft: 9, paddingRight: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 5, flexGrow: 1, minWidth: 0, fontSize: 12.5, whiteSpace: "nowrap" }}>
                  <div style={{ color: p.text }}>{effort.name}</div>
                  <div style={{ color: p.muted }}>{`(${currentChoice(effort)?.name ?? effort.current})`}</div>
                </div>
                <div role="radiogroup" aria-label={effort.name} style={{ display: "flex", alignItems: "center", flexShrink: 0, height: 24, paddingLeft: 4, paddingRight: 4, borderRadius: 12, backgroundColor: p.fill }}>
                  {effort.choices.map((choice) => {
                    const on = choice.value === effort.current;
                    return (
                      <div key={choice.value} onClick={() => pick(effort, choice.value)} role="radio" aria-checked={on} aria-label={choice.name} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 18, height: 24, cursor: "pointer", hover: { opacity: 0.72 } }}>
                        <div style={{ width: on ? 14 : 4, height: on ? 14 : 4, borderRadius: on ? 7 : 2, backgroundColor: on ? p.text3 : p.faint, pointerEvents: "none" }} />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </MenuSurface>
        </Popover>
      )}
    </div>
  );
}
