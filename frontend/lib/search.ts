// Mirrors the API's search (GET /api/leads?q=), so the app can tell whether a lead it just added
// is in the list on screen. Import-free so Node's test runner can load it (lib/search.test.ts).

/** Lower-cases A-Z only, like SQLite's lower() that the API's search runs on. */
const asciiLower = (value: string) => value.replace(/[A-Z]/g, (c) => c.toLowerCase());

/** True when the API would return this lead for the search `query`: name OR company contains it. */
export function matchesSearch(lead: { name: string; company: string | null }, query: string): boolean {
  const q = asciiLower(query.trim());
  if (!q) return true;
  return asciiLower(lead.name).includes(q) || asciiLower(lead.company ?? "").includes(q);
}
