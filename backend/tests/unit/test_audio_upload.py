"""Tests for the audio upload + AudioToSoap endpoint.

The fake provider is forced via dependency override — no Vertex AI auth needed
and no network calls made.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app, get_audio_to_soap
from app.providers.fake_audio_to_soap import FakeAudioToSoap


@pytest.fixture
def client() -> TestClient:
    app.dependency_overrides[get_audio_to_soap] = lambda: FakeAudioToSoap()
    try:
        with TestClient(app) as c:
            yield c
    finally:
        app.dependency_overrides.pop(get_audio_to_soap, None)


def test_healthz(client: TestClient) -> None:
    r = client.get("/healthz")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_upload_returns_transcript_and_soap(client: TestClient) -> None:
    payload = b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 2048
    r = client.post(
        "/audio/upload",
        files={"audio": ("dictation.m4a", payload, "audio/m4a")},
        data={"client_duration_ms": "5234"},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["size_bytes"] == len(payload)
    assert body["mime_type"] == "audio/m4a"
    assert body["client_duration_ms"] == 5234
    assert isinstance(body["recording_id"], str) and body["recording_id"]
    assert body["provider"] == "fake"
    assert "transcript" in body and isinstance(body["transcript"], str)
    assert "[FAKE PROVIDER" in body["transcript"]
    assert "soap" in body
    soap = body["soap"]
    assert soap["patient"]["name"] == "Test Patient"
    assert soap["subjective"]["chief_complaint"] == "Cough for three days"
    assert soap["objective"]["vitals"]["blood_pressure"] == "128/82"


def test_upload_honors_client_recording_id(client: TestClient) -> None:
    r = client.post(
        "/audio/upload",
        files={"audio": ("a.m4a", b"\x00" * 16, "audio/m4a")},
        data={"client_recording_id": "rec-abc-123"},
    )
    assert r.status_code == 201
    assert r.json()["recording_id"] == "rec-abc-123"


def test_upload_accepts_explicit_encounter_date(client: TestClient) -> None:
    r = client.post(
        "/audio/upload",
        files={"audio": ("a.m4a", b"\x00" * 16, "audio/m4a")},
        data={"encounter_date": "2026-01-15"},
    )
    assert r.status_code == 201
    assert r.json()["soap"]["patient"]["encounter_date"] == "2026-01-15"


def test_upload_rejects_invalid_encounter_date(client: TestClient) -> None:
    r = client.post(
        "/audio/upload",
        files={"audio": ("a.m4a", b"\x00" * 16, "audio/m4a")},
        data={"encounter_date": "not-a-date"},
    )
    assert r.status_code == 400
    assert r.json()["detail"] == "invalid_encounter_date"


def test_upload_rejects_unsupported_mime(client: TestClient) -> None:
    r = client.post(
        "/audio/upload",
        files={"audio": ("note.txt", b"hello", "text/plain")},
    )
    assert r.status_code == 415
    assert r.json()["detail"] == "unsupported_audio_format"


def test_upload_rejects_empty_body(client: TestClient) -> None:
    r = client.post(
        "/audio/upload",
        files={"audio": ("empty.m4a", b"", "audio/m4a")},
    )
    assert r.status_code == 400
    assert r.json()["detail"] == "empty_audio"


def test_upload_rejects_oversize(client: TestClient) -> None:
    from app.config import get_settings

    settings = get_settings()
    original = settings.max_upload_bytes
    object.__setattr__(settings, "max_upload_bytes", 1024)
    try:
        r = client.post(
            "/audio/upload",
            files={"audio": ("big.m4a", b"\x00" * 2048, "audio/m4a")},
        )
        assert r.status_code == 413
        assert r.json()["detail"] == "audio_too_large"
    finally:
        object.__setattr__(settings, "max_upload_bytes", original)


def test_upload_rejects_too_long_duration(client: TestClient) -> None:
    from app.config import get_settings

    settings = get_settings()
    over_limit = settings.max_audio_duration_ms + 1
    r = client.post(
        "/audio/upload",
        files={"audio": ("long.m4a", b"\x00" * 16, "audio/m4a")},
        data={"client_duration_ms": str(over_limit)},
    )
    assert r.status_code == 413
    assert r.json()["detail"] == "audio_too_long"
