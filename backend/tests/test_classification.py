"""Pinned / overdue classification, ordering, filters and search (PLAN.md §4B)."""

from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest

from app.services.leads import local_day_bounds
from tests.conftest import add_note, assert_error, create_lead

IST = ZoneInfo("Asia/Kolkata")
NEW_YORK = ZoneInfo("America/New_York")


def local(day: date, hour: int, minute: int = 0, zone: ZoneInfo = IST) -> datetime:
    return datetime.combine(day, time(hour, minute), tzinfo=zone)


def lead_with_follow_up(client, clock, name: str, follow_up: datetime) -> dict:
    """Create a lead whose follow-up was scheduled while it was still in the future."""
    real_now = clock.now
    clock.set(min(real_now, follow_up - timedelta(days=3)))
    lead = create_lead(client, name)
    add_note(client, lead["id"], f"note for {name}", follow_up)
    clock.set(real_now)
    return lead


def listing(client, tz: str = "Asia/Kolkata", **params: str) -> dict[str, list[dict]]:
    response = client.get("/api/leads", params={"tz": tz, **params})
    assert response.status_code == 200, response.text
    return response.json()


def names(leads: list[dict]) -> list[str]:
    return [lead["name"] for lead in leads]


@pytest.fixture
def ist_noon(clock):
    """Now = Tue 13 Oct 2026, 12:00 IST."""
    clock.set(local(date(2026, 10, 13), 12))
    return clock


def test_classification_table(client, ist_noon):
    today, clock = date(2026, 10, 13), ist_noon
    lead_with_follow_up(client, clock, "earlier today", local(today, 9))
    lead_with_follow_up(client, clock, "later today", local(today, 15))
    lead_with_follow_up(client, clock, "last minute today", local(today, 23, 59))
    lead_with_follow_up(client, clock, "midnight tomorrow", local(today + timedelta(days=1), 0))
    lead_with_follow_up(client, clock, "yesterday 23:59", local(today - timedelta(days=1), 23, 59))
    create_lead(client, "no follow-up")

    data = listing(client)
    pinned = {lead["name"]: lead["follow_up_overdue"] for lead in data["pinned"]}
    rest = {lead["name"]: lead["follow_up_overdue"] for lead in data["leads"]}
    assert pinned == {"earlier today": True, "later today": False, "last minute today": False}
    assert rest == {"yesterday 23:59": True, "midnight tomorrow": False, "no follow-up": False}


def test_each_lead_appears_exactly_once(client, ist_noon):
    today = date(2026, 10, 13)
    for index, hour in enumerate([1, 9, 15, 23]):
        lead_with_follow_up(client, ist_noon, f"lead {index}", local(today, hour))
    for index in range(3):
        create_lead(client, f"plain {index}")
    data = listing(client)
    ids = [lead["id"] for lead in data["pinned"] + data["leads"]]
    assert len(ids) == len(set(ids)) == 7


def test_pinned_order_is_by_follow_up_time(client, ist_noon):
    today = date(2026, 10, 13)
    lead_with_follow_up(client, ist_noon, "17:00", local(today, 17))
    lead_with_follow_up(client, ist_noon, "08:00", local(today, 8))
    lead_with_follow_up(client, ist_noon, "13:00", local(today, 13))
    assert names(listing(client)["pinned"]) == ["08:00", "13:00", "17:00"]


def test_main_list_order(client, ist_noon):
    clock, today = ist_noon, date(2026, 10, 13)
    lead_with_follow_up(client, clock, "overdue 2 days", local(today - timedelta(days=2), 10))
    lead_with_follow_up(client, clock, "overdue 1 day", local(today - timedelta(days=1), 10))
    # Activity: notes at different times; "fresh" has the most recent note.
    clock.advance(hours=-5)
    stale = create_lead(client, "stale")
    add_note(client, stale["id"])
    clock.advance(hours=4)
    fresh = create_lead(client, "fresh")
    add_note(client, fresh["id"])
    clock.advance(minutes=30)
    create_lead(client, "created recently, no notes")
    clock.advance(minutes=30)
    assert names(listing(client)["leads"]) == [
        "overdue 2 days",
        "overdue 1 day",
        "created recently, no notes",
        "fresh",
        "stale",
    ]


def test_same_instant_is_pinned_in_one_zone_but_not_another(client, clock):
    # Now is Tue 17:30 in Kolkata and Tue 08:00 in New York. The follow-up at 22:00 UTC is
    # Wed 03:30 in Kolkata (tomorrow) but Tue 18:00 in New York (today).
    clock.set(datetime(2026, 10, 13, 12, 0, tzinfo=UTC))
    lead_with_follow_up(client, clock, "cross-zone", datetime(2026, 10, 13, 22, 0, tzinfo=UTC))
    assert names(listing(client, tz="America/New_York")["pinned"]) == ["cross-zone"]
    assert names(listing(client, tz="Asia/Kolkata")["pinned"]) == []


def test_default_timezone_is_utc(client, clock):
    clock.set(datetime(2026, 10, 13, 20, 0, tzinfo=UTC))
    lead_with_follow_up(client, clock, "utc today", datetime(2026, 10, 13, 23, 0, tzinfo=UTC))
    response = client.get("/api/leads")
    assert names(response.json()["pinned"]) == ["utc today"]


@pytest.mark.parametrize(
    "tz", ["Mars/Base", "../etc/passwd", "Not A Zone", "America", "Etc", "Asia/Kolkata/"]
)
def test_invalid_timezone(client, tz):
    error = assert_error(client.get("/api/leads", params={"tz": tz}), 422, "invalid_timezone")
    assert error["details"] == [{"field": "tz", "message": "Unknown IANA timezone."}]


# --- DST -------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("day", "hours"), [(date(2026, 3, 8), 23), (date(2026, 11, 1), 25), (date(2026, 7, 1), 24)]
)
def test_new_york_day_length_across_dst(day, hours):
    now = local(day, 12, zone=NEW_YORK).astimezone(UTC)
    start, end = local_day_bounds(now, NEW_YORK)
    assert end - start == timedelta(hours=hours)
    assert start.astimezone(NEW_YORK).date() == day
    assert (start - timedelta(microseconds=1)).astimezone(NEW_YORK).date() == day - timedelta(1)
    assert (end - timedelta(microseconds=1)).astimezone(NEW_YORK).date() == day


def test_day_whose_midnight_is_skipped_by_dst():
    # On 2026-09-06 Santiago jumps from 00:00 to 01:00; the day starts at 01:00 local.
    santiago = ZoneInfo("America/Santiago")
    day = date(2026, 9, 6)
    now = local(day, 12, zone=santiago).astimezone(UTC)
    start, end = local_day_bounds(now, santiago)
    assert start.astimezone(santiago).replace(tzinfo=None) == datetime(2026, 9, 6, 1, 0)
    assert (start - timedelta(microseconds=1)).astimezone(santiago).date() == date(2026, 9, 5)
    assert end - start == timedelta(hours=23)


def test_pinning_on_new_york_25_hour_day(client, clock):
    # 01:30 happens twice on 2026-11-01; both occurrences and 23:30 belong to that day.
    day = date(2026, 11, 1)
    clock.set(datetime(2026, 11, 1, 4, 0, tzinfo=UTC))  # 00:00 EDT
    first_0130 = datetime(2026, 11, 1, 5, 30, tzinfo=UTC)  # 01:30 EDT
    second_0130 = datetime(2026, 11, 1, 6, 30, tzinfo=UTC)  # 01:30 EST
    late = local(day, 23, 30, zone=NEW_YORK)
    tomorrow = local(day + timedelta(days=1), 0, 0, zone=NEW_YORK)
    for name, follow_up in [("a", first_0130), ("b", second_0130), ("c", late), ("d", tomorrow)]:
        lead_with_follow_up(client, clock, name, follow_up)
    data = listing(client, tz="America/New_York")
    assert names(data["pinned"]) == ["a", "b", "c"]
    assert names(data["leads"]) == ["d"]


# --- filters and search ----------------------------------------------------------------------


def test_status_filter_applies_before_partition(client, ist_noon):
    today = date(2026, 10, 13)
    qualified_today = lead_with_follow_up(client, ist_noon, "qualified today", local(today, 15))
    lead_with_follow_up(client, ist_noon, "new today", local(today, 16))
    qualified_plain = create_lead(client, "qualified plain")
    for lead in (qualified_today, qualified_plain):
        client.patch(f"/api/leads/{lead['id']}", json={"status": "qualified"})
    data = listing(client, status="qualified")
    assert names(data["pinned"]) == ["qualified today"]
    assert names(data["leads"]) == ["qualified plain"]


@pytest.mark.parametrize(
    "status", ["new", "contacted", "qualified", "proposal_sent", "won", "lost"]
)
def test_every_status_can_be_filtered(client, status):
    lead = create_lead(client, f"lead {status}")
    if status != "new":
        client.patch(f"/api/leads/{lead['id']}", json={"status": status})
    create_lead(client, "other")
    if status == "new":
        assert len(listing(client, status=status)["leads"]) == 2
    else:
        assert names(listing(client, status=status)["leads"]) == [f"lead {status}"]


def test_invalid_status_filter(client):
    assert_error(client.get("/api/leads", params={"status": "nope"}), 422, "validation_error")


def test_search_matches_name_or_company_case_insensitively(client, ist_noon):
    create_lead(client, "Priya Raman", company="Northwind Labs")
    create_lead(client, "Dev Kapoor", company="Bluepeak")
    lead_with_follow_up(client, ist_noon, "Asha NORTH", local(date(2026, 10, 13), 15))
    data = listing(client, q="  north ")
    assert names(data["pinned"]) == ["Asha NORTH"]
    assert names(data["leads"]) == ["Priya Raman"]


def test_search_treats_wildcards_literally(client):
    create_lead(client, "100% Growth Co")
    create_lead(client, "Plain Name")
    create_lead(client, "snake_case Ltd")
    create_lead(client, "snakeXcase Ltd")
    assert names(listing(client, q="%")["leads"]) == ["100% Growth Co"]
    assert names(listing(client, q="e_c")["leads"]) == ["snake_case Ltd"]


def test_search_combined_with_status(client):
    match = create_lead(client, "Ravi Shah")
    create_lead(client, "Ravi Menon")
    client.patch(f"/api/leads/{match['id']}", json={"status": "won"})
    assert names(listing(client, q="ravi", status="won")["leads"]) == ["Ravi Shah"]


def test_search_too_long_is_rejected(client):
    assert_error(client.get("/api/leads", params={"q": "x" * 101}), 422, "validation_error")


def test_legacy_zone_names_resolve_without_a_system_time_zone_database(client, clock):
    # Some browsers report legacy names such as Asia/Calcutta, and slim containers or Windows may
    # have no (or no legacy) system zone data. The tzdata dependency must cover both.
    import zoneinfo

    zoneinfo.reset_tzpath(to=[])
    try:
        zoneinfo.ZoneInfo.clear_cache()
        assert listing(client, tz="Asia/Calcutta") == listing(client, tz="Asia/Kolkata")
    finally:
        zoneinfo.reset_tzpath()
        zoneinfo.ZoneInfo.clear_cache()
