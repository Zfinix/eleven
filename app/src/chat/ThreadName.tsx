import type { EventPayload } from "@gpuix/react";
import { type ReactElement, useState } from "react";

import { t } from "../i18n";
import { TYPING } from "../lib/shortcuts";
import { useTheme } from "../theme";
import { renameThread } from "./history";

/** A thread's name, editable in place: Return saves, Esc or clicking away keeps the old one. */
export function ThreadName({ id, title, height, onDone }: { readonly id: string; readonly title: string; readonly height: number; readonly onDone: () => void }): ReactElement {
  const { p } = useTheme();
  const [draft, setDraft] = useState(title);
  const save = (): void => {
    if (draft.trim() && draft.trim() !== title) renameThread(id, draft);
    onDone();
  };
  const onKeyDown = (event: EventPayload): void => {
    TYPING.onKeyDown(event);
    if (event.key === "escape") onDone();
  };
  return (
    <input autoFocus value={draft} aria-label={t("chat.threadName")} onKeyDown={onKeyDown} onChange={(e) => setDraft(e.value ?? "")} onSubmit={save} onBlur={onDone} style={{ height, flexShrink: 0, paddingLeft: 9, paddingRight: 9, borderWidth: 1, borderColor: p.line3, borderRadius: 8, backgroundColor: p.deep, color: p.text }} />
  );
}
