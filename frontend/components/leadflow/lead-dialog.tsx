"use client";

import { Loader2, Phone, X } from "lucide-react";
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
import { ApiError, api, isAbort, type Entry, type Lead, type Mutation } from "@/lib/api";
import { STATUSES, statusLabel, type LeadStatus } from "@/lib/status";

import { Composer } from "./composer";
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
  onDraftChange: (leadId: number, value: string) => void;
  onClose: () => void;
  /** Called after any successful change; refreshes the list and reports the outcome. */
  onChanged: (message: string) => Promise<void>;
}

const mutationError = (error: unknown) =>
  error instanceof ApiError ? error.message : "Something went wrong. Please try again.";

export function LeadDialog({ open, session, now, timeZone, drafts, onDraftChange, onClose, onChanged }: LeadDialogProps) {
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
            // Return focus to the lead's card, even if the list re-rendered while open; otherwise
            // to whatever opened the dialog (e.g. "View lead" in a toast).
            const card = session && document.querySelector<HTMLElement>(`[data-lead-id="${session.leadId}"]`);
            const target = card ?? (returnFocusTo.current?.isConnected ? returnFocusTo.current : null);
            if (target) {
              event.preventDefault();
              target.focus();
            }
          }}
          className="flex max-h-[92dvh] flex-col gap-0 overflow-hidden rounded-[14px] p-0 text-[15px] sm:max-w-[720px] max-sm:top-0 max-sm:left-0 max-sm:h-dvh max-sm:max-h-none max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none"
        >
          {session && now ? (
            <LeadDialogBody
              key={session.key}
              leadId={session.leadId}
              now={now}
              timeZone={timeZone}
              draft={draft}
              onDraftChange={(value) => onDraftChange(session.leadId, value)}
              onChanged={onChanged}
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
  now: Date;
  timeZone: string;
  draft: string;
  onDraftChange: (value: string) => void;
  onChanged: (message: string) => Promise<void>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  closeRef: React.RefObject<HTMLButtonElement | null>;
}

type Detail =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; lead: Lead; entries: Entry[] };

function LeadDialogBody({ leadId, now, timeZone, draft, onDraftChange, onChanged, textareaRef, closeRef }: BodyProps) {
  const [detail, setDetail] = useState<Detail>({ phase: "loading" });
  const [pendingStatus, setPendingStatus] = useState<LeadStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const [lead, entries] = await Promise.all([api.getLead(leadId, signal), api.timeline(leadId, signal)]);
        setDetail({ phase: "ready", lead, entries });
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

  const apply = (mutation: Mutation) =>
    setDetail((prev) =>
      prev.phase === "ready"
        ? { phase: "ready", lead: mutation.lead, entries: mutation.entry ? [mutation.entry, ...prev.entries] : prev.entries }
        : prev,
    );

  // Once the history is in, move a desktop user from the close button into the note box.
  const ready = detail.phase === "ready";
  useEffect(() => {
    if (!ready || document.activeElement !== closeRef.current) return;
    if (window.matchMedia("(pointer: fine)").matches) textareaRef.current?.focus();
  }, [ready, closeRef, textareaRef]);

  const changeStatus = async (lead: Lead, value: LeadStatus) => {
    if (value === lead.status || pendingStatus) return;
    setPendingStatus(value);
    try {
      const result = await api.updateStatus(lead.id, value);
      apply(result);
      setPendingStatus(null);
      await onChanged(`Status changed to ${statusLabel(value)}.`);
    } catch (error) {
      setPendingStatus(null);
      toast.error(`Couldn't change the status. It's still ${statusLabel(lead.status)}.`, {
        description: mutationError(error),
      });
    }
  };

  const saveNote = async (lead: Lead, note: string, followUpAt: string | undefined): Promise<string | null> => {
    setBusy(true);
    try {
      const result = await api.addDiscussion(lead.id, { note, follow_up_at: followUpAt });
      apply(result);
      onDraftChange("");
      setBusy(false);
      await onChanged("Note saved.");
      return null;
    } catch (error) {
      setBusy(false);
      const message = mutationError(error);
      toast.error("Couldn't save the note. It's still in the box.", { description: message });
      return message;
    }
  };

  const markDone = async (lead: Lead) => {
    setBusy(true);
    try {
      const result = await api.clearFollowUp(lead.id);
      apply(result);
      setBusy(false);
      await onChanged("Follow-up marked done.");
    } catch (error) {
      setBusy(false);
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
          <DialogTitle className="text-[22px] leading-tight font-bold tracking-tight">
            {lead ? lead.name : detail.phase === "loading" ? <Skeleton className="h-6 w-48 bg-[#e2e7e3]" /> : "Lead"}
          </DialogTitle>
          <DialogDescription id="lead-dialog-company" className="mt-1 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[15px] text-muted-foreground">
            {lead ? (
              <>
                <span>{lead.company ?? "No company"}</span>
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
              disabled={pendingStatus !== null}
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
        <DialogClose asChild>
          <Button ref={closeRef} variant="ghost" size="icon-lg" aria-label="Close">
            <X />
          </Button>
        </DialogClose>
      </div>

      {detail.phase === "ready" && lead ? (
        <div className="flex min-h-0 flex-1 flex-col max-sm:overflow-y-auto">
          <div className="min-h-[120px] flex-1 overflow-y-auto px-4 pt-5 pb-1 sm:px-6 max-sm:flex-none max-sm:overflow-visible">
            <Timeline entries={detail.entries} now={now} />
          </div>
          <Composer
            lead={lead}
            now={now}
            timeZone={timeZone}
            draft={draft}
            onDraftChange={onDraftChange}
            onSave={(note, followUpAt) => saveNote(lead, note, followUpAt)}
            onMarkDone={() => markDone(lead)}
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
