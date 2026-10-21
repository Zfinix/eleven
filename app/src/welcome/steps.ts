import type { PlainId } from "../i18n";

export type StepId = "engine" | "agent" | "keys" | "try";

export type Step = { readonly id: StepId; readonly label: PlainId };

export const STEPS: readonly Step[] = [
  { id: "engine", label: "setup.step.engine" },
  { id: "agent", label: "setup.step.agent" },
  { id: "keys", label: "setup.step.keys" },
  { id: "try", label: "setup.step.try" },
];

export function nextStep(id: StepId): StepId | null {
  return STEPS[STEPS.findIndex((step) => step.id === id) + 1]?.id ?? null;
}

export function previousStep(id: StepId): StepId | null {
  return STEPS[STEPS.findIndex((step) => step.id === id) - 1]?.id ?? null;
}
