import { expect, type APIRequestContext, type Page, type Route } from "@playwright/test";

// Must match the isolated API started by playwright.config.ts.
export const API = process.env.E2E_API_URL ?? "http://localhost:8100/api";

/** Create a lead through the API with a unique name, so tests never depend on each other. */
export async function createLead(request: APIRequestContext, prefix: string) {
  const name = `${prefix} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const response = await request.post(`${API}/leads`, { data: { name, company: "E2E Test Co" } });
  expect(response.status()).toBe(201);
  const body = await response.json();
  return { id: body.lead.id as number, name };
}

export async function setStatus(request: APIRequestContext, id: number, status: string) {
  const response = await request.patch(`${API}/leads/${id}`, { data: { status } });
  expect(response.status()).toBe(200);
}

export function card(page: Page, id: number) {
  return page.locator(`[data-lead-id="${id}"]`);
}

/** Matches list requests (GET /api/leads?...), not single-lead or mutation requests. */
export const LIST_REQUEST = /\/api\/leads\?/;

export async function activeElementInfo(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return {
      tag: el?.tagName ?? "",
      text: el?.textContent?.trim() ?? "",
      leadId: el?.getAttribute("data-lead-id") ?? null,
      inDialog: Boolean(el?.closest('[role="dialog"], [role="alertdialog"]')),
      inFilters: Boolean(el?.closest(".lf-filters")),
      checked: el?.getAttribute("aria-checked") ?? null,
    };
  });
}

/**
 * Holds every list request until the test decides its fate, so overlapping refreshes happen in a
 * known order. Requests the app has already aborted are ignored when settled.
 */
export async function holdListRequests(page: Page) {
  const held: Route[] = [];
  await page.route(LIST_REQUEST, (route) => {
    held.push(route); // left pending until continue/abort below
  });
  const settle = async (routes: Route[], how: "continue" | "abort") => {
    for (const route of routes) {
      await (how === "continue" ? route.continue() : route.abort("failed")).catch(() => {});
    }
  };
  return {
    count: () => held.length,
    /** Let every request except the newest one complete normally. */
    releaseAllButLatest: () => settle(held.slice(0, -1), "continue"),
    releaseLatest: () => settle(held.slice(-1), "continue"),
    failLatest: () => settle(held.slice(-1), "abort"),
    stop: () => page.unrouteAll({ behavior: "ignoreErrors" }),
  };
}
