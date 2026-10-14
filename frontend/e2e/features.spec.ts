import { expect, test, type Page } from "@playwright/test";

import { API, activeElementInfo, card, createLead } from "./helpers";

const timeline = (page: Page) =>
  page.getByRole("dialog").getByRole("list", { name: "Discussion history, newest first" }).getByRole("listitem");

test("edit a lead's name, company and phone from its dialog", async ({ page, request }) => {
  const created = await request.post(`${API}/leads`, {
    data: { name: `Typo Nmae ${Date.now().toString(36)}`, company: "Wrong Co", phone: "555-0100" },
  });
  const id = (await created.json()).lead.id as number;
  const newName = `Fixed Name ${Date.now().toString(36)}`;
  await page.goto("/");
  await card(page, id).click();
  const dialog = page.getByRole("dialog");

  await dialog.getByRole("button", { name: "Edit details" }).click();
  await expect(dialog.getByLabel("Name")).toBeFocused();
  await dialog.getByLabel("Name").fill(newName);
  await dialog.getByLabel("Company (optional)").fill("");
  await dialog.getByLabel("Phone (optional)").fill("call me");
  await dialog.getByRole("button", { name: "Save details" }).click();
  await expect(dialog.getByText(/^Phone can contain only digits/)).toBeVisible(); // from the server

  await dialog.getByLabel("Phone (optional)").fill("555-0199");
  await dialog.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByText("Details updated.")).toBeVisible();
  await expect(dialog.getByRole("heading", { name: newName })).toBeVisible();
  await expect(dialog.getByText("No company")).toBeVisible();
  await expect(timeline(page).first()).toContainText("Updated name, company and phone");
  await expect(dialog.getByRole("form", { name: "Edit lead details" })).toHaveCount(0);
  expect((await activeElementInfo(page)).inDialog).toBe(true);

  await page.keyboard.press("Escape");
  await expect(card(page, id)).toContainText(newName);
  await page.reload();
  await expect(card(page, id)).toContainText(newName);
  await expect(card(page, id)).not.toContainText("Wrong Co");
});

test("reschedule a follow-up without writing a note", async ({ page, request }) => {
  const lead = await createLead(request, "Reschedule lead");
  const tomorrow = new Date(Date.now() + 26 * 3_600_000).toISOString();
  await request.post(`${API}/leads/${lead.id}/discussions`, { data: { note: "Original discussion.", follow_up_at: tomorrow } });

  await page.goto("/");
  const target = await page.evaluate(() => {
    const t = new Date(Date.now() + 10 * 60_000);
    const pad = (n: number) => String(n).padStart(2, "0");
    return {
      ok: t.getDate() === new Date().getDate(),
      date: `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`,
      time: `${pad(t.getHours())}:${pad(t.getMinutes())}`,
    };
  });
  test.skip(!target.ok, "needs at least 10 minutes left in the local day");

  await card(page, lead.id).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Change follow-up" }).click();
  await dialog.getByLabel("Date").fill(target.date);
  await dialog.getByLabel("Time").fill(target.time);
  await dialog.getByRole("button", { name: "Save follow-up" }).click();

  await expect(page.getByText(/^Follow-up set for Today/)).toBeVisible();
  await expect(timeline(page).first()).toContainText("Follow-up moved to Today");
  await expect(dialog.getByLabel("New discussion")).toHaveValue("");
  await page.keyboard.press("Escape");
  const agenda = page.locator('section[aria-labelledby="agenda-heading"]');
  await expect(agenda.locator(`[data-lead-id="${lead.id}"]`)).toHaveCount(1);
  await expect(card(page, lead.id)).toContainText("Original discussion."); // last discussion unchanged
});
