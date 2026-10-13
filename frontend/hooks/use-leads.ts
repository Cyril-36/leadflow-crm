"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { api, type LeadList } from "@/lib/api";
import { ListLoader, viewFor, type LoaderState, type RefreshOutcome } from "@/lib/list-loader";
import type { LeadStatus } from "@/lib/status";

export type StatusFilter = LeadStatus | "all";

interface Lists {
  /** The server's answer for the filter and search in the key. */
  view: LeadList;
  /** All leads, unfiltered: the source for every count. */
  all: LeadList;
}

const BACKGROUND_REFRESH_MS = 60_000;

function keyFor(status: StatusFilter, query: string, tz: string): string {
  return JSON.stringify([status, query.trim(), tz]);
}

async function fetchLists(key: string, signal: AbortSignal): Promise<Lists> {
  const [status, query, tz] = JSON.parse(key) as [StatusFilter, string, string];
  const filtered = status !== "all" || query !== "";
  const [view, all] = await Promise.all([
    api.listLeads({ tz, status: status === "all" ? undefined : status, q: query }, signal),
    filtered ? api.listLeads({ tz }, signal) : Promise.resolve(null),
  ]);
  return { view, all: all ?? view };
}

/**
 * The lead list for the active filter, search and timezone (PLAN.md §5). What is shown always
 * belongs to the current parameters; `refresh()` resolves "fresh" only once the list on screen is
 * current, so callers can report a failed refresh separately from a successful save.
 */
export function useLeads(status: StatusFilter, query: string, tz: string | null) {
  const [state, setState] = useState<LoaderState<Lists>>({ data: null, error: null });
  const loader = useRef<ListLoader<Lists> | null>(null);
  const key = tz ? keyFor(status, query, tz) : null;

  useEffect(() => {
    const instance = new ListLoader<Lists>(fetchLists, setState);
    loader.current = instance;
    return () => instance.dispose();
  }, []);

  const refresh = useCallback(async (): Promise<RefreshOutcome> => {
    if (!loader.current || !key) return "failed";
    return loader.current.load(key);
  }, [key]);

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

  const shown = viewFor(state, key ?? "");
  return {
    view: shown.value?.view ?? null,
    // Counts never depend on the filter: use the latest unfiltered result, whichever request it came from.
    all: state.data?.value.all ?? null,
    phase: shown.phase,
    stale: shown.stale,
    errorMessage: shown.errorMessage,
    refresh,
  };
}
