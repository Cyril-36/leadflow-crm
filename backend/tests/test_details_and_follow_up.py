"""Editing lead details and setting a follow-up without a note."""

from datetime import timedelta

import pytest

from tests.conftest import add_note, assert_error, create_lead, parse_ts


def timeline(client, lead_id: int) -> list[dict]:
    return client.get(f"/api/leads/{lead_id}/timeline").json()


# --- details ----------------------------------------------------------------------------------


def test_update_details_changes_only_sent_fields_and_logs_them(client):
    lead = create_lead(client, "Priya Rmaan", company="Northwind", phone="555-0101")
    response = client.patch(
        f"/api/leads/{lead['id']}/details", json={"name": "  Priya Raman ", "phone": "555-0199"}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["lead"]["name"] == "Priya Raman"
    assert body["lead"]["phone"] == "555-0199"
    assert body["lead"]["company"] == "Northwind"  # not sent, unchanged
    assert body["entry"]["kind"] == "details_updated"
    assert body["entry"]["body"] == "Updated name and phone"
    assert client.get(f"/api/leads/{lead['id']}").json()["name"] == "Priya Raman"


def test_blank_company_or_phone_clears_it(client):
    lead = create_lead(client, company="Northwind", phone="555-0101")
    body = client.patch(
        f"/api/leads/{lead['id']}/details", json={"company": " ", "phone": ""}
    ).json()
    assert body["lead"]["company"] is None
    assert body["lead"]["phone"] is None
    assert body["entry"]["body"] == "Updated company and phone"


def test_unchanged_details_are_a_no_op(client):
    lead = create_lead(client, "Priya Raman", company="Northwind")
    body = client.patch(
        f"/api/leads/{lead['id']}/details", json={"name": "Priya Raman", "company": "Northwind"}
    ).json()
    assert body["entry"] is None
    assert len(timeline(client, lead["id"])) == 1


def test_three_changed_fields_read_naturally(client):
    lead = create_lead(client, "A", company="B", phone="555-0101")
    body = client.patch(
        f"/api/leads/{lead['id']}/details", json={"name": "C", "company": "D", "phone": "555-0102"}
    ).json()
    assert body["entry"]["body"] == "Updated name, company and phone"


@pytest.mark.parametrize(
    ("payload", "field", "message"),
    [
        ({"name": "   "}, "name", "Name is required."),
        ({"name": None}, "name", "Name is required."),
        ({"name": "x" * 121}, "name", None),
        ({"company": "x" * 121}, "company", None),
        ({"phone": "call me"}, "phone", None),
        ({"status": "won"}, "status", None),
        ({}, "request", "Send at least one of name, company or phone."),
    ],
)
def test_update_details_validation(client, payload, field, message):
    lead = create_lead(client)
    error = assert_error(
        client.patch(f"/api/leads/{lead['id']}/details", json=payload), 422, "validation_error"
    )
    assert [detail["field"] for detail in error["details"]] == [field]
    if message:
        assert error["message"] == message


def test_update_details_missing_lead(client):
    assert_error(client.patch("/api/leads/999/details", json={"name": "A"}), 404, "lead_not_found")


# --- follow-up without a note -----------------------------------------------------------------


def test_set_follow_up_without_a_note(client, clock):
    lead = create_lead(client)
    follow_up = clock.now + timedelta(hours=3)
    response = client.put(
        f"/api/leads/{lead['id']}/follow-up", json={"follow_up_at": follow_up.isoformat()}
    )
    assert response.status_code == 200
    body = response.json()
    assert parse_ts(body["lead"]["next_follow_up_at"]) == follow_up
    assert body["entry"]["kind"] == "follow_up_set"
    assert body["entry"]["body"] == "Follow-up set"
    assert body["lead"]["last_note"] is None  # not a discussion


def test_moving_a_follow_up_is_logged_as_rescheduled(client, clock):
    lead = create_lead(client)
    add_note(client, lead["id"], follow_up_at=clock.now + timedelta(days=1))
    later = clock.now + timedelta(days=2)
    body = client.put(
        f"/api/leads/{lead['id']}/follow-up", json={"follow_up_at": later.isoformat()}
    ).json()
    assert body["entry"]["body"] == "Follow-up rescheduled"
    assert parse_ts(body["entry"]["follow_up_at"]) == later


def test_setting_the_same_follow_up_is_a_no_op(client, clock):
    lead = create_lead(client)
    follow_up = clock.now + timedelta(days=1)
    add_note(client, lead["id"], follow_up_at=follow_up)
    body = client.put(
        f"/api/leads/{lead['id']}/follow-up", json={"follow_up_at": follow_up.isoformat()}
    ).json()
    assert body["entry"] is None


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"follow_up_at": "2026-10-14T10:00:00"},
        {"follow_up_at": "2026-10-13T06:30:00Z"},
        {"follow_up_at": "2030-01-01T10:00:00Z", "note": "x"},
    ],
)
def test_set_follow_up_validation(client, payload):
    lead = create_lead(client)
    assert_error(
        client.put(f"/api/leads/{lead['id']}/follow-up", json=payload), 422, "validation_error"
    )


def test_set_follow_up_missing_lead(client):
    response = client.put("/api/leads/999/follow-up", json={"follow_up_at": "2030-01-01T10:00:00Z"})
    assert_error(response, 404, "lead_not_found")
