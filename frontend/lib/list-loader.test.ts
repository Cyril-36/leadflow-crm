// Regression tests for the lead-list request handling (Phase 3 review findings).
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ListLoader, viewFor, type LoaderState } from "./list-loader.ts";

/** A fetcher whose responses the test resolves or rejects by hand, ignoring abort signals. */
function controllableFetcher() {
  const calls: { key: string; resolve: (value: string) => void; reject: (error: Error) => void }[] = [];
  const fetcher = (key: string) =>
    new Promise<string>((resolve, reject) => {
      calls.push({ key, resolve, reject });
    });
  return { calls, fetcher };
}

function setup() {
  const { calls, fetcher } = controllableFetcher();
  let state: LoaderState<string> = { data: null, error: null };
  const loader = new ListLoader<string>(fetcher, (next) => {
    state = next;
  });
  return { calls, loader, view: (key: string) => viewFor(state, key) };
}

describe("results are tied to the filter they were fetched for", () => {
  it("shows an error, not the previous filter's leads, when a new filter fails", async () => {
    const { calls, loader, view } = setup();
    const all = loader.load("all||UTC");
    calls[0].resolve("ALL LEADS");
    assert.equal(await all, "fresh");

    const qualified = loader.load("qualified||UTC");
    assert.equal(view("qualified||UTC").phase, "loading");
    assert.equal(view("qualified||UTC").value, null);
    calls[1].reject(new Error("Can't reach LeadFlow right now."));
    assert.equal(await qualified, "failed");

    const shown = view("qualified||UTC");
    assert.equal(shown.phase, "error");
    assert.equal(shown.value, null, "must not reuse the All-leads data");
    assert.equal(shown.errorMessage, "Can't reach LeadFlow right now.");
  });

  it("keeps showing data with a stale warning when a refresh of the same filter fails", async () => {
    const { calls, loader, view } = setup();
    const first = loader.load("all||UTC");
    calls[0].resolve("ALL LEADS");
    await first;
    const again = loader.load("all||UTC");
    calls[1].reject(new Error("offline"));
    assert.equal(await again, "failed");
    assert.deepEqual(
      { value: view("all||UTC").value, phase: view("all||UTC").phase, stale: view("all||UTC").stale },
      { value: "ALL LEADS", phase: "ready", stale: true },
    );
  });

  it("clears the stale warning after a later success", async () => {
    const { calls, loader, view } = setup();
    const a = loader.load("k");
    calls[0].resolve("v1");
    await a;
    const b = loader.load("k");
    calls[1].reject(new Error("offline"));
    await b;
    const c = loader.load("k");
    calls[2].resolve("v2");
    await c;
    assert.deepEqual(view("k"), { value: "v2", phase: "ready", stale: false, errorMessage: null });
  });
});

describe("a superseded refresh reports the outcome of the request that replaced it", () => {
  it("is not 'fresh' when the newer request fails", async () => {
    const { calls, loader } = setup();
    const afterSave = loader.load("all||UTC"); // refresh triggered by a save
    const poll = loader.load("all||UTC"); // background poll supersedes it
    calls[0].resolve("old response"); // the superseded request still answers
    calls[1].reject(new Error("offline"));
    assert.equal(await poll, "failed");
    assert.equal(await afterSave, "failed");
  });

  it("is 'fresh' only once the newer request succeeds", async () => {
    const { calls, loader, view } = setup();
    const afterSave = loader.load("all||UTC");
    const focus = loader.load("all||UTC");
    let settled = false;
    void afterSave.then(() => {
      settled = true;
    });
    calls[0].resolve("superseded");
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(settled, false, "must wait for the newer request");
    calls[1].resolve("current");
    assert.equal(await focus, "fresh");
    assert.equal(await afterSave, "fresh");
    assert.equal(view("all||UTC").value, "current");
  });

  it("follows a chain of supersessions, including a filter change", async () => {
    const { calls, loader, view } = setup();
    const afterSave = loader.load("all||UTC");
    loader.load("all||UTC");
    const filterChange = loader.load("won||UTC");
    calls[0].resolve("a");
    calls[1].resolve("b");
    calls[2].resolve("WON");
    assert.equal(await filterChange, "fresh");
    assert.equal(await afterSave, "fresh");
    assert.equal(view("won||UTC").value, "WON");
    assert.equal(view("all||UTC").value, null);
  });

  it("ignores a late response from an older request", async () => {
    const { calls, loader, view } = setup();
    loader.load("q=a");
    const newer = loader.load("q=ab");
    calls[1].resolve("results for ab");
    await newer;
    calls[0].resolve("results for a"); // arrives late
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(view("q=ab").value, "results for ab");
  });

  it("reports 'failed' after dispose instead of hanging or claiming success", async () => {
    const { calls, loader } = setup();
    const pending = loader.load("k");
    loader.dispose();
    calls[0].resolve("late");
    assert.equal(await pending, "failed");
  });
});
