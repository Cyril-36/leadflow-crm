# LeadFlow — Implementation Plan (frozen 2026-10-13, rev. 2)

Assessment: PravarAI "AI-smart fullstack intern". Brief received Tue 2026-10-13 11:04 IST;
three working days → **submit by Fri 2026-10-16**. The email is the contract; the
wireframes are design references. No AI feature is required by the brief; a reliable,
polished CRM is the goal.

## 1. Scope

| Tier | Contents |
|---|---|
| **Submission gates** (mandatory) | Public GitHub repo; README with working setup steps; `.env.example` listing every variable; meaningful commit history; screenshots **or** a video of the working flow (screenshots are the minimum, a short video if time allows) |
| **P0** (mandatory) | Lead list (name, status badge, last note, time since last note); all six status filters; today's follow-ups pinned; timeline dialog in reverse-chronological order; add discussion with optional follow-up; status change from the dialog; add lead; real persistence; immediate list updates (§5) |
| **P1** (quality + bonuses) | Search UI; overdue red styling; today/overdue counts; "mark follow-up done"; follow-up shortcuts ("Tomorrow 10 AM", "Next Mon 10 AM"); draft and pending behavior (§6); responsive layout; loading, empty and error states; accessibility pass; seed (≥ 5 leads); focused browser E2E scenarios (§9) |
| **P2** (only after gates and P1 pass) | Docker Compose first; then editing a lead's name, company and phone; login with server-side ownership only if time remains |

## 2. Architecture

- **Backend:** FastAPI, SQLAlchemy 2, Pydantic v2, one SQLite file (WAL, `busy_timeout=5000`,
  `foreign_keys=ON`). Tables created with `create_all` at startup (no migration history to manage).
- **Frontend:** Next.js (App Router, TypeScript, Tailwind). shadcn/ui is the single component
  foundation (Radix Dialog, Select, AlertDialog, Toast). date-fns for formatting.
- **Tests:** pytest + httpx (TestClient), ruff; Node's built-in test runner for the frontend time
  helper; Playwright for browser scenarios.
- Business rules live in `app/services/`; routers only parse and serialize.

```
leadflow/
  backend/  app/{main,config,db,clock,models,schemas,errors}.py
            app/services/leads.py  app/routers/leads.py  seed.py  tests/
  frontend/ app/  components/  lib/{api,status,time}.ts  e2e/
  .env.example  README.md  PLAN.md
```

### Data model

```
leads    id INTEGER PK AUTOINCREMENT, name, company?, phone?,
         status ENUM(new, contacted, qualified, proposal_sent, won, lost) DEFAULT new,
         next_follow_up_at? (UTC), created_at, updated_at
entries  id INTEGER PK AUTOINCREMENT, lead_id FK → leads (CASCADE),
         kind ENUM(note, lead_created, status_changed, follow_up_cleared),
         body, follow_up_at? (UTC), created_at (UTC, µs)
         INDEX (lead_id, created_at DESC, id DESC)
```

- `UTCDateTime` column type: rejects naive datetimes on write, stores UTC, returns aware UTC.
- There is no stored `last_discussion_at`. The last note is derived: the newest entry with
  `kind = note` by `(created_at DESC, id DESC)`. System entries never count as a discussion.

## 3. API contract

Every route lives under the single prefix **`/api`** (one constant shared by the router, tests
and README).

**All mutations return the same shape: `{lead: LeadSummary, entry: Entry | null}`.** `entry` is
the timeline entry the mutation wrote, or `null` for a no-op. The open dialog never misses
activity.

| Method | Path | Success | Errors |
|---|---|---|---|
| GET | `/api/health` | 200 `{status:"ok"}` | – |
| GET | `/api/leads?status=&q=&tz=` | 200 `{pinned:[LeadSummary], leads:[LeadSummary]}` | 422 bad status or tz |
| POST | `/api/leads` `{name, company?, phone?}` | **201** `{lead, entry}` (`lead_created`) | 422 |
| GET | `/api/leads/{id}` | 200 LeadSummary | 404 |
| PATCH | `/api/leads/{id}` `{status}` | 200 `{lead, entry}` (`status_changed`, or `null` when unchanged) | 404, 422 |
| GET | `/api/leads/{id}/timeline` | 200 `[Entry]` | 404 |
| POST | `/api/leads/{id}/discussions` `{note, follow_up_at?}` | **201** `{lead, entry}` (`note`) | 404, 422 |
| DELETE | `/api/leads/{id}/follow-up` | 200 `{lead, entry}` (`follow_up_cleared`, or `null` if none was set) | 404 |

`LeadSummary`: `id, name, company, phone, status, next_follow_up_at, follow_up_overdue,
last_note: {body, at} | null, created_at, updated_at`.
`Entry`: `id, kind, body, follow_up_at, created_at`.
`tz` is an IANA zone name, defaulting to `UTC`; the frontend always sends the browser's zone.

**Error envelope** for every non-2xx response:

```json
{"error": {"code": "validation_error", "message": "…", "details": [{"field": "follow_up_at", "message": "…"}]}}
```

Handlers: application errors (`lead_not_found`, `invalid_timezone`, …); Starlette
`HTTPException` (unknown route 404, 405); `RequestValidationError` → 422 with field details;
any unhandled exception → 500 `internal_error` (logged, no stack trace in the body). 500
handling is tested by overriding a dependency in the test suite. **No debug or failing
endpoint ships.** No pagination (assessment-scale data; noted in README).

## 4. Business rules

**A. Validation (422)** — `name` trimmed, 1–120 chars; `company` ≤ 120; `phone` matches
`^[0-9+()\-.\s]{3,30}$`; empty optional strings become `null`; `note` trimmed, 1–2000 chars;
`follow_up_at` must carry a UTC offset (naive → 422) and be strictly after now; `status` must be
one of the six values; unknown body fields are rejected.

**B. Follow-up classification** — computed on the server from the injected clock (`now`) and `tz`.

| Follow-up | Section | `follow_up_overdue` |
|---|---|---|
| Today (local), later than now | pinned | false |
| Today (local), earlier than now | pinned | **true** |
| Before today | leads (top) | true |
| After today | leads | false |
| None | leads | false |

- "Today" is `[local midnight, next local midnight)` in `tz`, computed with zone-aware datetimes,
  so 23- and 25-hour DST days and zones whose DST skips midnight are handled.
- The two arrays are a **partition**: a lead appears exactly once.
- Status filter and search (case-insensitive substring of name or company, wildcards escaped)
  are applied before the partition.
- Pinned order: `next_follow_up_at ASC, id ASC`. Leads order: overdue first
  (`next_follow_up_at ASC`), then latest activity DESC (last note time, else `created_at`),
  then `id DESC`.
- Won/Lost leads are classified the same way (see E) and rendered faded.

**C. Discussions** — a note with `follow_up_at` sets `lead.next_follow_up_at` in the same
transaction. A note without one leaves the existing follow-up unchanged (the form says so, §6).

**D. Follow-up invariant** (covers set and clear). Let *F* be a lead's entries that are either
`note` with a follow-up or `follow_up_cleared`. Then `lead.next_follow_up_at` equals the
`follow_up_at` of the entry of *F* with the **highest id** if it is a note, and `null` if it is
a clear or *F* is empty. Ids are the authoritative operation order: only write transactions
start with `BEGIN IMMEDIATE`, writes are serialized, and `AUTOINCREMENT` ids are assigned in
commit order and never reused. This does not depend on the system clock, which can move
backwards. `created_at` is still read after the lock is held, so the visible timeline
(`created_at DESC, id DESC`) normally agrees with id order. Reads use ordinary deferred
transactions and never wait for writers (WAL). Tested with concurrent set and clear operations
and with reads during a held write lock.

**E. Status changes are non-destructive.** A change writes a `status_changed` entry ("Status
changed from Qualified to Proposal Sent") and touches nothing else. Follow-ups are kept.
Setting the current status is a no-op (`entry: null`). No confirmation is needed because nothing
is destroyed.

**F. Timeline** — `created_at DESC, id DESC` (stable when timestamps tie). Creating a lead
writes a `lead_created` entry, as in the wireframe.

**G. Timezones**
- The API accepts only offset-aware ISO 8601; naive timestamps → 422.
- The frontend builds the instant from the date and time inputs in the browser's zone through
  one helper (`lib/time.ts`):
  - A **nonexistent** local time (spring-forward gap) is detected by round-trip and rejected
    inline: "That time doesn't exist in your timezone because of a daylight-saving change."
  - An **ambiguous** local time (fall-back) resolves to the earlier occurrence, and the form
    echoes the chosen time with its UTC offset.
- The helper (and the follow-up shortcuts) are tested under `TZ=America/New_York` with Node's
  built-in test runner.

## 5. Frontend reconciliation after mutations

1. The list state is exactly the server's latest `GET /api/leads` response for the current
   `{status, q, tz}`. `pinned` and `leads` are replaced together in one state update.
2. After a successful mutation:
   - the dialog updates from the response: `lead` replaces the header state, and a non-null
     `entry` is prepended to the timeline;
   - the list is re-fetched immediately with the current filters.
3. Each list request carries an incrementing sequence number and an `AbortController`; responses
   older than the latest are discarded.
4. Because the server partitions, duplicates can't happen; E2E asserts each card appears once.
5. The dialog is keyed by lead id and loads `GET /api/leads/{id}` and the timeline itself, so it
   stays open when a status change moves the lead out of the active filter.
6. The same list refresh runs every 60 s and on window focus. **Background refreshes never touch
   dialog or form state.**
7. **Save and refresh are reported separately.**

| Save | List refresh | What the user sees |
|---|---|---|
| ✓ | ✓ | Success toast; list updated |
| ✓ | ✗ | Form clears, entry shows in the timeline, toast: **"Discussion saved. Couldn't refresh the list."** with a **Retry refresh** action; a "List may be out of date" bar stays above the list until a refresh succeeds |
| ✗ | – | Form keeps the draft, field errors appear under the fields, toast shows the server's `message`; the status dropdown reverts |

   A failed refresh is never presented as a failed save, so the user isn't pushed into
   submitting twice.
8. **Created lead hidden by the active filter or search:** toast "Lead added — hidden by the
   *Qualified* filter" with **View lead** (opens its dialog) and **Show all** (clears the filter
   and search).

## 6. Forms: pending, drafts, follow-ups

- While a request is in flight, its submit button is disabled and shows a spinner; double
  submits are impossible (Enter is ignored while pending).
- Drafts survive errors and background refreshes. The discussion draft is kept per lead while
  the page is open.
- Closing the dialog with an unsaved note (Esc, ✕ or clicking outside) opens an in-app
  "Discard unsaved note?" dialog. No browser `confirm()`.
- The discussion form shows the current reminder: *"Current follow-up: Thu 15 Oct, 11:00 AM.
  Leave the date empty to keep it."*, plus a **Mark done** action (DELETE follow-up).
- Shortcut chips fill the date and time: **Later today (+2 h)**, **Tomorrow 10 AM**,
  **Next Mon 10 AM**.
- Add-lead dialog: name is focused on open, the dialog stays open with values on error, and
  closes on success.

## 7. Frontend design approach (Phase 4, after functional correctness)

Explore visual directions with Claude Design artifacts first. **shadcn/ui is the one
foundation.** Another source (Arc UI, affectUI, ObsidianUI, Kobra, Transitions.dev) is added
only for one specific component the foundation lacks, after checking its licence, bundle cost
and accessibility; at most one library per purpose. Consistent tokens (colors, radius,
spacing, status palette in `lib/status.ts`). One screen: lead cards, timeline dialog,
responsive controls, subtle motion that respects `prefers-reduced-motion`. Header shows
**Today** and **Overdue** counts.

## 8. Security note (single-user demo)

There is no authentication: anyone who can reach the API can read and modify every lead. The
app is meant to run locally. If it is ever demoed online, use a disposable deployment with
fictional seed data only, restrict CORS to the frontend origin, and tear it down after review.
The README states this explicitly. All seed data is fictional (`@example.com`, 555-01xx
numbers).

**Seed:** 8 believable fictional B2B leads covering all six statuses, 2–5 varied discussions
each, with relative dates: due earlier today (overdue + pinned), due later today, overdue from
yesterday, upcoming, no follow-up, and one New lead with no notes.

## 9. Phases

Every phase: implement → run the verification commands → independent code review → fix. The
phase report lists changed files, commands run, actual results, remaining risks and the commit
hash. Nothing is called verified without running its check.

| # | Phase | Tier | Acceptance | Verify |
|---|---|---|---|---|
| 1 | Backend foundation | P0 | All §3 endpoints against a real SQLite file; data survives a restart; rules A–G | `uv run ruff check .`, smoke tests, restart check |
| 2 | Backend verification | P0 | §10 backend rows pass with a frozen clock; invariant D holds under concurrency | `uv run pytest -q` |
| 3 | Functional frontend | P0 | Every P0 flow works in the browser and after reload; six filters; §5 reconciliation including the save/refresh split | `npm run lint && npm run build && node --test`, manual checklist |
| 4 | UI design and polish | P1 | Design direction chosen; §6 behaviors; search UI, overdue red, counts, shortcuts; responsive to 375 px; loading, empty and error states; keyboard access | screenshots at 375 / 1280 px |
| 5 | Submission audit | Gates + P1 | Seed; Playwright scenarios; clean-clone setup; README accurate; `.env.example` complete; screenshots (video if time) | clean clone → `uv sync --frozen`, `npm ci`, seed, `npx playwright test`; lockfiles unchanged |
| 6 | Optional | P2 | Docker Compose; then edit lead details; login only if time remains | `docker compose up --build`, `curl /api/health` |

## 10. Tests mapped to the evaluation matrix

| Matrix item | Evidence |
|---|---|
| List shows name, status, last note, time ago | API: fields present; `last_note` ignores system entries; E2E checks a card |
| Today's follow-ups pinned correctly | Frozen-clock boundaries: earlier today (pinned + overdue), 23:59 today, 00:00 tomorrow, 23:59 yesterday, one instant in two zones, New York 23 h and 25 h days, a zone whose DST skips midnight |
| Timeline in order | Equal timestamps → id tie-break; mixed note and system entries |
| Adding a discussion updates the list immediately | API returns `{lead, entry}`; E2E: lead moves into pinned without reload |
| Add lead works | 201 `{lead, entry}`; 422 for empty, whitespace or too-long name; default `new`; `lead_created` entry |
| Status update persists | PATCH then GET; same status → `entry: null`; 422 on invalid; E2E after reload |
| Correct status codes, clean errors | Envelope for 404 lead, 404 route, 422 body, 422 tz, naive datetime 422, 500 via dependency override |
| Integrity | Concurrent mix of set and clear on one lead → invariant D holds, all entries saved, orders agree |
| Filters, search | Partition rules hold under filter and search; `%` and `_` treated literally |
| Seed | Test checks the counts the README states and that all six statuses appear |

**Browser scenarios (Playwright, with `page.route` for failure injection; no backend changes):**
1. Main flow: add lead → open dialog → add note with a follow-up later today → lead appears
   pinned without reload → reload → still there.
2. Status change moves a lead out of the active filter; the dialog stays open; reload persists.
3. A failed save (500 injected) keeps the draft and shows the error; retry succeeds once.
4. Saved but refresh failed: shows "Discussion saved. Couldn't refresh the list" and Retry
   refresh recovers.
5. Creating a lead under a non-matching filter shows "View lead / Show all".

**Demo walkthrough** (screenshots, plus video if time) follows the evaluation matrix in order.

## 11. Time and risk

Estimate ≈ 12 h: Phase 1 ≈ 1.5 h, 2 ≈ 1.5 h, 3 ≈ 3 h, 4 ≈ 3 h, 5 ≈ 2.5 h. Hold back a testing
and submission window instead of coding until the deadline.

| Risk | Mitigation |
|---|---|
| **Deadline overlaps Graph Hacks (Oct 15–18)** | Finish P0 by end of Oct 14; Oct 15–16 for polish, audit and submission |
| Timezone and DST bugs | Server-side classification, frozen-clock tests, one tested frontend conversion helper |
| SQLite `database is locked` | WAL, busy timeout, `BEGIN IMMEDIATE`, concurrency test |
| Relative times cause hydration mismatch | Render time-ago on the client only |
| Visual polish expands | Phase 4 starts only after Phase 3 acceptance; one foundation |
| Scope creep | P2 only after the submission gates and P1 pass; Docker before editing, login last |
