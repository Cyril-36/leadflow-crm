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
  // Browser clock frozen at 9:00 AM tomorrow, so "Later today" would be 11:00 AM; the follow-up is
  // at 11:30 AM. The API keeps the real clock, for which that time is in the future.
  await page.goto("/");
  const nine = await page.evaluate(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d.getTime();
  });
  await page.clock.setFixedTime(nine);
  const lead = await createLead(request, "Earlier snooze");
  const at = new Date(nine + 150 * 60_000).toISOString();
  await request.post(`${API}/leads/${lead.id}/discussions`, { data: { note: "Call later.", follow_up_at: at } });
  await page.reload();

  await card(page, lead.id).waitFor();
  await page.getByRole("button", { name: `Snooze the follow-up for ${lead.name}` }).click();
  await expect(page.getByRole("menuitem", { name: "Tomorrow, 10 AM" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /^Later today/ })).toHaveCount(0);
});

test("a slow details save can't be interrupted by closing and reopening the editor", async ({ page, request }) => {
  const lead = await createLead(request, "Slow details");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route(`**/api/leads/${lead.id}/details`, async (route) => {
    const response = await route.fetch(); // the API commits...
    await gate; // ...but its answer is held
    await route.fulfill({ response });
  });
  await page.goto("/");
  await card(page, lead.id).click();
  const dialog = page.getByRole("dialog");
  const pencil = dialog.getByRole("button", { name: "Edit details" });
  await pencil.click();
  await dialog.getByLabel("Name").fill(`${lead.name} renamed`);
  await dialog.getByRole("button", { name: "Save details" }).click();
  await expect(dialog.getByRole("button", { name: "Saving…" })).toBeVisible();

  // While saving, neither the pencil nor Cancel closes (or reopens) the editor.
  await expect(pencil).toHaveAttribute("aria-disabled", "true");
  await pencil.click({ force: true }); // force: Playwright otherwise waits for aria-disabled to clear
  await dialog.getByRole("button", { name: "Cancel" }).click({ force: true });
  const form = dialog.getByRole("form", { name: "Edit lead details" });
  await expect(form).toBeVisible();
  await expect(dialog.getByLabel("Company (optional)")).toHaveAttribute("readonly", "");

  release();
  await expect(form).toHaveCount(0);
  await expect(dialog.getByRole("heading", { name: `${lead.name} renamed` })).toBeVisible();
  await expect(pencil).toBeFocused();
});

test("on a short phone screen the details editor's buttons can be reached", async ({ page, request }) => {
  const lead = await createLead(request, "Short screen details");
  await page.setViewportSize({ width: 375, height: 420 });
  await page.goto("/");
  await card(page, lead.id).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Edit details" }).click();
  await dialog.getByLabel("Phone (optional)").fill("abc");
  await dialog.getByLabel("Phone (optional)").press("Enter");
  await expect(dialog.getByText(/^Phone can contain only digits/)).toBeVisible();

  // Scroll the way a person would (wheel over the form; programmatic scrolling would also move
  // overflow-hidden boxes), until each button is fully on screen and not under the sticky Save bar.
  const reachable = async (name: string) => {
    const box = await dialog.getByRole("button", { name, exact: true }).boundingBox();
    if (!box || box.y < 0 || box.y + box.height > 420) return false;
    return page.evaluate(
      ([x, y, label]) => document.elementFromPoint(x, y)?.closest("button")?.textContent?.trim() === label,
      [box.x + box.width / 2, box.y + box.height / 2, name] as const,
    );
  };
  await page.mouse.move(187, 200);
  for (let step = 0; step < 12 && !((await reachable("Save details")) && (await reachable("Cancel"))); step++) {
    await page.mouse.wheel(0, 60);
    await page.waitForTimeout(50);
  }
  expect(await reachable("Save details")).toBe(true);
  expect(await reachable("Cancel")).toBe(true);
});
