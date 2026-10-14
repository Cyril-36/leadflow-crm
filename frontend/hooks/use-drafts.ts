"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "leadflow:drafts:v1";

function readStored(): Record<number, string> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        ([id, text]) => Number.isInteger(Number(id)) && typeof text === "string" && text.trim() !== "",
      ),
    ) as Record<number, string>;
  } catch {
    return {}; // storage blocked or corrupt: start empty
  }
}

function writeStored(drafts: Record<number, string>) {
  try {
    const kept = Object.fromEntries(Object.entries(drafts).filter(([, text]) => text.trim() !== ""));
    if (Object.keys(kept).length) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(kept));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable (private mode, quota): drafts still work for this visit.
  }
}

/**
 * Unsaved discussion notes, one per lead. They survive an accidental refresh (localStorage, this
 * browser only); drafts brought back from storage are reported as restored until edited.
 */
export function useDrafts() {
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [restored, setRestored] = useState<ReadonlySet<number>>(new Set());
  const loaded = useRef(false);

  // Load after mount: storage only exists in the browser.
  useEffect(() => {
    const timer = setTimeout(() => {
      const stored = readStored();
      loaded.current = true;
      setDrafts((current) => ({ ...stored, ...current }));
      setRestored(new Set(Object.keys(stored).map(Number)));
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (loaded.current) writeStored(drafts);
  }, [drafts]);

  const forget = (leadId: number) =>
    setRestored((current) => {
      if (!current.has(leadId)) return current;
      const next = new Set(current);
      next.delete(leadId);
      return next;
    });

  const change = useCallback((leadId: number, text: string) => {
    setDrafts((current) => ({ ...current, [leadId]: text }));
    forget(leadId);
  }, []);

  /** A note was saved from `submitted`; clear the draft only if it still holds exactly that text. */
  const saved = useCallback((leadId: number, submitted: string) => {
    setDrafts((current) => (current[leadId] === submitted ? { ...current, [leadId]: "" } : current));
    forget(leadId);
  }, []);

  return { drafts, restored, change, saved };
}
