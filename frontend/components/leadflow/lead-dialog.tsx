"use client";

import { Loader2, Pencil, Phone, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, api, isAbort, type Entry, type Lead, type LeadDetails, type Mutation } from "@/lib/api";
import { TaskQueue, mergeEntry, newerLead } from "@/lib/detail-state";
import { STATUSES, statusLabel, type LeadStatus } from "@/lib/status";
import { formatWhen } from "@/lib/time";

import { Composer } from "./composer";
import { DetailsEditor } from "./details-editor";
import { keepOpenForToasts } from "./toast-guard";
import { Timeline } from "./timeline";

export interface DialogSession {
  leadId: number;
  /** Changes on every open, so reopening a lead reloads its history. */
  key: number;
}

interface LeadDialogProps {
  open: boolean;
  /** The lead being shown; kept after closing so the closing animation still has content. */
  session: DialogSession | null;
  now: Date | null;
  timeZone: string;
  drafts: Record<number, string>;
  /** Leads whose draft was brought back from an earlier visit and not yet edited. */
  restoredDrafts: ReadonlySet<number>;
  onDraftChange: (leadId: number, value: string) => void;
  /** A note was saved from this exact draft text; clear the draft only if it hasn't changed since. */
  onDraftSaved: (leadId: number, submitted: string) => void;
  onClose: () => void;
  /** Called after any successful change; refreshes the list and reports the outcome. */
  onChanged: (leadId: number, message: string) => Promise<void>;
  /** The list behind the dialog failed to refresh; offer a retry that keyboard users can reach. */
  listStale: boolean;
  onRefreshList: () => Promise<void>;
  /** A change made outside the dialog (Snooze on a card), with when it completed. */
  externalMutation: ExternalMutation | null;
}

export interface ExternalMutation {
  mutation: Mutation;
  at: number;
}

const mutationError = (error: unknown) =>
  error instanceof ApiError ? error.message : "Something went wrong. Please try again.";

export function LeadDialog({
  open,
  session,
  now,
  timeZone,
  drafts,
  restoredDrafts,
  onDraftChange,
  onDraftSaved,
  onClose,
  onChanged,
  listStale,
  onRefreshList,
  externalMutation,
}: LeadDialogProps) {
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const returnFocusTo = useRef<HTMLElement | null>(null);
  const draft = session ? (drafts[session.leadId] ?? "") : "";

  const requestClose = () => {
    if (draft.trim()) setConfirmDiscard(true);
    else onClose();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !next && requestClose()}>
        <DialogContent
          showCloseButton={false}
          aria-describedby="lead-dialog-company"
          onInteractOutside={keepOpenForToasts}
          onOpenAutoFocus={(event) => {
            // Desktop: go straight to the note box. Touch: focus the close button so the
            // on-screen keyboard doesn't cover the history.
            event.preventDefault();
            returnFocusTo.current = document.activeElement as HTMLElement | null;
            const finePointer = window.matchMedia("(pointer: fine)").matches;
            const target = (finePointer && textareaRef.current) || closeRef.current;
            target?.focus();
          }}
          onCloseAutoFocus={(event) => {
            // Return focus to the lead's card, even if the list re-rendered while open. If the card
            // is gone (a status change moved it out of the active filter), fall back to whatever
            // opened the dialog, then to the selected status filter, so focus is never lost.
            const card = session && document.querySelector<HTMLElement>(`[data-lead-id="${session.leadId}"]`);
            const opener = returnFocusTo.current?.isConnected ? returnFocusTo.current : null;
            const filter = document.querySelector<HTMLElement>('.lf-filters [aria-checked="true"]');
            const target = card ?? opener ?? filter;
            if (target) {
              event.preventDefault();
              target.focus();
            }
          }}
          className="flex max-h-[92dvh] flex-col gap-0 overflow-hidden rounded-[14px] p-0 text-[15px] sm:max-w-[720px] max-sm:top-0 max-sm:left-0 max-sm:h-dvh max-sm:max-h-none max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:data-open:zoom-in-100 max-sm:data-open:slide-in-from-bottom-8 max-sm:data-closed:zoom-out-100 max-sm:data-closed:slide-out-to-bottom-8"
        >
          {session && now ? (
            <LeadDialogBody
              key={session.key}
              openedAt={session.key}
              leadId={session.leadId}
              now={now}
              timeZone={timeZone}
              draft={draft}
              draftRestored={restoredDrafts.has(session.leadId) && draft.trim() !== ""}
              onDraftChange={(value) => onDraftChange(session.leadId, value)}
              onDraftSaved={(submitted) => onDraftSaved(session.leadId, submitted)}
              onChanged={(message) => onChanged(session.leadId, message)}
              listStale={listStale}
              onRefreshList={onRefreshList}
              externalMutation={externalMutation}
              textareaRef={textareaRef}
              closeRef={closeRef}
            />
          ) : (
            <DialogTitle className="sr-only">Lead</DialogTitle>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <AlertDialogContent onCloseAutoFocus={(event) => {
          event.preventDefault();
          textareaRef.current?.focus();
        }}>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved note?</AlertDialogTitle>
            <AlertDialogDescription>Your note hasn&apos;t been saved yet.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (session) onDraftChange(session.leadId, "");
                setConfirmDiscard(false);
                onClose();
              }}
            >
              Discard note
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

interface BodyProps {
  leadId: number;
  /** When this dialog was opened (Date.now()); earlier outside changes are already in its fetch. */
  openedAt: number;
  now: Date;
  timeZone: string;
  draft: string;
  draftRestored: boolean;
  onDraftChange: (value: string) => void;
  onDraftSaved: (submitted: string) => void;
  onChanged: (message: string) => Promise<void>;
  listStale: boolean;
  onRefreshList: () => Promise<void>;
  externalMutation: ExternalMutation | null;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  closeRef: React.RefObject<HTMLButtonElement | null>;
}

/** Fold one change into a lead and its timeline: newest lead copy wins, entries in server order. */
function reconcile(current: { lead: Lead; entries: Entry[] }, mutation: Mutation): { lead: Lead; entries: Entry[] } {
  return { lead: newerLead(current.lead, mutation.lead), entries: mergeEntry(current.entries, mutation.entry) };
}

type Detail =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; lead: Lead; entries: Entry[] };

function LeadDialogBody({
  leadId,
  openedAt,
  now,
  timeZone,
  draft,
  draftRestored,
  onDraftChange,
  onDraftSaved,
  onChanged,
  listStale,
  onRefreshList,
  externalMutation,
  textareaRef,
  closeRef,
}: BodyProps) {
  const [detail, setDetail] = useState<Detail>({ phase: "loading" });
  const [pendingStatus, setPendingStatus] = useState<LeadStatus | null>(null);
  // Changes to one lead run one at a time, so responses can't arrive out of order, and each
  // response is reconciled rather than blindly applied (newest lead copy wins, entries in server order).
  const [queue] = useState(() => new TaskQueue());
  const [inFlight, setInFlight] = useState(0);
  const busy = inFlight > 0;
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [savingDetails, setSavingDetails] = useState(false);
  const editButtonRef = useRef<HTMLButtonElement | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const [lead, entries] = await Promise.all([api.getLead(leadId, signal), api.timeline(leadId, signal)]);
        // The fetch may have been read before an outside change committed: merge those in too.
        setDetail({ phase: "ready", ...external.current.reduce(reconcile, { lead, entries }) });
      } catch (error) {
        if (isAbort(error)) return;
        setDetail({ phase: "error", message: mutationError(error) });
      }
    },
    [leadId],
  );

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => void load(controller.signal), 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [load]);

  // Changes made outside the dialog while it is open (Snooze on this lead's card). Held so a history
  // fetch that is still loading also gets them, then merged like the dialog's own responses.
  const external = useRef<Mutation[]>([]);
  useEffect(() => {
    if (!externalMutation || externalMutation.at < openedAt || externalMutation.mutation.lead.id !== leadId) return;
    const { mutation } = externalMutation;
    if (external.current.includes(mutation)) return;
    external.current.push(mutation);
    setDetail((prev) => (prev.phase === "ready" ? { phase: "ready", ...reconcile(prev, mutation) } : prev));
  }, [externalMutation, openedAt, leadId]);

  const apply = (mutation: Mutation) =>
    setDetail((prev) =>
      prev.phase === "ready"
        ? { phase: "ready", lead: newerLead(prev.lead, mutation.lead), entries: mergeEntry(prev.entries, mutation.entry) }
        : prev,
    );

  /** Queue a change for this lead and apply its response when it arrives. */
  const mutate = async (request: () => Promise<Mutation>): Promise<Mutation> => {
    setInFlight((n) => n + 1);
    try {
      const result = await queue.run(request);
      apply(result);
      return result;
    } finally {
      setInFlight((n) => n - 1);
    }
  };

  // Once the history is in, move a desktop user from the close button into the note box.
  const ready = detail.phase === "ready";
  useEffect(() => {
    if (!ready || document.activeElement !== closeRef.current) return;
    if (window.matchMedia("(pointer: fine)").matches) textareaRef.current?.focus();
  }, [ready, closeRef, textareaRef]);

  const changeStatus = async (lead: Lead, value: LeadStatus) => {
    if (pendingStatus || value === lead.status) return;
    setPendingStatus(value);
    try {
      await mutate(() => api.updateStatus(lead.id, value));
      setPendingStatus(null);
      await onChanged(`Status changed to ${statusLabel(value)}.`);
    } catch (error) {
      setPendingStatus(null);
      toast.error(`Couldn't change the status to ${statusLabel(value)}.`, { description: mutationError(error) });
    }
  };

  const saveNote = async (
    lead: Lead,
    note: string,
    followUpAt: string | undefined,
    submittedDraft: string,
  ): Promise<string | null> => {
    try {
      await mutate(() => api.addDiscussion(lead.id, { note, follow_up_at: followUpAt }));
      onDraftSaved(submittedDraft); // keeps anything typed while the save was in flight
      await onChanged("Note saved.");
      return null;
    } catch (error) {
      const message = mutationError(error);
      toast.error("Couldn't save the note. It's still in the box.", { description: message });
      return message;
    }
  };

  const setFollowUp = async (lead: Lead, followUpAt: string): Promise<string | null> => {
    try {
      await mutate(() => api.setFollowUp(lead.id, followUpAt));
      await onChanged(`Follow-up set for ${formatWhen(new Date(followUpAt), new Date())}.`);
      return null;
    } catch (error) {
      const message = mutationError(error);
      toast.error("Couldn't change the follow-up.", { description: message });
      return message;
    }
  };

  const saveDetails = async (lead: Lead, details: LeadDetails): Promise<Record<string, string>> => {
    setSavingDetails(true);
    try {
      await mutate(() => api.updateDetails(lead.id, details));
      setEditing(false);
      editButtonRef.current?.focus();
      await onChanged("Details updated.");
      return {};
    } catch (error) {
      if (error instanceof ApiError && error.details.length) return error.fieldErrors();
      toast.error("Couldn't update the details.", { description: mutationError(error) });
      return {};
    } finally {
      setSavingDetails(false);
    }
  };

  const markDone = async (lead: Lead) => {
    if (busy) return;
    try {
      await mutate(() => api.clearFollowUp(lead.id));
      await onChanged("Follow-up marked done.");
    } catch (error) {
      toast.error("Couldn't mark the follow-up done.", { description: mutationError(error) });
    }
  };

  const lead = detail.phase === "ready" ? detail.lead : null;
  const tel = (lead?.phone ?? "").replace(/[^0-9+]/g, "");

  // One header for every phase, so the focused close button is never unmounted while loading.
  return (
    <>
      <div className="flex flex-none flex-wrap items-start gap-x-4 gap-y-3 border-b border-border py-4 pr-3 pl-4 sm:pl-6">
        <div className="min-w-0 flex-1 basis-60">
          <DialogTitle className="text-[22px] leading-tight font-bold tracking-tight [overflow-wrap:anywhere]">
            {lead ? lead.name : detail.phase === "loading" ? <Skeleton className="h-6 w-48 bg-[#e2e7e3]" /> : "Lead"}
          </DialogTitle>
          <DialogDescription id="lead-dialog-company" className="mt-1 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[15px] text-muted-foreground">
            {lead ? (
              <>
                <span className="min-w-0 [overflow-wrap:anywhere]">{lead.company ?? "No company"}</span>
                {lead.phone && (
                  <a href={`tel:${tel}`} className="inline-flex items-center gap-1.5 text-body hover:text-primary">
                    <Phone aria-hidden="true" className="size-[15px]" />
                    {lead.phone}
                  </a>
                )}
              </>
            ) : (
              <span className="sr-only">Lead details</span>
            )}
          </DialogDescription>
        </div>
        {lead && (
          <div className="flex flex-col gap-1 max-sm:order-3 max-sm:basis-full">
            <span id="status-label" className="text-[13px] font-semibold text-muted-foreground">
              Status
            </span>
            <Select
              value={pendingStatus ?? lead.status}
              onValueChange={(value) => void changeStatus(lead, value as LeadStatus)}
            >
              <SelectTrigger aria-labelledby="status-label" className="h-10 min-w-44 bg-card text-[15px] max-sm:w-full">
                {pendingStatus && <Loader2 className="animate-spin" aria-hidden="true" />}
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((status) => (
                  <SelectItem key={status.value} value={status.value}>
                    {status.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="flex items-center gap-1">
          {lead && (
            <Button
              ref={editButtonRef}
              variant="ghost"
              size="icon-lg"
              aria-label="Edit details"
              aria-expanded={editing}
              aria-disabled={savingDetails}
              onClick={() => !savingDetails && setEditing((open) => !open)}
            >
              <Pencil />
            </Button>
          )}
          <DialogClose asChild>
            <Button ref={closeRef} variant="ghost" size="icon-lg" aria-label="Close">
              <X />
            </Button>
          </DialogClose>
        </div>
      </div>


      {listStale && (
        <div role="status" className="flex flex-none flex-wrap items-center gap-x-3 gap-y-1 bg-stale px-4 py-2 text-sm text-stale-foreground sm:px-6">
          Your changes are saved, but the lead list behind this window may be out of date.
          <button
            type="button"
            aria-disabled={refreshing}
            onClick={async () => {
              if (refreshing) return;
              setRefreshing(true);
              await onRefreshList();
              setRefreshing(false);
            }}
            className="font-semibold underline underline-offset-3 aria-disabled:opacity-60"
          >
            {refreshing ? "Refreshing…" : "Refresh list"}
          </button>
        </div>
      )}

      {detail.phase === "ready" && lead ? (
        <div className="flex min-h-0 flex-1 flex-col max-sm:scroll-pb-24 max-sm:overflow-y-auto">
          {/* Inside the scrolling region, so on a short phone screen its buttons can be scrolled to. */}
          {editing && (
            <DetailsEditor
              lead={lead}
              saving={savingDetails}
              onSave={(details) => saveDetails(lead, details)}
              onCancel={() => {
                setEditing(false);
                editButtonRef.current?.focus();
              }}
            />
          )}
          <div className="min-h-[120px] flex-1 overflow-y-auto px-4 pt-5 pb-1 sm:px-6 max-sm:flex-[1_0_auto] max-sm:overflow-visible">
            <Timeline entries={detail.entries} now={now} />
          </div>
          <Composer
            lead={lead}
            now={now}
            timeZone={timeZone}
            draft={draft}
            draftRestored={draftRestored}
            onDraftChange={onDraftChange}
            onSave={(note, followUpAt, submittedDraft) => saveNote(lead, note, followUpAt, submittedDraft)}
            onMarkDone={() => markDone(lead)}
            onSetFollowUp={(followUpAt) => setFollowUp(lead, followUpAt)}
            busy={busy}
            textareaRef={textareaRef}
          />
        </div>
      ) : detail.phase === "loading" ? (
        <div aria-busy="true" className="flex flex-1 flex-col gap-4 p-6">
          <p role="status" className="sr-only">
            Loading discussion history
          </p>
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex flex-col gap-2">
              <Skeleton className="h-3 w-40 bg-[#e2e7e3]" />
              <Skeleton className="h-4 w-4/5 bg-[#e2e7e3]" />
            </div>
          ))}
        </div>
      ) : (
        <div className="p-6">
          <div role="alert" className="flex flex-col items-start gap-3 rounded-[10px] border border-overdue-border bg-overdue-surface p-5">
            <p className="font-semibold text-[#7a1a12]">Couldn&apos;t load this lead&apos;s history</p>
            <p className="text-body">{detail.phase === "error" ? detail.message : ""} Any note you started is kept.</p>
            <Button
              variant="outline"
              onClick={() => {
                setDetail({ phase: "loading" });
                void load();
              }}
            >
              Retry
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
