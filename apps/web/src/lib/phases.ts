import type { Stage } from "@/lib/labels";

/** Journ's four phases. The seven detailed stages stay in the data; the phase is how a campaign reads at a glance. */
export const PHASES = ["Plan", "Build", "Review", "Launch"] as const;
export type Phase = (typeof PHASES)[number];

const PHASE_OF: Record<Stage, Phase> = {
  brief_planning: "Plan",
  design: "Build",
  development: "Build",
  internal_qa: "Review",
  client_uat: "Review",
  live_deployment: "Launch",
  completed: "Launch",
};

export const phaseOf = (stage: Stage): Phase => PHASE_OF[stage];
export const phaseIndex = (stage: Stage) => PHASES.indexOf(phaseOf(stage));
/** A finished campaign has passed every phase, including Launch. */
export const phaseDone = (stage: Stage, i: number) => stage === "completed" || i < phaseIndex(stage);
