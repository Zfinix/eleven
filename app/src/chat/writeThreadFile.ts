import { closeSync, openSync, writeSync } from "node:fs";

import type { SavedThread } from "./history";
import type { Message } from "./thread";

function writeText(descriptor: number, text: string): void {
  const bytes = Buffer.from(text);
  let offset = 0;
  while (offset < bytes.length) {
    const written = writeSync(descriptor, bytes, offset, bytes.length - offset);
    if (written === 0) throw new Error("Chat storage stopped accepting data.");
    offset += written;
  }
}

function writeMessage(descriptor: number, message: Message): void {
  if (message.kind !== "agent") {
    writeText(descriptor, JSON.stringify(message));
    return;
  }
  const { blocks, ...metadata } = message;
  writeText(descriptor, `${JSON.stringify(metadata).slice(0, -1)},"blocks":[`);
  for (let index = 0; index < blocks.length; index++) {
    if (index > 0) writeText(descriptor, ",");
    writeText(descriptor, JSON.stringify(blocks[index]));
  }
  writeText(descriptor, "]}");
}

function writeThread(descriptor: number, thread: SavedThread): void {
  const { messages, ...metadata } = thread;
  writeText(descriptor, `${JSON.stringify(metadata).slice(0, -1)},"messages":[`);
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (!message) throw new Error("The chat contains a missing message.");
    if (index > 0) writeText(descriptor, ",");
    writeMessage(descriptor, message);
  }
  writeText(descriptor, "]}\n");
}

/** Serializes one block at a time, avoiding a second copy of the entire chat in memory. */
export function writeThreadFile(path: string, thread: SavedThread): void {
  const descriptor = openSync(path, "wx");
  try {
    writeThread(descriptor, thread);
  } catch (error) {
    try {
      closeSync(descriptor);
    } catch (cleanup) {
      throw new AggregateError([error, cleanup], `Couldn't finish the chat snapshot at ${path}.`);
    }
    throw new Error(`Couldn't finish the chat snapshot at ${path}.`, { cause: error });
  }
  closeSync(descriptor);
}
