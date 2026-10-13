import { cn } from "cn";

import type { Lead } from "@/lib/api";
import { isClosed } from "@/lib/status";
import { formatAgo, formatTime, formatWhen } from "@/lib/time";

import { StatusBadge } from "./status-badge";

interface LeadCardProps {
  lead: Lead;
  now: Date;
  /** "agenda": a slot in today's follow-ups; "list": a row in the other leads. */
  variant: "agenda" | "list";
  onOpen: (id: number) => void;
}

export function LeadCard({ lead, now, variant, onOpen }: LeadCardProps) {
  const followUp = lead.next_follow_up_at ? new Date(lead.next_follow_up_at) : null;
  const overdue = followUp !== null && followUp < now;
  const closed = isClosed(lead.status);
  const activity = lead.last_note
    ? `Last discussion ${formatAgo(new Date(lead.last_note.at), now)}`
    : `Added ${formatAgo(new Date(lead.created_at), now)}`;

  return (
    <button
      type="button"
      data-lead-id={lead.id}
      onClick={() => onOpen(lead.id)}
      className={cn(
        "flex w-full flex-col gap-1.5 rounded-[10px] border bg-card px-4 py-3.5 text-left transition-colors",
        "hover:border-[#b5c0ba] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        overdue ? "border-overdue-border bg-overdue-surface" : "border-border",
        closed && !overdue && "bg-[#f8f9f8]",
      )}
    >
      {variant === "agenda" && followUp && (
        <span className={cn("text-[13px] font-bold sm:hidden", overdue ? "text-overdue" : "text-primary")}>
          {formatTime(followUp)}
          {overdue && ", overdue"}
        </span>
      )}
      <span className="flex w-full flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className={cn("text-base font-semibold", closed && "text-muted-foreground")}>{lead.name}</span>
        {lead.company && <span className="text-muted-foreground">{lead.company}</span>}
        <StatusBadge status={lead.status} className="ml-auto" />
      </span>
      <span className="flex w-full min-w-0 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2.5">
        <span
          className={cn(
            "line-clamp-2 min-w-0 sm:line-clamp-1",
            lead.last_note ? (closed ? "text-muted-foreground" : "text-body") : "text-muted-foreground italic",
          )}
        >
          {lead.last_note ? lead.last_note.body : "No discussions yet"}
        </span>
        <span className="text-[13px] whitespace-nowrap text-muted-foreground">{activity}</span>
      </span>
      {variant === "agenda" && overdue && followUp && (
        <span className="self-start rounded-md bg-overdue-tint px-2.5 py-0.5 text-[13px] font-semibold text-overdue">
          Overdue since {formatTime(followUp)}
        </span>
      )}
      {variant === "list" && followUp && (
        <span
          className={cn(
            "self-start rounded-md px-2.5 py-0.5 text-[13px] font-semibold",
            overdue ? "bg-overdue-tint text-overdue" : "bg-secondary text-[#3e4a46]",
          )}
        >
          {overdue ? `Overdue, was due ${formatWhen(followUp, now)}` : `Follow-up ${formatWhen(followUp, now)}`}
        </span>
      )}
    </button>
  );
}
