"""The demo seed: counts the README states, all six statuses, and every follow-up case."""

from datetime import datetime, time
from zoneinfo import ZoneInfo

import pytest

from app.models import Entry, EntryKind
from app.seed import LEAD_COUNT, NOTE_COUNT, seed

IST = ZoneInfo("Asia/Kolkata")


@pytest.mark.parametrize("local_now", [time(12, 40), time(0, 20), time(23, 50)])
def test_seed_covers_every_case_at_any_hour(app, client, clock, local_now):
    now = datetime.combine(datetime(2026, 10, 14).date(), local_now, tzinfo=IST)
    clock.set(now)
    seed(app.state.session_factory, now)

    data = client.get("/api/leads", params={"tz": "Asia/Kolkata"}).json()
    leads = data["pinned"] + data["leads"]
    assert len(leads) == LEAD_COUNT
    assert {lead["status"] for lead in leads} == {
        "new",
        "contacted",
        "qualified",
        "proposal_sent",
        "won",
        "lost",
    }

    # Today: one follow-up already passed, one still ahead.
    assert [(lead["name"], lead["follow_up_overdue"]) for lead in data["pinned"]] == [
        ("Rohan Mehta", True),
        ("Ananya Rao", False),
    ]
    # Overdue from yesterday sorts first among the other leads.
    assert data["leads"][0]["name"] == "Farah Siddiqui"
    assert data["leads"][0]["follow_up_overdue"] is True
    # A lead with no discussions yet.
    karthik = next(lead for lead in leads if lead["name"] == "Karthik Nair")
    assert karthik["last_note"] is None

    with app.state.session_factory() as session:
        notes = session.query(Entry).filter(Entry.kind == EntryKind.NOTE).count()
    assert notes == NOTE_COUNT
