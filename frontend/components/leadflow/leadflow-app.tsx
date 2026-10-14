"use client";

import { CircleAlert, Plus, Search, TrendingUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { cn } from "cn";

import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Toaster } from "@/components/ui/sonner";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useDrafts } from "@/hooks/use-drafts";
import { useLeads, type StatusFilter } from "@/hooks/use-leads";
import { useNow } from "@/hooks/use-now";
import { ApiError, api, type Lead, type LeadList } from "@/lib/api";
import { QUIET_DAYS, attentionReasons, describeReason } from "@/lib/attention";
import { STATUSES, statusLabel } from "@/lib/status";
import { browserTimeZone, formatLongDate, formatWhen } from "@/lib/time";

import { AddLeadDialog } from "./add-lead-dialog";
import { Agenda } from "./agenda";
import { LeadCard } from "./lead-card";
import { LeadDialog, type DialogSession } from "./lead-dialog";
import { FirstUse, LoadError, LoadingList, NoResults, StaleBar } from "./list-states";

type ReminderFilter = "any" | "today" | "overdue" | "attention";

const isOverdue = (lead: Lead, now: Date) => Boolean(lead.next_follow_up_at && new Date(lead.next_follow_up_at) < now);

/** Narrow the server's (status- and search-filtered) list to today's or overdue follow-ups. */
function byReminder(view: LeadList, reminder: ReminderFilter, now: Date): LeadList {
  if (reminder === "today") return { pinned: view.pinned, leads: [] };
  if (reminder === "overdue") {
    return { pinned: view.pinned.filter((l) => isOverdue(l, now)), leads: view.leads.filter((l) => isOverdue(l, now)) };
  }
  if (reminder === "attention") {
    const needs = (l: Lead) => attentionReasons(l, now).length > 0;
    return { pinned: view.pinned.filter(needs), leads: view.leads.filter(needs) };
  }
  return view;
}

/** Attention reasons to show on a card; overdue is already shown in red, so it's left out. */
function reasonLabels(lead: Lead, now: Date): string[] {
  return attentionReasons(lead, now)
    .filter((reason) => reason !== "overdue")
    .map((reason) => describeReason(reason, lead, now));
}

function counts(all: LeadList | null, now: Date | null) {
  const leads = all ? [...all.pinned, ...all.leads] : [];
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s.value, 0])) as Record<string, number>;
  for (const lead of leads) byStatus[lead.status] += 1;
  const overdue = now
    ? leads.filter((lead) => lead.next_follow_up_at && new Date(lead.next_follow_up_at) < now).length
    : 0;
  const attention = now ? leads.filter((lead) => attentionReasons(lead, now).length > 0).length : 0;
  return { total: leads.length, byStatus, dueToday: all?.pinned.length ?? 0, overdue, attention };
}

/** A number that pops briefly when its value changes (not on first render). */
function Count({ value, className }: { value: number; className?: string }) {
  const [previous, setPrevious] = useState(value);
  const [changes, setChanges] = useState(0);
  if (value !== previous) {
    setPrevious(value);
    setChanges((n) => n + 1);
  }
  return (
    <b key={changes} className={cn("tabular-nums", changes > 0 && "lf-pop", className)}>
      {value}
    </b>
  );
}

export function LeadFlowApp() {
  const now = useNow();
  const [timeZone] = useState(() => (typeof window === "undefined" ? null : browserTimeZone()));
  const [status, setStatus] = useState<StatusFilter>("all");
  const [reminder, setReminder] = useState<ReminderFilter>("any");
  const [search, setSearch] = useState("");
  const query = useDebouncedValue(search, 250);
  const leads = useLeads(status, query, timeZone);

  const [dialog, setDialog] = useState<DialogSession | null>(null);
  const [lastDialog, setLastDialog] = useState<DialogSession | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const drafts = useDrafts();
  // Leads changed while their dialog was open get a short highlight once it closes.
  const [flash, setFlash] = useState<Record<number, number>>({});
  const changedWhileOpen = useRef(new Set<number>());

  // Keyboard shortcuts: "/" focuses search, "n" adds a lead. Ignored while typing, with a
  // modifier held, or when a dialog is open (Radix marks the page behind it aria-hidden).
  const searchRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true'], [role='dialog'], [role='alertdialog']")) return;
      if (document.querySelector("[role='dialog'], [role='alertdialog']")) return;
      if (event.key === "/") {
        event.preventDefault();
        searchRef.current?.focus();
      } else if (event.key === "n" || event.key === "N") {
        event.preventDefault();
        setAddOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const flashLeads = (ids: number[]) => {
    if (!ids.length) return;
    const token = Date.now();
    setFlash((prev) => ({ ...prev, ...Object.fromEntries(ids.map((id) => [id, token])) }));
  };

  const closeLead = () => {
    setDialog(null);
    flashLeads([...changedWhileOpen.current]);
    changedWhileOpen.current.clear();
  };

  const openLead = (leadId: number) => {
    const session = { leadId, key: Date.now() };
    setDialog(session);
    setLastDialog(session);
  };

  const clearFilters = () => {
    setStatus("all");
    setReminder("any");
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

  /** Snooze from a card: move the follow-up, refresh, then put focus back on that lead's card. */
  const snooze = async (lead: Lead, at: Date) => {
    try {
      await api.setFollowUp(lead.id, at.toISOString());
    } catch (error) {
      toast.error("Couldn't snooze the follow-up.", {
        description: error instanceof ApiError ? error.message : undefined,
      });
      return;
    }
    await afterChange(`Follow-up for ${lead.name} moved to ${formatWhen(at, new Date())}.`);
    flashLeads([lead.id]);
    // Wait for the refreshed list to render; the card may have moved sections.
    await new Promise((resolve) => setTimeout(resolve, 0));
    document.querySelector<HTMLElement>(`[data-lead-id="${lead.id}"]`)?.focus();
  };

  const onCreated = async (lead: Lead) => {
    const q = query.trim().toLowerCase();
    const hiddenByStatus = status !== "all" && status !== lead.status;
    // A new lead has no follow-up yet, so Due today and Overdue always hide it (Needs attention
    // shows it: an open lead with no follow-up needs one).
    const hiddenByReminder = reminder === "today" || reminder === "overdue";
    const hiddenBySearch = q !== "" && !`${lead.name} ${lead.company ?? ""}`.toLowerCase().includes(q);
    if (hiddenByStatus || hiddenByReminder || hiddenBySearch) {
      const reason = hiddenByStatus
        ? `the ${statusLabel(status as Lead["status"])} filter`
        : hiddenByReminder
          ? `the ${reminder === "today" ? "Due today" : "Overdue"} filter`
          : "your search";
      await afterChange(`Lead added. It's hidden by ${reason}.`, { view: () => openLead(lead.id), showAll: true });
    } else {
      await afterChange("Lead added.");
    }
    flashLeads([lead.id]);
  };

  const c = counts(leads.all, now);
  const view = leads.view && now ? byReminder(leads.view, reminder, now) : leads.view;
  const filtered = status !== "all" || query.trim() !== "" || reminder !== "any";
  const leadsNoun = status === "all" ? "leads" : `${statusLabel(status)} leads`;
  const emptyDescription =
    (reminder === "today"
      ? `No ${leadsNoun} due today`
      : reminder === "overdue"
        ? `No overdue ${leadsNoun}`
        : reminder === "attention"
          ? `No ${leadsNoun} need attention`
          : `No ${leadsNoun}`) +
    (query.trim() ? ` match \u201c${query.trim()}\u201d` : "");
  const toggleReminder = (value: ReminderFilter) => setReminder((current) => (current === value ? "any" : value));
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
              ref={searchRef}
              type="search"
              aria-keyshortcuts="/"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by name or company"
              aria-label="Search leads"
              maxLength={100}
              className="w-full bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
            />
            <kbd aria-hidden="true" className="hidden rounded border border-border bg-card px-1.5 text-xs text-muted-foreground sm:inline">
              /
            </kbd>
          </label>
          <Button
            onClick={() => setAddOpen(true)}
            aria-keyshortcuts="N"
            title="Add lead (N)"
            className="h-10 px-4 text-[15px] hover:bg-primary-hover"
          >
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
            <p className="flex flex-wrap items-baseline gap-x-1 text-muted-foreground">
              Across all leads:
              <button
                type="button"
                aria-pressed={reminder === "today"}
                onClick={() => toggleReminder("today")}
                className={cn(
                  "rounded-md px-1.5 py-0.5 underline-offset-3 hover:underline",
                  reminder === "today" && "bg-accent text-accent-foreground ring-1 ring-primary/30",
                )}
              >
                <Count value={c.dueToday} className="text-foreground" /> due today
              </button>
              and
              <button
                type="button"
                aria-pressed={reminder === "overdue"}
                onClick={() => toggleReminder("overdue")}
                className={cn(
                  "rounded-md px-1.5 py-0.5 text-overdue underline-offset-3 hover:underline",
                  reminder === "overdue" && "bg-overdue-tint ring-1 ring-overdue/30",
                )}
              >
                <Count value={c.overdue} /> overdue
              </button>
            </p>
          )}
        </div>

        <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="lf-filters min-w-0 max-w-full">
            <SegmentedControl<StatusFilter>
              aria-label="Filter leads by status"
              options={filterOptions}
              value={status}
              onChange={setStatus}
              size="lg"
            />
          </div>
          <button
            type="button"
            aria-pressed={reminder === "attention"}
            onClick={() => toggleReminder("attention")}
            className={cn(
              "inline-flex h-10 items-center gap-2 rounded-full border px-3.5 text-sm font-semibold transition-colors",
              reminder === "attention"
                ? "border-stale-foreground/40 bg-stale text-stale-foreground"
                : "border-border bg-card text-body hover:border-input",
            )}
          >
            <CircleAlert aria-hidden="true" className="size-4" />
            Needs attention
            <span className="rounded-full bg-stale px-2 text-xs text-stale-foreground tabular-nums">{c.attention}</span>
          </button>
          {filtered && (
            <button
              type="button"
              onClick={clearFilters}
              className="text-sm font-semibold text-primary underline underline-offset-3 hover:text-primary-hover"
            >
              Clear filters
            </button>
          )}
        </div>

        {reminder === "attention" && (
          <p className="-mt-3 mb-5 text-sm text-muted-foreground">
            Open leads with an overdue follow-up, no follow-up scheduled, or no discussion in the last {QUIET_DAYS}{" "}
            days.
          </p>
        )}

        {leads.stale && <StaleBar onRefresh={() => void retryRefresh()} />}

        {leads.phase === "loading" || !now ? (
          <LoadingList />
        ) : leads.phase === "error" ? (
          <LoadError message={leads.errorMessage} onRetry={() => void leads.refresh()} />
        ) : nothingToShow && !filtered ? (
          <FirstUse onAdd={() => setAddOpen(true)} />
        ) : nothingToShow ? (
          <NoResults description={emptyDescription} onClear={clearFilters} />
        ) : (
          view && (
            <>
              {view.pinned.length > 0 && (
                <Agenda
                  leads={view.pinned}
                  now={now}
                  onOpen={openLead}
                  flash={flash}
                  reasonsFor={reminder === "attention" ? (lead) => reasonLabels(lead, now) : undefined}
                  onSnooze={snooze}
                />
              )}
              {view.leads.length > 0 && (
                <section aria-labelledby="other-heading">
                  <h2 id="other-heading" className="mb-2.5 text-[15px] font-semibold">
                    {reminder === "overdue"
                      ? "Overdue from earlier days"
                      : reminder === "attention"
                        ? "Needs attention"
                      : view.pinned.length > 0
                        ? "Other leads"
                        : status === "all"
                          ? "All leads"
                          : `${statusLabel(status)} leads`}
                  </h2>
                  <ul className="flex flex-col gap-2">
                    {view.leads.map((lead) => (
                      <li key={lead.id}>
                        <LeadCard
                          lead={lead}
                          now={now}
                          variant="list"
                          onOpen={openLead}
                          flashToken={flash[lead.id]}
                          reasons={reminder === "attention" ? reasonLabels(lead, now) : undefined}
                          onSnooze={snooze}
                        />
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
        drafts={drafts.drafts}
        restoredDrafts={drafts.restored}
        onDraftChange={drafts.change}
        onDraftSaved={drafts.saved}
        onClose={closeLead}
        listStale={leads.stale}
        onRefreshList={retryRefresh}
        onChanged={(leadId, message) => {
          changedWhileOpen.current.add(leadId);
          return afterChange(message);
        }}
      />
      <AddLeadDialog open={addOpen} onOpenChange={setAddOpen} onCreated={onCreated} />
      <Toaster position="bottom-center" theme="light" />
    </div>
  );
}
