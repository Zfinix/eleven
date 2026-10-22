import { type ReactElement, type ReactNode, useState } from "react";

import { toolLabel } from "../agents/describe";
import type { PlanItem } from "../agents/events";
import { Tooltip } from "../components/kit";
import { type PlainId, t } from "../i18n";
import { seconds, useNow } from "../lib/useNow";
import { scrollbar, useTheme } from "../theme";
import { Icon, Row, Spacer } from "../components/ui";
import { MessageRow, useRowActions } from "./MessageRow";
import type { Draft, Message, ThreadState } from "./thread";
import type { Thread } from "./useThread";

const VERBS: readonly [PlainId, ...PlainId[]] = ["chat.verb.takingApart", "chat.verb.reading", "chat.verb.tracing", "chat.verb.following", "chat.verb.untangling", "chat.verb.decompiling"];
const VERB_MS = 2400;
const SHIMMER_MS = 1800;
const SHIMMER_CHAR_PX = 7.5;
const SHIMMER_LAYERS = [{ width: 56, opacity: 0.25 }, { width: 32, opacity: 0.35 }, { width: 14, opacity: 0.5 }] as const;

export function Shimmer({ text, color, now }: { readonly text: string; readonly color: string; readonly now: number }): ReactElement {
  const widest = SHIMMER_LAYERS[0].width;
  const travel = text.length * SHIMMER_CHAR_PX + widest;
  const center = ((now % SHIMMER_MS) / SHIMMER_MS) * travel - widest / 2;
  return (
    <div style={{ position: "relative", display: "flex", whiteSpace: "nowrap", color }}>
      <div style={{ opacity: 0.5 }}>{text}</div>
      {SHIMMER_LAYERS.map((layer) => {
        const left = center - layer.width / 2;
        return (
          <div key={layer.width} style={{ position: "absolute", top: 0, bottom: 0, left, width: layer.width, overflow: "hidden", opacity: layer.opacity, pointerEvents: "none" }}>
            <div style={{ position: "absolute", top: 0, left: -left, whiteSpace: "nowrap" }}>{text}</div>
          </div>
        );
      })}
    </div>
  );
}

function Centered({ children, top = 0, bottom = 16 }: { readonly children: ReactNode; readonly top?: number; readonly bottom?: number }): ReactElement {
  return (
    <div style={{ display: "flex", justifyContent: "center", width: "100%", paddingLeft: 20, paddingRight: 20, paddingTop: top, paddingBottom: bottom }}>
      <div style={{ display: "flex", flexDirection: "column", width: "100%", maxWidth: 680 }}>{children}</div>
    </div>
  );
}

export function runningTool(messages: readonly Message[]): string | null {
  const last = messages[messages.length - 1];
  if (last?.kind !== "agent") return null;
  const step = [...last.blocks].reverse().find((block) => block.kind === "tool" && block.step.status === "running");
  return step?.kind === "tool" ? toolLabel(step.step.tool, step.step.input, step.step.summary).label : null;
}

export function Working({ since, tool }: { readonly since: number; readonly tool: string | null }): ReactElement {
  const { p } = useTheme();
  const now = useNow(true, 33);
  const pulse = Math.floor(now / 600) % 2 === 0;
  const verb = tool ?? t(VERBS[Math.floor((now - since) / VERB_MS) % VERBS.length] ?? VERBS[0]);
  return (
    <Row gap={9} style={{ height: 24 }}>
      <div style={{ display: "flex", opacity: pulse ? 1 : 0.45 }}>
        <Icon name="spark" size={14} color={p.data} />
      </div>
      <Shimmer text={`${verb}…`} color={p.text} now={now} />
      <div style={{ fontSize: 12, color: p.faint }}>{t("chat.escToStop", { time: seconds(now - since) })}</div>
    </Row>
  );
}

function planIcon(item: PlanItem): string {
  if (item.status === "completed") return "check";
  return item.status === "in_progress" ? "circle-on" : "circle";
}

function PlanPanel({ items }: { readonly items: readonly PlanItem[] }): ReactElement {
  const { p } = useTheme();
  const [open, setOpen] = useState(true);
  const done = items.filter((item) => item.status === "completed").length;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8, paddingTop: 8, paddingBottom: 8, paddingLeft: 12, paddingRight: 12, borderWidth: 1, borderColor: p.line2, borderRadius: 14, backgroundColor: p.raised }}>
      <Row gap={8} style={{ cursor: "pointer", hover: { opacity: 0.72 } }}>
        <div onClick={() => setOpen(!open)} style={{ display: "flex", alignItems: "center", gap: 8, flexGrow: 1 }}>
          <Icon name="plan" size={14} color={p.text3} />
          <div style={{ fontSize: 12.5, color: p.text3 }}>{t("chat.plan", { done, count: items.length })}</div>
          <Spacer />
          <Icon name={open ? "disclosure" : "forward"} size={11} color={p.faint} />
        </div>
      </Row>
      {open && items.map((item, ix) => (
        <Row key={`${ix}-${item.content}`} gap={8} style={{ fontSize: 12.5, paddingLeft: 2 }}>
          <Icon name={planIcon(item)} size={13} color={item.status === "in_progress" ? p.data : p.muted} />
          <div style={{ color: item.status === "completed" ? p.faint : p.text2, ...(item.status === "completed" ? { textDecoration: "line-through" as const } : {}) }}>{item.content}</div>
        </Row>
      ))}
    </div>
  );
}

export function QueuePanel({ queue, onRemove }: { readonly queue: readonly Draft[]; readonly onRemove: (index: number) => void }): ReactElement {
  const { p } = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, marginBottom: 8, paddingTop: 8, paddingBottom: 6, paddingLeft: 12, paddingRight: 8, borderWidth: 1, borderColor: p.line2, borderRadius: 14, backgroundColor: p.raised }}>
      <Row gap={8} style={{ fontSize: 12, color: p.muted, marginBottom: 2 }}>
        <Icon name="clock" size={13} />
        <div>{t("chat.queued", { count: queue.length })}</div>
      </Row>
      {queue.map((draft, ix) => (
        <Row key={`${ix}-${draft.text}`} gap={8} style={{ height: 24, fontSize: 12.5 }}>
          <div style={{ flexGrow: 1, minWidth: 0, color: p.text2, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}>{draft.text}</div>
          {draft.attachments.length > 0 && <div style={{ flexShrink: 0, color: p.muted }}>{draft.attachments.length === 1 ? t("chat.oneFile") : t("chat.files", { count: draft.attachments.length })}</div>}
          <div onClick={() => onRemove(ix)} aria-label={t("chat.removeFromQueue")} style={{ display: "flex", padding: 4, cursor: "pointer", hover: { opacity: 0.72 } }}>
            <Icon name="close" size={11} />
          </div>
        </Row>
      ))}
    </div>
  );
}

function Header({ state, title, agentName, onWorkbench }: { readonly state: ThreadState; readonly title: string; readonly agentName: string; readonly onWorkbench: (() => void) | null }): ReactElement {
  const { p } = useTheme();
  const status = state.agent.kind === "starting" ? t("chat.starting", { name: agentName }) : agentName;
  return (
    <Row gap={8} style={{ height: 44, flexShrink: 0, paddingLeft: 16, paddingRight: 14, borderBottomWidth: 1, borderColor: p.fill }}>
      <div style={{ flexShrink: 1, minWidth: 0, fontWeight: 500, color: p.text, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}>{title}</div>
      <div style={{ flexShrink: 0, color: p.muted, whiteSpace: "nowrap" }}>{`· ${status}`}</div>
      <Spacer />
      {onWorkbench && (
        <Tooltip label={t("chat.backToCode")}>
          <div onClick={onWorkbench} role="button" style={{ display: "flex", alignItems: "center", gap: 6, height: 28, flexShrink: 0, paddingLeft: 10, paddingRight: 10, borderWidth: 1, borderColor: p.sel, borderRadius: 8, color: p.text3, fontSize: 12.5, cursor: "pointer", hover: { opacity: 0.72 } }}>
            <Icon name="expand" size={13} color={p.text3} />
            <div>{t("canvas.workbench")}</div>
          </div>
        </Tooltip>
      )}
    </Row>
  );
}

/** The chat column: header, the turn-by-turn timeline, and the docked composer. */
export function Conversation({ thread, title, agentName, composer, onWorkbench }: {
  readonly thread: Thread;
  readonly title: string;
  readonly agentName: string;
  readonly composer: ReactNode;
  readonly onWorkbench: (() => void) | null;
}): ReactElement {
  const { p } = useTheme();
  const { state } = thread;
  const shownAgent = state.agent.kind === "working" || state.agent.kind === "ready" ? state.agent.name || agentName : agentName;
  const actions = useRowActions({ onAnswer: thread.answer, onRetry: thread.retry, onOpen: thread.openFunction, onOpenText: thread.openText });
  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, flexBasis: 440, minWidth: 0 }}>
      <Header state={state} title={title} agentName={shownAgent} onWorkbench={onWorkbench} />
      <virtual-list followTail alignment="top" estimatedItemHeight={80} style={{ ...scrollbar(p), flexGrow: 1, minHeight: 0 }}>
        {state.messages.map((message, ix) => (
          <Centered key={ix} top={ix === 0 ? 22 : 0}>
            <MessageRow message={message} index={ix} agentName={shownAgent} last={ix === state.messages.length - 1} actions={actions} />
          </Centered>
        ))}
        {state.agent.kind === "working" && (
          <Centered key="working" bottom={24}>
            <Working since={state.agent.since} tool={runningTool(state.messages)} />
          </Centered>
        )}
      </virtual-list>
      <Centered bottom={14}>
        {state.plan.length > 0 && <PlanPanel items={state.plan} />}
        {state.queue.length > 0 && <QueuePanel queue={state.queue} onRemove={thread.unqueue} />}
        {composer}
      </Centered>
    </div>
  );
}
