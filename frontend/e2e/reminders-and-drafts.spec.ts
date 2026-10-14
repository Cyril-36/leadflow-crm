import { expect, test } from "@playwright/test";

import { API, card, createLead, setStatus } from "./helpers";

test("the due-today and overdue counts filter the list and combine with status", async ({ page, request }) => {
  // Relies on the seed, which always has an overdue lead from yesterday and two follow-ups today
  // (a past follow-up can't be created through the API).
  const plain = await createLead(request, "No follow-up lead");
  await page.goto("/");
  await expect(card(page, plain.id)).toBeVisible();

  const overdue = page.getByRole("button", { name: /overdue$/ });
  await overdue.click();
  await expect(overdue).toHaveAttribute("aria-pressed", "true");
  await expect(card(page, plain.id)).toHaveCount(0);
  const shown = page.locator("[data-lead-id]");
  await expect(shown.first()).toBeVisible();
  for (const text of await shown.allTextContents()) expect(text).toMatch(/Overdue/);

  // Combine with a status filter, then clear everything.
  await page.getByRole("radio", { name: /^Won/ }).click();
  await expect(page.getByText("No overdue Won leads")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).first().click();
  await expect(overdue).toHaveAttribute("aria-pressed", "false");
  await expect(card(page, plain.id)).toBeVisible();

  const dueToday = page.getByRole("button", { name: /due today$/ });
  await dueToday.click();
  await expect(page.locator('section[aria-labelledby="other-heading"]')).toHaveCount(0);
  await expect(page.locator('section[aria-labelledby="agenda-heading"] [data-lead-id]').first()).toBeVisible();
  await dueToday.click(); // toggles off
  await expect(card(page, plain.id)).toBeVisible();
});

test("an unsaved note survives a page refresh and can be discarded", async ({ page, request }) => {
  const lead = await createLead(request, "Draft restore lead");
  await setStatus(request, lead.id, "contacted");
  await page.goto("/");
  await card(page, lead.id).click();
  await page.getByLabel("New discussion").fill("Half-written note about the renewal.");

  await page.reload(); // an accidental refresh
  await card(page, lead.id).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Draft restored from your last visit.")).toBeVisible();
  await expect(dialog.getByLabel("New discussion")).toHaveValue("Half-written note about the renewal.");

  await dialog.getByRole("button", { name: "Discard draft" }).click();
  await expect(dialog.getByLabel("New discussion")).toHaveValue("");
  await expect(dialog.getByText("Draft restored from your last visit.")).toHaveCount(0);
  await page.reload();
  await card(page, lead.id).click();
  await expect(page.getByRole("dialog").getByLabel("New discussion")).toHaveValue("");
});

test("a saved note doesn't come back as a draft after refresh", async ({ page, request }) => {
  const lead = await createLead(request, "Saved draft lead");
  await page.goto("/");
  await card(page, lead.id).click();
  await page.getByLabel("New discussion").fill("Saved properly.");
  await page.getByRole("button", { name: "Save note" }).click();
  await expect(page.getByText("Note saved.", { exact: true })).toBeVisible();
  await page.reload();
  await card(page, lead.id).click();
  await expect(page.getByRole("dialog").getByLabel("New discussion")).toHaveValue("");
});

test("the timeline is grouped by day", async ({ page, request }) => {
  const lead = await createLead(request, "Timeline lead");
  expect((await request.post(`${API}/leads/${lead.id}/discussions`, { data: { note: "First call." } })).status()).toBe(201);
  await page.goto("/");
  await card(page, lead.id).click();
  const items = page.getByRole("dialog").getByRole("list", { name: "Discussion history, newest first" }).getByRole("listitem");
  await expect(items.first()).toContainText("Today");
  await expect(items.first()).toContainText("First call.");
  await expect(items.nth(1)).not.toContainText("Today"); // one heading per day
});
