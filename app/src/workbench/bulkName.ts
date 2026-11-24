import { nameInParallel, type NameJob } from "../engine/bulkName";
import type { Author } from "../engine/edits";
import { isAutoName } from "./diff";
import { propose } from "../engine/history";
import { t } from "../i18n";
import type { Bench } from "./parts";

const MAX_FUNCTIONS = 160;
const WORKERS = 3;
const READERS = 4;

/** The unnamed functions worth a pass, with their pseudocode, read a few at a time. */
async function unnamed(bench: Bench): Promise<readonly NameJob[]> {
  const { program, nameOf } = bench;
  const wanted = program.functions.filter((fn) => fn.kind === "function" && isAutoName(nameOf(fn.addr))).slice(0, MAX_FUNCTIONS);
  const jobs: NameJob[] = [];
  let next = 0;
  const reader = async (): Promise<void> => {
    while (next < wanted.length) {
      const fn = wanted[next++];
      if (!fn) continue;
      try {
        jobs.push({ addr: fn.addr, name: nameOf(fn.addr), pseudocode: await program.code(fn.addr, "pseudo") });
      } catch {
        continue;
      }
    }
  };
  await Promise.all(Array.from({ length: READERS }, reader));
  return jobs;
}

/** Several quiet agents name the unnamed functions in parallel; every name arrives as a suggestion to accept or decline. */
export async function nameUnnamed(bench: Bench): Promise<void> {
  const { program, chat } = bench;
  const agent = chat.agents.selected;
  const jobs = await unnamed(bench);
  if (jobs.length === 0) {
    chat.thread.note(t("workbench.bulkName.none"));
    return;
  }
  chat.thread.note(t("workbench.bulkName.started", { count: jobs.length, agents: WORKERS, agent: agent.name }));
  const by: Author = { kind: "agent", agent: agent.name, chat: chat.thread.id };
  const native = chat.agents.installed.get(agent.id)?.command ?? null;
  const named = await nameInParallel({ agent, native, projectId: program.id, binary: { path: program.path }, binaryName: program.name }, jobs, WORKERS, (proposals) => {
    for (const proposal of proposals) propose(program.id, "names", proposal.addr, proposal.name, by, proposal.why || undefined, proposal.evidence);
  });
  chat.thread.note(t("workbench.bulkName.done", { named, count: jobs.length }));
}
