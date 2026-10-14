import { expect, test } from "@playwright/test";

import { API, card, createLead } from "./helpers";

test("a lead added during a search that spans name and company is reported as hidden", async ({ page }) => {
  const tag = Date.now().toString(36);
  await page.goto("/");
  // "<tag> Kestrel" appears in "Asha <tag> Kestrel <tag>" only when name and company are joined;
  // the API matches each field on its own, so the new lead isn't in the list.
  await page.getByRole("searchbox").fill(`${tag} Kestrel`);
  await expect(page.getByRole("heading", { name: `No leads match \u201c${tag} Kestrel\u201d` })).toBeVisible();
  await page.getByRole("button", { name: "Add lead" }).click();
  await page.getByLabel("Name").fill(`Asha ${tag}`);
  await page.getByLabel("Company (optional)").fill(`Kestrel ${tag}`);
  await page.getByRole("button", { name: "Save lead" }).click();

  await expect(page.getByText("Lead added. It's hidden by your search.")).toBeVisible();
  await expect(page.locator("[data-lead-id]", { hasText: `Asha ${tag}` })).toHaveCount(0);
});

test("Snooze never offers to move a follow-up later today to an earlier time", async ({ page, request }) => {
  await page.goto("/");
  // Two and a half hours ahead: later than the "Later today" shortcut (two hours, rounded up to
  // the quarter hour), but still today.
  const at = await page.evaluate(() => {
    const t = new Date(Date.now() + 150 * 60_000);
    return t.getDate() === new Date().getDate() ? t.toISOString() : null;
  });
  test.skip(!at, "needs two and a half hours left in the local day");
  const lead = await createLead(request, "Earlier snooze");
  await request.post(`${API}/leads/${lead.id}/discussions`, { data: { note: "Call later.", follow_up_at: at } });
  await page.reload();

  await card(page, lead.id).waitFor();
  await page.getByRole("button", { name: `Snooze the follow-up for ${lead.name}` }).click();
  await expect(page.getByRole("menuitem", { name: "Tomorrow, 10 AM" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /^Later today/ })).toHaveCount(0);
});
