import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { matchesSearch } from "./search.ts";

describe("matchesSearch", () => {
  const lead = { name: "Ananya Rao", company: "Kestrel Logistics" };

  it("matches the name or the company, ignoring case and surrounding spaces", () => {
    assert.equal(matchesSearch(lead, "  rao "), true);
    assert.equal(matchesSearch(lead, "KESTREL"), true);
    assert.equal(matchesSearch(lead, ""), true);
    assert.equal(matchesSearch({ name: "Karthik", company: null }, "kar"), true);
  });

  it("doesn't match text that spans the name and the company, like the API", () => {
    assert.equal(matchesSearch(lead, "Rao Kestrel"), false);
    assert.equal(matchesSearch({ name: "Karthik", company: null }, "acme"), false);
  });
});
