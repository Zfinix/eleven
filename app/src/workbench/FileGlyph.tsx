import type { ReactElement } from "react";

import { useTheme } from "../theme";
import { FileIcon } from "../components/FileIcon";
import { Icon } from "../components/ui";
import { useBench } from "./parts";

/** The open file's icon (its format's logo or an app's own icon), falling back to the generic binary glyph. */
export function FileGlyph({ size = 18 }: { readonly size?: number }): ReactElement {
  const { p } = useTheme();
  const { program } = useBench();
  const source = program.origin || program.path;
  return <FileIcon path={source} px={size} fallback={<Icon name="binary" size={Math.round(size * 0.8)} color={p.muted} />} />;
}
