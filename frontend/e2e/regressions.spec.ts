import { expect, test } from "@playwright/test";

import { LIST_REQUEST, activeElementInfo, card, createLead, holdListRequests, setStatus } from "./helpers";

// Phase 3 review findings, verified in a real browser against the real API.

test("a failed request for a new filter shows an error, not the previous filter's leads", async ({ page, request }) => {
  const won = await createLead(request, "Won lead");
  await setStatus(request, won.id, "won");
  await page.goto("/");
  await expect(card(page, won.id)).toBeVisible();

  await page.route(LIST_REQUEST, (route) =>
    new URL(route.request().url()).searchParams.get("status") === "qualified" ? route.abort("failed") : route.continue(),
  );
  await page.getByRole("radio", { name: /Qualified/ }).click();

  await expect(page.getByRole("main").getByRole("alert")).toContainText("Couldn't load your leads");
  await expect(page.locator("[data-lead-id]")).toHaveCount(0); // nothing from the "All" list

  await page.unroute(LIST_REQUEST);
  await page.getByRole("button", { name: "Retry" }).click();
  const cards = page.locator("[data-lead-id]");
  await expect(cards.first()).toBeVisible();
  for (const badge of await cards.locator("span.rounded-full").allTextContents()) {
    expect(badge).toBe("Qualified");
  }
});

test("a save whose refresh is superseded by a failing refresh is not reported as fresh", async ({ page, request }) => {
  const lead = await createLead(request, "Overlap lead");
  await page.goto("/");
  await card(page, lead.id).click();
  await page.getByLabel("New discussion").fill("Discussed pricing tiers.");

  // The save's refresh is held; a focus-triggered refresh supersedes it and fails.
  const lists = await holdListRequests(page);
  await page.getByRole("button", { name: "Save note" }).click();
  await expect.poll(lists.count).toBeGreaterThanOrEqual(1);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(lists.count).toBeGreaterThanOrEqual(2);
  await lists.releaseAllButLatest(); // the superseded request answers successfully...
  await lists.failLatest(); // ...but the request that owns the list fails

  await expect(page.getByText("Note saved. Couldn't refresh the list.")).toBeVisible();
  await expect(page.getByText("Note saved.", { exact: true })).toHaveCount(0);

  // The toast's action works while the dialog is still open, and doesn't close it.
  await lists.stop();
  await page.getByRole("button", { name: "Retry refresh" }).click();
  await expect(page.getByText("List refreshed.")).toBeVisible();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("a save reports success only after the refresh that superseded it succeeds", async ({ page, request }) => {
  const lead = await createLead(request, "Overlap ok lead");
  await page.goto("/");
  await card(page, lead.id).click();
  await page.getByLabel("New discussion").fill("Agreed next steps.");

  const lists = await holdListRequests(page);
  await page.getByRole("button", { name: "Save note" }).click();
  await expect.poll(lists.count).toBeGreaterThanOrEqual(1);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(lists.count).toBeGreaterThanOrEqual(2);
  await lists.releaseAllButLatest();
  // The save flow is still waiting for the request that owns the list: the button keeps saying
  // "Saving…" and no outcome has been announced.
  await expect(page.getByRole("button", { name: "Saving…" })).toBeVisible();
  await expect(page.getByText(/^Note saved/)).toHaveCount(0);

  await lists.releaseLatest();
  await expect(page.getByText("Note saved.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save note" })).toBeEnabled();
  await lists.stop();
});

test("keyboard users can retry a failed list refresh without leaving the dialog", async ({ page, request }) => {
  const lead = await createLead(request, "Keyboard retry lead");
  await page.goto("/");
  await card(page, lead.id).focus();
  await page.keyboard.press("Enter");
  await page.getByLabel("New discussion").fill("Confirmed the budget.");

  const lists = await holdListRequests(page);
  await page.getByRole("button", { name: "Save note" }).focus();
  await page.keyboard.press("Enter");
  await expect.poll(lists.count).toBeGreaterThanOrEqual(1);
  await lists.failLatest();

  const retry = page.getByRole("dialog").getByRole("button", { name: "Refresh list" });
  await expect(retry).toBeVisible();
  await lists.stop();
  // Reach it with the keyboard only; focus must stay inside the dialog the whole way.
  for (let i = 0; i < 20 && !(await retry.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press("Shift+Tab");
    expect((await activeElementInfo(page)).inDialog).toBe(true);
  }
  await expect(retry).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByText("List refreshed.")).toBeVisible();
  await expect(retry).toHaveCount(0);
  await expect(page.getByRole("dialog")).toBeVisible();
  expect((await activeElementInfo(page)).inDialog).toBe(true);
});

test("saving with the keyboard keeps focus on the Save button", async ({ page, request }) => {
  const lead = await createLead(request, "Keyboard save lead");
  await page.goto("/");
  await card(page, lead.id).focus();
  await page.keyboard.press("Enter");
  await page.getByLabel("New discussion").fill("Sent the agenda for Thursday.");
  const save = page.getByRole("button", { name: /Save note|Saving…/ });
  await save.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Note saved.", { exact: true })).toBeVisible();
  await expect(save).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  expect((await activeElementInfo(page)).tag).not.toBe("DIV"); // not stranded on the dialog container
});

test("focus goes to the active filter when a status change removes the lead's card", async ({ page, request }) => {
  const lead = await createLead(request, "Moving lead");
  await page.goto("/");
  await page.getByRole("radio", { name: /^New/ }).click();
  await expect(card(page, lead.id)).toBeVisible();

  await card(page, lead.id).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("combobox").click();
  await page.getByRole("option", { name: "Won" }).click();
  await expect(page.getByText("Status changed to Won.")).toBeVisible();
  await expect(card(page, lead.id)).toHaveCount(0); // gone from the New list behind the dialog

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const focused = await activeElementInfo(page);
  expect(focused.inFilters).toBe(true);
  expect(focused.checked).toBe("true");
  expect(focused.text).toContain("New");
});

test("keyboard focus stays inside the lead dialog and returns to the card", async ({ page, request }) => {
  const lead = await createLead(request, "Focus lead");
  await page.goto("/");
  await card(page, lead.id).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("New discussion")).toBeFocused();

  for (let i = 0; i < 12; i++) {
    await page.keyboard.press(i % 2 ? "Shift+Tab" : "Tab");
    expect((await activeElementInfo(page)).inDialog).toBe(true);
  }
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press("Tab");
    expect((await activeElementInfo(page)).inDialog).toBe(true);
  }

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await activeElementInfo(page)).leadId).toBe(String(lead.id));
});
