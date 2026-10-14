import type { ReactElement } from "react";

import { fileIcon, type FormatLogo, formatLogo } from "../lib/fileIcon";
import { useLoaded } from "../lib/useLoaded";
import { useTheme } from "../theme";

function Logo({ logo, box }: { readonly logo: FormatLogo; readonly box: number }): ReactElement {
  const { p } = useTheme();
  switch (logo.kind) {
    case "color":
      return <img src={logo.src} objectFit="contain" style={{ width: box, height: box, flexShrink: 0, pointerEvents: "none" }} />;
    case "mono": {
      const width = Math.round(box * Math.min(logo.aspect, 1.12));
      return <svg source={logo.svg} style={{ width, height: Math.round(width / logo.aspect), flexShrink: 0, color: p.text, pointerEvents: "none" }} />;
    }
    default: {
      const unhandled: never = logo;
      return unhandled;
    }
  }
}

/** Sized like a macOS app icon: the rounded square fills about 80% of its box, corners at 22.5% of its side. */
function LogoTile({ logo, px }: { readonly logo: FormatLogo; readonly px: number }): ReactElement {
  const { p } = useTheme();
  const tile = Math.round(px * 0.805);
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: px, height: px, flexShrink: 0, pointerEvents: "none" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: tile, height: tile, borderRadius: tile * 0.225, borderWidth: 1, borderColor: p.line3, backgroundColor: p.raised2, pointerEvents: "none" }}>
        <Logo logo={logo} box={Math.round(tile * 0.74)} />
      </div>
    </div>
  );
}

/** A file's icon: its format's logo on a tile, else what Finder shows, else `fallback`. */
export function FileIcon({ path, px, radius = px / 4.5, fallback }: {
  readonly path: string;
  readonly px: number;
  readonly radius?: number;
  readonly fallback: ReactElement;
}): ReactElement {
  const logo = path ? formatLogo(path) : null;
  const icon = useLoaded<string | null>(() => (logo || !path ? Promise.resolve(null) : fileIcon(path)), `icon:${path}`);
  if (logo && px < 24) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: px, height: px, flexShrink: 0, pointerEvents: "none" }}>
        <Logo logo={logo} box={Math.round(px * 0.805)} />
      </div>
    );
  }
  if (logo) return <LogoTile logo={logo} px={px} />;
  if (icon.kind === "ready" && icon.value) return <img src={icon.value} style={{ width: px, height: px, flexShrink: 0, borderRadius: radius }} />;
  return fallback;
}
