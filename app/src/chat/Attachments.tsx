import type { ReactElement } from "react";
import { pathToFileURL } from "node:url";

import { type Attachment, sizeLabel } from "../agents/attachments";
import { Icon } from "../components/ui";
import { t } from "../i18n";
import { openLink } from "../settings/system";
import { useTheme } from "../theme";

const THUMB = 18;
const PREVIEW = 120;

function kindIcon(file: Attachment): string {
  return file.kind === "text" ? "text" : "binary";
}

/** One attached file as a small chip: a thumbnail or icon, its name and size, and a way to take it off. */
export function AttachmentChip({ file, onRemove = null, onOpen = null }: { readonly file: Attachment; readonly onRemove?: (() => void) | null; readonly onOpen?: (() => void) | null }): ReactElement {
  const { p } = useTheme();
  return (
    <div {...(onOpen ? { onClick: onOpen, role: "button" } : {})} aria-label={file.name} style={{ display: "flex", alignItems: "center", gap: 6, height: 26, maxWidth: 260, paddingLeft: 6, paddingRight: onRemove ? 4 : 8, borderRadius: 7, backgroundColor: p.fill2, ...(onOpen ? { cursor: "pointer", hover: { opacity: 0.72 } } : {}) }}>
      {file.kind === "image"
        ? <img src={file.path} objectFit="cover" style={{ width: THUMB, height: THUMB, flexShrink: 0, borderRadius: 4, pointerEvents: "none" }} />
        : <Icon name={kindIcon(file)} size={13} color={p.muted} />}
      <div style={{ flexShrink: 1, minWidth: 0, fontSize: 12, color: p.text3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{file.name}</div>
      <div style={{ flexShrink: 0, fontSize: 11, color: p.faint, whiteSpace: "nowrap" }}>{sizeLabel(file.bytes)}</div>
      {onRemove && (
        <div onClick={onRemove} role="button" aria-label={t("composer.remove", { name: file.name })} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 18, height: 18, borderRadius: 4, cursor: "pointer", hover: { opacity: 0.72 } }}>
          <Icon name="close" size={9} color={p.faint} />
        </div>
      )}
    </div>
  );
}

/** What went with a sent message: pictures large enough to recognise, other files as chips; each opens in its own app. */
export function SentAttachments({ files }: { readonly files: readonly Attachment[] }): ReactElement | null {
  const { p } = useTheme();
  if (files.length === 0) return null;
  const open = (file: Attachment): void => openLink(pathToFileURL(file.path).href);
  const images = files.filter((file) => file.kind === "image");
  const others = files.filter((file) => file.kind !== "image");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {images.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {images.map((file) => (
            <div key={file.path} onClick={() => open(file)} role="button" aria-label={file.name} style={{ display: "flex", borderRadius: 8, borderWidth: 1, borderColor: p.line2, overflow: "hidden", cursor: "pointer", hover: { opacity: 0.72 } }}>
              <img src={file.path} objectFit="cover" style={{ width: PREVIEW * 1.5, height: PREVIEW, pointerEvents: "none" }} />
            </div>
          ))}
        </div>
      )}
      {others.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {others.map((file) => <AttachmentChip key={file.path} file={file} onOpen={() => open(file)} />)}
        </div>
      )}
    </div>
  );
}
