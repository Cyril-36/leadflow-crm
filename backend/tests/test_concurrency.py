"""Transaction strategy, write locking, the follow-up invariant and persistence (PLAN.md §4D)."""

import random
import sqlite3
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event

from app.clock import get_clock, utc_now
from app.config import Settings
from app.main import create_app
from tests.conftest import add_note, create_lead, parse_ts


def sqlite_path(db_url: str) -> str:
    return db_url.removeprefix("sqlite:///")


@pytest.fixture
def held_write_lock(db_url, client):
    """A separate connection holding SQLite's write lock until released."""
    connection = sqlite3.connect(
        sqlite_path(db_url), isolation_level=None, timeout=0, check_same_thread=False
    )
    connection.execute("BEGIN IMMEDIATE")
    released = threading.Event()

    def release() -> None:
        if not released.is_set():
            connection.execute("ROLLBACK")
            released.set()

    yield release
    release()
    connection.close()


def test_reads_use_deferred_and_writes_take_the_lock_before_the_clock(app, client, clock):
    engine = app.state.session_factory.kw["bind"]
    engine.dispose()  # make the next connection go through the trace hook
    log: list[str] = []

    @event.listens_for(engine, "connect")
    def _trace(dbapi_connection, _record):
        dbapi_connection.set_trace_callback(log.append)

    def logging_clock():
        log.append("CLOCK")
        return clock.now

    app.dependency_overrides[get_clock] = lambda: logging_clock
    client.get("/api/leads")
    read_log, log[:] = list(log), []
    create_lead(client)
    write_log = list(log)

    read_sql = [line for line in read_log if line != "CLOCK"]
    assert read_sql[0] == "BEGIN DEFERRED"
    assert "BEGIN IMMEDIATE" not in read_sql
    assert write_log[:2] == ["BEGIN IMMEDIATE", "CLOCK"]


def test_reads_are_not_blocked_by_a_writer(client, held_write_lock):
    create_lead_started = time.monotonic()
    response = client.get("/api/leads")
    assert response.status_code == 200
    # With BEGIN IMMEDIATE on reads this would wait for the 5 s busy timeout and then fail.
    assert time.monotonic() - create_lead_started < 1.0


def test_writes_wait_for_the_lock_and_then_succeed(client, held_write_lock):
    timer = threading.Timer(0.3, held_write_lock)
    started = time.monotonic()
    timer.start()
    response = client.post("/api/leads", json={"name": "Waited"})
    timer.join()
    assert response.status_code == 201
    assert time.monotonic() - started >= 0.3


def test_follow_up_invariant_under_concurrent_set_and_clear(app, client):
    app.dependency_overrides[get_clock] = lambda: utc_now  # real, advancing clock
    lead_id = create_lead(client)["id"]
    base = utc_now() + timedelta(days=1)
    rng = random.Random(7)
    operations = [
        ("set", base + timedelta(minutes=i)) if rng.random() < 0.6 else ("clear", None)
        for i in range(80)
    ]

    def run(operation):
        kind, follow_up = operation
        if kind == "set":
            response = client.post(
                f"/api/leads/{lead_id}/discussions",
                json={
                    "note": f"set {follow_up.isoformat()}",
                    "follow_up_at": follow_up.isoformat(),
                },
            )
        else:
            response = client.delete(f"/api/leads/{lead_id}/follow-up")
        listing = client.get("/api/leads")  # reads interleaved with writes
        return kind, follow_up, response, listing

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(run, operations))

    sets = [r for r in results if r[0] == "set"]
    clears = [r for r in results if r[0] == "clear"]
    assert all(r[2].status_code == 201 for r in sets)
    assert all(r[2].status_code == 200 for r in clears)
    assert all(r[3].status_code == 200 for r in results)
    # Each response reflects its own committed transaction.
    for _, follow_up, response, _ in sets:
        assert parse_ts(response.json()["lead"]["next_follow_up_at"]) == follow_up
    for _, _, response, _ in clears:
        assert response.json()["lead"]["next_follow_up_at"] is None

    entries = client.get(f"/api/leads/{lead_id}/timeline").json()
    notes = [e for e in entries if e["kind"] == "note"]
    cleared = [e for e in entries if e["kind"] == "follow_up_cleared"]
    assert len(notes) == len(sets)
    assert len(cleared) == sum(1 for r in clears if r[2].json()["entry"] is not None)

    # Invariant D: the highest-id set/clear entry decides the lead's follow-up.
    relevant = [e for e in entries if e["kind"] == "follow_up_cleared" or e["follow_up_at"]]
    latest = max(relevant, key=lambda e: e["id"])
    expected = latest["follow_up_at"] if latest["kind"] == "note" else None
    assert client.get(f"/api/leads/{lead_id}").json()["next_follow_up_at"] == expected

    # Timestamps were read under the lock, so the visible timeline agrees with id order.
    ids = [e["id"] for e in entries]
    assert ids == sorted(ids, reverse=True)


def test_data_survives_an_app_restart(db_url, clock):
    first = create_app(Settings(database_url=db_url))
    first.dependency_overrides[get_clock] = lambda: clock
    with TestClient(first) as client:
        lead = create_lead(client, "Persistent Lead")
        add_note(client, lead["id"], "Remember me", clock.now + timedelta(days=2))
        client.patch(f"/api/leads/{lead['id']}", json={"status": "qualified"})

    second = create_app(Settings(database_url=db_url))
    second.dependency_overrides[get_clock] = lambda: clock
    with TestClient(second) as client:
        restored = client.get(f"/api/leads/{lead['id']}").json()
        entries = client.get(f"/api/leads/{lead['id']}/timeline").json()
    assert restored["status"] == "qualified"
    assert restored["last_note"]["body"] == "Remember me"
    assert parse_ts(restored["next_follow_up_at"]) == clock.now + timedelta(days=2)
    assert [e["kind"] for e in entries] == ["status_changed", "note", "lead_created"]
