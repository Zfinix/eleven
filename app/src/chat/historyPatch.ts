import type { SavedThread } from "./history";
import type { Block, Message, Step } from "./thread";

type AgentMessage = Extract<Message, { kind: "agent" }>;
type ChangedBlock =
  | { readonly kind: "replace"; readonly index: number; readonly block: Block }
  | {
      readonly kind: "tool";
      readonly index: number;
      readonly step: Omit<Step, "input" | "output">;
      readonly input?: unknown;
      readonly output?: string | null;
    };
type MessageChange =
  | { readonly kind: "replace"; readonly index: number; readonly message: Message }
  | {
      readonly kind: "agent";
      readonly index: number;
      readonly metadata: Omit<AgentMessage, "blocks">;
      readonly length: number;
      readonly blocks: readonly ChangedBlock[];
    };

export type ThreadPatch = {
  readonly metadata: Omit<SavedThread, "messages">;
  readonly length: number;
  readonly changes: readonly MessageChange[];
};

function changedBlocks(
  previous: readonly Block[],
  next: readonly Block[],
): readonly ChangedBlock[] {
  const changes: ChangedBlock[] = [];
  for (let index = 0; index < next.length; index++) {
    const block = next[index];
    const old = previous[index];
    if (!block || block === old) continue;
    if (block.kind !== "tool" || old?.kind !== "tool") {
      changes.push({ kind: "replace", index, block });
      continue;
    }

    const { input, output, ...step } = block.step;
    changes.push({
      kind: "tool",
      index,
      step,
      ...(input !== old.step.input ? { input } : {}),
      ...(output !== old.step.output ? { output } : {}),
    });
  }
  return changes;
}

function applyBlock(previous: Block | undefined, change: ChangedBlock): Block {
  if (change.kind === "replace") return change.block;
  if (previous?.kind !== "tool")
    throw new Error("The saved tool call changed before its update could be applied.");
  return {
    kind: "tool",
    step: {
      ...change.step,
      input: "input" in change ? change.input : previous.step.input,
      output: change.output === undefined ? previous.step.output : change.output,
    },
  };
}

/** Unchanged tool inputs never cross the worker boundary again. */
export function threadPatch(previous: SavedThread | null, next: SavedThread): ThreadPatch {
  const { messages, ...metadata } = next;
  const changes: MessageChange[] = [];
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    const old = previous?.messages[index];
    if (!message || message === old) continue;
    if (old?.kind !== "agent" || message.kind !== "agent") {
      changes.push({ kind: "replace", index, message });
      continue;
    }

    const { blocks, ...agent } = message;
    changes.push({
      kind: "agent",
      index,
      metadata: agent,
      length: blocks.length,
      blocks: changedBlocks(old.blocks, blocks),
    });
  }
  return { metadata, length: messages.length, changes };
}

export function applyThreadPatch(saved: SavedThread | null, patch: ThreadPatch): SavedThread {
  const messages = saved ? [...saved.messages] : [];
  messages.length = patch.length;
  for (const change of patch.changes) {
    if (change.kind === "replace") {
      messages[change.index] = change.message;
      continue;
    }
    const old = messages[change.index];
    if (old?.kind !== "agent")
      throw new Error("The saved chat changed before its update could be applied.");
    const blocks = [...old.blocks];
    blocks.length = change.length;
    for (const item of change.blocks) blocks[item.index] = applyBlock(blocks[item.index], item);
    messages[change.index] = { ...change.metadata, blocks };
  }
  for (const message of messages) {
    if (!message) throw new Error("The saved chat is missing messages needed by its update.");
  }
  return {
    ...patch.metadata,
    project: saved?.project ?? patch.metadata.project,
    ...(saved?.named ? { named: saved.named } : {}),
    messages,
  };
}
