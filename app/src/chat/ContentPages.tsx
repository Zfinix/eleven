import { type ReactElement, type ReactNode, useState } from "react";

import { useTheme } from "../theme";

export function PageControls({
  label,
  previous,
  next,
  latest,
}: {
  readonly label: string;
  readonly previous: (() => void) | null;
  readonly next: (() => void) | null;
  readonly latest?: (() => void) | null;
}): ReactElement {
  const { p } = useTheme();
  const button = {
    cursor: "pointer",
    color: p.link,
    padding: 4,
    hover: { opacity: 0.72 },
  } as const;
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 8,
        fontSize: 12,
        color: p.muted,
      }}
    >
      <div>{label}</div>
      {previous && (
        <div role="button" onClick={previous} style={button}>
          Previous
        </div>
      )}
      {next && (
        <div role="button" onClick={next} style={button}>
          Next
        </div>
      )}
      {latest && (
        <div role="button" onClick={latest} style={button}>
          Latest
        </div>
      )}
    </div>
  );
}

const PAGE_CHARS = 12_000;

/** Large replies remain readable without handing one enormous string to native layout. */
export function ContentPages({
  text,
  followTail = false,
  children,
}: {
  readonly text: string;
  readonly followTail?: boolean;
  readonly children: (text: string) => ReactNode;
}): ReactElement {
  const [selected, setSelected] = useState<number | null>(null);
  const last = Math.max(0, Math.ceil(text.length / PAGE_CHARS) - 1);
  const page = Math.min(selected ?? (followTail ? last : 0), last);
  const start = page * PAGE_CHARS;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {children(text.slice(start, start + PAGE_CHARS))}
      {last > 0 && (
        <PageControls
          label={`Page ${page + 1} of ${last + 1}`}
          previous={page > 0 ? () => setSelected(page - 1) : null}
          next={page < last ? () => setSelected(page + 1) : null}
          latest={followTail && selected !== null ? () => setSelected(null) : null}
        />
      )}
    </div>
  );
}
