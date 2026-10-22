import type { EventPayload } from "@gpuix/react";
import { type ReactElement, useMemo, useRef, useState } from "react";

import { MenuRows } from "../components/MenuRows";
import { Icon, Row } from "../components/ui";
import { t } from "../i18n";
import { noteTyping } from "../lib/shortcuts";
import { MONO, type Palette, useTheme } from "../theme";
import { type Mention, type MentionIndex, type MentionKind, type MentionResult, searchMentions } from "./mentions";

const ITEM_ROW = 34;
const ROWS_MAX = 254;

function look(kind: MentionKind, p: Palette): { readonly icon: string; readonly tone: string } {
  switch (kind) {
    case "bookmark":
      return { icon: "bookmark", tone: p.data };
    case "note":
      return { icon: "note", tone: p.keyword };
    case "function":
      return { icon: "function", tone: p.call };
    case "string":
      return { icon: "text", tone: p.string };
    default: {
      const unhandled: never = kind;
      return unhandled;
    }
  }
}

function MentionRow({ mention, highlighted, onPick }: { readonly mention: Mention; readonly highlighted: boolean; readonly onPick: () => void }): ReactElement {
  const { p } = useTheme();
  const { icon, tone } = look(mention.kind, p);
  return (
    <div onClick={onPick} style={{ display: "flex", alignItems: "center", gap: 10, height: ITEM_ROW, flexShrink: 0, paddingLeft: 10, paddingRight: 10, borderRadius: 8, cursor: "pointer", hover: { opacity: 0.72 }, ...(highlighted ? { backgroundColor: p.sel } : {}) }}>
      <Icon name={icon} size={15} color={tone} />
      <div style={{ color: p.text, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden", minWidth: 0, flexShrink: 1, fontFamily: MONO, fontSize: 12.5 }}>{mention.label}</div>
      <div style={{ flexGrow: 1 }} />
      <div style={{ color: p.muted, whiteSpace: "nowrap", flexShrink: 0, fontSize: 12 }}>{mention.detail}</div>
    </div>
  );
}

/** The @ picker under the prompt: functions, strings, bookmarks and notes in the open file, with its own search. */
export function MentionPicker({ mentions, onPick, onClose, onAttach }: {
  readonly mentions: MentionIndex;
  readonly onPick: (mention: Mention) => void;
  /** Closes without a pick, handing back what was typed so it stays in the draft. */
  readonly onClose: (typed: string) => void;
  readonly onAttach: () => void;
}): ReactElement {
  const { p } = useTheme();
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const last = useRef<MentionResult | null>(null);
  const items = useMemo(() => {
    const result = searchMentions(mentions, query, last.current);
    last.current = result;
    return result.shown;
  }, [mentions, query]);
  const at = Math.min(highlighted, Math.max(0, items.length - 1));
  const onKeyDown = (event: EventPayload): void => {
    noteTyping(event);
    if (event.key === "escape") onClose(`@${query}`);
    else if (event.key === "space" && items.length === 0) onClose(`@${query} `);
    else if (event.key === "backspace" && query.length === 0) onClose("");
    else if (event.key === "down") setHighlighted((at + 1) % Math.max(1, items.length));
    else if (event.key === "up") setHighlighted((at - 1 + items.length) % Math.max(1, items.length));
    else if (event.key === "tab") submit();
  };
  const submit = (): void => {
    const item = items[at];
    if (item) onPick(item);
    else onClose(`@${query}`);
  };
  return (
    <div onMouseDownOutside={() => onClose(`@${query}`)} style={{ display: "flex", flexDirection: "column", width: "100%", maxHeight: 300, padding: 6, borderWidth: 1, borderColor: p.sel, borderRadius: 16, backgroundColor: p.win }}>
      <Row gap={8} style={{ height: 34, flexShrink: 0, paddingLeft: 10, paddingRight: 10 }}>
        <div style={{ color: p.muted, fontFamily: MONO }}>@</div>
        <input autoFocus value={query} placeholder={mentions.all.length > 0 ? t("chat.mention.search") : t("chat.mention.noFile")} aria-label={t("chat.mention.label")} onChange={(e) => {
          setQuery(e.value ?? "");
          setHighlighted(0);
        }} onKeyDown={onKeyDown} onSubmit={submit} style={{ flexGrow: 1, color: p.text, backgroundColor: p.win }} />
      </Row>
      {mentions.all.length === 0 && (
        <div onClick={onAttach} role="button" style={{ display: "flex", alignItems: "center", gap: 10, height: ITEM_ROW, flexShrink: 0, paddingLeft: 10, paddingRight: 10, borderRadius: 8, cursor: "pointer", hover: { opacity: 0.72 } }}>
          <Icon name="attach" size={15} color={p.text3} />
          <div style={{ color: p.text }}>{t("composer.addFile")}</div>
          <div style={{ color: p.muted }}>{t("chat.mention.addFile.detail")}</div>
        </div>
      )}
      {mentions.all.length > 0 && items.length === 0 && <div style={{ padding: 10, color: p.faint }}>{t("chat.nothingMatches")}</div>}
      <MenuRows heights={items.map(() => ITEM_ROW)} maxHeight={ROWS_MAX} reveal={at}>
        {items.map((mention, ix) => <MentionRow key={`${mention.kind}:${mention.addr}:${mention.label}`} mention={mention} highlighted={ix === at} onPick={() => onPick(mention)} />)}
      </MenuRows>
    </div>
  );
}
