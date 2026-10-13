"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { api, isAbort, type LeadList } from "@/lib/api";
import type { LeadStatus } from "@/lib/status";

export type StatusFilter = LeadStatus | "all";

export interface LeadsState {
  /** The server's latest answer for the active filter and search. */
  view: LeadList | null;
  /** All leads, unfiltered: the source for every count, so counts never depend on the filter. */
  all: LeadList | null;
  phase: "loading" | "ready" | "error";
  /** A refresh failed after data was already shown; the list may be out of date. */
  stale: boolean;
  errorMessage: string | null;
}

const BACKGROUND_REFRESH_MS = 60_000;

/**
 * Loads the lead list (PLAN.md §5). The list is always exactly the server's latest response:
 * pinned and other leads are replaced together, older responses are discarded, and `refresh()`
 * resolves to whether the list is now up to date, so callers can report a failed refresh
 * separately from a successful save.
 */
export function useLeads(status: StatusFilter, query: string, tz: string | null) {
  const [state, setState] = useState<LeadsState>({
    view: null,
    all: null,
    phase: "loading",
    stale: false,
    errorMessage: null,
  });
  const sequence = useRef(0);
  const inFlight = useRef<AbortController | null>(null);

  const refresh = useCallback(async (): Promise<boolean> => {
    if (!tz) return false;
    const id = ++sequence.current;
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    const filtered = status !== "all" || query.trim() !== "";
    try {
      const [view, all] = await Promise.all([
        api.listLeads({ tz, status: status === "all" ? undefined : status, q: query }, controller.signal),
        filtered ? api.listLeads({ tz }, controller.signal) : Promise.resolve(null),
      ]);
      if (id !== sequence.current) return true; // a newer refresh owns the list now
      setState({ view, all: all ?? view, phase: "ready", stale: false, errorMessage: null });
      return true;
    } catch (error) {
      if (isAbort(error) || id !== sequence.current) return true;
      const message = error instanceof Error ? error.message : "Couldn't load your leads.";
      setState((prev) => ({
        ...prev,
        phase: prev.view ? "ready" : "error",
        stale: prev.view !== null,
        errorMessage: message,
      }));
      return false;
    }
  }, [status, query, tz]);

  // Load whenever the filter, search or timezone changes.
  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(timer);
  }, [refresh]);

  // Background refresh: every minute and when the tab regains focus.
  useEffect(() => {
    const timer = setInterval(() => void refresh(), BACKGROUND_REFRESH_MS);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  useEffect(() => () => inFlight.current?.abort(), []);

  return { ...state, refresh };
}
