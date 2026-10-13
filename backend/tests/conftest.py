from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.clock import get_clock
from app.config import Settings
from app.main import create_app

# A Tuesday, 12:00 in Asia/Kolkata.
DEFAULT_NOW = datetime(2026, 10, 13, 6, 30, tzinfo=UTC)


class FrozenClock:
    def __init__(self, now: datetime) -> None:
        self.now = now

    def __call__(self) -> datetime:
        return self.now

    def set(self, now: datetime) -> None:
        self.now = now

    def advance(self, **delta: float) -> None:
        self.now += timedelta(**delta)


@pytest.fixture
def db_url(tmp_path: Path) -> str:
    return f"sqlite:///{tmp_path / 'leadflow.db'}"


@pytest.fixture
def clock() -> FrozenClock:
    return FrozenClock(DEFAULT_NOW)


@pytest.fixture
def app(db_url: str, clock: FrozenClock) -> FastAPI:
    app = create_app(Settings(database_url=db_url))
    app.dependency_overrides[get_clock] = lambda: clock
    return app


@pytest.fixture
def client(app: FastAPI) -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client


def create_lead(client: TestClient, name: str = "Priya Raman", **fields: object) -> dict:
    response = client.post("/api/leads", json={"name": name, **fields})
    assert response.status_code == 201, response.text
    return response.json()["lead"]


def add_note(
    client: TestClient, lead_id: int, note: str = "Called", follow_up_at: datetime | None = None
) -> dict:
    body: dict[str, object] = {"note": note}
    if follow_up_at is not None:
        body["follow_up_at"] = follow_up_at.isoformat()
    response = client.post(f"/api/leads/{lead_id}/discussions", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def parse_ts(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def assert_error(response, status: int, code: str) -> dict:
    assert response.status_code == status, response.text
    body = response.json()
    assert set(body) == {"error"}
    assert body["error"]["code"] == code
    assert isinstance(body["error"]["message"], str) and body["error"]["message"]
    return body["error"]
