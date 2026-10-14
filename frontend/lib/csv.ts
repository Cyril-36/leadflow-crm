// CSV export of the leads on screen. Import-free so Node's test runner can load it directly
// (lib/csv.test.ts).

export interface CsvLead {
  name: string;
  company: string | null;
  phone: string | null;
  status: string;
  last_note: { body: string; at: string } | null;
  next_follow_up_at: string | null;
  created_at: string;
}

export interface CsvOptions {
  statusLabel: (status: string) => string;
  timeZone: string;
  /** The time the screen uses, so "overdue" in the file matches the cards. */
  now: Date;
}

/**
 * A signed number written in digit groups, such as "+91 98765 43210" or "-5". With no operator
 * after the sign, a spreadsheet can't compute anything from it, so it needs no apostrophe.
 */
const SIGNED_DIGIT_GROUPS = /^[+-]?[0-9]+( [0-9]+)*$/;

/**
 * One CSV field (RFC 4180). Values a spreadsheet would treat as a formula (starting with =, +, -,
 * @, tab or carriage return) are prefixed with an apostrophe so they stay plain text, except
 * signed digit groups such as "+91 98765 43210", which would otherwise show the apostrophe.
 */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) && !SIGNED_DIGIT_GROUPS.test(value) ? `'${value}` : value;
  return /[",\r\n]|^\s|\s$/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/** "2026-10-14 15:00" in the given time zone, so the file reads the same as the screen. */
export function localDateTime(iso: string, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(iso))
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

/** The leads as a CSV document: UTF-8 byte-order mark (for Excel), CRLF line endings. */
export function leadsToCsv(leads: CsvLead[], { statusLabel, timeZone, now }: CsvOptions): string {
  const header = [
    "Name",
    "Company",
    "Phone",
    "Status",
    "Last discussion",
    `Last discussion at (${timeZone})`,
    `Next follow-up (${timeZone})`,
    "Follow-up overdue",
    `Added (${timeZone})`,
  ];
  const rows = leads.map((lead) => [
    lead.name,
    lead.company ?? "",
    lead.phone ?? "",
    statusLabel(lead.status),
    lead.last_note?.body ?? "",
    lead.last_note ? localDateTime(lead.last_note.at, timeZone) : "",
    lead.next_follow_up_at ? localDateTime(lead.next_follow_up_at, timeZone) : "",
    lead.next_follow_up_at && Date.parse(lead.next_follow_up_at) < now.getTime() ? "Yes" : "No",
    localDateTime(lead.created_at, timeZone),
  ]);
  return "﻿" + [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
