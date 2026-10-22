import type { ReactElement } from "react";

import { scrollbar, useTheme } from "../theme";
import { t } from "../i18n";
import { useCodeLook } from "../settings/look";
import { Icon } from "../components/ui";
import { text } from "./look";
import type { Recording, Span } from "./types";
import { Timeline } from "./Timeline";

function Stats({ span }: { readonly span: Span }): ReactElement {
  const { p } = useTheme();
  const { family } = useCodeLook();
  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, flexBasis: 310, padding: 14, borderWidth: 1, borderColor: p.sel, borderRadius: 10 }}>
      <div style={{ fontWeight: 600, fontFamily: family }}>{span.label}</div>
      <div style={{ display: "grid", gridTemplateColumns: 2, gap: 8, marginTop: 10 }}>
        {span.stats.map((s) => (
          <div key={s.label} style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ color: p.muted, ...text(12) }}>{s.label}</div>
            <div style={{ fontWeight: 500 }}>{s.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Advice({ span }: { readonly span: Span }): ReactElement {
  const { p } = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, flexBasis: 350, minWidth: 0, padding: 14, borderWidth: 1, borderColor: p.line3, borderRadius: 10, backgroundColor: p.raised }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <Icon name="bolt" size={15} color={p.data} />
        <div style={{ fontWeight: 500 }}>{t("gpu.profile.advice")}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, color: p.text2 }}>
        {span.advice.map((paragraph) => <div key={paragraph} style={{ lineHeight: 20 }}>{paragraph}</div>)}
        {span.advice.length === 0 && <div style={{ color: p.muted }}>{t("gpu.profile.fine")}</div>}
      </div>
    </div>
  );
}

/** A recorded frame on a timeline, with the picked bar's numbers and what to do about them. */
export function ProfileView({ recording, span, onPick, onAsk }: {
  readonly recording: Recording;
  readonly span: Span;
  readonly onPick: (id: string) => void;
  readonly onAsk: () => void;
}): ReactElement {
  const { p } = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, flexGrow: 1, minHeight: 0, overflowY: "scroll", ...scrollbar(p), paddingTop: 16, paddingBottom: 16, paddingLeft: 18, paddingRight: 18 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 10, flexShrink: 0 }}>
        <div style={{ fontWeight: 600, ...text(18) }}>{recording.title}</div>
        <div style={{ flexGrow: 1, paddingBottom: 2.3, color: p.muted }}>{recording.source}</div>
        <div onClick={onAsk} role="button" style={{ display: "flex", alignItems: "center", height: 28, paddingLeft: 10, paddingRight: 10, borderWidth: 1, borderColor: p.line3, borderRadius: 8, backgroundColor: p.sel, color: p.text, cursor: "pointer", hover: { opacity: 0.72 } }}>
          <div>{t("gpu.profile.ask")}</div>
        </div>
      </div>
      <Timeline recording={recording} selected={span.id} onPick={onPick} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, flexShrink: 0 }}>
        <Stats span={span} />
        <Advice span={span} />
      </div>
    </div>
  );
}
