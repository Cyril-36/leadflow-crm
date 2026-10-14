import { expect, test, type Page } from "@playwright/test";

import { API, card } from "./helpers";

// The assessment's required workflow, end to end in a real browser against the real API.

async function localNow(page: Page) {
  return page.evaluate(() => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const later = new Date(now.getTime() + 10 * 60_000);
    later.setSeconds(0, 0);
    return {
      minutesLeftToday: 24 * 60 - (now.getHours() * 60 + now.getMinutes()),
      date: `${later.getFullYear()}-${pad(later.getMonth() + 1)}-${pad(later.getDate())}`,
      time: `${pad(later.getHours())}:${pad(later.getMinutes())}`,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  });
}

test("create a lead, log a discussion with a follow-up, change status, mark done, persist", async ({ page }) => {
  // 1. Open the dashboard.
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).not.toBeEmpty();
  await expect(page.locator("[data-lead-id]").first()).toBeVisible();
  const clock = await localNow(page);
  test.skip(clock.minutesLeftToday < 15, "needs at least 15 minutes left in the local day");

  // 2. Create a lead; it starts as New.
  const name = `Acceptance ${Date.now().toString(36)}`;
  await page.getByRole("button", { name: "Add lead" }).click();
  await page.getByLabel("Name").fill(name);
  await page.getByLabel(/Company/).fill("Northwind Advisory");
  await page.getByLabel(/Phone/).fill("555-0142");
  await page.getByRole("button", { name: "Save lead" }).click();
  await expect(page.getByText("Lead added.", { exact: true })).toBeVisible();
  const newCard = page.locator("[data-lead-id]", { hasText: name });
  await expect(newCard).toBeVisible();
  await expect(newCard).toContainText("New");
  await expect(newCard).toContainText("No discussions yet");
  const id = Number(await newCard.getAttribute("data-lead-id"));

  // 3. Open its timeline dialog.
  await newCard.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name })).toBeVisible();
  await expect(dialog.getByText("Lead created")).toBeVisible();

  // 4. Add a discussion with a follow-up later today.
  await dialog.getByLabel("New discussion").fill("Intro call. Wants a demo for the advisory team.");
  await dialog.getByRole("button", { name: "Add follow-up" }).click();
  await dialog.getByLabel("Date").fill(clock.date);
  await dialog.getByLabel("Time").fill(clock.time);
  await expect(dialog.getByText(/^New follow-up: Today,/)).toBeVisible();
  await dialog.getByRole("button", { name: "Save note" }).click();
  await expect(page.getByText("Note saved.", { exact: true })).toBeVisible();
  const timeline = dialog.getByRole("list", { name: "Discussion history, newest first" });
  await expect(timeline.getByRole("listitem").first()).toContainText("Intro call. Wants a demo");
  await expect(timeline.getByRole("listitem").first()).toContainText("Follow-up set for Today");

  // 5. It moves into Today's follow-ups immediately (no reload).
  const agenda = page.locator('section[aria-labelledby="agenda-heading"]');
  await expect(agenda.locator(`[data-lead-id="${id}"]`)).toHaveCount(1);

  // 6. Change the status; the timeline records it.
  await dialog.getByRole("combobox").click();
  await page.getByRole("option", { name: "Qualified" }).click();
  await expect(page.getByText("Status changed to Qualified.")).toBeVisible();
  await expect(timeline.getByRole("listitem").first()).toContainText("Status changed from New to Qualified");

  // 7. Mark the follow-up done; the lead leaves Today.
  await dialog.getByRole("button", { name: "Mark done" }).click();
  await expect(page.getByText("Follow-up marked done.")).toBeVisible();
  await expect(timeline.getByRole("listitem").first()).toContainText("marked done");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(agenda.locator(`[data-lead-id="${id}"]`)).toHaveCount(0);
  await expect(card(page, id)).toContainText("Qualified");

  // 8. Reload: everything persisted.
  await page.reload();
  await expect(card(page, id)).toContainText("Qualified");
  await expect(card(page, id)).toContainText("Intro call. Wants a demo");
  await expect(agenda.locator(`[data-lead-id="${id}"]`)).toHaveCount(0);
  await card(page, id).click();
  await expect(timeline.getByRole("listitem")).toHaveCount(4);
  const entries = await timeline.getByRole("listitem").allTextContents();
  expect(entries[0]).toContain("marked done");
  expect(entries[1]).toContain("Status changed from New to Qualified");
  expect(entries[2]).toContain("Intro call");
  expect(entries[3]).toContain("Lead created");
  await page.keyboard.press("Escape");

  // 9. Every lead appears exactly once, and the page shows exactly what the API returns.
  const ids = await page.locator("[data-lead-id]").evaluateAll((els) => els.map((el) => el.getAttribute("data-lead-id")));
  expect(new Set(ids).size).toBe(ids.length);
  const api = await (await page.request.get(`${API}/leads?tz=${encodeURIComponent(clock.tz)}`)).json();
  const apiIds = [...api.pinned, ...api.leads].map((lead: { id: number }) => String(lead.id));
  expect([...ids].sort()).toEqual([...apiIds].sort());
});
