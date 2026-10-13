"""Lead creation, status changes, discussions, follow-up clearing and the timeline."""

from datetime import timedelta

import pytest

from tests.conftest import add_note, assert_error, create_lead, parse_ts


def timeline(client, lead_id: int) -> list[dict]:
    response = client.get(f"/api/leads/{lead_id}/timeline")
    assert response.status_code == 200
    return response.json()


# --- create ---------------------------------------------------------------------------------


def test_create_lead_returns_201_with_lead_and_created_entry(client, clock):
    response = client.post(
        "/api/leads", json={"name": "  Priya Raman ", "company": " Northwind ", "phone": "555-0101"}
    )
    assert response.status_code == 201
    body = response.json()
    lead, entry = body["lead"], body["entry"]
    assert lead["name"] == "Priya Raman"
    assert lead["company"] == "Northwind"
    assert lead["status"] == "new"
    assert lead["next_follow_up_at"] is None
    assert lead["last_note"] is None
    assert parse_ts(lead["created_at"]) == clock.now
    assert entry["kind"] == "lead_created"
    assert timeline(client, lead["id"]) == [entry]


def test_blank_optional_fields_become_null(client):
    lead = create_lead(client, company="   ", phone="")
    assert lead["company"] is None
    assert lead["phone"] is None


@pytest.mark.parametrize(
    ("payload", "field"),
    [
        ({}, "name"),
        ({"name": "   "}, "name"),
        ({"name": "x" * 121}, "name"),
        ({"name": "A", "company": "x" * 121}, "company"),
        ({"name": "A", "phone": "call me"}, "phone"),
        ({"name": "A", "phone": "12"}, "phone"),
        ({"name": "A", "status": "won"}, "status"),
        ({"name": "A", "owner": 1}, "owner"),
    ],
)
def test_create_lead_validation(client, payload, field):
    error = assert_error(client.post("/api/leads", json=payload), 422, "validation_error")
    assert [detail["field"] for detail in error["details"]] == [field]
    assert client.get("/api/leads").json() == {"pinned": [], "leads": []}


def test_validation_messages_are_readable(client):
    error = assert_error(client.post("/api/leads", json={"name": " "}), 422, "validation_error")
    assert error["message"] == "Name is required."
    error = assert_error(
        client.post("/api/leads", json={"name": "A", "phone": "x"}), 422, "validation_error"
    )
    assert error["message"].startswith("Phone can contain only digits")


def test_get_lead(client):
    lead = create_lead(client)
    response = client.get(f"/api/leads/{lead['id']}")
    assert response.status_code == 200
    assert response.json() == lead


# --- status -----------------------------------------------------------------------------------


def test_status_change_persists_and_logs_entry(client):
    lead = create_lead(client)
    response = client.patch(f"/api/leads/{lead['id']}", json={"status": "proposal_sent"})
    assert response.status_code == 200
    body = response.json()
    assert body["lead"]["status"] == "proposal_sent"
    assert body["entry"]["kind"] == "status_changed"
    assert body["entry"]["body"] == "Status changed from New to Proposal Sent"
    assert client.get(f"/api/leads/{lead['id']}").json()["status"] == "proposal_sent"


def test_same_status_is_a_no_op(client):
    lead = create_lead(client)
    response = client.patch(f"/api/leads/{lead['id']}", json={"status": "new"})
    assert response.status_code == 200
    assert response.json()["entry"] is None
    assert len(timeline(client, lead["id"])) == 1


def test_status_change_keeps_follow_up(client, clock):
    lead = create_lead(client)
    follow_up = clock.now + timedelta(hours=2)
    add_note(client, lead["id"], follow_up_at=follow_up)
    body = client.patch(f"/api/leads/{lead['id']}", json={"status": "won"}).json()
    assert parse_ts(body["lead"]["next_follow_up_at"]) == follow_up


@pytest.mark.parametrize("payload", [{"status": "archived"}, {}, {"status": "new", "name": "B"}])
def test_status_validation(client, payload):
    lead = create_lead(client)
    assert_error(client.patch(f"/api/leads/{lead['id']}", json=payload), 422, "validation_error")


# --- discussions ------------------------------------------------------------------------------


def test_note_with_follow_up_updates_lead(client, clock):
    lead = create_lead(client)
    follow_up = clock.now + timedelta(days=1)
    body = add_note(client, lead["id"], "  Sent pricing.  ", follow_up)
    assert body["entry"]["kind"] == "note"
    assert body["entry"]["body"] == "Sent pricing."
    assert parse_ts(body["entry"]["follow_up_at"]) == follow_up
    assert parse_ts(body["lead"]["next_follow_up_at"]) == follow_up
    assert body["lead"]["last_note"] == {"body": "Sent pricing.", "at": body["entry"]["created_at"]}


def test_note_follow_up_with_offset_is_stored_as_same_instant(client, clock):
    lead = create_lead(client)
    response = client.post(
        f"/api/leads/{lead['id']}/discussions",
        json={"note": "n", "follow_up_at": "2026-10-14T10:00:00+05:30"},
    )
    assert response.status_code == 201
    assert response.json()["lead"]["next_follow_up_at"] == "2026-10-14T04:30:00Z"


def test_note_without_follow_up_keeps_existing_one(client, clock):
    lead = create_lead(client)
    follow_up = clock.now + timedelta(days=1)
    add_note(client, lead["id"], follow_up_at=follow_up)
    body = add_note(client, lead["id"], "Quick check-in")
    assert parse_ts(body["lead"]["next_follow_up_at"]) == follow_up


@pytest.mark.parametrize(
    ("payload", "message"),
    [
        ({"note": "   "}, "Note can't be empty."),
        ({"note": "x" * 2001}, None),
        ({"note": "n", "follow_up_at": "2026-10-14T10:00:00"}, None),
        ({"note": "n", "follow_up_at": "not a date"}, None),
        ({"note": "n", "follow_up_at": "2026-10-13T06:30:00Z"}, "Follow-up must be in the future."),
        ({"note": "n", "follow_up_at": "2026-10-13T06:29:59Z"}, "Follow-up must be in the future."),
        ({"note": "n", "extra": True}, None),
    ],
)
def test_discussion_validation(client, payload, message):
    lead = create_lead(client)
    response = client.post(f"/api/leads/{lead['id']}/discussions", json=payload)
    error = assert_error(response, 422, "validation_error")
    if message:
        assert error["message"] == message
    assert len(timeline(client, lead["id"])) == 1


def test_last_note_ignores_system_entries(client, clock):
    lead = create_lead(client)
    add_note(client, lead["id"], "Real discussion")
    clock.advance(minutes=5)
    client.patch(f"/api/leads/{lead['id']}", json={"status": "contacted"})
    listed = client.get("/api/leads").json()["leads"][0]
    assert listed["last_note"]["body"] == "Real discussion"


# --- follow-up clearing -----------------------------------------------------------------------


def test_clear_follow_up(client, clock):
    lead = create_lead(client)
    follow_up = clock.now + timedelta(hours=3)
    add_note(client, lead["id"], follow_up_at=follow_up)
    response = client.delete(f"/api/leads/{lead['id']}/follow-up")
    assert response.status_code == 200
    body = response.json()
    assert body["lead"]["next_follow_up_at"] is None
    assert body["entry"]["kind"] == "follow_up_cleared"
    assert parse_ts(body["entry"]["follow_up_at"]) == follow_up


def test_clear_without_follow_up_is_a_no_op(client):
    lead = create_lead(client)
    response = client.delete(f"/api/leads/{lead['id']}/follow-up")
    assert response.status_code == 200
    assert response.json()["entry"] is None
    assert len(timeline(client, lead["id"])) == 1


# --- timeline ---------------------------------------------------------------------------------


def test_timeline_is_newest_first_with_id_tiebreak(client, clock):
    lead = create_lead(client)
    add_note(client, lead["id"], "first")  # same frozen timestamp as creation
    add_note(client, lead["id"], "second")
    client.patch(f"/api/leads/{lead['id']}", json={"status": "qualified"})
    clock.advance(minutes=1)
    add_note(client, lead["id"], "later")
    entries = timeline(client, lead["id"])
    assert [entry["body"] for entry in entries] == [
        "later",
        "Status changed from New to Qualified",
        "second",
        "first",
        "Lead created",
    ]
    ids = [entry["id"] for entry in entries]
    assert ids == sorted(ids, reverse=True)


def test_timeline_only_contains_that_leads_entries(client):
    first = create_lead(client, "A")
    second = create_lead(client, "B")
    add_note(client, second["id"], "for B")
    assert [e["body"] for e in timeline(client, first["id"])] == ["Lead created"]


# --- not found --------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("method", "path", "json"),
    [
        ("get", "/api/leads/999", None),
        ("patch", "/api/leads/999", {"status": "won"}),
        ("get", "/api/leads/999/timeline", None),
        ("post", "/api/leads/999/discussions", {"note": "n"}),
        ("delete", "/api/leads/999/follow-up", None),
    ],
)
def test_missing_lead_returns_404(client, method, path, json):
    kwargs = {"json": json} if json is not None else {}
    error = assert_error(getattr(client, method)(path, **kwargs), 404, "lead_not_found")
    assert error["message"] == "Lead 999 was not found."
