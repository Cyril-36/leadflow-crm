"use client";

import { Plus, Search, TrendingUp } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Toaster } from "@/components/ui/sonner";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useLeads, type StatusFilter } from "@/hooks/use-leads";
import { useNow } from "@/hooks/use-now";
import type { Lead, LeadList } from "@/lib/api";
import { STATUSES, statusLabel } from "@/lib/status";
import { browserTimeZone, formatLongDate } from "@/lib/time";

import { AddLeadDialog } from "./add-lead-dialog";
import { Agenda } from "./agenda";
import { LeadCard } from "./lead-card";
import { LeadDialog, type DialogSession } from "./lead-dialog";
import { FirstUse, LoadError, LoadingList, NoResults, StaleBar } from "./list-states";

function counts(all: LeadList | null, now: Date | null) {
  const leads = all ? [...all.pinned, ...all.leads] : [];
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s.value, 0])) as Record<string, number>;
  for (const lead of leads) byStatus[lead.status] += 1;
  const overdue = now
    ? leads.filter((lead) => lead.next_follow_up_at && new Date(lead.next_follow_up_at) < now).length
    : 0;
  return { total: leads.length, byStatus, dueToday: all?.pinned.length ?? 0, overdue };
}

export function LeadFlowApp() {
  const now = useNow();
  const [timeZone] = useState(() => (typeof window === "undefined" ? null : browserTimeZone()));
  const [status, setStatus] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const query = useDebouncedValue(search, 250);
  const leads = useLeads(status, query, timeZone);

  const [dialog, setDialog] = useState<DialogSession | null>(null);
  const [lastDialog, setLastDialog] = useState<DialogSession | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<number, string>>({});

  const openLead = (leadId: number) => {
    const session = { leadId, key: Date.now() };
    setDialog(session);
    setLastDialog(session);
  };

  const clearFilters = () => {
    setStatus("all");
    setSearch("");
  };

  /** After a saved change: refresh the list, and report a failed refresh separately from the save. */
  const afterChange = async (message: string, actions?: { view?: () => void; showAll?: boolean }) => {
    const outcome = await leads.refresh();
    toast.dismiss(); // a saved change supersedes earlier error toasts
    if (outcome === "fresh") {
      toast.success(message, {
        duration: actions ? 10_000 : 4_000,
        action: actions?.view ? { label: "View lead", onClick: actions.view } : undefined,
        cancel: actions?.showAll ? { label: "Show all", onClick: clearFilters } : undefined,
      });
    } else {
      toast(`${message.replace(/\.$/, "")}. Couldn't refresh the list.`, {
        duration: Infinity,
        action: { label: "Retry refresh", onClick: () => void retryRefresh() },
      });
    }
  };

  const retryRefresh = async () => {
    if ((await leads.refresh()) === "fresh") toast.success("List refreshed.");
    else toast.error("Still couldn't refresh the list. Try again in a moment.");
  };

  const onCreated = async (lead: Lead) => {
    const q = query.trim().toLowerCase();
    const hiddenByStatus = status !== "all" && status !== lead.status;
    const hiddenBySearch = q !== "" && !`${lead.name} ${lead.company ?? ""}`.toLowerCase().includes(q);
    if (hiddenByStatus || hiddenBySearch) {
      const reason = hiddenByStatus ? `the ${statusLabel(status as Lead["status"])} filter` : "your search";
      await afterChange(`Lead added. It's hidden by ${reason}.`, { view: () => openLead(lead.id), showAll: true });
    } else {
      await afterChange("Lead added.");
    }
  };

  const c = counts(leads.all, now);
  const view = leads.view;
  const filtered = status !== "all" || query.trim() !== "";
  const nothingToShow = view !== null && view.pinned.length === 0 && view.leads.length === 0;
  const filterOptions = [
    { value: "all" as StatusFilter, label: "All", count: c.total },
    ...STATUSES.map((s) => ({ value: s.value as StatusFilter, label: s.label, count: c.byStatus[s.value] })),
  ];

  return (
    <div className="min-h-screen bg-background text-[15px] leading-[1.45] text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex min-h-16 max-w-[1040px] flex-wrap items-center gap-x-4 gap-y-3 px-4 py-2.5 sm:px-6">
          <div className="mr-auto flex items-center gap-2 text-[19px] font-bold tracking-tight text-primary">
            <TrendingUp aria-hidden="true" className="size-[22px]" />
            LeadFlow
          </div>
          <label className="flex h-10 min-w-[200px] flex-[0_1_320px] items-center gap-2 rounded-lg border border-border bg-background px-3 text-muted-foreground focus-within:border-primary focus-within:ring-3 focus-within:ring-accent max-sm:order-3 max-sm:flex-[1_1_100%]">
            <Search aria-hidden="true" className="size-[18px]" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by name or company"
              aria-label="Search leads"
              maxLength={100}
              className="w-full bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
            />
          </label>
          <Button onClick={() => setAddOpen(true)} className="h-10 px-4 text-[15px] hover:bg-primary-hover">
            <Plus aria-hidden="true" /> Add lead
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-[1040px] px-4 pb-16 sm:px-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5 pt-7 pb-3.5">
          <h1 className="min-h-9 text-[23px] font-bold tracking-tight sm:text-[28px]">
            {now ? formatLongDate(now) : ""}
          </h1>
          {leads.all && (
            <p className="text-muted-foreground">
              Across all leads: <b className="text-foreground tabular-nums">{c.dueToday}</b> due today,{" "}
              <span className="text-overdue">
                <b className="tabular-nums">{c.overdue}</b> overdue
              </span>
            </p>
          )}
        </div>

        <div className="lf-filters mb-6 min-w-0">
          <SegmentedControl<StatusFilter>
            aria-label="Filter leads by status"
            options={filterOptions}
            value={status}
            onChange={setStatus}
            size="lg"
          />
        </div>

        {leads.stale && <StaleBar onRefresh={() => void retryRefresh()} />}

        {leads.phase === "loading" || !now ? (
          <LoadingList />
        ) : leads.phase === "error" ? (
          <LoadError message={leads.errorMessage} onRetry={() => void leads.refresh()} />
        ) : nothingToShow && !filtered ? (
          <FirstUse onAdd={() => setAddOpen(true)} />
        ) : nothingToShow ? (
          <NoResults
            description={
              query.trim()
                ? `No ${status === "all" ? "" : `${statusLabel(status)} `}leads match “${query.trim()}”`
                : `No ${statusLabel(status as Lead["status"])} leads`
            }
            onClear={clearFilters}
          />
        ) : (
          view && (
            <>
              {view.pinned.length > 0 && <Agenda leads={view.pinned} now={now} onOpen={openLead} />}
              {view.leads.length > 0 && (
                <section aria-labelledby="other-heading">
                  <h2 id="other-heading" className="mb-2.5 text-[15px] font-semibold">
                    {view.pinned.length > 0 ? "Other leads" : status === "all" ? "All leads" : `${statusLabel(status)} leads`}
                  </h2>
                  <ul className="flex flex-col gap-2">
                    {view.leads.map((lead) => (
                      <li key={lead.id}>
                        <LeadCard lead={lead} now={now} variant="list" onOpen={openLead} />
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )
        )}
      </main>

      <LeadDialog
        open={dialog !== null}
        session={lastDialog}
        now={now}
        timeZone={timeZone ?? "UTC"}
        drafts={drafts}
        onDraftChange={(leadId, value) => setDrafts((prev) => ({ ...prev, [leadId]: value }))}
        onClose={() => setDialog(null)}
        onChanged={(message) => afterChange(message)}
      />
      <AddLeadDialog open={addOpen} onOpenChange={setAddOpen} onCreated={onCreated} />
      <Toaster position="bottom-center" theme="light" />
    </div>
  );
}
