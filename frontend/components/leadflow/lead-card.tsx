import { cn } from "cn";

import type { Lead } from "@/lib/api";
import { isClosed } from "@/lib/status";
import { dayOffset, formatAgo, formatTime, formatWhen } from "@/lib/time";

import { SnoozeMenu } from "./snooze-menu";
import { StatusBadge } from "./status-badge";

interface LeadCardProps {
  lead: Lead;
  now: Date;
  /** "agenda": a slot in today's follow-ups; "list": a row in the other leads. */
  variant: "agenda" | "list";
  onOpen: (id: number) => void;
  /** Changes when this lead was just updated; replays a short highlight. */
  flashToken?: number;
  /** Why the lead needs attention, shown in the Needs attention view. */
  reasons?: string[];
  /** Offered on follow-ups that are due today or overdue. */
  onSnooze?: (lead: Lead, at: Date) => Promise<void>;
}

export function LeadCard({ lead, now, variant, onOpen, flashToken, reasons, onSnooze }: LeadCardProps) {
  const followUp = lead.next_follow_up_at ? new Date(lead.next_follow_up_at) : null;
  const overdue = followUp !== null && followUp < now;
  const closed = isClosed(lead.status);
  const activity = lead.last_note
    ? `Last discussion ${formatAgo(new Date(lead.last_note.at), now)}`
    : `Added ${formatAgo(new Date(lead.created_at), now)}`;

  const snoozable = Boolean(onSnooze && followUp && dayOffset(followUp, now) <= 0);
  const followUpChip =
    followUp && variant === "agenda" && overdue ? (
      <span className="inline-block rounded-md bg-overdue-tint px-2.5 py-0.5 text-[13px] font-semibold text-overdue">
        Overdue since {formatTime(followUp)}
      </span>
    ) : followUp && variant === "list" ? (
      <span
        className={cn(
          "inline-block rounded-md px-2.5 py-0.5 text-[13px] font-semibold",
          overdue ? "bg-overdue-tint text-overdue" : "bg-secondary text-[#3e4a46]",
        )}
      >
        {overdue ? `Overdue, was due ${formatWhen(followUp, now)}` : `Follow-up ${formatWhen(followUp, now)}`}
      </span>
    ) : null;

  // The Snooze menu is a sibling of the card's button (buttons can't nest), placed over its corner.
  return (
    <div className="relative">
      <button
        type="button"
        data-lead-id={lead.id}
        onClick={() => onOpen(lead.id)}
        className={cn(
          "relative isolate flex w-full flex-col gap-1.5 rounded-[10px] border bg-card px-4 py-3.5 text-left transition-colors",
          "hover:border-[#b5c0ba] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
          overdue ? "border-overdue-border bg-overdue-surface" : "border-border",
          closed && !overdue && "bg-[#f8f9f8]",
        )}
      >
        {flashToken !== undefined && (
          <span
            key={flashToken}
            aria-hidden="true"
            className="lf-flash pointer-events-none absolute inset-0 -z-10 rounded-[10px] bg-accent ring-2 ring-primary/40"
          />
        )}
        {variant === "agenda" && followUp && (
          <span className={cn("text-[13px] font-bold sm:hidden", overdue ? "text-overdue" : "text-primary")}>
            {formatTime(followUp)}
            {overdue && ", overdue"}
          </span>
        )}
        <span className="flex w-full flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <span className={cn("min-w-0 text-base font-semibold [overflow-wrap:anywhere]", closed && "text-muted-foreground")}>
            {lead.name}
          </span>
          {lead.company && <span className="min-w-0 text-muted-foreground [overflow-wrap:anywhere]">{lead.company}</span>}
          <StatusBadge status={lead.status} className="ml-auto shrink-0" />
        </span>
        <span className="flex w-full min-w-0 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2.5">
          <span
            className={cn(
              "line-clamp-2 min-w-0 [overflow-wrap:anywhere] sm:line-clamp-1",
              lead.last_note ? (closed ? "text-muted-foreground" : "text-body") : "text-muted-foreground italic",
            )}
          >
            {lead.last_note ? lead.last_note.body : "No discussions yet"}
          </span>
          <span className="text-[13px] whitespace-nowrap text-muted-foreground">{activity}</span>
        </span>
        {reasons && reasons.length > 0 && (
          <span className="flex flex-wrap gap-1.5">
            {reasons.map((reason) => (
              <span key={reason} className="rounded-md bg-stale px-2.5 py-0.5 text-[13px] font-semibold text-stale-foreground">
                {reason}
              </span>
            ))}
          </span>
        )}
        {(followUpChip || snoozable) && (
          // With Snooze, the bottom row keeps room on the right for its button (rendered outside).
          <span className="flex w-full items-end justify-between gap-2">
            <span className="min-w-0">{followUpChip}</span>
            {snoozable && <span aria-hidden="true" className="h-8 w-[104px] shrink-0" />}
          </span>
        )}
      </button>
      {snoozable && onSnooze && <SnoozeMenu lead={lead} now={now} onSnooze={onSnooze} />}
    </div>
  );
}
