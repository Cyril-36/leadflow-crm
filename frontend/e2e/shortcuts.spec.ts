import { expect, test } from "@playwright/test";

import { card, createLead } from "./helpers";

test("keyboard shortcuts: / searches, N adds a lead, Ctrl+Enter saves a note", async ({ page, request }) => {
  const lead = await createLead(request, "Shortcut lead");
  await page.goto("/");
  await expect(card(page, lead.id)).toBeVisible();

  await page.locator("body").press("/");
  await expect(page.getByLabel("Search leads")).toBeFocused();
  await page.keyboard.type("n"); // typing in a field must not trigger shortcuts
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByLabel("Search leads").fill("");
  await page.getByLabel("Search leads").blur();

  await page.keyboard.press("n");
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Add lead" })).toBeVisible();
  await page.keyboard.press("Escape");

  await card(page, lead.id).click();
  const box = page.getByLabel("New discussion");
  await box.fill("Saved with the keyboard.");
  await box.press("Control+Enter");
  await expect(page.getByText("Note saved.", { exact: true })).toBeVisible();
  await page.keyboard.press("n"); // inside the dialog: no shortcut
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Add lead" })).toHaveCount(0);
});
