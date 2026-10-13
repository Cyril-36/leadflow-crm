import { cn } from "cn";

import type { Lead } from "@/lib/api";
import { formatTime } from "@/lib/time";

import { LeadCard } from "./lead-card";

interface AgendaProps {
  leads: Lead[];
  now: Date;
  onOpen: (id: number) => void;
}

/** Today's follow-ups as a day planner: overdue slots above the "Now" line, upcoming below. */
export function Agenda({ leads, now, onOpen }: AgendaProps) {
  const due = (lead: Lead) => new Date(lead.next_follow_up_at as string);
  const before = leads.filter((lead) => due(lead) < now);
  const after = leads.filter((lead) => due(lead) >= now);

  const slot = (lead: Lead) => {
    const overdue = due(lead) < now;
    return (
      <li key={lead.id} className="grid grid-cols-1 gap-x-4 sm:grid-cols-[104px_minmax(0,1fr)]">
        <span
          aria-hidden="true"
          className={cn(
            "hidden pt-3.5 text-right font-semibold whitespace-nowrap sm:block",
            overdue && "text-overdue",
          )}
        >
          {formatTime(due(lead))}
        </span>
        <LeadCard lead={lead} now={now} variant="agenda" onOpen={onOpen} />
      </li>
    );
  };

  return (
    <section aria-labelledby="agenda-heading" className="mb-8">
      <h2 id="agenda-heading" className="mb-2.5 text-[15px] font-semibold">
        Today&apos;s follow-ups
      </h2>
      <ol className="flex flex-col gap-2">
        {before.map(slot)}
        <li className="my-0.5 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2.5 sm:grid-cols-[104px_minmax(0,1fr)] sm:gap-x-4">
          <span className="text-[13px] font-bold whitespace-nowrap text-primary sm:text-right">
            Now {formatTime(now)}
          </span>
          <span
            aria-hidden="true"
            className="relative h-0.5 bg-primary before:absolute before:-top-1 before:-left-1.5 before:size-2.5 before:rounded-full before:bg-primary"
          />
        </li>
        {after.map(slot)}
      </ol>
    </section>
  );
}
