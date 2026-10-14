"use client";

import { AlarmClock, ChevronDown } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Lead } from "@/lib/api";
import { snoozeShortcuts } from "@/lib/time";

interface SnoozeMenuProps {
  lead: Lead;
  now: Date;
  onSnooze: (lead: Lead, at: Date) => Promise<void>;
}

/** One-click "move this follow-up" from a card: later today, tomorrow, next working day. */
export function SnoozeMenu({ lead, now, onSnooze }: SnoozeMenuProps) {
  const [busy, setBusy] = useState(false);
  const current = lead.next_follow_up_at ? new Date(lead.next_follow_up_at) : null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label={`Snooze the follow-up for ${lead.name}`}
          data-snooze-for={lead.id}
          aria-disabled={busy}
          className="absolute right-4 bottom-3.5 h-8 gap-1 bg-card px-2.5 text-[13px] font-semibold aria-disabled:opacity-60"
        >
          <AlarmClock aria-hidden="true" />
          Snooze
          <ChevronDown aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      {/* Radix returns focus to this trigger on close; after the request the app moves it on. */}
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel>Move the follow-up to</DropdownMenuLabel>
        {snoozeShortcuts(now, current).map((option) => {
          const alreadySet = option.at.getTime() === current?.getTime();
          return (
            <DropdownMenuItem
              key={option.label}
              className="text-[14px]"
              disabled={alreadySet}
              onSelect={async () => {
                if (busy) return;
                setBusy(true);
                await onSnooze(lead, option.at);
                setBusy(false);
              }}
            >
              {option.label}
              {alreadySet && <span className="ml-auto text-xs text-muted-foreground">Already set</span>}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
