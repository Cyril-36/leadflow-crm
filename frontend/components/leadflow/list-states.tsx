import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export function LoadingList() {
  return (
    <div aria-busy="true" className="lf-delayed flex flex-col gap-3">
      <p role="status" className="sr-only">
        Loading your leads
      </p>
      <Skeleton className="h-4 w-44 bg-[#e2e7e3]" />
      {[0, 1].map((i) => (
        <div key={i} className="grid grid-cols-1 gap-x-4 sm:grid-cols-[104px_minmax(0,1fr)]">
          <Skeleton className="mt-3.5 hidden h-4 bg-[#e2e7e3] sm:block" />
          <SkeletonCard />
        </div>
      ))}
      <Skeleton className="mt-4 h-4 w-28 bg-[#e2e7e3]" />
      {[0, 1, 2].map((i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="flex flex-col gap-2.5 rounded-[10px] border border-border bg-card px-4 py-3.5">
      <Skeleton className="h-4 w-1/2 bg-[#e2e7e3]" />
      <Skeleton className="h-3 w-4/5 bg-[#e2e7e3]" />
    </div>
  );
}

export function LoadError({ message, onRetry }: { message: string | null; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-[10px] border border-overdue-border bg-overdue-surface p-5">
      <h2 className="text-[17px] font-semibold text-[#7a1a12]">Couldn&apos;t load your leads</h2>
      <p className="text-body">{message ?? "Something went wrong."} Your data is safe.</p>
      <Button onClick={onRetry} className="h-10 px-4 text-[15px]">
        Retry
      </Button>
    </div>
  );
}

export function FirstUse({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-[10px] border border-dashed border-input bg-card px-6 py-12 text-center">
      <h2 className="text-lg font-semibold">No leads yet</h2>
      <p className="max-w-sm text-muted-foreground">
        Add the first person you&apos;re talking to. You can log every discussion and set a follow-up from their
        timeline.
      </p>
      <Button onClick={onAdd} className="h-10 px-4 text-[15px]">
        <Plus /> Add your first lead
      </Button>
    </div>
  );
}

export function NoResults({ description, onClear }: { description: string; onClear: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-[10px] border border-dashed border-input bg-card px-6 py-12 text-center">
      <h2 className="text-lg font-semibold">{description}</h2>
      <p className="text-muted-foreground">Check the spelling, or clear the search and the status filter.</p>
      <Button variant="outline" onClick={onClear} className="h-10 px-4 text-[15px]">
        Clear filters
      </Button>
    </div>
  );
}

export function StaleBar({ onRefresh }: { onRefresh: () => void }) {
  return (
    <div role="status" className="mb-4 flex flex-wrap items-center gap-3 rounded-lg bg-stale px-3.5 py-2.5 text-stale-foreground">
      The list may be out of date.
      <button type="button" onClick={onRefresh} className="font-semibold underline underline-offset-3">
        Refresh list
      </button>
    </div>
  );
}
