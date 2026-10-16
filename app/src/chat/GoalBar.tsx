import { type ReactElement, useState } from "react";

import type { Goal, GoalStatus } from "../agents/events";
import { Icon } from "../components/ui";
import { useNow } from "../lib/useNow";
import { MONO, useTheme } from "../theme";

const STATUS: Readonly<Record<GoalStatus, string>> = {
  active: "Pursuing goal",
  paused: "Goal paused",
  blocked: "Goal blocked",
  complete: "Goal complete",
  limited: "Goal limit reached",
};

function duration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  const remainder = total % 60;

  if (hours > 0) return `${hours}h ${minutes}m ${remainder}s`;
  if (minutes > 0) return `${minutes}m ${remainder}s`;
  return `${remainder}s`;
}

/** Only the clock refreshes each second; the rest of the chat keeps its own render cadence. */
function GoalDuration({ goal }: { readonly goal: Goal }): ReactElement {
  const { p } = useTheme();
  const active = goal.status === "active";
  const now = useNow(active);
  const sinceUpdate = active ? Math.max(0, now - goal.updatedAt) / 1000 : 0;
  const elapsed = duration(goal.timeUsedSeconds + sinceUpdate);

  return (
    <div
      aria-label={`Time spent on goal: ${elapsed}`}
      style={{
        flexShrink: 0,
        fontFamily: MONO,
        fontSize: 11.5,
        color: p.muted,
        whiteSpace: "nowrap",
      }}
    >
      {elapsed}
    </div>
  );
}

export function GoalBar({ goal }: { readonly goal: Goal }): ReactElement {
  const { p } = useTheme();
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        borderWidth: 1,
        borderColor: p.line2,
        borderRadius: 12,
        backgroundColor: p.win,
      }}
    >
      <div
        role="button"
        aria-expanded={expanded}
        aria-label={`${STATUS[goal.status]}: ${goal.objective}`}
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          minHeight: 36,
          paddingLeft: 12,
          paddingRight: 12,
          cursor: "pointer",
          hover: { opacity: 0.72 },
        }}
      >
        <div
          style={{
            flexShrink: 0,
            fontSize: 12.5,
            fontWeight: 500,
            color: p.text3,
            whiteSpace: "nowrap",
          }}
        >
          {STATUS[goal.status]}
        </div>
        <div
          style={{
            flexGrow: 1,
            minWidth: 0,
            fontSize: 12.5,
            color: p.muted,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {goal.objective}
        </div>
        <GoalDuration goal={goal} />
        <Icon name={expanded ? "chevron-up" : "disclosure"} size={11} color={p.faint} />
      </div>
      {expanded && (
        <div
          style={{
            maxHeight: 160,
            overflowY: "scroll",
            paddingLeft: 12,
            paddingRight: 12,
            paddingBottom: 12,
            fontSize: 13,
            lineHeight: 19,
            color: p.text3,
            whiteSpace: "normal",
            userSelect: "text",
          }}
        >
          {goal.objective}
        </div>
      )}
    </div>
  );
}
