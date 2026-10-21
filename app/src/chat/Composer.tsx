import { openSettings } from "../settings/open";
import { PERMISSION_LEVELS, type PermissionLevel, useSettings } from "../settings/store";
import { type EventPayload, type PublicInstance, useGpuix } from "@gpuix/react";
import { type ReactElement, type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import type { SessionOption } from "../agents/events";
import type { Target } from "../engine/target";
import { type PlainId, t } from "../i18n";
import { MONO, useTheme } from "../theme";
import { Chip, Icon, MenuSurface, Popover, Row, Spacer, usePopover } from "../components/ui";
import { loadSkills, skillPrompt } from "../skills/load";
import { AgentPicker } from "./AgentPicker";
import { CommandPalette, type PaletteItem } from "./CommandPalette";
import { ContextRing } from "./ContextRing";
import { MentionPicker } from "./MentionPicker";
import { indexMentions, type Mention, type MentionIndex, startedMention, withMentions } from "./mentions";
import { flipped, isSwitch, ModelChip, OptionChip } from "./OptionMenu";
import { isCommand } from "./thread";
import type { Agents } from "./useAgents";
import type { Thread } from "./useThread";
import { noteTyping } from "../lib/shortcuts";
import { useDropTarget } from "../Shell";
import { join } from "node:path";

import { cacheRoot, choosePath, clipboardFile, primaryHeld } from "../lib/platform";
import { type Attachment, attachmentFor, canAttach } from "../agents/attachments";
import { AttachmentChip } from "./Attachments";

export type ComposerPlace = "landing" | "conversation" | "dock";

const PLACEHOLDER: Readonly<Record<ComposerPlace, PlainId>> = {
  landing: "composer.placeholder.landing",
  conversation: "composer.placeholder.conversation",
  dock: "composer.placeholder.dock",
};

const NO_MENTIONS = indexMentions([]);

/** One ⌘V can reach the box twice in a row; a second paste inside this window is the same paste. */
const PASTE_GAP_MS = 500;

function RoundIcon({ icon, size, label, ring = false, onClick }: { readonly icon: string; readonly size: number; readonly label: string; readonly ring?: boolean; readonly onClick: () => void }): ReactElement {
  const { p } = useTheme();
  const box = ring ? 32 : 30;
  return (
    <div onClick={onClick} aria-label={label} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: box, height: box, borderRadius: box / 2, borderWidth: 1, borderColor: ring ? p.line2 : "transparent", flexShrink: 0, cursor: "pointer", hover: { opacity: 0.72 } }}>
      <Icon name={icon} size={size} color={p.text3} />
    </div>
  );
}

function AddRow({ icon, label, onPick }: { readonly icon: string; readonly label: string; readonly onPick: () => void }): ReactElement {
  const { p } = useTheme();
  return (
    <div onClick={onPick} role="menuitem" aria-label={label} style={{ display: "flex", alignItems: "center", gap: 8, height: 30, flexShrink: 0, paddingLeft: 8, paddingRight: 8, borderRadius: 6, fontSize: 12.5, color: p.text, cursor: "pointer", hover: { opacity: 0.72 } }}>
      <Icon name={icon} size={14} color={p.text3} />
      <div style={{ whiteSpace: "nowrap" }}>{label}</div>
    </div>
  );
}

/** One plus for everything you can bring in: the app or binary to work on, or a file for this message. */
function AddButton({ ring, onOpenFile, onAttachFile }: { readonly ring: boolean; readonly onOpenFile: () => void; readonly onAttachFile: () => void }): ReactElement {
  const { p } = useTheme();
  const menu = usePopover();
  const box = ring ? 32 : 30;
  const pick = (run: () => void): void => {
    menu.close();
    run();
  };
  return (
    <div onMouseDown={menu.onTriggerDown} style={{ display: "flex", position: "relative", flexShrink: 0 }}>
      <div onClick={menu.onTriggerClick} role="button" aria-label={t("composer.addFile")} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: box, height: box, borderRadius: box / 2, borderWidth: 1, borderColor: ring ? p.line2 : "transparent", cursor: "pointer", hover: { opacity: 0.72 }, ...(menu.open ? { backgroundColor: p.fill2 } : {}) }}>
        <Icon name="new" size={ring ? 15 : 16} color={p.text3} />
      </div>
      {menu.open && (
        <Popover side="top" align="start" onDismiss={menu.dismiss}>
          <MenuSurface width={252}>
            <AddRow icon="folder" label={t("composer.openFile")} onPick={() => pick(onOpenFile)} />
            <AddRow icon="attach" label={t("composer.attachFile")} onPick={() => pick(onAttachFile)} />
          </MenuSurface>
        </Popover>
      )}
    </div>
  );
}

function SendButton({ stopping, ready, blocked, large = false, onClick }: { readonly stopping: boolean; readonly ready: boolean; readonly blocked: boolean; readonly large?: boolean; readonly onClick: () => void }): ReactElement {
  const { p } = useTheme();
  const box = large ? 34 : 32;
  const lit = (ready || stopping) && !blocked;
  const look = large ? { backgroundColor: lit ? p.text : p.faint } : { backgroundColor: blocked ? p.faint : p.primary, opacity: lit ? 1 : 0.35 };
  return (
    <div onClick={() => !blocked && onClick()} aria-label={stopping ? t("composer.stop") : blocked ? t("composer.cantSend") : t("composer.send")} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: box, height: box, borderRadius: box / 2, flexShrink: 0, ...look, cursor: blocked ? "default" : "pointer", hover: blocked ? {} : { opacity: 0.72 } }}>
      <Icon name={stopping ? "stop" : "send"} size={stopping ? 12 : 15} color={p.onPrimary} on={stopping} />
    </div>
  );
}

function TargetPill({ target, onOpen, onRemove }: { readonly target: Target | null; readonly onOpen: () => void; readonly onRemove: () => void }): ReactElement {
  const { p } = useTheme();
  if (!target) return <Chip label={t("composer.noFile")} caret onClick={onOpen} />;
  return (
    <Row gap={6} style={{ height: 30, paddingLeft: 8, paddingRight: 6, fontSize: 12.5, color: p.text3 }}>
      <div onClick={onOpen} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", hover: { opacity: 0.72 } }}>
        <Icon name={target.kind} size={14} color={p.text3} />
        <div style={{ whiteSpace: "nowrap" }}>{target.name}</div>
        <div style={{ whiteSpace: "nowrap", color: p.faint }}>{target.meta}</div>
      </div>
      <div onClick={onRemove} aria-label={t("composer.remove", { name: target.name })} style={{ display: "flex", padding: 3, cursor: "pointer", hover: { opacity: 0.72 } }}>
        <Icon name="close" size={11} color={p.faint} />
      </div>
    </Row>
  );
}

const RUN_CODE: Readonly<Record<PermissionLevel, { readonly word: PlainId; readonly said: PlainId }>> = {
  Allow: { word: "composer.runCode.auto", said: "composer.runCode.auto.desc" },
  Ask: { word: "composer.runCode.ask", said: "composer.runCode.ask.desc" },
  Never: { word: "composer.runCode.blocked", said: "composer.runCode.blocked.desc" },
};

function RunCodeRow({ level, on, onPick }: { readonly level: PermissionLevel; readonly on: boolean; readonly onPick: () => void }): ReactElement {
  const { p } = useTheme();
  return (
    <div onClick={onPick} role="menuitemradio" aria-checked={on} style={{ display: "flex", alignItems: "center", gap: 10, height: 44, flexShrink: 0, paddingLeft: 10, paddingRight: 10, borderRadius: 7, cursor: "pointer", hover: { opacity: 0.72 }, ...(on ? { backgroundColor: p.sel } : {}) }}>
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: p.text }}>{t(RUN_CODE[level].word)}</div>
        <div style={{ fontSize: 11.5, color: p.muted }}>{t(RUN_CODE[level].said)}</div>
      </div>
      {on && <Icon name="check" size={13} color={p.text} />}
    </div>
  );
}

/** Whether the agent may run code: Ask, Auto or Blocked, saved straight to Settings → Permissions. */
function RunCodePill({ compact }: { readonly compact: boolean }): ReactElement {
  const { p } = useTheme();
  const { settings, update } = useSettings();
  const menu = usePopover();
  const level = settings.permissions.shell;
  const pick = (next: PermissionLevel): void => {
    menu.close();
    update({ permissions: { ...settings.permissions, shell: next } });
  };
  const ring = compact ? {} : { paddingLeft: 12, paddingRight: 12, borderWidth: 1, borderColor: p.line2 };
  return (
    <div onMouseDown={menu.onTriggerDown} style={{ display: "flex", position: "relative", flexShrink: 0 }}>
      <div onClick={menu.onTriggerClick} role="button" aria-label={t("composer.runCode.change", { said: t(RUN_CODE[level].said) })} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, height: compact ? 30 : 32, minWidth: compact ? 30 : 0, borderRadius: 16, fontSize: 12.5, color: p.text3, cursor: "pointer", hover: { opacity: 0.72 }, ...ring, ...(menu.open ? { backgroundColor: p.fill2 } : {}) }}>
        <Icon name="asks" size={14} color={p.text3} />
        {!compact && <div style={{ whiteSpace: "nowrap" }}>{t(RUN_CODE[level].word)}</div>}
      </div>
      {menu.open && (
        <Popover side="top" align="start" onDismiss={menu.dismiss}>
          <MenuSurface width={240}>
            <div style={{ paddingTop: 4, paddingLeft: 10, paddingBottom: 6, fontSize: 11.5, color: p.muted }}>{t("composer.runCode")}</div>
            {PERMISSION_LEVELS.map((option) => <RunCodeRow key={option} level={option} on={option === level} onPick={() => pick(option)} />)}
            <div onClick={() => { menu.close(); openSettings("permissions"); }} role="button" style={{ display: "flex", alignItems: "center", height: 32, marginTop: 4, paddingLeft: 10, fontSize: 12.5, color: p.muted, cursor: "pointer", hover: { opacity: 0.72 } }}>{t("composer.allPermissions")}</div>
          </MenuSurface>
        </Popover>
      )}
    </div>
  );
}

function Settings({ thread, pill, compact }: { readonly thread: Thread; readonly pill: boolean; readonly compact: boolean }): ReactElement {
  const options = thread.state.options.filter((option) => !isSwitch(option));
  const pick = (option: SessionOption, value: string): void => thread.setOption(option, value);
  const mode = options.find((option) => option.category === "mode") ?? null;
  const model = options.find((option) => option.category === "model") ?? null;
  const effort = options.find((option) => option.category === "thought_level") ?? null;
  const others = options.filter((option) => option.category === "other");
  return (
    <Row gap={2} style={{ flexShrink: 1, minWidth: 0, overflow: "hidden" }}>
      {mode ? <OptionChip option={mode} disabled={false} onPick={(value) => pick(mode, value)} /> : !pill && <RunCodePill compact={compact} />}
      <ModelChip model={model} effort={effort} onPick={pick} />
      {others.map((option) => (
        <OptionChip key={option.id} option={option} disabled={false} onPick={(value) => pick(option, value)} />
      ))}
    </Row>
  );
}

/** The prompt: the file and agent above, then the draft with mode, model, memory use and send, the / palette and the @ picker. */
export function Composer({ place, target, agents, thread, onAttach, onDetach, onPickAgent, mention = null, mentions = NO_MENTIONS, slot = null, seed = null, queued = false, blocked = false, hint = null }: {
  readonly place: ComposerPlace;
  /** Replaces the place's usual placeholder, for files that aren't code. */
  readonly hint?: string | null;
  /** The function in focus, sent along as @name unless you remove it. */
  readonly mention?: string | null;
  /** What @ can point at in the open file. */
  readonly mentions?: MentionIndex;
  readonly slot?: ReactNode;
  readonly seed?: { readonly text: string } | null;
  readonly queued?: boolean;
  readonly blocked?: boolean;
  readonly target: Target | null;
  readonly agents: Agents;
  readonly thread: Thread;
  readonly onAttach: () => void;
  readonly onDetach: () => void;
  readonly onPickAgent: (id: string) => void;
}): ReactElement {
  const { p } = useTheme();
  const drop = useDropTarget();
  const [draft, setDraft] = useState(seed?.text ?? "");
  useEffect(() => {
    if (seed) setDraft(seed.text);
  }, [seed]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mentioning, setMentioning] = useState(false);
  const [picked, setPicked] = useState<readonly Mention[]>([]);
  const [files, setFiles] = useState<readonly Attachment[]>([]);
  const lastPaste = useRef(0);
  const box = useRef<PublicInstance>(null);
  const { renderer } = useGpuix();
  const refocus = (): void => queueMicrotask(() => {
    if (box.current) renderer?.focusElement?.(box.current.id);
  });
  const [dropped, setDropped] = useState<string | null>(null);
  const about = mention && mention !== dropped ? mention : null;
  const skills = useMemo(loadSkills, []);
  const fileOnly = place === "landing" && target !== null && draft.trim().length === 0;
  const typed = draft.trim().length > 0 || fileOnly || files.length > 0;
  const addFiles = (added: readonly Attachment[]): void => {
    setFiles((current) => [...current, ...added.filter((file) => !current.some((have) => have.path === file.path))]);
  };
  const attachFile = async (): Promise<void> => {
    const path = await choosePath("file", t("composer.attachPrompt"));
    if (path) addFiles([await attachmentFor(path)]);
    refocus();
  };
  const pasteFile = async (): Promise<void> => {
    const now = Date.now();
    if (now - lastPaste.current < PASTE_GAP_MS) return;
    lastPaste.current = now;
    const path = await clipboardFile(join(cacheRoot(), "pasted"));
    if (path) addFiles([await attachmentFor(path)]);
  };
  const onFileDrop = async (event: EventPayload): Promise<void> => {
    const paths = (event.paths ?? []).filter(canAttach);
    if (paths.length === 0) {
      drop.onFileDrop?.(event);
      return;
    }
    addFiles(await Promise.all(paths.map(attachmentFor)));
  };
  const dropHere = { onFileDrop: (event: EventPayload) => void onFileDrop(event) };
  const stopping = thread.busy && !typed;
  const commandReturn = useSettings().settings.sendKey === "Command Return";
  const submit = (): void => {
    if (!typed || blocked) return;
    const text = fileOnly && target ? t("landing.binary", { name: target.name }) : draft.trim() || t("composer.lookAtThis");
    thread.send(withMentions(about && !isCommand(text) ? `@${about} ${text}` : text, picked), files);
    setDraft("");
    setPicked([]);
    setFiles([]);
  };
  const onChange = (text: string): void => {
    const before = startedMention(draft, text);
    if (before !== null) {
      setDraft(before);
      setPaletteOpen(false);
      setMentioning(true);
      return;
    }
    if (text === "/") {
      setDraft("");
      setPaletteOpen(true);
      return;
    }
    setDraft(text);
  };
  const onKeyDown = (event: EventPayload): void => {
    noteTyping(event);
    if (event.key === "escape" && thread.busy) thread.stop();
    if (event.key?.toLowerCase() === "v" && primaryHeld(event.modifiers)) void pasteFile();
    if (commandReturn && event.key === "enter" && primaryHeld(event.modifiers)) submit();
  };
  const pick = (item: PaletteItem): void => {
    switch (item.kind) {
      case "mode":
        thread.setOption(item.option, item.choice.value);
        break;
      case "skill":
        thread.send(skillPrompt(item.skill, draft));
        setDraft("");
        break;
      case "command":
        setDraft(`/${item.command.name} `);
        break;
      case "switch":
        thread.setOption(item.option, flipped(item.option));
        return;
      case "attach":
        onAttach();
        break;
      default: {
        const unhandled: never = item;
        return unhandled;
      }
    }
    setPaletteOpen(false);
  };
  const pickMention = (item: Mention): void => {
    setDraft(`${draft}@${item.label} `);
    setPicked([...picked, item]);
    setMentioning(false);
    refocus();
  };
  const closeMention = (typed: string): void => {
    setDraft(`${draft}${typed}`);
    setMentioning(false);
    refocus();
  };
  const attachFromMention = (): void => {
    setMentioning(false);
    onAttach();
  };
  const picker = mentioning && <MentionPicker mentions={mentions} onPick={pickMention} onClose={closeMention} onAttach={attachFromMention} />;
  const palette = paletteOpen && (
    <CommandPalette options={thread.state.options} commands={thread.state.commands} skills={skills} onPick={pick} onClose={() => setPaletteOpen(false)} />
  );
  const landing = place === "landing";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%", maxWidth: place === "landing" ? 700 : 680 }}>
      {place === "conversation" && (
        <Row gap={4} style={{ paddingLeft: 6 }}>
          <TargetPill target={target} onOpen={onAttach} onRemove={onDetach} />
        </Row>
      )}
      {place !== "landing" && palette}
      {place !== "landing" && picker}
      <div {...dropHere} style={{ display: "flex", flexDirection: "column", borderWidth: 1, borderColor: queued ? p.link : thread.busy || (landing && target) ? p.line3 : p.sel, borderRadius: 20, backgroundColor: p.win }}>
        {slot}
        {landing && target && (
          <Row gap={8} style={{ paddingTop: 12, paddingLeft: 14, paddingRight: 14 }}>
            <Row gap={8} style={{ height: 30, paddingLeft: 10, paddingRight: 10, borderRadius: 9, backgroundColor: p.fill2 }}>
              <Icon name={target.kind} size={16} color={p.muted} />
              <div style={{ whiteSpace: "nowrap", color: p.text }}>{target.name}</div>
              <div style={{ whiteSpace: "nowrap", fontSize: 12, color: p.muted }}>{target.meta}</div>
              <div onClick={onDetach} role="button" aria-label={t("composer.remove", { name: target.name })} style={{ display: "flex", cursor: "pointer", hover: { opacity: 0.72 } }}>
                <Icon name="close" size={11} color={p.muted} />
              </div>
            </Row>
          </Row>
        )}
        {about && (
          <Row gap={6} style={{ paddingTop: 10, paddingLeft: 14, paddingRight: 14 }}>
            <div onClick={() => setDropped(about)} role="button" aria-label={t("composer.stopAsking", { name: about })} style={{ display: "flex", alignItems: "center", gap: 6, height: 24, paddingLeft: 8, paddingRight: 8, borderRadius: 6, backgroundColor: p.fill2, cursor: "pointer", hover: { opacity: 0.72 } }}>
              <Icon name="function" size={12} color={p.call} />
              <div style={{ fontSize: 11.5, color: p.text3, whiteSpace: "nowrap", fontFamily: MONO }}>{about}</div>
              <Icon name="close" size={8} color={p.faint} />
            </div>
          </Row>
        )}
        {files.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, paddingTop: 10, paddingLeft: 14, paddingRight: 14 }}>
            {files.map((file) => <AttachmentChip key={file.path} file={file} onRemove={() => setFiles(files.filter((have) => have.path !== file.path))} />)}
          </div>
        )}
        <textarea
          {...dropHere}
          ref={box}
          autoFocus
          aria-label={t("composer.message")}
          value={draft}
          minRows={place === "landing" ? 3 : 1}
          maxRows={12}
          placeholder={thread.busy ? t("composer.queue") : about ? t("composer.aboutFunction") : (hint ?? t(PLACEHOLDER[place]))}
          onChange={(e) => onChange(e.value ?? "")}
          onKeyDown={onKeyDown}
          {...(commandReturn ? {} : { onSubmit: submit })}
          style={{ paddingTop: 14, paddingLeft: 16, paddingRight: 16, paddingBottom: 6, fontSize: place === "landing" ? 15 : 14, color: p.text, backgroundColor: p.win, borderTopLeftRadius: 19, borderTopRightRadius: 19 }}
        />
        <Row gap={landing ? 8 : 4} style={landing ? { paddingTop: 6, paddingLeft: 10, paddingRight: 10, paddingBottom: 10 } : { paddingTop: 4, paddingLeft: 8, paddingRight: 8, paddingBottom: 8 }}>
          <AddButton ring={landing} onOpenFile={onAttach} onAttachFile={() => void attachFile()} />
          <RoundIcon icon="slash" size={15} label={t("composer.palette")} onClick={() => setPaletteOpen(true)} />
          {landing && !thread.state.options.some((option) => option.category === "mode") && <RunCodePill compact={false} />}
          <Settings thread={thread} pill={landing} compact={place === "dock"} />
          <Spacer />
          {thread.state.usage && <ContextRing usage={thread.state.usage} />}
          <AgentPicker agents={agents} locked={thread.busy} compact={false} onPick={onPickAgent} />
          <SendButton stopping={stopping} ready={typed} blocked={blocked && !stopping} large={landing} onClick={stopping ? thread.stop : submit} />
        </Row>
      </div>
      {place === "landing" && palette}
      {place === "landing" && picker}
    </div>
  );
}
