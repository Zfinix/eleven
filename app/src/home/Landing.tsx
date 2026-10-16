import type { ReactElement, ReactNode } from "react";

import { tr, trN, useLanguage } from "../i18n";
import { useTheme } from "../theme";
import { appIcon, Icon, Row } from "../components/ui";

function suggestions(file: string | null, model: boolean): readonly { readonly kind: string; readonly icon: string; readonly text: string; readonly ask: string }[] {
  const binary = file ?? "/bin/ls";
  const first = model && file
    ? { kind: "Model", icon: "model", text: trN("What is in {name}, and is it safe to load?", { name: file }), ask: trN("What is in {name}, and is it safe to load?", { name: file }) }
    : { kind: "Binary", icon: "binary", text: trN("What does {name} do when it starts?", { name: binary }), ask: trN("What does {name} do when it starts, and where does it print its usage?", { name: binary }) };
  return [
    first,
    { kind: "App", icon: "app", text: tr("How does Notes save attachments?"), ask: tr("How does Notes save attachments?") },
    ...(model ? [{ kind: "Binary", icon: "binary", text: trN("What does {name} do when it starts?", { name: "/bin/ls" }), ask: trN("What does {name} do when it starts, and where does it print its usage?", { name: "/bin/ls" }) }] : [{ kind: "Model", icon: "model", text: tr("Is this .pt file safe to load?"), ask: tr("Is this .pt file safe to load?") }]),
    { kind: "Shader", icon: "gpu", text: tr("Why is this blur shader slow?"), ask: tr("Why is this blur shader slow?") },
  ];
}

function Suggestion({ kind, icon, text, ask, onPick }: {
  readonly kind: string;
  readonly icon: string;
  readonly text: string;
  readonly ask: string;
  readonly onPick: (text: string) => void;
}): ReactElement {
  const { p } = useTheme();
  return (
    <div onClick={() => onPick(ask)} style={{ display: "flex", flexDirection: "column", gap: 3, paddingTop: 12, paddingBottom: 12, paddingLeft: 14, paddingRight: 14, borderWidth: 1, borderColor: p.fill2, borderRadius: 14, cursor: "pointer", hover: { opacity: 0.72 } }}>
      <Row gap={6} style={{ fontSize: 11.5, color: p.muted }}>
        <Icon name={icon} size={14} />
        <div>{tr(kind)}</div>
      </Row>
      <div style={{ color: p.text }}>{text}</div>
    </div>
  );
}

/** The first screen: one question, one composer, four ways in. */
export function Landing({ composer, file, model = false, onSuggest, showSuggestions = true }: { readonly composer: ReactNode; readonly file: string | null; readonly model?: boolean; readonly onSuggest: (text: string) => void; readonly showSuggestions?: boolean }): ReactElement {
  const { p } = useTheme();
  useLanguage();
  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, alignItems: "center", justifyContent: "center", paddingTop: 32, paddingLeft: 24, paddingRight: 24, paddingBottom: 64 }}>
      <img src={appIcon(p.icon)} style={{ width: 56, height: 56, marginBottom: 14 }} />
      <div style={{ fontSize: 28, fontWeight: 500, marginBottom: 22, color: p.text }}>{tr("What should we take apart?")}</div>
      {composer}
      {showSuggestions && (
        <div style={{ display: "grid", gridTemplateColumns: 2, gap: 10, marginTop: 16, width: "100%", maxWidth: 700 }}>
          {suggestions(file, model).map((s) => (
            <Suggestion key={s.kind} kind={s.kind} icon={s.icon} text={s.text} ask={s.ask} onPick={onSuggest} />
          ))}
        </div>
      )}
    </div>
  );
}
