"use client";

import { AlarmClock, ChevronDown } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Lead } from "@/lib/api";
import { followUpShortcuts } from "@/lib/time";

interface SnoozeMenuProps {
  lead: Lead;
  now: Date;
  onSnooze: (lead: Lead, at: Date) => Promise<void>;
}

/** One-click "move this follow-up" from a card: later today, tomorrow, next working day. */
export function SnoozeMenu({ lead, now, onSnooze }: SnoozeMenuProps) {
  const [busy, setBusy] = useState(false);
  // After a choice the card usually moves (e.g. out of Today), so the app focuses its new card;
  // only Escape returns focus to this trigger.
  const chose = useRef(false);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label={`Snooze the follow-up for ${lead.name}`}
          aria-disabled={busy}
          className="absolute right-4 bottom-3.5 h-8 gap-1 bg-card px-2.5 text-[13px] font-semibold aria-disabled:opacity-60"
        >
          <AlarmClock aria-hidden="true" />
          Snooze
          <ChevronDown aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-56"
        onCloseAutoFocus={(event) => {
          if (chose.current) event.preventDefault();
          chose.current = false;
        }}
      >
        <DropdownMenuLabel>Move the follow-up to</DropdownMenuLabel>
        {followUpShortcuts(now).map((option) => (
          <DropdownMenuItem
            key={option.label}
            className="text-[14px]"
            onSelect={async () => {
              if (busy) return;
              chose.current = true;
              setBusy(true);
              await onSnooze(lead, option.at);
              setBusy(false);
            }}
          >
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
