import { cn } from "cn";

import type { Entry } from "@/lib/api";
import { dayOffset, formatAgo, formatTime, formatWhen } from "@/lib/time";

/** "Today", "Yesterday" or "Mon 12 Oct" (with the year when it isn't this year). */
function dayLabel(t: Date, now: Date): string {
  const k = dayOffset(t, now);
  if (k === 0) return "Today";
  if (k === -1) return "Yesterday";
  return formatWhen(t, now).replace(/, [^,]+$/, "");
}

/**
 * Discussion history, newest first, grouped by day. System events are one compact line; notes get
 * a full block.
 */
export function Timeline({ entries, now }: { entries: Entry[]; now: Date }) {
  return (
    <ol aria-label="Discussion history, newest first" className="flex flex-col">
      {entries.map((entry, index) => {
        const at = new Date(entry.created_at);
        const day = dayLabel(at, now);
        const newDay = index === 0 || dayLabel(new Date(entries[index - 1].created_at), now) !== day;
        const isNote = entry.kind === "note";
        const nextSameDay =
          index < entries.length - 1 && dayLabel(new Date(entries[index + 1].created_at), now) === day;
        const followUp = entry.follow_up_at ? new Date(entry.follow_up_at) : null;
        let body = entry.body;
        if (entry.kind === "follow_up_cleared" && followUp) body = `Follow-up for ${formatWhen(followUp, now)} marked done`;
        if (entry.kind === "follow_up_set" && followUp)
          body = `${entry.body === "Follow-up rescheduled" ? "Follow-up moved to" : "Follow-up set for"} ${formatWhen(followUp, now)}`;
        return (
          <li key={entry.id}>
            {newDay && <p className={cn("mb-2 text-[13px] font-semibold text-body", index > 0 && "pt-1")}>{day}</p>}
            <div className={cn("relative pl-7", isNote ? "pb-[18px]" : "pb-3")}>
              {nextSameDay && <span aria-hidden="true" className="absolute top-4 bottom-0 left-[5px] w-0.5 bg-border" />}
              <span
                aria-hidden="true"
                className={cn(
                  "absolute rounded-full ring-[3px] ring-card",
                  isNote ? "top-1 left-0 size-3" : "top-1.5 left-0.5 size-2",
                  index === 0 ? "bg-primary" : "bg-input",
                )}
              />
              {isNote ? (
                <>
                  <p className="mb-1 text-[13px] text-muted-foreground">
                    <time dateTime={entry.created_at} title={at.toLocaleString()}>
                      {formatTime(at)}
                    </time>{" "}
                    ({formatAgo(at, now)})
                  </p>
                  <p className="whitespace-pre-wrap text-body [overflow-wrap:anywhere]">{entry.body}</p>
                  {followUp && (
                    <span className="mt-2 inline-block rounded-md bg-accent px-2.5 py-0.5 text-[13px] font-semibold text-accent-foreground">
                      Follow-up set for {formatWhen(followUp, now)}
                    </span>
                  )}
                </>
              ) : (
                <p className="text-[13px] text-muted-foreground [overflow-wrap:anywhere]">
                  <i className="text-body">{body}</i>,{" "}
                  <time dateTime={entry.created_at} title={at.toLocaleString()}>
                    {formatTime(at)}
                  </time>
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
