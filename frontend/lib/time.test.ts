// Run with: npm test  (Node's built-in runner; TypeScript types are stripped natively.)
// Every case runs in New York so the daylight-saving transitions are real.
process.env.TZ = "America/New_York";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  currentZoneName,
  dayOffset,
  followUpShortcuts,
  snoozeShortcuts,
  formatAgo,
  formatOffset,
  formatWhen,
  parseFollowUp,
} from "./time.ts";

// Wednesday 14 October 2026, 12:40 local.
const NOW = new Date(2026, 9, 14, 12, 40);

describe("parseFollowUp", () => {
  it("converts local date and time to the right instant", () => {
    const result = parseFollowUp("2026-10-14", "15:00", NOW);
    assert.ok(result.ok);
    assert.equal(result.date.toISOString(), "2026-10-14T19:00:00.000Z"); // EDT is UTC-4
  });

  it("rejects a time skipped by the spring-forward change", () => {
    const march = new Date(2026, 2, 1, 9, 0);
    const result = parseFollowUp("2026-03-08", "02:30", march);
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.reason, "nonexistent");
  });

  it("resolves a repeated fall-back time to the earlier occurrence", () => {
    const result = parseFollowUp("2026-11-01", "01:30", NOW);
    assert.ok(result.ok);
    assert.equal(result.date.toISOString(), "2026-11-01T05:30:00.000Z"); // 01:30 EDT, not EST
    assert.equal(formatOffset(result.date), "GMT-4");
  });

  it("treats the hour after fall-back as standard time", () => {
    const result = parseFollowUp("2026-11-01", "02:30", NOW);
    assert.ok(result.ok);
    assert.equal(result.date.toISOString(), "2026-11-01T07:30:00.000Z");
    assert.equal(formatOffset(result.date), "GMT-5");
  });

  it("rejects past times, the current minute and incomplete input", () => {
    assert.equal(parseFollowUp("2026-10-14", "12:40", NOW).ok, false);
    assert.equal(parseFollowUp("2026-10-14", "09:00", NOW).ok, false);
    const incomplete = parseFollowUp("2026-10-15", "", NOW);
    assert.equal(!incomplete.ok && incomplete.reason, "incomplete");
  });

  it("rejects impossible dates", () => {
    const result = parseFollowUp("2026-02-30", "10:00", NOW);
    assert.equal(!result.ok && result.reason, "invalid");
  });
});

describe("relative formatting follows the calendar", () => {
  it("never calls an entry from two calendar days ago 'yesterday'", () => {
    const monday = new Date(2026, 9, 12, 16, 20); // ~44 hours before NOW
    assert.equal(formatAgo(monday, NOW), "2 days ago");
    assert.equal(formatWhen(monday, NOW), "Mon 12 Oct, 4:20 PM");
  });

  it("uses 'yesterday' for any time on the previous calendar day", () => {
    const lateYesterday = new Date(2026, 9, 13, 23, 59);
    const earlyYesterday = new Date(2026, 9, 13, 0, 1);
    assert.equal(formatAgo(lateYesterday, NOW), "yesterday");
    assert.equal(formatAgo(earlyYesterday, NOW), "yesterday");
    assert.equal(formatWhen(lateYesterday, NOW), "Yesterday, 11:59 PM");
  });

  it("uses minutes and hours within today", () => {
    assert.equal(formatAgo(new Date(2026, 9, 14, 12, 39, 30), NOW), "just now");
    assert.equal(formatAgo(new Date(2026, 9, 14, 12, 15), NOW), "25 min ago");
    assert.equal(formatAgo(new Date(2026, 9, 14, 10, 15), NOW), "2 hours ago");
    assert.equal(formatWhen(new Date(2026, 9, 14, 15, 0), NOW), "Today, 3:00 PM");
    assert.equal(formatWhen(new Date(2026, 9, 15, 10, 0), NOW), "Tomorrow, 10:00 AM");
  });

  it("counts calendar days across a DST change", () => {
    const sundayAfterFallBack = new Date(2026, 10, 1, 12, 0);
    const mondayAfter = new Date(2026, 10, 2, 0, 30);
    assert.equal(dayOffset(sundayAfterFallBack, mondayAfter), -1);
    assert.equal(formatAgo(sundayAfterFallBack, mondayAfter), "yesterday");
  });

  it("adds the year for dates outside the current year", () => {
    assert.equal(formatWhen(new Date(2025, 11, 30, 9, 0), NOW), "Tue 30 Dec 2025, 9:00 AM");
  });
});

describe("followUpShortcuts", () => {
  const labels = (now: Date) => followUpShortcuts(now).map((s) => s.label);

  it("offers later today, tomorrow and next Monday midweek", () => {
    const shortcuts = followUpShortcuts(NOW);
    assert.deepEqual(
      shortcuts.map(({ label, date, time }) => ({ label, date, time })),
      [
        { label: "Later today, 2:45 PM", date: "2026-10-14", time: "14:45" },
        { label: "Tomorrow, 10 AM", date: "2026-10-15", time: "10:00" },
        { label: "Next Mon, 10 AM", date: "2026-10-19", time: "10:00" },
      ],
    );
    assert.equal(shortcuts[1].at.getTime(), new Date(2026, 9, 15, 10, 0).getTime());
  });

  it("adds the next working day when tomorrow is a weekend, without repeating Monday", () => {
    const friday = new Date(2026, 9, 16, 9, 0);
    assert.deepEqual(labels(friday), ["Later today, 11:00 AM", "Tomorrow, 10 AM", "Next working day, Mon 10 AM"]);
    const saturday = new Date(2026, 9, 17, 22, 30);
    assert.deepEqual(labels(saturday), ["Tomorrow, 10 AM", "Next working day, Mon 10 AM"]);
  });

  it("drops 'later today' late in the evening and avoids duplicating tomorrow", () => {
    const sundayNight = new Date(2026, 9, 18, 22, 30);
    assert.deepEqual(labels(sundayNight), ["Tomorrow, 10 AM"]);
  });
});

describe("snoozeShortcuts", () => {
  const labels = (current: Date | null) => snoozeShortcuts(NOW, current).map((s) => s.label);

  it("offers every shortcut for an overdue follow-up", () => {
    assert.deepEqual(labels(new Date(2026, 9, 14, 9, 0)), ["Later today, 2:45 PM", "Tomorrow, 10 AM", "Next Mon, 10 AM"]);
  });

  it("never moves a follow-up later today to an earlier time", () => {
    assert.deepEqual(labels(new Date(2026, 9, 14, 18, 0)), ["Tomorrow, 10 AM", "Next Mon, 10 AM"]);
  });

  it("keeps the choice equal to the current follow-up", () => {
    assert.deepEqual(labels(new Date(2026, 9, 14, 14, 45)), ["Later today, 2:45 PM", "Tomorrow, 10 AM", "Next Mon, 10 AM"]);
  });
});

describe("currentZoneName", () => {
  it("uses the current name for zones browsers report by their old one", () => {
    assert.equal(currentZoneName("Asia/Calcutta"), "Asia/Kolkata");
    assert.equal(currentZoneName("Europe/Kiev"), "Europe/Kyiv");
  });

  it("leaves current names alone", () => {
    assert.equal(currentZoneName("Asia/Kolkata"), "Asia/Kolkata");
    assert.equal(currentZoneName("America/New_York"), "America/New_York");
  });
});
