import { type PublicInstance, useGpuix } from "@gpuix/react";
import { type ReactElement, type ReactNode, useEffect, useRef } from "react";

import { scrollbar, useTheme } from "../theme";

/** A menu's scrolling rows; GPUI builds only the ones in view. A virtual list needs a bounded height, so it sizes to its rows up to `maxHeight`. */
export function MenuRows({ heights, maxHeight, reveal = null, children }: {
  readonly heights: readonly number[];
  readonly maxHeight: number;
  readonly reveal?: number | null;
  readonly children: ReactNode;
}): ReactElement {
  const { p } = useTheme();
  const { renderer } = useGpuix();
  const list = useRef<PublicInstance | null>(null);
  useEffect(() => {
    const id = list.current?.id;
    if (reveal !== null && id !== undefined) renderer?.scrollToItem?.(id, reveal);
  }, [reveal]);
  const total = heights.reduce((sum, height) => sum + height, 0);
  return (
    <virtual-list ref={list} estimatedItemHeight={heights[0] ?? 32} style={{ ...scrollbar(p), height: Math.min(total, maxHeight), flexShrink: 0 }}>
      {children}
    </virtual-list>
  );
}
