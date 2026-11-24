import { isRecord, stringField } from "../lib/guards";

/** The functions from a start to a goal, one calling the next; empty when no path was found among the functions searched. */
export type CallPath = { readonly steps: readonly string[]; readonly searched: number; readonly complete: boolean };

const SEARCH_LIMIT = 400;

/** The shortest chain of direct calls from `from` to `to`, reading each function's callees at most once and stopping after `limit` of them. */
export async function searchCallPath(from: string, to: string, callees: (addr: string) => Promise<readonly string[]>, limit = SEARCH_LIMIT): Promise<CallPath> {
  if (from === to) return { steps: [from], searched: 0, complete: true };
  const came = new Map<string, string | null>([[from, null]]);
  let frontier = [from];
  let searched = 0;
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const addr of frontier) {
      if (searched >= limit) return { steps: [], searched, complete: false };
      searched++;
      const calls = await callees(addr).catch((): readonly string[] => []);
      for (const callee of calls) {
        if (came.has(callee)) continue;
        came.set(callee, addr);
        if (callee === to) return { steps: walkBack(came, to), searched, complete: true };
        next.push(callee);
      }
    }
    frontier = next;
  }
  return { steps: [], searched, complete: true };
}

function walkBack(came: ReadonlyMap<string, string | null>, to: string): readonly string[] {
  const steps: string[] = [];
  for (let at: string | null | undefined = to; at; at = came.get(at)) steps.unshift(at);
  return steps;
}

/** REA's `trace_call_path` result as a path; `complete` is false when REA stopped early or couldn't read every function. */
export function parseReaCallPath(result: unknown): CallPath {
  if (!isRecord(result)) return { steps: [], searched: 0, complete: false };
  const steps = Array.isArray(result.traversal_path) ? result.traversal_path.filter((step): step is string => typeof step === "string") : [];
  const searched = Array.isArray(result.nodes) ? result.nodes.length : 0;
  const failures = Array.isArray(result.failures) ? result.failures.length : 0;
  const reached = stringField(result, "goal_status") === "reached";
  return { steps: reached ? steps : [], searched, complete: reached || (result.truncated !== true && failures === 0) };
}
