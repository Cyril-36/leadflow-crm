import { expect, test, type Locator, type Page } from "@playwright/test";

import { card, createLead } from "./helpers";

test.use({ viewport: { width: 375, height: 812 }, hasTouch: true });

async function rect(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("element is not rendered");
  return { top: box.y, bottom: box.y + box.height };
}

/** The follow-up confirmation can be scrolled fully clear of the pinned Save bar. */
async function expectEchoClearOfSaveBar(page: Page) {
  const dialog = page.getByRole("dialog");
  const echo = dialog.getByText(/^New follow-up:/);
  await echo.scrollIntoViewIfNeeded();
  // Reads "Save follow-up" until a note is written, then "Save note".
  const save = dialog.getByRole("button", { name: /^Save (note|follow-up)$/ });
  await expect(save).toBeInViewport();
  const echoBox = await rect(echo);
  const saveBarTop = (await rect(save.locator(".."))).top;
  expect(echoBox.bottom).toBeLessThanOrEqual(saveBarTop + 1);
  expect(echoBox.top).toBeGreaterThanOrEqual(0);
}

test("the 375px follow-up editor stays usable, including with the keyboard open", async ({ page, request }) => {
  const lead = await createLead(request, "Mobile lead");
  await page.goto("/");
  await card(page, lead.id).click();

  const dialog = page.getByRole("dialog");
  // Full screen once the slide-up has settled.
  await expect.poll(async () => dialog.boundingBox()).toMatchObject({ x: 0, y: 0, width: 375, height: 812 });

  await dialog.getByRole("button", { name: "Add follow-up" }).click();
  await dialog.getByRole("button", { name: "Tomorrow, 10 AM" }).click();
  await expect(dialog.getByText(/^New follow-up: Tomorrow, 10:00 AM/)).toBeAttached();
  await expectEchoClearOfSaveBar(page);

  // An open on-screen keyboard leaves roughly half the screen.
  await page.setViewportSize({ width: 375, height: 420 });
  const note = dialog.getByLabel("New discussion");
  await note.focus();
  await note.fill("Called from the car. Wants pricing by Friday.");
  await expect(note).toBeInViewport();
  await expect(dialog.getByRole("button", { name: "Save note" })).toBeInViewport();
  await expectEchoClearOfSaveBar(page);
  await expect(dialog.getByLabel("Date")).toHaveValue(/\d{4}-\d{2}-\d{2}/);

  await dialog.getByRole("button", { name: "Save note" }).click();
  await expect(page.getByText("Note saved.", { exact: true })).toBeVisible();
});
