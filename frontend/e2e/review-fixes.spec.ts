import { expect, test, type Page, type Route } from "@playwright/test";

import { API, card, createLead, setStatus } from "./helpers";

// Regressions for the bugs found in the pre-submission review.

/** Lets the request reach the server (so it commits) but holds the response until released. */
async function holdResponse(page: Page, url: string) {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  let arrived: () => void = () => {};
  const reached = new Promise<void>((resolve) => (arrived = resolve));
  await page.route(url, async (route: Route) => {
    const response = await route.fetch();
    arrived();
    await gate;
    await route.fulfill({ response });
  });
  return { reached, release };
}

const timeline = (page: Page) =>
  page.getByRole("dialog").getByRole("list", { name: "Discussion history, newest first" }).getByRole("listitem");

test("text typed while a save is in flight is kept, not cleared", async ({ page, request }) => {
  const lead = await createLead(request, "Draft lead");
  await page.goto("/");
  await card(page, lead.id).click();
  const box = page.getByLabel("New discussion");
  await box.fill("Original note");

  const held = await holdResponse(page, `**/api/leads/${lead.id}/discussions`);
  await page.getByRole("button", { name: "Save note" }).click();
  await held.reached;
  await expect(page.getByRole("button", { name: "Saving…" })).toBeVisible();
  await box.fill("Second draft typed while the first was saving");
  held.release();

  await expect(page.getByText("Note saved.", { exact: true })).toBeVisible();
  await expect(box).toHaveValue("Second draft typed while the first was saving");
  await expect(timeline(page).first()).toContainText("Original note");
  await expect(timeline(page).filter({ hasText: "Second draft" })).toHaveCount(0);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("a status change made while a note is saving ends in the right state and order", async ({ page, request }) => {
  const lead = await createLead(request, "Overlap status lead");
  await setStatus(request, lead.id, "contacted");
  await page.goto("/");
  await card(page, lead.id).click();
  await page.getByLabel("New discussion").fill("Discussed the proposal.");

  const held = await holdResponse(page, `**/api/leads/${lead.id}/discussions`);
  await page.getByRole("button", { name: "Save note" }).click();
  await held.reached; // the note is committed on the server; its response is held
  await page.getByRole("dialog").getByRole("combobox").click();
  const statusSent = page.waitForRequest((r) => r.method() === "PATCH" && r.url().endsWith(`/leads/${lead.id}`), {
    timeout: 1_000,
  });
  await page.getByRole("option", { name: "Qualified" }).click();
  // If the status change goes out while the note is pending (the reviewed bug), make sure its
  // response lands first, so the older note response arrives last. A fixed app queues it instead.
  const sent = await statusSent.catch(() => null);
  if (sent) await sent.response();
  held.release();

  // Wait until both changes have been applied to the dialog and the save has finished, then
  // check the final state (an older response arriving last must not win).
  await expect(timeline(page).filter({ hasText: "Discussed the proposal." })).toHaveCount(1);
  await expect(timeline(page).filter({ hasText: "Status changed from Contacted to Qualified" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Save note" })).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("combobox")).toHaveText(/Qualified/);
  await expect(timeline(page).nth(0)).toContainText("Status changed from Contacted to Qualified");
  await expect(timeline(page).nth(1)).toContainText("Discussed the proposal.");

  // The server agrees with what the dialog shows.
  const stored = await (await request.get(`${API}/leads/${lead.id}`)).json();
  expect(stored.status).toBe("qualified");
  await page.keyboard.press("Escape");
  await expect(card(page, lead.id)).toContainText("Qualified");
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("a failed save keeps the draft, claims nothing, and can be retried", async ({ page, request }) => {
  const lead = await createLead(request, "Failed save lead");
  await page.goto("/");
  await card(page, lead.id).click();
  const box = page.getByLabel("New discussion");
  await box.fill("Asked for references.");
  const before = await timeline(page).count();

  await page.route(`**/api/leads/${lead.id}/discussions`, (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "internal_error", message: "Something went wrong on the server." } }),
    }),
  );
  await page.getByRole("button", { name: "Save note" }).click();
  await expect(page.getByText("Couldn't save the note. It's still in the box.")).toBeVisible();
  await expect(box).toHaveValue("Asked for references.");
  await expect(page.getByText("Note saved.", { exact: true })).toHaveCount(0);
  await expect(timeline(page)).toHaveCount(before);

  await page.unrouteAll({ behavior: "ignoreErrors" });
  await page.getByRole("button", { name: "Save note" }).click();
  await expect(page.getByText("Note saved.", { exact: true })).toBeVisible();
  await expect(timeline(page).first()).toContainText("Asked for references.");
});

for (const viewport of [
  { width: 375, height: 812 },
  { width: 1280, height: 900 },
]) {
  test(`long names, companies and notes stay inside the layout at ${viewport.width}px`, async ({ page, request }) => {
    await page.setViewportSize(viewport);
    const name = "LongName".repeat(15); // 120 characters, the maximum accepted
    const created = await request.post(`${API}/leads`, { data: { name, company: "CompanyName".repeat(10) } });
    expect(created.status()).toBe(201);
    const id = (await created.json()).lead.id as number;
    const note = `See https://example.com/${"averyveryverylongpathsegment".repeat(8)} for the details.`;
    expect((await request.post(`${API}/leads/${id}/discussions`, { data: { note } })).status()).toBe(201);

    await page.goto("/");
    await expect(card(page, id)).toBeVisible();
    const page_ = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
    expect(page_.scroll).toBeLessThanOrEqual(page_.width);

    await card(page, id).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name })).toBeVisible();
    const overflow = await dialog.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await expect(dialog.getByRole("button", { name: "Close" })).toBeInViewport();
    await expect(dialog.getByText("averyveryverylongpathsegment", { exact: false })).toBeVisible();
  });
}

test("on a phone, a short history keeps the composer at the bottom of the screen", async ({ page, request }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const lead = await createLead(request, "Short history lead");
  await page.goto("/");
  await card(page, lead.id).click();
  const save = page.getByRole("dialog").getByRole("button", { name: "Save note" });
  await expect(save).toBeInViewport();
  await expect.poll(async () => 812 - ((await save.boundingBox())?.y ?? 0)).toBeLessThan(90);
});
