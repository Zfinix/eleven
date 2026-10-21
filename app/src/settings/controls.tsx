import { type EventPayload, type PublicInstance, useGpuix } from "@gpuix/react";
import { type ReactElement, type ReactNode, useRef } from "react";

import { AgentLogo, Icon, MenuSurface, Popover, usePopover } from "../components/ui";
import { t } from "../i18n";
import { TYPING } from "../lib/shortcuts";
import { DARK, MONO, type Palette, useTheme } from "../theme";
import type { Action, ButtonStyle, Confirm, Control, GroupModel, Lead, Option, SettingRowModel, Tone } from "./model";

const SHADOW = { offsetX: 0, offsetY: 1, blurRadius: 2, spreadRadius: 0, color: "rgba(0,0,0,0.25)" };

export function washes(p: Palette): { readonly ok: string; readonly warn: string; readonly err: string } {
  return p === DARK
    ? { ok: "rgba(152,195,121,0.14)", warn: "rgba(229,192,123,0.14)", err: "rgba(224,108,117,0.14)" }
    : { ok: "rgba(80,161,79,0.14)", warn: "rgba(193,132,1,0.12)", err: "rgba(228,86,73,0.12)" };
}

export function inks(p: Palette): { readonly ok: string; readonly warn: string; readonly err: string } {
  return p === DARK ? { ok: p.string, warn: p.data, err: p.error } : { ok: "#3f8a3e", warn: "#9a6700", err: "#c8443a" };
}

export function PageHeader({ title, intro }: { readonly title: string; readonly intro: string }): ReactElement {
  const { p } = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "column", paddingBottom: 20 }}>
      <div style={{ fontSize: 20, lineHeight: 28, fontWeight: 600, color: p.text }}>{title}</div>
      <div style={{ marginTop: 2, color: p.muted }}>{intro}</div>
    </div>
  );
}

export function Toggle({ on, label, onFlip }: { readonly on: boolean; readonly label: string; readonly onFlip: () => void }): ReactElement {
  const { p } = useTheme();
  return (
    <div onClick={onFlip} role="switch" aria-label={label} aria-selected={on} style={{ display: "flex", alignItems: "center", justifyContent: on ? "flex-end" : "flex-start", width: 34, height: 20, padding: 2, borderRadius: 10, flexShrink: 0, cursor: "pointer", backgroundColor: on ? p.primary : p.line3, hover: { opacity: 0.72 } }}>
      <div style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: on ? p.onPrimary : p.text3, pointerEvents: "none" }} />
    </div>
  );
}

export function Segmented({ label, options, value, onPick }: { readonly label: string; readonly options: readonly Option[]; readonly value: string; readonly onPick: (value: string) => void }): ReactElement {
  const { p } = useTheme();
  return (
    <div role="radiogroup" aria-label={label} style={{ display: "flex", padding: 2, borderRadius: 9, flexShrink: 0, backgroundColor: p.fill }}>
      {options.map((option) => {
        const on = option.value === value;
        const color = on && option.value === "Never" ? inks(p).err : on ? p.text : p.muted;
        return (
          <div key={option.value} onClick={() => onPick(option.value)} role="radio" aria-label={option.label} aria-selected={on} style={{ display: "flex", alignItems: "center", height: 26, paddingLeft: 11, paddingRight: 11, borderRadius: 7, fontSize: 12.5, whiteSpace: "nowrap", cursor: "pointer", color, hover: { opacity: 0.72 }, ...(on ? { backgroundColor: p.card, boxShadow: SHADOW } : {}) }}>{option.label}</div>
        );
      })}
    </div>
  );
}

export function Select({ label, options, value, onPick, lead = null, minWidth = 150, menuWidth = 220 }: {
  readonly label: string;
  readonly options: readonly (Option & { readonly lead?: ReactNode })[];
  readonly value: string;
  readonly onPick: (value: string) => void;
  readonly lead?: ReactNode;
  readonly minWidth?: number;
  readonly menuWidth?: number;
}): ReactElement {
  const { p } = useTheme();
  const menu = usePopover();
  const current = options.find((option) => option.value === value);
  return (
    <div style={{ display: "flex", position: "relative", flexShrink: 0 }}>
      <div onMouseDown={menu.onTriggerDown} onClick={menu.onTriggerClick} aria-label={label} style={{ display: "flex", alignItems: "center", gap: 8, minWidth, height: 30, paddingLeft: lead ? 8 : 10, paddingRight: 10, borderWidth: 1, borderColor: p.line3, borderRadius: 8, cursor: "pointer", hover: { opacity: 0.72 } }}>
        {lead}
        <div style={{ flexGrow: 1, whiteSpace: "nowrap", color: p.text }}>{current?.label ?? value}</div>
        <Icon name="disclosure" size={11} color={p.faint} />
      </div>
      {menu.open && (
        <Popover side="bottom" align={lead ? "start" : "end"} gap={6} onDismiss={menu.dismiss}>
          <MenuSurface width={menuWidth} maxHeight={420}>
            {options.map((option) => {
              const on = option.value === value;
              return (
                <div key={option.value} onClick={() => { menu.close(); onPick(option.value); }} role="option" aria-label={option.label} aria-selected={on} style={{ display: "flex", alignItems: "center", gap: 9, minHeight: 32, flexShrink: 0, paddingTop: 4, paddingBottom: 4, paddingLeft: 8, paddingRight: 8, borderRadius: 8, cursor: "pointer", hover: { opacity: 0.72 }, ...(on ? { backgroundColor: p.sel } : {}) }}>
                  {option.lead}
                  <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, pointerEvents: "none" }}>
                    <div style={{ color: p.text, whiteSpace: "nowrap" }}>{option.label}</div>
                    {option.note && <div style={{ fontSize: 11.5, color: p.muted }}>{option.note}</div>}
                  </div>
                  {on && <Icon name="check" size={13} color={p.text} />}
                </div>
              );
            })}
          </MenuSurface>
        </Popover>
      )}
    </div>
  );
}

const TRACK = 150;
const KNOB = 14;

export function Range({ label, min, max, step, value, unit, onSet }: {
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly value: number;
  readonly unit: string;
  readonly onSet: (value: number) => void;
}): ReactElement {
  const { p } = useTheme();
  const { renderer } = useGpuix();
  const box = useRef<PublicInstance | null>(null);
  const at = (event: EventPayload): void => {
    const id = box.current?.id;
    const bounds = id === undefined ? null : renderer?.getElementBounds?.(id);
    if (!bounds) return;
    const ratio = Math.min(1, Math.max(0, ((event.x ?? 0) - bounds.x - KNOB / 2) / (TRACK - KNOB)));
    const next = Math.round((min + ratio * (max - min)) / step) * step;
    if (next !== value) onSet(next);
  };
  const move = (event: EventPayload): void => {
    if (event.pressedButton === 0) at(event);
  };
  const filled = ((value - min) / (max - min)) * (TRACK - KNOB);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
      <div ref={box} onMouseDown={at} onMouseMove={move} role="slider" aria-label={label} aria-valuenow={value} style={{ position: "relative", width: TRACK, height: 20, cursor: "pointer" }}>
        <div style={{ position: "absolute", left: 0, top: 8, width: TRACK, height: 4, borderRadius: 2, backgroundColor: p.line3, pointerEvents: "none" }} />
        <div style={{ position: "absolute", left: 0, top: 8, width: filled + KNOB / 2, height: 4, borderRadius: 2, backgroundColor: p.text, pointerEvents: "none" }} />
        <div style={{ position: "absolute", left: filled, top: 3, width: KNOB, height: KNOB, borderRadius: KNOB / 2, backgroundColor: p.text, pointerEvents: "none" }} />
      </div>
      <div style={{ minWidth: 52, textAlign: "right", fontFamily: MONO, fontSize: 12, color: p.text3 }}>{`${value}${unit}`}</div>
    </div>
  );
}

export function TextInput({ label, value, placeholder, onSet }: { readonly label: string; readonly value: string; readonly placeholder: string; readonly onSet: (value: string) => void }): ReactElement {
  const { p } = useTheme();
  return (
    <div style={{ display: "flex", alignItems: "center", width: 220, height: 30, paddingLeft: 10, paddingRight: 10, borderWidth: 1, borderColor: p.line3, borderRadius: 8, flexShrink: 0 }}>
      <input {...TYPING} aria-label={label} value={value} placeholder={placeholder} onChange={(e) => onSet(e.value ?? "")} style={{ flexGrow: 1, fontFamily: MONO, fontSize: 12, color: p.text, backgroundColor: p.raised2 }} />
    </div>
  );
}

function buttonLook(style: ButtonStyle, p: Palette): { readonly border: number; readonly bg: string | null; readonly fg: string; readonly weight: number } {
  switch (style) {
    case "plain":
      return { border: 1, bg: null, fg: p.text2, weight: 400 };
    case "primary":
      return { border: 0, bg: p.primary, fg: p.onPrimary, weight: 600 };
    case "danger":
      return { border: 1, bg: null, fg: inks(p).err, weight: 500 };
    default: {
      const unhandled: never = style;
      return unhandled;
    }
  }
}

export function Button({ action }: { readonly action: Action }): ReactElement {
  const { p } = useTheme();
  const look = buttonLook(action.style, p);
  return (
    <div onClick={action.act} role="button" aria-label={action.label} style={{ display: "flex", alignItems: "center", gap: 6, height: 28, paddingLeft: 11, paddingRight: 11, borderWidth: look.border, borderColor: p.line3, borderRadius: 8, fontSize: 12.5, fontWeight: look.weight, color: look.fg, whiteSpace: "nowrap", flexShrink: 0, cursor: "pointer", hover: { opacity: 0.72 }, ...(look.bg ? { backgroundColor: look.bg } : {}) }}>{action.label}</div>
  );
}

function toneColors(tone: Tone, p: Palette): readonly [string, string] {
  const wash = washes(p);
  switch (tone) {
    case "good":
      return [wash.ok, inks(p).ok];
    case "warn":
      return [wash.warn, inks(p).warn];
    case "quiet":
      return [p.fill2, p.muted];
    default: {
      const unhandled: never = tone;
      return unhandled;
    }
  }
}

export function StatusPill({ text, tone }: { readonly text: string; readonly tone: Tone }): ReactElement {
  const { p } = useTheme();
  const [bg, fg] = toneColors(tone, p);
  return <div style={{ display: "flex", alignItems: "center", height: 22, paddingLeft: 9, paddingRight: 9, borderRadius: 11, backgroundColor: bg, color: fg, fontSize: 12, whiteSpace: "nowrap", flexShrink: 0 }}>{text}</div>;
}

function LeadView({ lead }: { readonly lead: Lead }): ReactElement {
  const { p } = useTheme();
  const box = { width: 30, height: 30, flexShrink: 0, borderRadius: 8 } as const;
  switch (lead.kind) {
    case "img":
      return <img src={p === DARK && lead.darkSrc ? lead.darkSrc : lead.src} objectFit="contain" style={box} />;
    case "agent":
      return (
        <div style={{ ...box, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: p.fill2 }}>
          <AgentLogo icon={lead.icon} size={18} />
        </div>
      );
    case "box":
      return <div style={{ ...box, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: p.fill2, color: p.text3, fontSize: 12, fontWeight: 700 }}>{lead.text}</div>;
    default: {
      const unhandled: never = lead;
      return unhandled;
    }
  }
}

function ControlView({ control, label }: { readonly control: Control; readonly label: string }): ReactElement | null {
  switch (control.kind) {
    case "none":
      return null;
    case "toggle":
      return <Toggle on={control.on} label={label} onFlip={control.flip} />;
    case "seg":
      return <Segmented label={label} options={control.options} value={control.value} onPick={control.pick} />;
    case "select":
      return <Select label={label} options={control.options} value={control.value} onPick={control.pick} />;
    case "range":
      return <Range label={label} min={control.min} max={control.max} step={control.step} value={control.value} unit={control.unit} onSet={control.set} />;
    case "input":
      return <TextInput label={label} value={control.value} placeholder={control.placeholder} onSet={control.set} />;
    default: {
      const unhandled: never = control;
      return unhandled;
    }
  }
}

function ConfirmBar({ confirm, onCancel }: { readonly confirm: Confirm; readonly onCancel: () => void }): ReactElement {
  const { p } = useTheme();
  return (
    <div role="alert" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginTop: -4, marginLeft: 18, marginRight: 18, marginBottom: 14, paddingTop: 10, paddingBottom: 10, paddingLeft: 12, paddingRight: 12, borderRadius: 10, backgroundColor: washes(p).err }}>
      <div style={{ flexGrow: 1, flexBasis: 260, color: p.text2, fontSize: 12.5 }}>{confirm.text}</div>
      <div onClick={onCancel} role="button" aria-label={t("settings.cancel")} style={{ display: "flex", alignItems: "center", height: 28, paddingLeft: 11, paddingRight: 11, borderWidth: 1, borderColor: p.line3, borderRadius: 8, fontSize: 12.5, cursor: "pointer", hover: { opacity: 0.72 } }}>{t("settings.cancel")}</div>
      <div onClick={confirm.act} role="button" aria-label={confirm.label} style={{ display: "flex", alignItems: "center", height: 28, paddingLeft: 11, paddingRight: 11, borderRadius: 8, backgroundColor: inks(p).err, color: "#ffffff", fontSize: 12.5, fontWeight: 600, cursor: "pointer", hover: { opacity: 0.72 } }}>{confirm.label}</div>
    </div>
  );
}

export function RowView({ row, first, confirming, onCancel }: { readonly row: SettingRowModel; readonly first: boolean; readonly confirming: boolean; readonly onCancel: () => void }): ReactElement {
  const { p } = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "column", opacity: row.dim ? 0.45 : 1 }}>
      {!first && <div style={{ height: 1, marginLeft: 18, marginRight: 18, backgroundColor: p.line2 }} />}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14, minHeight: 64, paddingTop: 12, paddingBottom: 12, paddingLeft: 18, paddingRight: 18 }}>
        {row.pick && (
          <div onClick={row.pick.act} role="radio" aria-label={row.title} aria-selected={row.pick.on} style={{ width: 18, height: 18, borderRadius: 9, flexShrink: 0, borderWidth: row.pick.on ? 5 : 1.5, borderColor: row.pick.on ? p.text : p.line3, cursor: "pointer", hover: { opacity: 0.72 } }} />
        )}
        {row.lead && <LeadView lead={row.lead} />}
        <div style={{ display: "flex", flexDirection: "column", gap: 2, flexGrow: 1, flexShrink: 1, flexBasis: 240, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <div style={{ color: p.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{row.title}</div>
            {row.tag && <div style={{ display: "flex", alignItems: "center", height: 18, paddingLeft: 7, paddingRight: 7, borderRadius: 9, flexShrink: 0, backgroundColor: p.fill2, color: p.text4, fontSize: 11 }}>{row.tag}</div>}
          </div>
          {row.desc !== "" && <div style={{ fontSize: 12.5, lineHeight: 18, color: p.muted, ...(row.mono ? { fontFamily: MONO } : {}) }}>{row.desc}</div>}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
          {row.status && <StatusPill text={row.status.text} tone={row.status.tone} />}
          <ControlView control={row.control} label={row.title} />
          {(row.buttons ?? []).map((action) => <Button key={action.label} action={action} />)}
        </div>
      </div>
      {confirming && row.confirm && <ConfirmBar confirm={row.confirm} onCancel={onCancel} />}
    </div>
  );
}

export function GroupLabel({ label, note = null, link = null }: { readonly label: string; readonly note?: string | null; readonly link?: { readonly text: string; readonly go: () => void } | null }): ReactElement {
  const { p } = useTheme();
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 8, paddingLeft: 4, paddingRight: 4, paddingBottom: 8 }}>
      {label !== "" && <div style={{ fontSize: 12.5, fontWeight: 500, color: p.muted }}>{label}</div>}
      {note && <div style={{ fontSize: 12, color: p.faint }}>{note}</div>}
      {link && <div onClick={link.go} role="button" aria-label={link.text} style={{ fontSize: 12, color: p.link, cursor: "pointer", hover: { opacity: 0.72 } }}>{link.text}</div>}
    </div>
  );
}

export function GroupView({ group, confirm, onCancel, preview = null, link = null }: {
  readonly group: GroupModel;
  readonly confirm: string | null;
  readonly onCancel: () => void;
  readonly preview?: ReactNode;
  readonly link?: { readonly text: string; readonly go: () => void } | null;
}): ReactElement {
  const { p } = useTheme();
  return (
    <div aria-label={group.label ?? t("settings.title")} style={{ display: "flex", flexDirection: "column", marginBottom: 26 }}>
      {(group.label || link) && <GroupLabel label={group.label ?? ""} link={link} />}
      <div style={{ display: "flex", flexDirection: "column", borderRadius: 14, backgroundColor: p.raised2 }}>
        {group.rows.map((row, ix) => (
          <RowView key={row.title} row={row} first={ix === 0} confirming={!!row.confirm && row.confirm.id === confirm} onCancel={onCancel} />
        ))}
      </div>
      {preview}
      {group.foot && !link && <div style={{ marginTop: 8, marginLeft: 4, marginRight: 4, color: p.faint, fontSize: 12 }}>{group.foot}</div>}
    </div>
  );
}

export function SettingsToast({ text }: { readonly text: string }): ReactElement {
  const { p } = useTheme();
  const shadow = { offsetX: 0, offsetY: 12, blurRadius: 30, spreadRadius: 0, color: p === DARK ? "rgba(0,0,0,0.6)" : "rgba(0,0,0,0.16)" };
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 24, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
      <div role="status" style={{ display: "flex", alignItems: "center", gap: 8, height: 36, paddingLeft: 14, paddingRight: 14, borderRadius: 10, backgroundColor: p.primary, color: p.onPrimary, whiteSpace: "nowrap", boxShadow: shadow }}>
        <Icon name="check" size={13} color={p.onPrimary} />
        <div>{text}</div>
      </div>
    </div>
  );
}
