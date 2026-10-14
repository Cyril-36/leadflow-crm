import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { TaskQueue, mergeEntry, newerLead, timestampMicros } from "./detail-state.ts";

describe("timestampMicros", () => {
  it("keeps microsecond precision, with or without a fraction", () => {
    assert.equal(timestampMicros("2026-10-14T01:13:26.000002Z") - timestampMicros("2026-10-14T01:13:26.000001Z"), 1);
    assert.equal(timestampMicros("2026-10-14T01:13:26Z"), timestampMicros("2026-10-14T01:13:26.000000Z"));
    assert.equal(timestampMicros("2026-10-14T01:13:26.5Z") - timestampMicros("2026-10-14T01:13:26Z"), 500_000);
  });
});

describe("newerLead", () => {
  it("tells apart writes less than a millisecond apart", () => {
    const first = { status: "contacted", updated_at: "2026-10-14T01:13:26.000100Z" };
    const second = { status: "qualified", updated_at: "2026-10-14T01:13:26.000900Z" };
    assert.equal(newerLead(second, first), second);
  });

  it("keeps the newer copy when an older response arrives last", () => {
    const qualified = { status: "qualified", updated_at: "2026-10-14T01:13:32.000001Z" };
    const contacted = { status: "contacted", updated_at: "2026-10-14T01:13:26.000001Z" };
    assert.equal(newerLead(qualified, contacted), qualified);
    assert.equal(newerLead(contacted, qualified), qualified);
  });
});

describe("mergeEntry", () => {
  const note = { id: 10, created_at: "2026-10-14T01:13:26Z", body: "note" };
  const status = { id: 11, created_at: "2026-10-14T01:13:32Z", body: "status" };
  const created = { id: 1, created_at: "2026-10-01T09:00:00Z", body: "created" };

  it("places a late-arriving older entry below newer ones", () => {
    const afterStatus = mergeEntry([created], status);
    assert.deepEqual(mergeEntry(afterStatus, note).map((e) => e.body), ["status", "note", "created"]);
  });

  it("orders entries with the same timestamp by id", () => {
    const a = { id: 5, created_at: "2026-10-14T01:00:00Z", body: "a" };
    const b = { id: 6, created_at: "2026-10-14T01:00:00Z", body: "b" };
    assert.deepEqual(mergeEntry([a], b).map((e) => e.body), ["b", "a"]);
  });

  it("ignores duplicates and null entries", () => {
    const entries = [status, created];
    assert.equal(mergeEntry(entries, status), entries);
    assert.equal(mergeEntry(entries, null), entries);
  });
});

describe("TaskQueue", () => {
  it("runs tasks one at a time in queue order, even when the first is slow", async () => {
    const queue = new TaskQueue();
    const events: string[] = [];
    let releaseFirst: () => void = () => {};
    const first = queue.run(async () => {
      events.push("first started");
      await new Promise<void>((resolve) => (releaseFirst = resolve));
      events.push("first finished");
    });
    const second = queue.run(async () => {
      events.push("second started");
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(events, ["first started"]);
    releaseFirst();
    await Promise.all([first, second]);
    assert.deepEqual(events, ["first started", "first finished", "second started"]);
  });

  it("keeps going after a failed task", async () => {
    const queue = new TaskQueue();
    const failed = queue.run(async () => {
      throw new Error("boom");
    });
    await assert.rejects(failed);
    assert.equal(await queue.run(async () => "next"), "next");
  });
});
