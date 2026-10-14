"use client";

import { Bell, Loader2 } from "lucide-react";
import { useState, type RefObject } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Lead } from "@/lib/api";
import { followUpShortcuts, formatOffset, formatWhen, parseFollowUp } from "@/lib/time";

interface ComposerProps {
  lead: Lead;
  now: Date;
  timeZone: string;
  draft: string;
  onDraftChange: (value: string) => void;
  /**
   * Resolves null when the note was saved, or a message explaining why it wasn't. `submittedDraft`
   * is the exact text sent, so the caller clears the draft only if it hasn't changed meanwhile.
   */
  onSave: (note: string, followUpAt: string | undefined, submittedDraft: string) => Promise<string | null>;
  onMarkDone: () => Promise<void>;
  /** Move or set the follow-up on its own, without a note. Resolves like onSave. */
  onSetFollowUp: (followUpAt: string) => Promise<string | null>;
  busy: boolean;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}

// Busy controls use aria-disabled rather than disabled: a disabled button drops keyboard focus,
// which would strand focus on the dialog container. Handlers ignore presses while busy.
const linkButton =
  "font-semibold whitespace-nowrap text-primary underline underline-offset-3 hover:text-primary-hover aria-disabled:cursor-progress aria-disabled:opacity-60";

export function Composer({
  lead,
  now,
  timeZone,
  draft,
  onDraftChange,
  onSave,
  onMarkDone,
  onSetFollowUp,
  busy,
  textareaRef,
}: ComposerProps) {
  const [editingFollowUp, setEditingFollowUp] = useState(false);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const current = lead.next_follow_up_at ? new Date(lead.next_follow_up_at) : null;
  const touched = editingFollowUp && (date !== "" || time !== "");
  const parsed = touched ? parseFollowUp(date, time, now) : null;

  const closeEditor = () => {
    setEditingFollowUp(false);
    setDate("");
    setTime("");
    setError(null);
  };

  // With no note written, a chosen follow-up is saved on its own ("Save follow-up").
  const followUpOnly = draft.trim() === "" && parsed !== null;

  const save = async () => {
    if (saving || busy) return;
    const note = draft.trim();
    if (parsed && !parsed.ok) {
      setError(parsed.message);
      return;
    }
    if (!note && !parsed) {
      setError(editingFollowUp ? "Write a note or pick a follow-up time." : "Write a note before saving.");
      return;
    }
    setError(null);
    setSaving(true);
    const followUpAt = parsed?.ok ? parsed.date.toISOString() : undefined;
    const failure = note ? await onSave(note, followUpAt, draft) : await onSetFollowUp(followUpAt as string);
    setSaving(false);
    if (failure) setError(failure);
    else closeEditor();
  };

  return (
    <div className="flex flex-none flex-col gap-2.5 border-t border-border bg-[#fafbfa] px-4 pt-3.5 sm:px-6">
      <Label htmlFor="note-box" className="text-[13px] font-semibold text-muted-foreground">
        New discussion
      </Label>
      <Textarea
        id="note-box"
        ref={textareaRef}
        rows={2}
        value={draft}
        maxLength={2000}
        placeholder="What did you discuss?"
        onChange={(event) => {
          onDraftChange(event.target.value);
          setError(null);
        }}
        className="min-h-16 resize-y bg-card text-[15px]"
      />

      {!editingFollowUp ? (
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-sm text-body">
          <span className="mr-auto inline-flex items-center gap-1.5 max-sm:basis-full">
            <Bell aria-hidden="true" className="size-4 text-muted-foreground" />
            {current ? `Follow-up ${formatWhen(current, now)}` : "No follow-up scheduled"}
          </span>
          <button type="button" className={linkButton} onClick={() => setEditingFollowUp(true)}>
            {current ? "Change follow-up" : "Add follow-up"}
          </button>
          {current && (
            <button
              type="button"
              className={linkButton}
              aria-disabled={busy || saving}
              onClick={() => {
                if (!busy && !saving) void onMarkDone();
              }}
            >
              Mark done
            </button>
          )}
        </div>
      ) : (
        <fieldset className="lf-fade-in flex flex-col gap-2 rounded-[10px] border border-border bg-card p-3 max-sm:gap-1.5 max-sm:p-2.5">
          <legend className="sr-only">Follow-up</legend>
          <div className="flex flex-wrap gap-2 max-sm:-mx-2.5 max-sm:flex-nowrap max-sm:overflow-x-auto max-sm:px-2.5 max-sm:[scrollbar-width:none] max-sm:[&::-webkit-scrollbar]:hidden">
            {followUpShortcuts(now).map((shortcut) => (
              <button
                key={shortcut.label}
                type="button"
                aria-disabled={saving}
                onClick={() => {
                  if (saving) return;
                  setDate(shortcut.date);
                  setTime(shortcut.time);
                  setError(null);
                }}
                className="h-8 shrink-0 rounded-full border border-input bg-card px-3 text-[13px] font-semibold hover:border-primary hover:text-primary"
              >
                {shortcut.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-3 max-sm:grid max-sm:grid-cols-2 max-sm:gap-2">
            <label className="flex flex-col gap-1 text-[13px] font-semibold text-muted-foreground">
              Date
              <input
                type="date"
                value={date}
                readOnly={saving}
                onChange={(event) => setDate(event.target.value)}
                className="h-10 w-full rounded-lg border border-input bg-card px-2.5 text-[15px] font-normal text-foreground"
              />
            </label>
            <label className="flex flex-col gap-1 text-[13px] font-semibold text-muted-foreground">
              Time
              <input
                type="time"
                value={time}
                readOnly={saving}
                onChange={(event) => setTime(event.target.value)}
                className="h-10 w-full rounded-lg border border-input bg-card px-2.5 text-[15px] font-normal text-foreground"
              />
            </label>
            <span className="pb-2.5 text-[13px] text-muted-foreground max-sm:col-span-2 max-sm:pb-0">Times in {timeZone}</span>
          </div>
          {parsed?.ok && (
            <p className="text-sm font-semibold text-primary">
              New follow-up: {formatWhen(parsed.date, now)} ({formatOffset(parsed.date)})
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            {current ? `Leave empty to keep ${formatWhen(current, now)}. ` : "Optional. "}
            <button type="button" className={linkButton} aria-disabled={saving} onClick={() => !saving && closeEditor()}>
              Cancel
            </button>
          </p>
        </fieldset>
      )}

      <div className="flex items-center justify-end gap-3 bg-[#fafbfa] pt-1 pb-4 max-sm:sticky max-sm:bottom-0 max-sm:-mx-4 max-sm:border-t max-sm:border-border max-sm:px-4 max-sm:pt-3 max-sm:pb-[max(16px,env(safe-area-inset-bottom))]">
        {error && (
          <p role="alert" className="mr-auto text-sm font-semibold text-overdue">
            {error}
          </p>
        )}
        <Button
          onClick={() => void save()}
          aria-disabled={saving || busy}
          className="h-10 px-4 text-[15px] aria-disabled:cursor-progress aria-disabled:opacity-70 max-sm:flex-1"
        >
          {saving && <Loader2 className="animate-spin" aria-hidden="true" />}
          {saving ? "Saving…" : followUpOnly ? "Save follow-up" : "Save note"}
        </Button>
      </div>
    </div>
  );
}
