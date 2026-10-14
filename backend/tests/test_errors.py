"""Error envelope, status codes, CORS and the health check."""

from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from app.clock import get_clock
from app.db import get_session
from app.models import UTCDateTime
from tests.conftest import assert_error, create_lead


def test_health(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_unknown_route_uses_envelope(client):
    assert_error(client.get("/api/nope"), 404, "not_found")
    assert_error(client.get("/leads"), 404, "not_found")  # everything lives under /api


def test_wrong_method_uses_envelope(client):
    assert_error(client.put("/api/leads/1", json={}), 405, "method_not_allowed")


def test_malformed_json_is_422(client):
    response = client.post(
        "/api/leads", content=b'{"name": ', headers={"Content-Type": "application/json"}
    )
    assert_error(response, 422, "validation_error")


def test_non_integer_lead_id_is_422(client):
    error = assert_error(client.get("/api/leads/abc"), 422, "validation_error")
    assert error["details"][0]["field"] == "lead_id"


def test_multiple_validation_errors_are_all_reported(client):
    error = assert_error(
        client.post("/api/leads", json={"name": "", "phone": "x", "company": "y" * 200}),
        422,
        "validation_error",
    )
    assert error["message"] == "Some fields are invalid."
    assert {detail["field"] for detail in error["details"]} == {"name", "phone", "company"}


def test_unhandled_error_returns_500_without_internals(app):
    def broken_session():
        raise RuntimeError("secret internal detail")

    app.dependency_overrides[get_session] = broken_session
    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.get("/api/leads")
    error = assert_error(response, 500, "internal_error")
    assert "secret" not in response.text
    assert error == {"code": "internal_error", "message": "Something went wrong on the server."}


def test_failure_inside_a_write_rolls_back_and_releases_the_lock(app, clock):
    def exploding_clock():
        raise RuntimeError("clock failure")

    with TestClient(app, raise_server_exceptions=False) as client:
        app.dependency_overrides[get_clock] = lambda: exploding_clock
        assert_error(client.post("/api/leads", json={"name": "A"}), 500, "internal_error")
        app.dependency_overrides[get_clock] = lambda: clock
        # Would wait out the 5 s busy timeout and fail if the write lock had leaked.
        create_lead(client, "B")
        assert [lead["name"] for lead in client.get("/api/leads").json()["leads"]] == ["B"]


def test_cors_allows_only_the_configured_origin(client):
    allowed = client.options(
        "/api/leads",
        headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "POST"},
    )
    assert allowed.headers.get("access-control-allow-origin") == "http://localhost:3000"
    blocked = client.options(
        "/api/leads",
        headers={"Origin": "http://evil.example", "Access-Control-Request-Method": "POST"},
    )
    assert "access-control-allow-origin" not in blocked.headers


def test_utc_column_rejects_naive_datetimes():
    column = UTCDateTime()
    with pytest.raises(ValueError, match="naive"):
        column.process_bind_param(datetime(2026, 1, 1), None)
    aware = datetime(2026, 1, 1, 12, tzinfo=UTC)
    assert column.process_result_value(column.process_bind_param(aware, None), None) == aware


@pytest.mark.parametrize("method", ["GET", "POST", "PUT", "PATCH", "DELETE"])
def test_cors_allows_every_method_the_app_uses(client, method):
    response = client.options(
        "/api/leads/1/follow-up",
        headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": method},
    )
    assert response.status_code == 200
    assert method in response.headers.get("access-control-allow-methods", "")
