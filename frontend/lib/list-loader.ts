// Request bookkeeping for the lead list, kept free of React and imports so it can be unit-tested
// with Node's test runner (lib/list-loader.test.ts).
//
// Two guarantees (PLAN.md §5):
// 1. Results are tagged with the parameters (filter, search, timezone) they were fetched for, so a
//    failed request for a new filter never shows the previous filter's leads.
// 2. A refresh reports "fresh" only when the list on screen is current. If a newer request
//    supersedes it (polling, window focus, a filter change), it reports that request's outcome.

export type RefreshOutcome = "fresh" | "failed";

export interface Tagged<T> {
  key: string;
  value: T;
}

export interface LoaderState<T> {
  /** The latest successful result and the parameters it belongs to. */
  data: Tagged<T> | null;
  /** The latest failure and the parameters it was for. */
  error: Tagged<string> | null;
}

export interface ListView<T> {
  value: T | null;
  phase: "loading" | "ready" | "error";
  /** Data for these parameters is shown, but the latest refresh of it failed. */
  stale: boolean;
  errorMessage: string | null;
}

/** What the screen should show for the parameters currently selected. */
export function viewFor<T>(state: LoaderState<T>, key: string): ListView<T> {
  const value = state.data?.key === key ? state.data.value : null;
  const failed = state.error?.key === key;
  return {
    value,
    phase: value !== null ? "ready" : failed ? "error" : "loading",
    stale: value !== null && failed,
    errorMessage: failed ? (state.error?.value ?? null) : null,
  };
}

const isAbort = (error: unknown) => error instanceof Error && error.name === "AbortError";

export class ListLoader<T> {
  private sequence = 0;
  private controller: AbortController | null = null;
  private latest: Promise<RefreshOutcome> = Promise.resolve("fresh");
  private disposed = false;
  private state: LoaderState<T> = { data: null, error: null };

  private readonly fetcher: (key: string, signal: AbortSignal) => Promise<T>;
  private readonly onChange: (state: LoaderState<T>) => void;
  private readonly messageFor: (error: unknown) => string;

  // Plain fields rather than parameter properties: Node's type stripping can't erase those.
  constructor(
    fetcher: (key: string, signal: AbortSignal) => Promise<T>,
    onChange: (state: LoaderState<T>) => void,
    messageFor: (error: unknown) => string = (error) =>
      error instanceof Error ? error.message : "Couldn't load your leads.",
  ) {
    this.fetcher = fetcher;
    this.onChange = onChange;
    this.messageFor = messageFor;
  }

  /**
   * Fetch the list for `key`. Resolves "fresh" once the list on screen is current, or "failed"
   * if the request that ends up owning the list fails.
   */
  load(key: string): Promise<RefreshOutcome> {
    const id = ++this.sequence;
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;

    const run = async (): Promise<RefreshOutcome> => {
      try {
        const value = await this.fetcher(key, controller.signal);
        if (this.disposed) return "failed";
        if (id !== this.sequence) return this.latest; // superseded: report the newer request
        this.set({ data: { key, value }, error: null });
        return "fresh";
      } catch (error) {
        if (this.disposed) return "failed";
        if (id !== this.sequence || isAbort(error)) return this.latest;
        this.set({ data: this.state.data, error: { key, value: this.messageFor(error) } });
        return "failed";
      }
    };
    const outcome = run();
    this.latest = outcome;
    return outcome;
  }

  dispose(): void {
    this.disposed = true;
    this.controller?.abort();
  }

  private set(state: LoaderState<T>): void {
    this.state = state;
    this.onChange(state);
  }
}
