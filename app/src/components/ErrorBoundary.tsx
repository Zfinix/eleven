import { Component, type ErrorInfo, type ReactElement, type ReactNode } from "react";

import { t } from "../i18n";
import { errorMessage } from "../lib/guards";
import { copyToClipboard, FROM_SOURCE } from "../lib/platform";
import { recordCrash, sendCrashes } from "../lib/telemetry";
import { MONO, useTheme } from "../theme";
import { Button } from "./kit";
import { appIcon } from "./ui";

type Crash = { readonly message: string; readonly details: string };
type State = { readonly crash: Crash | null };

/** While developing, the raw error; a hot reload clears it. */
function DevError({ message }: { readonly message: string }): ReactElement {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%", height: "100%", padding: 40, backgroundColor: "#171717", color: "#ededed" }}>
      <div style={{ fontSize: 16 }}>{t("components.crash.dev")}</div>
      <div style={{ fontFamily: MONO, fontSize: 12, color: "#e06c75" }}>{message}</div>
    </div>
  );
}

/** In the app people use: what happened in plain words and a way back to Home. */
function CrashPage({ crash, onHome }: { readonly crash: Crash; readonly onHome: () => void }): ReactElement {
  const { p } = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, width: "100%", height: "100%", paddingLeft: 24, paddingRight: 24, backgroundColor: p.card, color: p.text }}>
      <img src={appIcon(p.icon)} style={{ width: 56, height: 56 }} />
      <div style={{ fontSize: 18, fontWeight: 500 }}>{t("components.crash.title")}</div>
      <div style={{ maxWidth: 420, textAlign: "center", color: p.muted }}>{t("components.crash.detail")}</div>
      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
        <Button label={t("components.crash.home")} tone="primary" icon="back" onClick={onHome} />
        <Button label={t("components.crash.copy")} tone="outline" icon="copy" onClick={() => void copyToClipboard(crash.details)} />
      </div>
    </div>
  );
}

/** Catches a screen that fails to draw so the whole app doesn't go down with it. */
export class ErrorBoundary extends Component<{ readonly children: ReactNode; readonly onHome: () => void; readonly dev?: boolean }, State> {
  override state: State = { crash: null };

  static getDerivedStateFromError(error: unknown): State {
    return { crash: { message: errorMessage(error), details: error instanceof Error ? (error.stack ?? error.message) : errorMessage(error) } };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error(errorMessage(error), info.componentStack);
    recordCrash("screen", error, info.componentStack ?? "");
    void sendCrashes();
    const crash = this.state.crash;
    if (crash) this.setState({ crash: { ...crash, details: `${crash.details}\n${info.componentStack ?? ""}`.trim() } });
  }

  private readonly home = (): void => {
    this.props.onHome();
    this.setState({ crash: null });
  };

  override render(): ReactNode {
    const { crash } = this.state;
    if (crash === null) return this.props.children;
    return (this.props.dev ?? FROM_SOURCE) ? <DevError message={crash.message} /> : <CrashPage crash={crash} onHome={this.home} />;
  }
}
