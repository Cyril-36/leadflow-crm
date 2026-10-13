import { cn } from "cn";

import { STATUS_BADGE, statusLabel, type LeadStatus } from "@/lib/status";

export function StatusBadge({ status, className }: { status: LeadStatus; className?: string }) {
  return (
    <span
      className={cn(
        "rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap",
        STATUS_BADGE[status],
        className,
      )}
    >
      {statusLabel(status)}
    </span>
  );
}
