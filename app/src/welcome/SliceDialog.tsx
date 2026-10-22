import type { ReactElement } from "react";

import { MONO, useTheme } from "../theme";
import { Icon } from "../components/ui";
import { Button } from "../components/kit";
import { t } from "../i18n";
import type { SlicePrompt } from "../chat/useChat";
import { useCommand } from "../lib/shortcuts";
import { useBench } from "../workbench/parts";
import { HOVER, lineHeight } from "./look";
import { sliceName, sliceNote, sliceTitle, universalNote } from "./slices";

/** A universal file's versions by arch, this Mac's first; names and notes are worded when shown. */
export type SliceChoice = {
  readonly name: string;
  readonly app: boolean;
  readonly archs: readonly string[];
  readonly host: string | null;
  readonly chosen: string;
  readonly matchThisMac: boolean;
};

const SHADOW = { offsetX: 0, offsetY: 24, blurRadius: 60, spreadRadius: 0, color: "rgba(0,0,0,0.55)" } as const;

function SliceRow({ arch, host, on, onPick }: { readonly arch: string; readonly host: string | null; readonly on: boolean; readonly onPick: () => void }): ReactElement {
  const { p } = useTheme();
  const ring = on ? { borderWidth: 5, borderColor: p.text } : { borderWidth: 1.5, borderColor: p.line3 };
  return (
    <div onClick={onPick} role="radio" aria-checked={on} aria-label={sliceName(arch)} style={{ display: "flex", alignItems: "center", gap: 12, paddingTop: 10, paddingBottom: 10, paddingLeft: 12, paddingRight: 12, borderRadius: 10, cursor: "pointer", hover: HOVER, backgroundColor: on ? p.sel : "transparent" }}>
      <div style={{ width: 16, height: 16, flexShrink: 0, borderRadius: 8, pointerEvents: "none", ...ring }} />
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 500 }}>{sliceName(arch)}</div>
        <div style={{ fontSize: 12, lineHeight: lineHeight(12), color: p.muted }}>{sliceNote(arch, host)}</div>
      </div>
      <div style={{ fontFamily: MONO, fontSize: 12, lineHeight: lineHeight(12), color: p.muted }}>{arch}</div>
    </div>
  );
}

function Checkbox({ on }: { readonly on: boolean }): ReactElement {
  const { p } = useTheme();
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 15, height: 15, borderRadius: 4, flexShrink: 0, pointerEvents: "none", backgroundColor: on ? p.text : p.line3 }}>
      {on && <Icon name="check" size={11} color={p.win} />}
    </div>
  );
}

/** Asks which version of a universal file to take apart, over the workbench card it just opened. */
export function SliceOverlay(): ReactElement | null {
  const { chat, onBack } = useBench();
  return chat.slicePrompt && <SliceDialog prompt={chat.slicePrompt} onBack={onBack} />;
}

function SliceDialog({ prompt, onBack }: { readonly prompt: SlicePrompt; readonly onBack: () => void }): ReactElement {
  const { p } = useTheme();
  const cancel = (): void => {
    prompt.cancel();
    onBack();
  };
  useCommand("confirm", prompt.open);
  useCommand("dismiss", cancel);
  const { choice } = prompt;
  const chosen = sliceName(choice.chosen);
  return (
    <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, backgroundColor: "rgba(0,0,0,0.45)" }}>
      <div role="dialog" aria-label={t("slice.title")} style={{ display: "flex", flexDirection: "column", gap: 14, width: "100%", maxWidth: 440, padding: 20, borderRadius: 16, backgroundColor: p.raised, boxShadow: SHADOW }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 16, lineHeight: lineHeight(16), fontWeight: 600 }}>{sliceTitle(choice)}</div>
          <div style={{ color: p.muted }}>{universalNote(choice)}</div>
        </div>
        <div role="radiogroup" aria-label={t("slice.version")} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {choice.archs.map((arch) => (
            <SliceRow key={arch} arch={arch} host={choice.host} on={arch === choice.chosen} onPick={() => prompt.pick(arch)} />
          ))}
        </div>
        <div onClick={prompt.toggleMatch} role="checkbox" aria-checked={choice.matchThisMac} style={{ display: "flex", alignItems: "center", gap: 10, paddingLeft: 2, paddingRight: 2, color: p.text3, cursor: "pointer" }}>
          <Checkbox on={choice.matchThisMac} />
          <div>{t("slice.matchThisMac")}</div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 2 }}>
          <Button label={t("slice.cancel")} tone="outline" onClick={cancel} />
          <div onClick={prompt.open} role="button" aria-label={t("slice.open", { name: chosen })} style={{ display: "flex", alignItems: "center", gap: 8, height: 32, paddingLeft: 14, paddingRight: 12, borderRadius: 8, backgroundColor: p.text, color: p.win, fontWeight: 600, cursor: "pointer", hover: HOVER }}>
            <div>{t("slice.open", { name: chosen })}</div>
            <div style={{ fontSize: 11.5, fontWeight: 500, opacity: 0.55 }}>↩</div>
          </div>
        </div>
      </div>
    </div>
  );
}
