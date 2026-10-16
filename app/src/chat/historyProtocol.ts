import type { SavedThread, ThreadSummary } from "./history";
import type { ThreadPatch } from "./historyPatch";
import type { Target } from "../engine/target";

export type HistoryOperation =
  | { readonly kind: "list" }
  | { readonly kind: "load"; readonly id: string }
  | { readonly kind: "prepare"; readonly patch: ThreadPatch }
  | {
      readonly kind: "document";
      readonly target: Target;
      readonly id: string;
      readonly path: string;
      readonly threadIds: readonly string[];
    };

export type HistoryRequest = { readonly requestId: number; readonly operation: HistoryOperation };

export type HistoryValue =
  | {
      readonly kind: "list";
      readonly summaries: readonly ThreadSummary[];
      readonly issues: readonly string[];
    }
  | { readonly kind: "load"; readonly thread: SavedThread | null }
  | { readonly kind: "prepare"; readonly temporary: string; readonly summary: ThreadSummary }
  | { readonly kind: "document" };

export type HistoryResponse =
  | { readonly requestId: number; readonly ok: true; readonly value: HistoryValue }
  | { readonly requestId: number; readonly ok: false; readonly error: string };
