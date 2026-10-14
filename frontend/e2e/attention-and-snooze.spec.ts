import { expect, test, type Page } from "@playwright/test";

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
