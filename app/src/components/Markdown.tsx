import { type ReactElement, useEffect, useMemo, useState } from "react";

import { pieces } from "../engine/ask";
import { t } from "../i18n";
import { copyToClipboard } from "../lib/platform";
import { syntaxFor, useCodeLook } from "../settings/look";
import { useSettings } from "../settings/store";
import { openLink } from "../settings/system";
import { nativeTheme, scrollbar, useTheme } from "../theme";
import { Icon } from "./ui";

const SHOWN_MS = 1600;

function CopyButton({ text, shown }: { readonly text: string; readonly shown: boolean }): ReactElement {
  const { p } = useTheme();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), SHOWN_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <div
      onClick={() => { void copyToClipboard(text); setCopied(true); }}
      role="button"
      aria-label={t("components.copyCode")}
      style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: 6, opacity: shown || copied ? 1 : 0, cursor: "pointer", hover: { opacity: 0.72 } }}
    >
      <Icon name={copied ? "check" : "copy"} size={12} color={copied ? p.string : p.muted} />
    </div>
  );
}

/** A fenced block as the chat draws it: the language, a copy icon on hover, and the code drawn natively. */
export function FencedCode({ fence, lines, language = "" }: { readonly fence: string; readonly lines: readonly string[]; readonly language?: string }): ReactElement {
  const { p } = useTheme();
  const look = useCodeLook();
  const { colorScheme } = useSettings().settings;
  const [hovered, setHovered] = useState(false);
  const theme = useMemo(() => nativeTheme(p, look, syntaxFor(colorScheme, p)), [p, look, colorScheme]);
  const code = useMemo(() => lines.join("\n"), [lines]);
  return (
    <div onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} style={{ display: "flex", flexDirection: "column", borderWidth: 1, borderColor: p.line2, borderRadius: 8, backgroundColor: p.fill }}>
      <div style={{ display: "flex", alignItems: "center", height: 28, paddingLeft: 12, paddingRight: 5 }}>
        <div style={{ flexGrow: 1, minWidth: 0, fontSize: 11, color: p.faint }}>{fence}</div>
        <CopyButton text={code} shown={hovered} />
      </div>
      <div style={{ display: "flex", paddingLeft: 12, paddingRight: 12, paddingBottom: 8, overflowX: "scroll", ...scrollbar(p) }}>
        <code code={code} language={fence || language} theme={theme} />
      </div>
    </div>
  );
}

/** Markdown with the fenced blocks drawn by Eleven, so each one can be copied on its own. */
export function Markdown({ source, color }: { readonly source: string; readonly color: string }): ReactElement {
  const { p } = useTheme();
  const look = useCodeLook();
  const { colorScheme } = useSettings().settings;
  const theme = useMemo(() => nativeTheme(p, look, syntaxFor(colorScheme, p)), [p, look, colorScheme]);
  const parts = useMemo(() => pieces(source), [source]);
  const prose = (text: string, key: string): ReactElement => (
    <markdown key={key} source={text} theme={theme} onLinkClick={(event) => event.value && openLink(event.value)} style={{ color }} />
  );
  if (!parts.some((piece) => piece.kind === "code")) return prose(source, "all");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {parts.map((piece, ix) => (piece.kind === "code"
        ? <FencedCode key={ix} fence={piece.fence} lines={piece.lines} />
        : prose(piece.text, String(ix))))}
    </div>
  );
}
