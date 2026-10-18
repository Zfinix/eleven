import type { ChildProcess } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";

import * as acp from "@agentclientprotocol/sdk";

import { AGENT_ENV, BRIDGE_ENV, CHAT_ENV, ELEVEN_SERVER } from "../bridge/protocol";
import { errorMessage } from "../lib/guards";
import { toWebReadable, toWebWritable } from "../lib/streams";
import { currentSettings, loadSettings, pathSetting } from "../settings/store";
import { reaEnv } from "../engine/rea";
import type { NativeCommand } from "./detect";
import type { AgentEvent, PermissionChoice, SessionOption } from "./events";
import type { GoalControl } from "./goals";
import { type Launch, resolveLaunch } from "./launch";
import { chimeForAnswer } from "./notify";
import { isRemembered, rememberAnswer } from "./remembered";
import { isReadOnly, onlySuggests, permissionTool, REA_SERVER, reaToolName } from "./permissions";
import { type AgentEntry, shortName } from "./registry";
import { configOptions, legacyModes, mergeOptions, translate } from "./translate";
import { rememberModels } from "./models";
import type { Picks } from "./picks";
import { FROM_SOURCE } from "../lib/platform";
import { start, stop } from "../lib/process";

type Emit = (event: AgentEvent) => void;
type Answer = (choiceId: string | null) => void;

const STDERR_TAIL = 2000;
const EXIT_GRACE_MS = 400;
const PASS_THROUGH_ENV = ["GHIDRA_INSTALL_DIR", "JAVA_HOME", "PATH", "HOME", "ELEVEN_REA", "ELEVEN_SUPPORT", "SystemRoot", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "PATHEXT"] as const;

/** Eleven itself, started with `flag` to serve one of its MCP servers. */
function selfServer(name: string, flag: string, env: acp.EnvVariable[]): acp.McpServer {
  const args = FROM_SOURCE ? [join(import.meta.dir, "..", "main.tsx"), flag] : [flag];
  return { name, command: process.execPath, args, env };
}

/** REA, behind Eleven's filter so names, comments and bookmarks go through Eleven's project. */
function reaServer(): acp.McpServer {
  const env = PASS_THROUGH_ENV.flatMap((name) => {
    const value = process.env[name];
    return value ? [{ name, value }] : [];
  });
  const knobs = Object.entries(reaEnv()).map(([name, value]) => ({ name, value }));
  return selfServer(REA_SERVER, "--rea-mcp", [...env, ...knobs]);
}

function envList(value: unknown): acp.EnvVariable[] {
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([name, v]) => (typeof v === "string" ? [{ name, value: v }] : []));
}

/** An IDA MCP server described by a JSON file with `command`, `args` and `env`, as REA's IDA provider reads it. */
function idaServer(): readonly acp.McpServer[] {
  const config = pathSetting("idaPath", "REA_IDA_MCP_CONFIG");
  if (!config?.endsWith(".json")) return [];
  try {
    const parsed: unknown = JSON.parse(readFileSync(config, "utf8"));
    if (typeof parsed !== "object" || parsed === null || !("command" in parsed) || typeof parsed.command !== "string") return [];
    const args = "args" in parsed && Array.isArray(parsed.args) ? parsed.args.filter((arg): arg is string => typeof arg === "string") : [];
    return [{ name: "ida", command: parsed.command, args, env: "env" in parsed ? envList(parsed.env) : [] }];
  } catch {
    return [];
  }
}

/** The extra tool server from Settings, such as `npx my-mcp-server`. */
function customServer(command: string): readonly acp.McpServer[] {
  const [program, ...args] = command.trim().split(/\s+/).filter(Boolean);
  return program ? [{ name: "custom", command: program, args, env: [] }] : [];
}

function toolServers(agent: string, chat: string): acp.McpServer[] {
  const s = currentSettings();
  return [
    ...(s.reaTools ? [reaServer()] : []),
    ...(s.elevenTools ? elevenServer(agent, chat) : []),
    ...(s.idaTools ? idaServer() : []),
    ...customServer(s.customToolServer),
  ];
}

function inputNumber(input: unknown, keys: readonly string[]): number | null {
  if (typeof input !== "object" || input === null) return null;
  for (const [key, value] of Object.entries(input)) if (keys.includes(key) && typeof value === "number") return value;
  return null;
}

function inputPaths(input: unknown): readonly string[] {
  if (typeof input !== "object" || input === null) return [];
  return Object.values(input).filter((value): value is string => typeof value === "string" && isAbsolute(value));
}

/** A tool call that reads or sends the whole open file: read_bytes over all of it, or any non-REA tool given its path. */
export function readsWholeFile(tool: string, input: unknown, file: string | null): boolean {
  if (!file) return false;
  const rea = reaToolName(tool);
  if (rea === "open_binary") return false;
  if (rea === "read_bytes") {
    const length = inputNumber(input, ["length", "size", "count"]);
    try {
      return length !== null && length >= statSync(file).size;
    } catch {
      return false;
    }
  }
  return rea === null && inputPaths(input).includes(file);
}

/** Eleven's own tools, talking back to this window. */
function elevenServer(agent: string, chat: string): readonly acp.McpServer[] {
  const bridge = process.env[BRIDGE_ENV];
  if (!bridge) return [];
  return [selfServer(ELEVEN_SERVER, "--eleven-mcp", [{ name: BRIDGE_ENV, value: bridge }, { name: AGENT_ENV, value: agent }, { name: CHAT_ENV, value: chat }])];
}

function choicesOf(options: readonly acp.PermissionOption[]): readonly PermissionChoice[] {
  return options.map((option) => ({ id: option.optionId, label: option.name, allows: option.kind === "allow_once" || option.kind === "allow_always" }));
}

function autoAllow(request: acp.RequestPermissionRequest, project: string | null, file: string | null): acp.RequestPermissionResponse | null {
  const { askBeforeChanges, readWithoutAsking, reviewAgentEdits, permissions, rememberAnswers, askBeforeWholeFile } = loadSettings();
  const tool = request.toolCall.title ?? "";
  const level = permissions[permissionTool(tool)];
  if (level === "Never") {
    const reject = request.options.find((o) => o.kind === "reject_once" || o.kind === "reject_always");
    return reject ? { outcome: { outcome: "selected", optionId: reject.optionId } } : { outcome: { outcome: "cancelled" } };
  }
  if (askBeforeWholeFile && readsWholeFile(tool, request.toolCall.rawInput, file)) return null;
  if (rememberAnswers && project && isRemembered(project, tool)) return allowOption(request);
  const readOnly = isReadOnly(tool);
  if (level === "Ask" && askBeforeChanges && !(readOnly && readWithoutAsking) && !onlySuggests(tool, reviewAgentEdits)) return null;
  return allowOption(request);
}

function allowOption(request: acp.RequestPermissionRequest): acp.RequestPermissionResponse | null {
  const option = request.options.find((o) => o.kind === "allow_always") ?? request.options.find((o) => o.kind === "allow_once");
  return option ? { outcome: { outcome: "selected", optionId: option.optionId } } : null;
}

function startFailure(agent: AgentEntry, native: NativeCommand | null, detail: string): string {
  if (!/auth|sign.?in|log.?in|credential|api key/i.test(detail)) return `Couldn't start ${agent.name}. ${detail}`;
  const command = native ? basename(native.path) : agent.name;
  return `${agent.name} needs you to sign in. Run \`${command} login\` in Terminal, then try again. ${detail}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** One ACP agent process, with REA handed to it as an MCP server. */
export class AgentSession {
  private child: ChildProcess | null = null;
  private connection: acp.ClientSideConnection | null = null;
  private sessionId: string | null = null;
  private readonly ready: Promise<void>;
  private readonly pending = new Map<number, Answer>();
  private nextRequest = 1;
  private stderrTail = "";
  private failed = false;
  /** Set once Eleven stops this session on purpose; nothing it says afterwards reaches the thread. */
  private stopped = false;
  private options: readonly SessionOption[] = [];
  /** Your saved picks being applied; the first prompt waits so it runs on the model you chose. */
  private restoring: Promise<void> = Promise.resolve();

  constructor(
    private readonly agent: AgentEntry,
    private readonly native: NativeCommand | null,
    private readonly cwd: string,
    private readonly sink: Emit,
    private readonly chat: string,
    private readonly project: string | null = null,
    private readonly file: string | null = null,
    /** Off for a quick answer that already has its context, so no tool servers have to start first. */
    private readonly tools: boolean = true,
  ) {
    this.ready = this.start();
    this.ready.catch(async (err: unknown) => {
      await delay(EXIT_GRACE_MS);
      const said = this.stderrTail.trim().split("\n").filter(Boolean).at(-1);
      this.fail(startFailure(agent, native, said ? `${errorMessage(err)}: ${said}` : errorMessage(err)));
    });
  }

  private emit(event: AgentEvent): void {
    if (!this.stopped) this.sink(event);
  }

  private fail(reason: string): void {
    if (this.failed) return;
    this.failed = true;
    this.emit({ kind: "failed", reason });
  }

  private publish(options: readonly SessionOption[]): void {
    this.options = options;
    rememberModels(this.agent.id, options);
    this.emit({ kind: "options", options });
  }

  private async start(): Promise<void> {
    this.connection = this.connect(await resolveLaunch(this.agent, this.native));
    const init = await this.connection.initialize({ protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: { session: { notices: {} } } });
    const session = await this.connection.newSession({ cwd: this.cwd, mcpServers: this.tools ? toolServers(shortName(this.agent.name), this.chat) : [] });
    this.sessionId = session.sessionId;
    this.emit({ kind: "connected", agent: shortName(init.agentInfo?.title ?? init.agentInfo?.name ?? this.agent.name) });
    this.publish(mergeOptions(configOptions(session.configOptions), legacyModes(session.modes)));
  }

  private connect(launch: Launch): acp.ClientSideConnection {
    const child = start(launch.command, launch.args, { cwd: this.cwd, env: { ...process.env, ...launch.env } });
    child.stderr.on("data", (chunk: Buffer) => {
      this.stderrTail = (this.stderrTail + chunk.toString()).slice(-STDERR_TAIL);
    });
    child.on("error", (err) => this.fail(`Couldn't start ${this.agent.name}: ${err.message}`));
    child.on("exit", (code) => {
      if (code) this.fail(`${this.agent.name} stopped. ${this.lastError()}`);
    });
    this.child = child;
    return new acp.ClientSideConnection(() => this.client(), acp.ndJsonStream(toWebWritable(child.stdin), toWebReadable(child.stdout)));
  }

  private client(): acp.Client {
    return {
      sessionUpdate: async ({ update }): Promise<void> => {
        const event = translate(update, this.options);
        if (event?.kind === "options") this.options = event.options;
        if (event) this.emit(event);
      },
      requestPermission: async (request): Promise<acp.RequestPermissionResponse> => autoAllow(request, this.project, this.file) ?? (await this.ask(request)),
    };
  }

  private async ask(request: acp.RequestPermissionRequest): Promise<acp.RequestPermissionResponse> {
    const id = this.nextRequest++;
    const choiceId = await new Promise<string | null>((resolve) => {
      this.pending.set(id, resolve);
      this.emit({ kind: "permission", id, tool: request.toolCall.title ?? "use a tool", input: request.toolCall.rawInput, choices: choicesOf(request.options) });
      void chimeForAnswer();
    });
    const always = request.options.find((o) => o.optionId === choiceId)?.kind === "allow_always";
    if (always && this.project && currentSettings().rememberAnswers) rememberAnswer(this.project, request.toolCall.title ?? "");
    return choiceId ? { outcome: { outcome: "selected", optionId: choiceId } } : { outcome: { outcome: "cancelled" } };
  }

  private lastError(): string {
    const lines = this.stderrTail.trim().split("\n").filter(Boolean);
    return lines.at(-1) ?? "Try again, or pick another agent.";
  }

  private async session(): Promise<{ readonly connection: acp.ClientSideConnection; readonly sessionId: string }> {
    await this.ready;
    if (!this.connection || !this.sessionId) throw new Error("The agent didn't start a session.");
    return { connection: this.connection, sessionId: this.sessionId };
  }

  private categoryOf(id: string): string {
    return this.options.find((o) => o.id === id)?.category ?? "";
  }

  /** Switches to the options you picked last time, skipping any this agent no longer offers. */
  restore(picks: Picks): void {
    this.restoring = (async (): Promise<void> => {
      await this.session();
      const modelFirst = Object.entries(picks).sort(([a], [b]) => Number(this.categoryOf(b) === "model") - Number(this.categoryOf(a) === "model"));
      for (const [id, value] of modelFirst) {
        const option = this.options.find((o) => o.id === id);
        if (option && option.current !== value && option.choices.some((choice) => choice.value === value)) await this.setOption(option, value);
      }
    })().catch(() => undefined);
  }

  async prompt(text: string): Promise<void> {
    try {
      await this.restoring;
      const { connection, sessionId } = await this.session();
      const result = await connection.prompt({ sessionId, prompt: [{ type: "text", text }] });
      this.emit({ kind: "turnEnded", cancelled: result.stopReason === "cancelled" });
    } catch (err) {
      await delay(EXIT_GRACE_MS);
      this.fail(`${this.agent.name} stopped: ${errorMessage(err)}`);
    }
  }

  async controlGoal(action: GoalControl): Promise<void> {
    const { connection, sessionId } = await this.session();
    await connection.extMethod("_session/goal", { sessionId, action });
  }

  async cancel(): Promise<void> {
    for (const answer of this.pending.values()) answer(null);
    this.pending.clear();
    const { connection, sessionId } = await this.session();
    await connection.cancel({ sessionId });
  }

  async setOption(option: SessionOption, value: string): Promise<void> {
    const { connection, sessionId } = await this.session();
    if (option.legacyMode) {
      await connection.setSessionMode({ sessionId, modeId: value });
      this.publish(this.options.map((o) => (o.id === option.id ? { ...o, current: value } : o)));
      return;
    }
    const response = await connection.setSessionConfigOption({ sessionId, configId: option.id, value });
    this.publish(mergeOptions(configOptions(response.configOptions), this.options.filter((o) => o.legacyMode)));
  }

  answer(id: number, choiceId: string | null): void {
    this.pending.get(id)?.(choiceId);
    this.pending.delete(id);
  }

  stop(): void {
    this.stopped = true;
    if (this.child) stop(this.child);
  }
}
