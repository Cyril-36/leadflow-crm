export type LeadStatus = "new" | "contacted" | "qualified" | "proposal_sent" | "won" | "lost";

export interface StatusOption {
  value: LeadStatus;
  label: string;
}

export const STATUSES: StatusOption[] = [
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "qualified", label: "Qualified" },
  { value: "proposal_sent", label: "Proposal Sent" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
];

const LABELS = Object.fromEntries(STATUSES.map((s) => [s.value, s.label])) as Record<LeadStatus, string>;

export function statusLabel(status: LeadStatus): string {
  return LABELS[status];
}

/** Badge colors: every pair meets 4.5:1 contrast, and the text label always carries the meaning. */
export const STATUS_BADGE: Record<LeadStatus, string> = {
  new: "bg-[#e6edf7] text-[#2f4c77]",
  contacted: "bg-[#fbefdc] text-[#7a4106]",
  qualified: "bg-[#dff0ea] text-[#0d5c4f]",
  proposal_sent: "bg-[#eee8fa] text-[#563797]",
  won: "bg-[#e2f2e5] text-[#1d6530]",
  lost: "bg-[#eceeed] text-[#4e5653]",
};

export function isClosed(status: LeadStatus): boolean {
  return status === "won" || status === "lost";
}
