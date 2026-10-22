import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { useEffect, useReducer, useRef, useState } from "react";

import type { NativeCommand } from "../agents/detect";
import type { Attachment } from "../agents/attachments";
import type { AgentEvent, PermissionChoice, SessionOption } from "../agents/events";
import { type GoalControl, goalControl } from "../agents/goals";
import type { AgentEntry } from "../agents/registry";
import { rememberPick, savedPicks } from "../agents/picks";
import { AgentSession } from "../agents/session";
import { hidePaths } from "../bridge/privacy";
import { t } from "../i18n";
import { currentSettings, type Settings } from "../settings/store";
import { errorMessage, stringField } from "../lib/guards";
import { entryProcedure, loadProcedures } from "../engine/procedures";
import { projectId } from "../engine/project";
import { type Opened, rea } from "../engine/rea";
import { DALVIK, openJadx } from "../engine/jadx";
import { rizinDisassembly, rizinEntry, rizinFunctions, rizinPseudocode } from "../engine/rizin";
import { androidHint, engineHint } from "../analysis/hint";
import { activeBackend } from "../analysis/engines";
import { prepareTarget, type Target } from "../engine/target";
import { type SavedThread, saveThread } from "./history";
import { agentName, type Draft, EMPTY_THREAD, isBusy, isCommand, type Message, threadReducer, type ThreadState } from "./thread";
import { useStreamBuffer } from "./streamBuffer";
import { useChatMoments } from "../notify/useChatMoments";
import { shownText } from "../skills/load";
import { copyToClipboard, THIS_DEVICE } from "../lib/platform";

export type Thread = {
  readonly id: string;
  readonly state: ThreadState;
  readonly busy: boolean;
  readonly send: (text: string, attachments?: readonly Attachment[]) => void;
  readonly stop: () => void;
  readonly unqueue: (index: number) => void;
  readonly retry: () => void;
  readonly answer: (index: number, permissionId: number, choice: PermissionChoice | null) => void;
  readonly setOption: (option: SessionOption, value: string) => void;
  readonly reset: () => void;
  readonly restore: (saved: SavedThread) => void;
  readonly selectTab: (index: number) => void;
  readonly closeCanvas: () => void;
  readonly openFunction: (procedure: string) => void;
  readonly openText: (title: string, text: string) => void;
  readonly note: (text: string) => void;
};

const PAST_MESSAGES: Readonly<Record<Settings["chatHistory"], number>> = { Short: 10, Normal: 20, Long: 50 };
const PAST_CHARS = 1500;

function opening(target: Target | null): readonly string[] {
  if (!target) {
    return [
      "You are working inside Eleven, a reverse-engineering app. No file is open yet.",
      `When the user names a binary or app to study: ${engineHint("<that path>", "")}`,
      `If it is an Android app (an APK or .dex): ${androidHint("<that path>")}`,
    ];
  }
  if (target.kind === "gpu") {
    return [
      `You are working inside Eleven, a reverse-engineering app. The user opened the GPU code file ${target.original}.`,
      "It holds shaders or kernels, not a program, so don't open it with open_binary. Eleven already lists its kernels in the workbench with their registers, memory, parameters and code (PTX for CUDA, metadata for HIP). Read the file's bytes yourself only if you need more than that.",
    ];
  }
  if (target.kind === "model") {
    return [
      `You are working inside Eleven, a reverse-engineering app. The user opened the model file ${target.original}.`,
      "It holds weights, not a program, so don't open it with open_binary. Eleven already shows its header, tensors and load risks in the model panel next to this chat. Read the file's bytes yourself only if you need more than that.",
    ];
  }
  const slice = target.path === target.original ? "" : ` (analyze ${target.path}, the ${target.arch} slice)`;
  return [
    `You are working inside Eleven, a reverse-engineering app. The user opened ${target.original}${slice}.`,
    engineHint(target.path, target.arch),
  ];
}

function transcript(messages: readonly Message[]): readonly string[] {
  const lines = messages.slice(-PAST_MESSAGES[currentSettings().chatHistory]).flatMap((message) => {
    if (message.kind === "user") return [`User: ${message.text.slice(0, PAST_CHARS)}`];
    if (message.kind !== "agent") return [];
    const said = message.blocks.flatMap((block) => (block.kind === "text" ? [block.text] : [])).join("").trim();
    return said ? [`You: ${said.slice(0, PAST_CHARS)}`] : [];
  });
  return lines.length > 0 ? ["", "This continues an earlier conversation:", ...lines.map((line) => hidePaths(line))] : [];
}

function firstPrompt(target: Target | null, past: readonly Message[], text: string): string {
  return [
    ...opening(target),
    `Only use Eleven's tools (eleven and eleven-rea). Never use your own built-in reverse-engineering tools or other disassemblers such as Hopper, IDA or a separate Ghidra, even if one is installed. eleven-rea runs Ghidra on ${THIS_DEVICE}.`,
    "When you study a function, read it with procedure_pseudo_code so it appears in Eleven's code panel.",
    "Answer plainly and briefly, in markdown. Put any code, disassembly, addresses or symbol names in fenced code blocks or inline `code` so they read in the code font.",
    ...transcript(past),
    "",
    text,
  ].join("\n");
}

/** Agents name a tool on its first update and send its input later, so names are remembered by step id. */
function openedPath(event: AgentEvent, tools: Map<string, string>): string | null {
  if (event.kind !== "step") return null;
  if (event.tool) tools.set(event.id, event.tool);
  const path = stringField(event.input, "path");
  const opens = (tools.get(event.id) ?? "").includes("open_binary") || stringField(event.input, "provider_id") !== undefined;
  return path && opens ? path : null;
}

/** The file as REA's caches know it, by its fingerprint; REA only opens it (in Ghidra) when something isn't cached yet. */
function openedFor(target: Target): Opened {
  return { path: target.path, sha256: projectId(target), format: "", architecture: target.arch };
}

async function entryName(target: Target, opened: { current: Opened | null }): Promise<string | null> {
  if (target.arch === DALVIK) return null;
  if (activeBackend() === "rizin") return rizinEntry(await rizinFunctions(target.path))?.name ?? null;
  opened.current ??= openedFor(target);
  return entryProcedure(await loadProcedures(target.path, opened.current.sha256))?.name ?? null;
}

async function rizinCode(path: string, procedure: string): Promise<string> {
  const fn = (await rizinFunctions(path)).find((candidate) => candidate.name === procedure);
  if (!fn) throw new Error(t("chat.noFunction", { name: procedure }));
  try {
    return await rizinPseudocode(path, fn.addr);
  } catch {
    return rizinDisassembly(path, fn.addr);
  }
}

async function jadxCode(target: Target, procedure: string): Promise<string> {
  const app = await openJadx(target.path, projectId(target));
  const fn = app.functions.find((candidate) => candidate.name === procedure);
  if (!fn) throw new Error(t("chat.noMethod", { name: procedure }));
  return app.code(fn.addr, "pseudo");
}

async function loadCode(target: Target, opened: { current: Opened | null }, procedure: string): Promise<string> {
  if (target.arch === DALVIK) return jadxCode(target, procedure);
  if (activeBackend() === "rizin") return rizinCode(target.path, procedure);
  opened.current ??= openedFor(target);
  return rea.code(opened.current, procedure, "pseudocode");
}

function projectOf(target: Target | null): string | null {
  if (!target) return null;
  try {
    return projectId(target);
  } catch {
    return null;
  }
}

export function copyText(text: string): void {
  void copyToClipboard(text);
}

/** One conversation with one agent about one target, plus the code canvas it drives. Only a `live` thread runs an agent. */
export function useThread(agent: AgentEntry, native: NativeCommand | null, target: Target | null, onTarget: (target: Target) => void, live = true): Thread {
  const [state, dispatch] = useReducer(threadReducer, EMPTY_THREAD);
  const [id, setId] = useState<string>(() => randomUUID());
  const session = useRef<AgentSession | null>(null);
  const opened = useRef<Opened | null>(null);
  const requested = useRef(new Set<string>());
  const prompted = useRef(false);
  const adopted = useRef<{ readonly from: string; readonly path: string } | null>(null);
  const tools = useRef(new Map<string, string>());
  const latest = useRef({ target, onTarget });
  latest.current = { target, onTarget };

  const adopt = (path: string): void => {
    const current = latest.current.target;
    if (adopted.current?.from === path || current?.path === path || current?.original === path) return;
    try {
      const next = prepareTarget(path);
      adopted.current = { from: path, path: next.path };
      latest.current.onTarget(next);
    } catch (err) {
      dispatch({ type: "note", text: t("chat.note.cantShow", { path, error: errorMessage(err) }), tone: "info" });
    }
  };

  const stream = useStreamBuffer((event, at) => dispatch({ type: "event", event, at }));

  const onEvent = (event: AgentEvent): void => {
    moments.heard(event);
    stream.push(event);
    const path = openedPath(event, tools.current);
    if (path) adopt(path);
  };

  const ensureSession = (): AgentSession => {
    if (session.current) return session.current;
    const cwd = target ? dirname(target.path) : process.env.HOME ?? "/";
    session.current = new AgentSession(agent, native, cwd, onEvent, id, projectOf(target), target?.path ?? null);
    session.current.restore(savedPicks(agent.id));
    dispatch({ type: "starting" });
    return session.current;
  };

  const stopSession = (): void => {
    stream.flush();
    session.current?.stop();
    session.current = null;
    prompted.current = false;
  };

  useEffect(() => stopSession, []);

  useEffect(() => {
    if (!live) stopSession();
  }, [live]);

  useEffect(() => {
    dispatch({ type: "switchAgent" });
  }, [agent.id, native?.path]);

  useEffect(() => {
    opened.current = null;
    requested.current.clear();
    dispatch({ type: "retarget" });
    const agentOpenedIt = target !== null && target.path === adopted.current?.path;
    adopted.current = null;
    if (agentOpenedIt) return;
    stopSession();
    if (live && (target === null || currentSettings().startAgentWithProject)) ensureSession();
  }, [agent.id, native?.path, target?.path]);

  useEffect(() => {
    const first = state.messages.find((message) => message.kind === "user");
    if (!live || first?.kind !== "user") return;
    saveThread({ id, title: shownText(first.text).split("\n")[0] ?? "", target: target?.original ?? null, project: target ? projectId(target) : null, messages: state.messages, updatedAt: Date.now() });
  }, [id, state.messages.length, state.agent.kind, target?.original, live]);

  useEffect(() => {
    if (!target) return;
    for (const tab of state.tabs) {
      if (tab.code.kind !== "loading" || requested.current.has(tab.procedure)) continue;
      requested.current.add(tab.procedure);
      const fetchCode = async (): Promise<void> => {
        try {
          dispatch({ type: "codeLoaded", procedure: tab.procedure, code: { kind: "ready", text: await loadCode(target, opened, tab.procedure) } });
        } catch (err) {
          dispatch({ type: "codeLoaded", procedure: tab.procedure, code: { kind: "failed", message: errorMessage(err) } });
        }
      };
      void fetchCode();
    }
  }, [state.tabs, target]);

  const openEntry = async (opening: Target): Promise<void> => {
    try {
      const name = await entryName(opening, opened);
      if (name) dispatch({ type: "openTab", procedure: name });
    } catch (err) {
      dispatch({ type: "note", text: t("chat.note.codeViewFailed", { name: opening.name, error: errorMessage(err) }), tone: "info" });
    }
  };

  const deliver = (draft: Draft): void => {
    const live = ensureSession();
    if (target && (target.kind === "binary" || target.kind === "app") && !prompted.current) void openEntry(target);
    const command = isCommand(draft.text);
    const prompt = prompted.current || command ? draft.text : firstPrompt(target, state.messages, draft.text);
    if (!command) prompted.current = true;
    dispatch({ type: "sent", draft, at: Date.now() });
    void live.prompt(prompt, draft.attachments);
  };

  useEffect(() => {
    const next = state.queue[0];
    if (next === undefined || isBusy(state)) return;
    dispatch({ type: "dequeued" });
    deliver(next);
  }, [state.queue, state.agent.kind]);

  const controlGoal = async (live: AgentSession, action: GoalControl): Promise<void> => {
    try {
      await live.controlGoal(action);
      dispatch({ type: "note", text: action === "pause" ? t("chat.note.goalPaused") : t("chat.note.goalCleared"), tone: "info" });
    } catch (err) {
      dispatch({ type: "note", text: action === "pause" ? t("chat.note.pauseFailed", { error: errorMessage(err) }) : t("chat.note.clearFailed", { error: errorMessage(err) }), tone: "error" });
    }
  };

  const send = (text: string, attachments: readonly Attachment[] = []): void => {
    const clean = text.trim();
    if (!clean) return;
    const control = goalControl(agent.id, clean);
    if (control && session.current && isBusy(state)) return void controlGoal(session.current, control);
    const draft: Draft = { text: clean, attachments };
    if (isBusy(state)) return dispatch({ type: "queued", draft });
    deliver(draft);
  };

  const answer = (index: number, permissionId: number, choice: PermissionChoice | null): void => {
    session.current?.answer(permissionId, choice?.id ?? null);
    dispatch({ type: "answered", index, label: choice?.label ?? "Not allowed" });
    moments.answered(permissionId);
  };
  const moments = useChatMoments(state, { id, live, project: target?.name ?? null, agent: agentName(state.agent) ?? agent.name, answer });

  const lastUser = (): Draft | null => {
    const users = state.messages.filter((m) => m.kind === "user");
    const last = users[users.length - 1];
    return last?.kind === "user" ? { text: last.text, attachments: last.attachments ?? [] } : null;
  };

  return {
    id,
    state,
    busy: isBusy(state),
    send,
    stop: () => void session.current?.cancel(),
    unqueue: (index) => dispatch({ type: "unqueued", index }),
    retry: () => {
      const last = lastUser();
      if (last) send(last.text, last.attachments);
    },
    answer,
    setOption: (option, value) => {
      rememberPick(agent.id, option.id, value);
      void ensureSession().setOption(option, value);
    },
    reset: () => {
      stopSession();
      requested.current.clear();
      setId(randomUUID());
      dispatch({ type: "reset" });
      ensureSession();
    },
    restore: (saved) => {
      stopSession();
      requested.current.clear();
      setId(saved.id);
      dispatch({ type: "restore", messages: saved.messages });
      ensureSession();
    },
    selectTab: (index) => dispatch({ type: "selectTab", index }),
    closeCanvas: () => dispatch({ type: "closeCanvas" }),
    openFunction: (procedure) => dispatch({ type: "openTab", procedure }),
    openText: (title, text) => dispatch({ type: "openText", title, text }),
    note: (text) => dispatch({ type: "note", text, tone: "info" }),
  };
}
