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
 * The lead to show after a response arrives: whichever copy the server wrote last. A response
 * that arrives late (for an older change) must not overwrite a newer one.
 */
export function newerLead<T extends Revisioned>(current: T, incoming: T): T {
  return Date.parse(incoming.updated_at) >= Date.parse(current.updated_at) ? incoming : current;
}

/** Newest first by creation time, then id, matching the server's timeline order. */
export function compareEntries(a: Ordered, b: Ordered): number {
  return Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id;
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
