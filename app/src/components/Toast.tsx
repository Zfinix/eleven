import type { ReactElement } from "react";

import { t } from "../i18n";
import { ErrorCard } from "./kit";
import { Icon } from "./ui";

/** An error card pinned to the bottom right until dismissed. */
export function Toast({ title, detail, raw = null, onClose }: { readonly title: string; readonly detail: string; readonly raw?: string | null; readonly onClose: () => void }): ReactElement {
  const shadow = { offsetX: 0, offsetY: 12, blurRadius: 32, spreadRadius: 0, color: "rgba(0,0,0,0.3)" };
  return (
    <div style={{ position: "absolute", right: 16, bottom: 42, display: "flex", flexDirection: "column", maxWidth: 400, borderRadius: 10, boxShadow: shadow }}>
      <ErrorCard title={title} detail={detail} raw={raw} />
      <div onClick={onClose} role="button" aria-label={t("components.dismiss")} style={{ position: "absolute", top: 8, right: 8, display: "flex", padding: 4, cursor: "pointer", hover: { opacity: 0.72 } }}>
        <Icon name="close" size={11} />
      </div>
    </div>
  );
}
