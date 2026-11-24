import { parseEvidence } from "./edits";
import { askQuietly, type QuietAsk } from "./rewrite";

/** One unnamed function and its pseudocode, read before the pass so each agent starts with the code in hand. */
export type NameJob = { readonly addr: string; readonly name: string; readonly pseudocode: string };

/** A name an agent proposes, with what it read; `evidence` is empty when it gave none. */
export type Proposal = { readonly addr: string; readonly name: string; readonly why: string; readonly evidence: readonly string[] };

const BATCH = 8;
const MAX_CODE = 2500;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{1,63}$/;

/** Small functions first: they are usually the leaves, and a caller is easier to name once its callees have names. */
export function batches(jobs: readonly NameJob[], size = BATCH): readonly (readonly NameJob[])[] {
  const ordered = [...jobs].sort((a, b) => a.pseudocode.length - b.pseudocode.length);
  return Array.from({ length: Math.ceil(ordered.length / size) }, (_, ix) => ordered.slice(ix * size, ix * size + size));
}

export function namingPrompt(batch: readonly NameJob[], binary: string): string {
  return [
    `Name these functions from ${binary}. They have no real names yet. Read each one; use your tools to read callers, callees or strings only when the code below doesn't settle it.`,
    "",
    "Give a name only when the code shows what the function does. Skip any you can't tell; a skipped function is better than a wrong name.",
    "Reply with one JSON object per line and nothing else:",
    '{"addr": "0x100001234", "name": "parse_config_line", "why": "splits a line on = and stores both halves", "evidence": "0x100001250 calls strchr with \'=\', 0x100004020 string \\"config\\""}',
    "evidence lists the addresses you relied on and what was there, comma separated. Use C identifiers for names.",
    "",
    ...batch.flatMap((job) => [`${job.name} at ${job.addr}:`, "```c", job.pseudocode.slice(0, MAX_CODE), "```", ""]),
  ].join("\n");
}

function field(value: unknown, key: string): string {
  if (typeof value !== "object" || value === null) return "";
  const found: unknown = Reflect.get(value, key);
  return typeof found === "string" ? found.trim() : "";
}

/** The names an agent proposed for this batch: only well-formed lines, only for functions it was asked about, one each. */
export function parseNames(reply: string, batch: readonly NameJob[]): readonly Proposal[] {
  const asked = new Set(batch.map((job) => job.addr.toLowerCase()));
  const named = new Set<string>();
  return reply.split("\n").flatMap((line): Proposal[] => {
    const text = line.trim().replace(/^[-*]\s*/, "").replace(/,$/, "");
    if (!text.startsWith("{")) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return [];
    }
    const addr = field(parsed, "addr").toLowerCase();
    const name = field(parsed, "name");
    if (!asked.has(addr) || named.has(addr) || !IDENTIFIER.test(name) || /^(?:FUN|sub|fcn)_/i.test(name)) return [];
    named.add(addr);
    return [{ addr, name, why: field(parsed, "why"), evidence: parseEvidence(field(parsed, "evidence")) }];
  });
}

/**
 * Two independent passes over the same batch. A name both chose stands, with
 * both passes' evidence; when they differ, the first is kept but its evidence
 * is dropped so it shows as a guess, and the reason names both choices.
 */
export function agree(first: readonly Proposal[], second: readonly Proposal[]): readonly Proposal[] {
  const other = new Map(second.map((proposal) => [proposal.addr, proposal]));
  return first.flatMap((proposal): Proposal[] => {
    const match = other.get(proposal.addr);
    if (!match) return [];
    if (match.name.toLowerCase() === proposal.name.toLowerCase()) {
      return [{ ...proposal, evidence: [...new Set([...proposal.evidence, ...match.evidence])] }];
    }
    return [{ addr: proposal.addr, name: proposal.name, why: `Two passes disagreed: ${proposal.name} or ${match.name}. Check before accepting.`, evidence: [] }];
  });
}

export type BulkProgress = { readonly done: number; readonly total: number; readonly named: number };

/** Several agents work through the batches from one shared queue, each with only its own batch in context. */
export async function nameInParallel(req: QuietAsk & { readonly binaryName: string }, jobs: readonly NameJob[], workers: number, onBatch: (proposals: readonly Proposal[], progress: BulkProgress) => void, crossCheck = true): Promise<number> {
  const queue = batches(jobs);
  let next = 0;
  let done = 0;
  let named = 0;
  const worker = async (): Promise<void> => {
    while (next < queue.length) {
      const batch = queue[next++];
      if (!batch) continue;
      let proposals: readonly Proposal[] = [];
      try {
        const ask = async (): Promise<readonly Proposal[]> => parseNames(await askQuietly(req, namingPrompt(batch, req.binaryName), () => {}), batch);
        proposals = crossCheck ? agree(...(await Promise.all([ask(), ask()]))) : await ask();
      } catch {
        proposals = [];
      }
      done++;
      named += proposals.length;
      onBatch(proposals, { done, total: queue.length, named });
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(workers, queue.length)) }, worker));
  return named;
}
