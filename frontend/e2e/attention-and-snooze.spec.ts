import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { API, activeElementInfo, card, createLead } from "./helpers";

const agenda = (page: Page) => page.locator('section[aria-labelledby="agenda-heading"]');

/** A follow-up 10 minutes from now in the browser's day, or null too close to midnight. */
async function soonToday(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const soon = new Date(Date.now() + 10 * 60_000);
    return soon.getDate() === new Date().getDate() ? soon.toISOString() : null;
  });
}

test("Needs attention lists open leads that need action and says why", async ({ page, request }) => {
  const unscheduled = await createLead(request, "Unscheduled lead");
  const healthy = await createLead(request, "Healthy lead");
  const nextWeek = new Date(Date.now() + 7 * 86_400_000).toISOString();
  await request.post(`${API}/leads/${healthy.id}/discussions`, { data: { note: "All good.", follow_up_at: nextWeek } });
  const won = await createLead(request, "Won lead without follow-up");
  await request.patch(`${API}/leads/${won.id}`, { data: { status: "won" } });

  await page.goto("/");
  const toggle = page.getByRole("button", { name: /Needs attention/ });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText(/^Open leads with an overdue follow-up, no follow-up scheduled/)).toBeVisible();

  await expect(card(page, unscheduled.id)).toContainText("No follow-up scheduled");
  await expect(card(page, healthy.id)).toHaveCount(0);
  await expect(card(page, won.id)).toHaveCount(0); // Won and Lost never need attention

  await toggle.click();
  await expect(card(page, healthy.id)).toBeVisible();
  await expect(card(page, unscheduled.id)).not.toContainText("No follow-up scheduled"); // reasons only in that view
});

test("Snooze moves a due follow-up out of Today and logs it", async ({ page, request }) => {
  await page.goto("/");
  const followUp = await soonToday(page);
  test.skip(!followUp, "needs at least 10 minutes left in the local day");
  const lead = await createLead(request, "Snooze lead");
  await request.post(`${API}/leads/${lead.id}/discussions`, { data: { note: "Call back later.", follow_up_at: followUp } });
  await page.reload();
  await expect(agenda(page).locator(`[data-lead-id="${lead.id}"]`)).toHaveCount(1);

  await page.getByRole("button", { name: `Snooze the follow-up for ${lead.name}` }).click();
  await page.getByRole("menuitem", { name: "Tomorrow, 10 AM" }).click();

  await expect(page.getByText(`Follow-up for ${lead.name} moved to Tomorrow, 10:00 AM.`)).toBeVisible();
  await expect(agenda(page).locator(`[data-lead-id="${lead.id}"]`)).toHaveCount(0);
  await expect(card(page, lead.id)).toContainText("Follow-up Tomorrow, 10:00 AM");
  await expect.poll(async () => (await activeElementInfo(page)).leadId).toBe(String(lead.id)); // focus back on the card

  await card(page, lead.id).click();
  const items = page.getByRole("dialog").getByRole("list", { name: "Discussion history, newest first" }).getByRole("listitem");
  await expect(items.first()).toContainText("Follow-up moved to Tomorrow, 10:00 AM");
});

test("Snooze works from the keyboard", async ({ page, request }) => {
  await page.goto("/");
  const followUp = await soonToday(page);
  test.skip(!followUp, "needs at least 10 minutes left in the local day");
  const lead = await createLead(request, "Keyboard snooze lead");
  await request.post(`${API}/leads/${lead.id}/discussions`, { data: { note: "Ping again.", follow_up_at: followUp } });
  await page.reload();

  const trigger = page.getByRole("button", { name: `Snooze the follow-up for ${lead.name}` });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByText(new RegExp(`^Follow-up for ${lead.name} moved to`))).toBeVisible();
  await expect(menu).toHaveCount(0);
});

/** A unique lead due `minutes` from now, today, or null too close to midnight. */
async function leadDueSoon(page: Page, request: APIRequestContext, prefix: string, minutes: number) {
  const at = await page.evaluate((m) => {
    const soon = new Date(Date.now() + m * 60_000);
    return soon.getDate() === new Date().getDate() ? soon.toISOString() : null;
  }, minutes);
  if (!at) return null;
  const lead = await createLead(request, prefix);
  await request.post(`${API}/leads/${lead.id}/discussions`, { data: { note: "Due soon.", follow_up_at: at } });
  return { ...lead, at };
}

async function snoozeWithKeyboard(page: Page, name: string, option: string | RegExp) {
  await page.getByRole("button", { name: `Snooze the follow-up for ${name}` }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("menuitem", { name: option }).focus();
  await page.keyboard.press("Enter");
}

test("when a filter hides the snoozed lead, focus moves to the next card", async ({ page, request }) => {
  await page.goto("/");
  const tag = `Neighbour ${Date.now().toString(36)}`;
  const first = await leadDueSoon(page, request, tag, 10);
  const second = await leadDueSoon(page, request, tag, 20);
  test.skip(!first || !second, "needs at least 20 minutes left in the local day");
  await page.reload();
  await page.getByRole("searchbox").fill(tag);
  await page.getByRole("button", { name: /due today/ }).click();
  await expect(page.locator("[data-lead-id]")).toHaveCount(2);

  await snoozeWithKeyboard(page, first!.name, "Tomorrow, 10 AM");
  await expect(page.getByText(`Follow-up for ${first!.name} moved to Tomorrow, 10:00 AM.`)).toBeVisible();
  await expect(card(page, first!.id)).toHaveCount(0); // Due today no longer matches
  await expect.poll(async () => (await activeElementInfo(page)).leadId).toBe(String(second!.id));
});

test("when the snoozed lead was the only one shown, focus moves to the active filter", async ({ page, request }) => {
  await page.goto("/");
  const lead = await leadDueSoon(page, request, `Only ${Date.now().toString(36)}`, 10);
  test.skip(!lead, "needs at least 10 minutes left in the local day");
  await page.reload();
  await page.getByRole("searchbox").fill(lead!.name);
  const dueToday = page.getByRole("button", { name: /due today/ });
  await dueToday.click();
  await expect(page.locator("[data-lead-id]")).toHaveCount(1);

  await snoozeWithKeyboard(page, lead!.name, "Tomorrow, 10 AM");
  await expect(page.locator("[data-lead-id]")).toHaveCount(0);
  await expect(dueToday).toBeFocused();
  await expect(dueToday).toHaveAttribute("aria-pressed", "true");
});

test("a failed Snooze keeps the follow-up and leaves focus on the Snooze button", async ({ page, request }) => {
  await page.goto("/");
  const lead = await leadDueSoon(page, request, "Failing snooze", 10);
  test.skip(!lead, "needs at least 10 minutes left in the local day");
  await page.route(`**/api/leads/${lead!.id}/follow-up`, (route) =>
    route.fulfill({ status: 500, json: { error: { code: "internal", message: "Server unavailable." } } }),
  );
  await page.reload();

  await snoozeWithKeyboard(page, lead!.name, "Tomorrow, 10 AM");
  await expect(page.getByText("Couldn't snooze the follow-up.")).toBeVisible();
  await expect(page.getByRole("button", { name: `Snooze the follow-up for ${lead!.name}` })).toBeFocused();
  await expect(agenda(page).locator(`[data-lead-id="${lead!.id}"]`)).toHaveCount(1);
  await expect(page.getByText(/moved to/)).toHaveCount(0);
});

test("Snoozing to the time already set says so instead of claiming a move", async ({ page, request }) => {
  await page.goto("/");
  const lead = await leadDueSoon(page, request, "Unchanged snooze", 10);
  test.skip(!lead, "needs at least 10 minutes left in the local day");
  // Send the lead's current follow-up time, so the real API treats it as a no-op (entry: null).
  await page.route(`**/api/leads/${lead!.id}/follow-up`, (route) =>
    route.continue({ postData: JSON.stringify({ follow_up_at: lead!.at }) }),
  );
  await page.reload();

  await snoozeWithKeyboard(page, lead!.name, "Tomorrow, 10 AM");
  await expect(page.getByText(new RegExp(`^Follow-up for ${lead!.name} is already scheduled for`))).toBeVisible();
  await expect(page.getByText(/moved to/)).toHaveCount(0);
  await expect.poll(async () => (await activeElementInfo(page)).leadId).toBe(String(lead!.id));

  await card(page, lead!.id).click();
  const items = page.getByRole("dialog").getByRole("list", { name: "Discussion history, newest first" }).getByRole("listitem");
  await expect(items.first()).toContainText("Due soon."); // the newest entry is still the note
  await expect(items.filter({ hasText: "Follow-up moved" })).toHaveCount(0); // nothing logged
});

/**
 * Freezes the browser clock at 9:00 AM tomorrow (local), so the Snooze choices are fixed: "Later
 * today" is exactly 11:00 AM. The API keeps the real clock, for which that day is in the future.
 */
async function freezeAtNineTomorrow(page: Page): Promise<number> {
  await page.goto("/");
  const nine = await page.evaluate(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d.getTime();
  });
  await page.clock.setFixedTime(nine);
  return nine;
}

test("the Snooze option matching the current follow-up is disabled", async ({ page, request }) => {
  const nine = await freezeAtNineTomorrow(page);
  const lead = await createLead(request, "Already set snooze");
  const at = new Date(nine + 2 * 3_600_000).toISOString(); // the "Later today" choice, 11:00 AM
  await request.post(`${API}/leads/${lead.id}/discussions`, { data: { note: "Later.", follow_up_at: at } });
  await page.reload();

  await page.getByRole("button", { name: `Snooze the follow-up for ${lead.name}` }).click();
  const laterToday = page.getByRole("menuitem", { name: /^Later today, 11:00 AM/ });
  await expect(laterToday).toHaveAttribute("aria-disabled", "true");
  await expect(laterToday).toContainText("Already set");
  await expect(page.getByRole("menuitem", { name: "Tomorrow, 10 AM" })).not.toHaveAttribute("aria-disabled", "true");
});

test("a Snooze that completes while the lead is open updates the dialog", async ({ page, request }) => {
  await page.goto("/");
  const lead = await leadDueSoon(page, request, "Snooze while open", 10);
  test.skip(!lead, "needs at least 10 minutes left in the local day");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route(`**/api/leads/${lead!.id}/follow-up`, async (route) => {
    await gate; // hold the request before it reaches the API
    await route.continue();
  });
  await page.reload();

  await page.getByRole("button", { name: `Snooze the follow-up for ${lead!.name}` }).click();
  await page.getByRole("menuitem", { name: "Tomorrow, 10 AM" }).click();
  await card(page, lead!.id).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/^Follow-up Today,/)).toBeVisible(); // loaded before the change

  release();
  await expect(dialog.getByText("Follow-up Tomorrow, 10:00 AM")).toBeVisible();
  const items = dialog.getByRole("list", { name: "Discussion history, newest first" }).getByRole("listitem");
  await expect(items.first()).toContainText("Follow-up moved to Tomorrow, 10:00 AM");
  await expect(dialog.getByRole("textbox").first()).toBeFocused(); // focus stays in the dialog
});
