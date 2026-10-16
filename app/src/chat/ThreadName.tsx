import type { EventPayload } from "@gpuix/react";
import { type ReactElement, useState } from "react";

import { TYPING } from "../lib/shortcuts";
import { errorMessage } from "../lib/guards";
import { useTheme } from "../theme";
import { renameThread } from "./history";

/** A thread's name, editable in place: Return saves, Esc or clicking away keeps the old one. */
export function ThreadName({
  id,
  title,
  height,
  onDone,
  onError,
}: {
  readonly id: string;
  readonly title: string;
  readonly height: number;
  readonly onDone: () => void;
  readonly onError: (message: string) => void;
}): ReactElement {
  const { p } = useTheme();
  const [draft, setDraft] = useState(title);
  const save = (): void => {
    try {
      if (draft.trim() && draft.trim() !== title) renameThread(id, draft);
      onDone();
    } catch (error) {
      onError(`Couldn't rename this chat. ${errorMessage(error)}`);
    }
  };
  const onKeyDown = (event: EventPayload): void => {
    TYPING.onKeyDown(event);
    if (event.key === "escape") onDone();
  };
  return (
    <input
      autoFocus
      value={draft}
      aria-label="Thread name"
      onKeyDown={onKeyDown}
      onChange={(e) => setDraft(e.value ?? "")}
      onSubmit={save}
      onBlur={onDone}
      style={{
        height,
        flexShrink: 0,
        paddingLeft: 9,
        paddingRight: 9,
        borderWidth: 1,
        borderColor: p.line3,
        borderRadius: 8,
        backgroundColor: p.deep,
        color: p.text,
      }}
    />
  );
}
