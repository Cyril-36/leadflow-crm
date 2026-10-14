# LeadFlow

[![CI](https://github.com/Cyril-36/leadflow-crm/actions/workflows/ci.yml/badge.svg)](https://github.com/Cyril-36/leadflow-crm/actions/workflows/ci.yml)

A single-screen lead tracker for a sales rep: see every lead at a glance, keep a timeline of every
discussion, and never miss a follow-up. Built for the PravarAI fullstack assessment with
**Next.js 16 + FastAPI**.

**Live demo:** https://leadflow-zdbh.onrender.com (API: https://leadflow-api-no50.onrender.com/docs).
Hosted on Render's free tier, so after 15 idle minutes it sleeps: the first visit can take about a
minute to wake both services. Each wake-up starts from fresh demo data (8 fictional leads, times
relative to that moment in India time), so feel free to add leads and notes.

**Demo video:** [docs/demo.mp4](docs/demo.mp4) walks through the evaluation checklist in order.

| Desktop | Phone (375 px) |
|---|---|
| ![Lead list with today's follow-ups](docs/screenshots/desktop-list.png) | ![Lead list on a phone](docs/screenshots/mobile-list.png) |
| ![Timeline dialog with a follow-up being set](docs/screenshots/desktop-timeline-dialog.png) | ![Timeline dialog on a phone](docs/screenshots/mobile-timeline-dialog.png) |

## What it does

**The brief**

- **Lead list.** Every lead shows its name, company, status badge, latest discussion and how long
  ago it was. Won and Lost leads are faded.
- **Today's follow-ups, pinned.** Follow-ups due today sit at the top as a day planner with a
  *Now* line: ones whose time has passed are above it in red, upcoming ones below. Older overdue
  follow-ups head the rest of the list in red. A lead appears exactly once.
- **Timeline dialog.** Clicking a lead opens its history in a dialog, newest first and grouped by
  day. Status changes and follow-up updates appear as compact system entries.
- **Log a discussion** with an optional follow-up (shortcuts: later today, tomorrow 10 AM, next
  Monday 10 AM). Saving updates the lead's follow-up and the list immediately, without a reload.
- **Change status** from the dialog (New, Contacted, Qualified, Proposal Sent, Won, Lost). It is
  saved and logged in the timeline.
- **Add a lead.** Name is required; company and phone are optional; status starts as New.

**Bonus items from the brief:** search by name or company, status filters with counts, overdue
follow-ups in red, a seed script with 8 fictional leads and their discussions, and Docker Compose.

**Extras that came out of using it**

- **Needs attention.** A work queue of open leads with an overdue follow-up, no follow-up
  scheduled, or no discussion in the last 7 days; each card says why. Won and Lost leads never
  appear.
- **Snooze.** Cards due today or overdue have a Snooze menu: later today, tomorrow 10 AM, the next
  working day (when tomorrow is a weekend) or next Monday.
- **Export CSV.** Downloads exactly the leads on screen, with the active filters, times in your
  time zone, and formula-safe cells for spreadsheets.
- **Reminder filters.** The "due today" and "overdue" counts are toggles that combine with the
  status filter and search; *Clear filters* resets everything.
- **Reschedule without a note.** Change or set a follow-up on its own (the button becomes *Save
  follow-up* when no note is written), or *Mark done*.
- **Edit details.** Correct a lead's name, company or phone from the dialog; the change is logged.
- **Drafts survive a refresh.** An unsaved note comes back after an accidental reload, with a
  *Discard draft* option.
- **Keyboard shortcuts.** `/` jumps to search, `N` adds a lead, Ctrl/⌘ + Enter saves a note.
- Full keyboard support (focus stays inside dialogs and returns to the card you opened), a
  full-screen dialog with a pinned Save button on phones, reduced-motion support, and a prompt
  before discarding an unsaved note.

## Run it

### With Docker (one command)

```bash
docker compose up --build
```

Open http://localhost:3000 (API on http://localhost:8000, docs at http://localhost:8000/docs).
The 8 demo leads are added on the first start only; data lives in the `leadflow-data` volume and
survives restarts. Demo dates are relative to the container's clock in UTC; to seed them in your
time zone, start it with e.g. `TZ=Asia/Kolkata docker compose up --build`. `docker compose down -v`
removes the data.

### Without Docker

You need **Python 3.12** with [uv](https://docs.astral.sh/uv/) and **Node.js 22.18+** (tested on
Node 24; see `.nvmrc`).

**1. Backend** (FastAPI on http://localhost:8000)

```bash
cd backend
uv sync
uv run python -m app.seed                                    # 8 demo leads (only into an empty database)
uv run uvicorn app.main:create_app --factory --reload --port 8000
```

To reload fresh demo data later: `uv run python -m app.seed --reset` (this **deletes everything**
in the database first).

**2. Frontend** (Next.js on http://localhost:3000), in a second terminal

```bash
cd frontend
npm ci
npm run dev
```

Open http://localhost:3000. For a production build use `npm run build && npm start`.

**Configuration.** Everything works with the defaults. To change them, copy the matching section
of [`.env.example`](.env.example) to `backend/.env` and/or `frontend/.env.local`:

| Variable | Used by | Default |
|---|---|---|
| `DATABASE_URL` | backend | `sqlite:///./leadflow.db` (in `backend/`) |
| `CORS_ORIGINS` | backend | `http://localhost:3000` |
| `NEXT_PUBLIC_API_URL` | frontend (baked in at build time) | `http://localhost:8000/api` |

## Tests

| Suite | Command | What it covers |
|---|---|---|
| Backend (pytest, 121 tests) | `cd backend && uv run pytest` | Validation (including phone formats and time zone directory names), status codes and error format, pinned/overdue rules with a frozen clock, DST days in New York and Santiago, legacy time zone names, timeline order, search and filters, editing and rescheduling, 90 simultaneous follow-up changes, persistence across restarts, CORS, the seed |
| Frontend unit (50 tests) | `cd frontend && npm test` | Time helpers (calendar-relative wording, DST gaps and repeats, weekend-aware shortcuts), list request handling (results tied to their filter, overlapping refreshes), reconciling out-of-order responses, the Needs attention rules, Snooze choices, search matching for new leads, and CSV quoting and formula safety (+91-style phone numbers left intact) |
| Browser (Playwright, 37 tests) | `cd frontend && npx playwright install chromium && npm run test:e2e` | The full workflow end to end; editing, rescheduling, reminder filters, Needs attention, Snooze (pointer, keyboard, focus when filtered out, failure, no-op, never earlier, completing while the lead is open), CSV export, a new lead hidden by search, draft recovery, keyboard shortcuts; failed saves, failed and overlapping refreshes, a status change racing a pending save, a slow details save, the details editor on a short phone screen, text typed during a save; long names at 375 px and desktop; the phone layout with the keyboard open; keyboard focus |
| Lint and types | `cd backend && uv run ruff check .` · `cd frontend && npm run lint && npm run typecheck` | |

The browser tests never touch your local app or its data: they start their own API on port 8100
(with a throwaway `backend/e2e.db`) and their own production build on port 3100. The demo video
and screenshots are produced the same way by `npm run demo:record` (ports 8200/3200,
`backend/demo.db`; `DEMO_TZ` picks the time zone).

[GitHub Actions](.github/workflows/ci.yml) runs all of the above on every push, plus a Docker
Compose build that waits for both services to report healthy.

## How it is built

```
backend/   FastAPI + SQLAlchemy 2 + SQLite
  app/main.py              app factory, CORS, error handlers; every route under /api
  app/routers/leads.py     thin HTTP layer
  app/services/leads.py    all business rules
  app/models.py            Lead and Entry tables (UTC timestamps)
  app/seed.py              demo data, written through the service layer
  tests/
frontend/  Next.js 16 (App Router) + TypeScript + Tailwind + shadcn/ui
  components/leadflow/     the screen: agenda, lead card, timeline dialog, composer, editors
  hooks/                   list loading and polling, drafts, the current time
  lib/api.ts               typed API client with user-facing error messages
  lib/list-loader.ts       list request bookkeeping (framework-free, unit-tested)
  lib/detail-state.ts      ordering and reconciling changes to one lead (unit-tested)
  lib/time.ts              local-time formatting, DST-safe parsing, follow-up shortcuts (unit-tested)
  lib/attention.ts         Needs attention rules (unit-tested)
  lib/csv.ts               CSV export (unit-tested)
  e2e/                     Playwright tests
docker-compose.yml         API + app, SQLite volume, health checks
```

### API

| Method | Path | Success | Errors |
|---|---|---|---|
| GET | `/api/health` | 200 | |
| GET | `/api/leads?status=&q=&tz=` | 200 `{pinned, leads}` | 422 |
| POST | `/api/leads` | **201** `{lead, entry}` | 422 |
| GET | `/api/leads/{id}` | 200 | 404 |
| PATCH | `/api/leads/{id}` `{status}` | 200 `{lead, entry}` | 404, 422 |
| PATCH | `/api/leads/{id}/details` `{name?, company?, phone?}` | 200 `{lead, entry}` | 404, 422 |
| GET | `/api/leads/{id}/timeline` | 200 | 404 |
| POST | `/api/leads/{id}/discussions` `{note, follow_up_at?}` | **201** `{lead, entry}` | 404, 422 |
| PUT | `/api/leads/{id}/follow-up` `{follow_up_at}` | 200 `{lead, entry}` | 404, 422 |
| DELETE | `/api/leads/{id}/follow-up` | 200 `{lead, entry}` | 404 |

Every change returns the updated lead and the timeline entry it wrote (`entry` is `null` when
nothing changed, e.g. setting the same status), so the open dialog never misses activity. Every
error, including FastAPI's own validation errors, has one shape:
`{"error": {"code": "...", "message": "...", "details": [{"field": "...", "message": "..."}]}}`.

### Rules worth knowing

- **Time zones.** Times are stored in UTC. The browser sends its time zone, and the server decides
  what "today" means in that zone, so 23- and 25-hour DST days are handled. A follow-up must be in
  the future; a time skipped by a DST change is rejected with a clear message.
- **Last discussion** means the newest note; status changes and other system entries never replace it.
- **Status changes never delete anything.** Moving a lead to Won or Lost keeps its follow-up.
  Setting the same status again is a no-op.
- **A note without a follow-up keeps the existing one.** Use *Save follow-up* to move it or
  *Mark done* to clear it.
- **Concurrent changes are safe.** On the server, writes take SQLite's write lock before reading
  the clock, so the most recent set, move or clear always decides a lead's follow-up; reads never
  wait for writers. In the browser, changes to one lead run one at a time and each response is
  reconciled, so a slow older response can't overwrite a newer one.
- **The list is always the server's latest answer** for the current filter and search. A save is
  reported as saved even if the list then fails to refresh; that case says so separately and offers
  a retry (also inside the open dialog, for keyboard users) rather than suggesting the save failed.
- **Counts are across all leads**, whatever filter or search is active.

### Components and dependencies

shadcn/ui on Radix primitives (dialogs, select, inputs, toasts) is the foundation; its small
stylesheet is vendored in `app/shadcn.css`, so the shadcn CLI isn't a runtime dependency. The
status filter is the [affectUI](https://github.com/flohoeller/affectui) segmented control (MIT),
themed to the app's palette. `npm audit --omit=dev` reports no vulnerabilities; the one advisory
left in the full audit is in Next's ESLint config (development only, no patched release yet).

## Limitations

- **No login.** The brief marks it optional, so this is a single-user app: anyone who can reach
  the API can read and change every lead. Run it locally; if you ever put it online, use a
  throwaway deployment with fictional data only, keep `CORS_ORIGINS` limited to the frontend's
  address, and tear it down afterwards.
- Unsaved drafts are kept in the browser's local storage on that device only, until saved or
  discarded.
- All demo data is fictional (`555-01xx` numbers, made-up people and companies).
- No pagination: the list loads every lead, which suits the size of this assessment.
- SQLite with a single API process. Moving to Postgres would need connection settings and a
  different locking approach.
