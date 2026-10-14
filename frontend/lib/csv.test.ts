import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { csvCell, leadsToCsv, localDateTime } from "./csv.ts";

describe("csvCell", () => {
  it("leaves plain values alone", () => {
    assert.equal(csvCell("Ananya Rao"), "Ananya Rao");
  });

  it("quotes commas, quotes and line breaks", () => {
    assert.equal(csvCell("Cedar & Pine, Studio"), '"Cedar & Pine, Studio"');
    assert.equal(csvCell('She said "yes"'), '"She said ""yes"""');
    assert.equal(csvCell("line one\nline two"), '"line one\nline two"');
  });

  it("neutralises values a spreadsheet would run as a formula", () => {
    assert.equal(csvCell("=HYPERLINK(\"http://x\")"), '"\'=HYPERLINK(""http://x"")"');
    assert.equal(csvCell("@SUM(A1)"), "'@SUM(A1)");
    assert.equal(csvCell("+cmd|' /C calc'!A0"), "'+cmd|' /C calc'!A0");
    assert.equal(csvCell("-2+SUM(A1:A9)"), "'-2+SUM(A1:A9)");
    assert.equal(csvCell("+"), "'+");
  });

  it("leaves +91-style phone numbers and signed numbers alone", () => {
    assert.equal(csvCell("+91 98765 43210"), "+91 98765 43210");
    assert.equal(csvCell("+919876543210"), "+919876543210");
    assert.equal(csvCell("-5"), "-5");
    assert.equal(csvCell("555-0107"), "555-0107"); // no leading formula character
  });

  it("still guards signed values that contain arithmetic", () => {
    assert.equal(csvCell("+1-2"), "'+1-2");
    assert.equal(csvCell("+1 -2"), "'+1 -2");
    assert.equal(csvCell("-1+1"), "'-1+1");
    assert.equal(csvCell("+1 (555) 010-1234"), "'+1 (555) 010-1234");
    assert.equal(csvCell("+1.5"), "'+1.5");
  });
});

describe("leadsToCsv", () => {
  const lead = {
    name: "Ananya Rao",
    company: "Kestrel Logistics",
    phone: null,
    status: "proposal_sent",
    last_note: { body: "Sent pricing, waiting on finance.", at: "2026-10-14T04:45:00Z" },
    next_follow_up_at: "2026-10-14T09:30:00Z",
    follow_up_overdue: false,
    created_at: "2026-10-07T03:32:00Z",
  };

  it("writes a header and one row per lead, in local time", () => {
    const csv = leadsToCsv([lead], { statusLabel: () => "Proposal Sent", timeZone: "Asia/Kolkata" });
    assert.ok(csv.startsWith("﻿"));
    const lines = csv.slice(1).trimEnd().split("\r\n");
    assert.equal(lines.length, 2);
    assert.equal(
      lines[0],
      "Name,Company,Phone,Status,Last discussion,Last discussion at (Asia/Kolkata),Next follow-up (Asia/Kolkata),Follow-up overdue,Added (Asia/Kolkata)",
    );
    assert.equal(
      lines[1],
      'Ananya Rao,Kestrel Logistics,,Proposal Sent,"Sent pricing, waiting on finance.",2026-10-14 10:15,2026-10-14 15:00,No,2026-10-07 09:02',
    );
  });

  it("formats times in the requested zone, across a DST change", () => {
    assert.equal(localDateTime("2026-11-01T05:30:00Z", "America/New_York"), "2026-11-01 01:30");
    assert.equal(localDateTime("2026-11-01T06:30:00Z", "America/New_York"), "2026-11-01 01:30");
  });
});
