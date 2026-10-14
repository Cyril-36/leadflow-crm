import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { createLead } from "./helpers";

test("Export CSV downloads the leads shown, with the active filters", async ({ page, request }) => {
  const lead = await createLead(request, "Export lead, with comma");
  await page.goto("/");
  await expect(page.locator(`[data-lead-id="${lead.id}"]`)).toBeVisible();
  const shown = await page.locator("[data-lead-id]").count();

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export the leads shown as CSV" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^leadflow-leads-\d{4}-\d{2}-\d{2}\.csv$/);
  const lines = (await readFile(await download.path(), "utf8")).replace(/^﻿/, "").trimEnd().split("\r\n");
  expect(lines[0]).toMatch(/^Name,Company,Phone,Status,Last discussion,/);
  expect(lines).toHaveLength(shown + 1);
  expect(lines.some((line) => line.startsWith(`"${lead.name}",E2E Test Co,,New,`))).toBe(true);
  await expect(page.getByText(`Exported ${shown} leads.`)).toBeVisible();

  // With a filter on, only the filtered leads are exported.
  await page.getByRole("radio", { name: /^Won/ }).click();
  await expect(page.locator(`[data-lead-id="${lead.id}"]`)).toHaveCount(0);
  await expect(page.locator("[data-lead-id]").first()).toContainText("Won"); // the Won list has loaded
  const wonShown = await page.locator("[data-lead-id]").count();
  const [filtered] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export the leads shown as CSV" }).click(),
  ]);
  const filteredLines = (await readFile(await filtered.path(), "utf8")).trimEnd().split("\r\n");
  expect(filteredLines).toHaveLength(wonShown + 1);
  for (const line of filteredLines.slice(1)) expect(line).toContain(",Won,");
});
