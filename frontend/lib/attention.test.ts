import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { QUIET_DAYS, attentionReasons, describeReason } from "./attention.ts";

const NOW = new Date("2026-10-14T12:00:00Z");
const daysAgo = (days: number, hours = 0) => new Date(NOW.getTime() - (days * 24 + hours) * 3_600_000).toISOString();

function lead(overrides: Partial<Parameters<typeof attentionReasons>[0]> = {}) {
  return {
    status: "contacted",
    next_follow_up_at: "2026-10-15T05:00:00Z",
    last_note: { at: daysAgo(1) },
    created_at: daysAgo(10),
    ...overrides,
  };
}

describe("attentionReasons", () => {
  it("leaves an open lead with a future follow-up and a recent discussion alone", () => {
    assert.deepEqual(attentionReasons(lead(), NOW), []);
  });

  it("flags an overdue follow-up", () => {
    assert.deepEqual(attentionReasons(lead({ next_follow_up_at: "2026-10-14T11:59:00Z" }), NOW), ["overdue"]);
  });

  it("flags an open lead with no follow-up scheduled", () => {
    assert.deepEqual(attentionReasons(lead({ next_follow_up_at: null }), NOW), ["no_follow_up"]);
  });

  it(`flags a lead quiet for ${QUIET_DAYS} days, but not one hour earlier`, () => {
    assert.deepEqual(attentionReasons(lead({ last_note: { at: daysAgo(QUIET_DAYS) } }), NOW), ["quiet"]);
    assert.deepEqual(attentionReasons(lead({ last_note: { at: daysAgo(QUIET_DAYS - 1, 23) } }), NOW), []);
  });

  it("counts from creation when there has never been a discussion", () => {
    const silent = lead({ last_note: null, created_at: daysAgo(9) });
    assert.deepEqual(attentionReasons(silent, NOW), ["quiet"]);
    assert.equal(describeReason("quiet", silent, NOW), "Added 9 days ago, no discussion yet");
  });

  it("lists several reasons in priority order", () => {
    const neglected = lead({ next_follow_up_at: null, last_note: { at: daysAgo(12) } });
    assert.deepEqual(attentionReasons(neglected, NOW), ["no_follow_up", "quiet"]);
    assert.equal(describeReason("quiet", neglected, NOW), "No discussion for 12 days");
  });

  it("never flags Won or Lost leads", () => {
    for (const status of ["won", "lost"]) {
      assert.deepEqual(attentionReasons(lead({ status, next_follow_up_at: null, last_note: { at: daysAgo(30) } }), NOW), []);
    }
  });
});
