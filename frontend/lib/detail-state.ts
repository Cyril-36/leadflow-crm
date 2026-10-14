// Reconciling mutation responses into an open lead's dialog. Framework-free and import-free so
// Node's test runner can load it directly (lib/detail-state.test.ts).

export interface Revisioned {
  updated_at: string;
}

export interface Ordered {
  id: number;
  created_at: string;
}

/**
 * Microseconds since the epoch for the API's ISO timestamps ("…T23:30:48.076988Z"). Date.parse
 * keeps only milliseconds, which could make two writes in the same millisecond look equal.
 */
export function timestampMicros(iso: string): number {
  const fraction = /\.(\d+)/.exec(iso)?.[1] ?? "";
  const wholeSeconds = Math.floor(Date.parse(iso) / 1000);
  return wholeSeconds * 1_000_000 + Number(fraction.slice(0, 6).padEnd(6, "0"));
}

/**
 * The lead to show after a response arrives: whichever copy the server wrote last. A response
 * that arrives late (for an older change) must not overwrite a newer one. Within one dialog the
 * per-lead TaskQueue already applies responses in commit order; this check is the second line of
 * defence, and on an exact tie the incoming (later-queued) response wins.
 */
export function newerLead<T extends Revisioned>(current: T, incoming: T): T {
  return timestampMicros(incoming.updated_at) >= timestampMicros(current.updated_at) ? incoming : current;
}

/** Newest first by creation time, then id, matching the server's timeline order. */
export function compareEntries(a: Ordered, b: Ordered): number {
  return timestampMicros(b.created_at) - timestampMicros(a.created_at) || b.id - a.id;
}

/** Add an entry to a newest-first timeline: no duplicates, and in the server's order. */
export function mergeEntry<T extends Ordered>(entries: T[], entry: T | null): T[] {
  if (!entry || entries.some((existing) => existing.id === entry.id)) return entries;
  return [...entries, entry].sort(compareEntries);
}

/**
 * Runs async tasks one at a time, in the order they were queued. A failed task doesn't stop the
 * ones queued after it.
 */
export class TaskQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task);
    this.tail = result.catch(() => undefined);
    return result;
  }
}
