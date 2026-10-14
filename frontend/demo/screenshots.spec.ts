import { expect, test } from "@playwright/test";

// README screenshots from the freshly seeded demo environment.
const OUT = "../docs/screenshots";

test("desktop", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('section[aria-labelledby="agenda-heading"]')).toBeVisible();
  await page.waitForTimeout(600); // let entrance animations settle
  await page.screenshot({ path: `${OUT}/desktop-list.png`, fullPage: true });

  await page.locator("[data-lead-id]", { hasText: "Ananya Rao" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Intro call. 40 reps")).toBeVisible();
  await dialog.getByLabel("New discussion").fill("Finance approved the 40-seat plan. Sending the order form.");
  await dialog.getByRole("button", { name: "Change follow-up" }).click();
  await dialog.getByRole("button", { name: "Tomorrow, 10 AM" }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/desktop-timeline-dialog.png` });
});

test("mobile", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await expect(page.locator('section[aria-labelledby="agenda-heading"]')).toBeVisible();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/mobile-list.png`, fullPage: true });
  await page.locator("[data-lead-id]", { hasText: "Ananya Rao" }).click();
  await expect(page.getByRole("dialog").getByText("Intro call. 40 reps")).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/mobile-timeline-dialog.png` });
});
