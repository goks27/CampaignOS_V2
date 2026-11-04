import * as React from "react";

/** What the user is looking at on the canvas, so the assistant panel can answer "this" questions. UI state only. */
export type AssistantHint = { campaignId: string; node: string; label: string } | null;

let hint: AssistantHint = null;
const subs = new Set<() => void>();

export const getAssistantHint = () => hint;
export function setAssistantHint(next: AssistantHint) {
  if (JSON.stringify(next) === JSON.stringify(hint)) return;
  hint = next;
  subs.forEach((f) => f());
}
export function useAssistantHint() {
  return React.useSyncExternalStore((cb) => { subs.add(cb); return () => { subs.delete(cb); }; }, getAssistantHint);
}
