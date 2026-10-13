// Date helpers for the browser's local timezone. No imports, so Node's test runner can load the
// file directly (lib/time.test.ts).

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const LONG_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const pad = (n: number) => String(n).padStart(2, "0");

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Calendar days from today to `t` in local time (negative = past). DST-safe. */
export function dayOffset(t: Date, now: Date): number {
  return Math.round((startOfDay(t).getTime() - startOfDay(now).getTime()) / 86_400_000);
}

export function formatTime(t: Date): string {
  const h = t.getHours();
  return `${h % 12 || 12}:${pad(t.getMinutes())} ${h < 12 ? "AM" : "PM"}`;
}

/** "Today, 3:00 PM", "Yesterday, 9:05 AM", "Tomorrow, 10:00 AM", "Thu 16 Oct, 11:00 AM". */
export function formatWhen(t: Date, now: Date): string {
  const k = dayOffset(t, now);
  if (k === 0) return `Today, ${formatTime(t)}`;
  if (k === -1) return `Yesterday, ${formatTime(t)}`;
  if (k === 1) return `Tomorrow, ${formatTime(t)}`;
  const year = t.getFullYear() === now.getFullYear() ? "" : ` ${t.getFullYear()}`;
  return `${DAYS[t.getDay()]} ${t.getDate()} ${MONTHS[t.getMonth()]}${year}, ${formatTime(t)}`;
}

/**
 * Relative time that agrees with the calendar: minutes and hours only within today, calendar
 * days from yesterday on ("Mon 12 Oct" on a Wednesday is "2 days ago", never "yesterday").
 */
export function formatAgo(t: Date, now: Date): string {
  const k = dayOffset(t, now);
  if (k >= 0) {
    const minutes = Math.floor((now.getTime() - t.getTime()) / 60_000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  }
  const days = -k;
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) {
    const weeks = Math.floor(days / 7);
    return weeks === 1 ? "1 week ago" : `${weeks} weeks ago`;
  }
  const months = Math.floor(days / 30);
  return months === 1 ? "1 month ago" : `${months} months ago`;
}

/** "Wednesday 14 October" */
export function formatLongDate(d: Date): string {
  return `${LONG_DAYS[d.getDay()]} ${d.getDate()} ${LONG_MONTHS[d.getMonth()]}`;
}

/** "GMT+5:30", "GMT-4" for the offset in effect at `d`. */
export function formatOffset(d: Date): string {
  const total = -d.getTimezoneOffset();
  const sign = total >= 0 ? "+" : "-";
  const h = Math.floor(Math.abs(total) / 60);
  const m = Math.abs(total) % 60;
  return `GMT${sign}${h}${m ? `:${pad(m)}` : ""}`;
}

export function toDateInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function toTimeInput(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export type FollowUpResult =
  | { ok: true; date: Date }
  | { ok: false; reason: "incomplete" | "invalid" | "nonexistent" | "past"; message: string };

/**
 * Turn the values of <input type="date"> and <input type="time"> into an instant in the
 * browser's timezone.
 *
 * - A local time skipped by a DST change (clocks jump forward) is rejected: JavaScript would
 *   silently move it, so we detect that the result no longer reads back as the same wall time.
 * - A local time that happens twice (clocks go back) resolves to the earlier occurrence, which
 *   is what `new Date(y, m, d, h, mi)` does; the form shows the offset so the choice is visible.
 */
export function parseFollowUp(dateValue: string, timeValue: string, now: Date): FollowUpResult {
  if (!dateValue || !timeValue) {
    return { ok: false, reason: "incomplete", message: "Pick both a date and a time." };
  }
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);
  const tm = /^(\d{2}):(\d{2})$/.exec(timeValue);
  if (!dm || !tm) {
    return { ok: false, reason: "invalid", message: "Enter a valid date and time." };
  }
  const [y, mo, d] = [Number(dm[1]), Number(dm[2]), Number(dm[3])];
  const [h, mi] = [Number(tm[1]), Number(tm[2])];
  const date = new Date(y, mo - 1, d, h, mi);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) {
    return { ok: false, reason: "invalid", message: "Enter a valid date and time." };
  }
  if (date.getHours() !== h || date.getMinutes() !== mi) {
    return {
      ok: false,
      reason: "nonexistent",
      message: "That time doesn't exist in your timezone because of a daylight-saving change.",
    };
  }
  if (date.getTime() <= now.getTime()) {
    return { ok: false, reason: "past", message: "Pick a time in the future." };
  }
  return { ok: true, date };
}

export type Shortcut = { label: string; date: string; time: string };

/** Quick follow-up choices: later today (+2 h, next quarter hour), tomorrow 10 AM, next Monday 10 AM. */
export function followUpShortcuts(now: Date): Shortcut[] {
  const shortcuts: Shortcut[] = [];
  const later = new Date(now.getTime() + 2 * 3_600_000);
  later.setSeconds(0, 0);
  later.setMinutes(Math.ceil(later.getMinutes() / 15) * 15);
  if (dayOffset(later, now) === 0) {
    shortcuts.push({ label: `Later today, ${formatTime(later)}`, date: toDateInput(later), time: toTimeInput(later) });
  }
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 10, 0);
  shortcuts.push({ label: "Tomorrow, 10 AM", date: toDateInput(tomorrow), time: "10:00" });
  const daysToMonday = ((8 - now.getDay()) % 7) || 7;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysToMonday, 10, 0);
  if (daysToMonday !== 1) {
    shortcuts.push({ label: "Next Mon, 10 AM", date: toDateInput(monday), time: "10:00" });
  }
  return shortcuts;
}

/** The browser's IANA timezone, e.g. "Asia/Kolkata". */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
