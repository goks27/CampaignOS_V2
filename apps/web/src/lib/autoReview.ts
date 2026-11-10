/**
 * What to say after an upload about the automatic review. Reviews start by themselves (on by default; an Admin can switch each off in
 * Settings, Automation). When nothing started, say why in one line, and where to start it by hand.
 */
export type UploadKind = "sow" | "design" | "build";

export function autoReviewNote(kind: UploadKind, queued: number): string {
  if (queued > 0) return "Review queued automatically.";
  switch (kind) {
    case "sow": return "No automatic review ran. Press Check SOW to start it.";
    case "design": return "No automatic review ran: accept some requirements first (or switch automatic reviews on in Settings). Press Review designs any time.";
    case "build": return "No automatic check ran: automatic reviews may be off in Settings, or there is nothing to check yet. Press Test build any time.";
  }
}
