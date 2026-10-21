import type { ReactElement, ReactNode } from "react";

import { t } from "../i18n";
import { useTheme } from "../theme";
import { appIcon, Icon, Row } from "../components/ui";

type Idea = { readonly kind: string; readonly label: string; readonly icon: string; readonly text: string; readonly ask: string };

function binaryIdea(name: string): Idea {
  return { kind: "Binary", label: t("landing.kind.binary"), icon: "binary", text: t("landing.binary", { name }), ask: t("landing.binary.ask", { name }) };
}

function suggestions(file: string | null, model: boolean): readonly Idea[] {
  const modelIdea = (text: string): Idea => ({ kind: "Model", label: t("landing.kind.model"), icon: "model", text, ask: text });
  const notes = t("landing.notes");
  const shader = t("landing.shader");
  return [
    model && file ? modelIdea(t("landing.model", { name: file })) : binaryIdea(file ?? "/bin/ls"),
    { kind: "App", label: t("landing.kind.app"), icon: "app", text: notes, ask: notes },
    model ? binaryIdea("/bin/ls") : modelIdea(t("landing.pt")),
    { kind: "Shader", label: t("landing.kind.shader"), icon: "gpu", text: shader, ask: shader },
  ];
}

function Suggestion({ label, icon, text, ask, onPick }: {
  readonly label: string;
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
        <div>{label}</div>
      </Row>
      <div style={{ color: p.text }}>{text}</div>
    </div>
  );
}

/** The first screen: one question, one composer, four ways in. */
export function Landing({ composer, file, model = false, onSuggest, showSuggestions = true }: { readonly composer: ReactNode; readonly file: string | null; readonly model?: boolean; readonly onSuggest: (text: string) => void; readonly showSuggestions?: boolean }): ReactElement {
  const { p } = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, alignItems: "center", justifyContent: "center", paddingTop: 32, paddingLeft: 24, paddingRight: 24, paddingBottom: 64 }}>
      <img src={appIcon(p.icon)} style={{ width: 56, height: 56, marginBottom: 14 }} />
      <div style={{ fontSize: 28, fontWeight: 500, marginBottom: 22, color: p.text }}>{t("landing.title")}</div>
      {composer}
      {showSuggestions && (
        <div style={{ display: "grid", gridTemplateColumns: 2, gap: 10, marginTop: 16, width: "100%", maxWidth: 700 }}>
          {suggestions(file, model).map((s) => (
            <Suggestion key={s.kind} label={s.label} icon={s.icon} text={s.text} ask={s.ask} onPick={onSuggest} />
          ))}
        </div>
      )}
    </div>
  );
}
