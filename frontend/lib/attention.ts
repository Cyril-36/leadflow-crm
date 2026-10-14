// "Needs attention": deterministic rules for open leads a rep should act on. Import-free so Node's
// test runner can load it directly (lib/attention.test.ts).

/** A lead with no discussion for this many days is considered quiet. */
export const QUIET_DAYS = 7;

const DAY_MS = 86_400_000;

export type AttentionReason = "overdue" | "no_follow_up" | "quiet";

export interface AttentionLead {
  status: string;
  next_follow_up_at: string | null;
  last_note: { at: string } | null;
  created_at: string;
}

/**
 * Why an open lead needs attention, in priority order; empty when it doesn't. Won and Lost leads
 * never need attention.
 */
export function attentionReasons(lead: AttentionLead, now: Date): AttentionReason[] {
  if (lead.status === "won" || lead.status === "lost") return [];
  const reasons: AttentionReason[] = [];
  if (!lead.next_follow_up_at) reasons.push("no_follow_up");
  else if (Date.parse(lead.next_follow_up_at) < now.getTime()) reasons.push("overdue");
  if (quietDays(lead, now) >= QUIET_DAYS) reasons.push("quiet");
  return reasons;
}

/** Whole days since the last discussion, or since the lead was added if there is none. */
export function quietDays(lead: AttentionLead, now: Date): number {
  const since = Date.parse(lead.last_note?.at ?? lead.created_at);
  return Math.floor((now.getTime() - since) / DAY_MS);
}

/** Short, user-facing explanation of one reason. */
export function describeReason(reason: AttentionReason, lead: AttentionLead, now: Date): string {
  if (reason === "overdue") return "Follow-up overdue";
  if (reason === "no_follow_up") return "No follow-up scheduled";
  const days = quietDays(lead, now);
  return lead.last_note ? `No discussion for ${days} days` : `Added ${days} days ago, no discussion yet`;
}
