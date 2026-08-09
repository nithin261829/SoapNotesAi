"""Shared fixtures: an in-memory Firestore fake + cache hygiene.

Everything runs fully offline:
  - `get_db` is patched in every module that imported it, so all reads/writes
    hit a plain dict keyed by document path.
  - `google.cloud.firestore.transactional` is patched to an identity decorator;
    the fake transaction applies writes immediately (tests are single-threaded).
  - Razorpay config/client and OTP delivery are stubbed per-test.
  - The module-level TTL caches (app_config._cache, otp._session_cache) are
    cleared around every test.
"""
from __future__ import annotations

import copy
import uuid
from datetime import datetime, timedelta

import pytest

from app.auth.deps import UserContext
from app.services.app_config import RazorpayConfig

# ─── In-memory Firestore fake ──────────────────────────────────────


class FakeSnapshot:
    def __init__(self, path: str, data: dict | None):
        self._path = path
        self._data = copy.deepcopy(data) if data is not None else None

    @property
    def id(self) -> str:
        return self._path.rsplit("/", 1)[-1]

    @property
    def exists(self) -> bool:
        return self._data is not None

    def to_dict(self) -> dict | None:
        return copy.deepcopy(self._data) if self._data is not None else None


class FakeDocRef:
    def __init__(self, db: "FakeDB", path: str):
        self._db = db
        self.path = path

    @property
    def id(self) -> str:
        return self.path.rsplit("/", 1)[-1]

    def collection(self, name: str) -> "FakeCollection":
        return FakeCollection(self._db, f"{self.path}/{name}")

    def get(self, transaction=None) -> FakeSnapshot:
        return FakeSnapshot(self.path, self._db.store.get(self.path))

    def set(self, data: dict, merge: bool = False) -> None:
        if merge and self.path in self._db.store:
            self._db.store[self.path].update(copy.deepcopy(data))
        else:
            self._db.store[self.path] = copy.deepcopy(data)

    def update(self, data: dict) -> None:
        # Real Firestore raises NotFound when updating a missing doc.
        if self.path not in self._db.store:
            raise KeyError(f"update() on missing doc: {self.path}")
        self._db.store[self.path].update(copy.deepcopy(data))

    def delete(self) -> None:
        self._db.store.pop(self.path, None)


def _match(actual, op: str, expected) -> bool:
    if actual is None:
        return op == "==" and expected is None
    if op == "==":
        return actual == expected
    if op == ">=":
        return actual >= expected
    if op == "<=":
        return actual <= expected
    if op == ">":
        return actual > expected
    if op == "<":
        return actual < expected
    raise NotImplementedError(f"fake firestore: unsupported op {op!r}")


class FakeQuery:
    def __init__(self, db: "FakeDB", coll_path: str, filters=(), order=None, limit_n=None):
        self._db = db
        self._coll_path = coll_path
        self._filters = tuple(filters)
        self._order = order
        self._limit = limit_n

    def where(self, field: str, op: str, value) -> "FakeQuery":
        return FakeQuery(
            self._db, self._coll_path, self._filters + ((field, op, value),),
            self._order, self._limit,
        )

    def order_by(self, field: str, direction: str = "ASCENDING") -> "FakeQuery":
        return FakeQuery(self._db, self._coll_path, self._filters, (field, direction), self._limit)

    def limit(self, n: int) -> "FakeQuery":
        return FakeQuery(self._db, self._coll_path, self._filters, self._order, n)

    def stream(self, transaction=None):
        docs = [
            (path, data)
            for path, data in self._db.store.items()
            if path.rsplit("/", 1)[0] == self._coll_path
        ]
        for field, op, value in self._filters:
            docs = [(p, d) for p, d in docs if _match(d.get(field), op, value)]
        if self._order:
            field, direction = self._order
            docs.sort(key=lambda pd: pd[1].get(field), reverse=(direction == "DESCENDING"))
        if self._limit is not None:
            docs = docs[: self._limit]
        for path, data in docs:
            yield FakeSnapshot(path, data)


class FakeCollection(FakeQuery):
    def document(self, doc_id: str | None = None) -> FakeDocRef:
        return FakeDocRef(self._db, f"{self._coll_path}/{doc_id or uuid.uuid4().hex}")


class FakeTransaction:
    """Writes apply immediately — single-threaded tests don't need atomicity."""

    def set(self, ref: FakeDocRef, data: dict) -> None:
        ref.set(data)

    def update(self, ref: FakeDocRef, data: dict) -> None:
        ref.update(data)

    def get(self, ref: FakeDocRef) -> FakeSnapshot:
        return ref.get()

    def delete(self, ref: FakeDocRef) -> None:
        ref.delete()


class FakeDB:
    def __init__(self):
        self.store: dict[str, dict] = {}

    def collection(self, name: str) -> FakeCollection:
        return FakeCollection(self, name)

    def transaction(self) -> FakeTransaction:
        return FakeTransaction()

    def seed(self, path: str, data: dict) -> None:
        self.store[path] = copy.deepcopy(data)

    def docs_under(self, coll_path: str) -> list[str]:
        return [p for p in self.store if p.rsplit("/", 1)[0] == coll_path]


# ─── Fixtures ──────────────────────────────────────────────────────

# Every module that did `from app.services.firestore import get_db` holds its
# own reference — patch them all.
_GET_DB_MODULES = [
    "app.services.firestore",
    "app.services.app_config",
    "app.services.billing_service",
    "app.services.otp",
    "app.routers.billing",
]


@pytest.fixture(autouse=True)
def clear_caches():
    from app.services import app_config, otp

    app_config._cache.clear()
    otp._session_cache.clear()
    yield
    app_config._cache.clear()
    otp._session_cache.clear()


@pytest.fixture
def fake_db(monkeypatch) -> FakeDB:
    db = FakeDB()
    for mod in _GET_DB_MODULES:
        monkeypatch.setattr(f"{mod}.get_db", lambda db=db: db)
    # Bypass google.cloud.firestore's @transactional retry machinery: the
    # decorated function is simply called with our FakeTransaction.
    monkeypatch.setattr("google.cloud.firestore.transactional", lambda fn: fn)
    return db


@pytest.fixture
def set_config(fake_db: FakeDB):
    """Write an app_config/{name} doc into the fake store (and drop its cache
    entry so get_config_doc re-reads it)."""

    def _set(name: str, data: dict) -> None:
        from app.services.app_config import _cache

        fake_db.seed(f"app_config/{name}", data)
        _cache.pop(name, None)

    return _set


def make_user(
    role: str | None = "owner",
    uid: str = "u1",
    org_id: str | None = "org1",
    clinic_id: str | None = "clinic-a",
) -> UserContext:
    return UserContext(
        uid=uid,
        email="owner@example.com",
        phone=None,
        org_id=org_id,
        active_clinic_id=clinic_id,
        role=role,
    )


@pytest.fixture
def owner() -> UserContext:
    return make_user(role="owner")


@pytest.fixture
def rzp_config(monkeypatch) -> RazorpayConfig:
    """Deterministic Razorpay keys; never falls back to .env values."""
    cfg = RazorpayConfig(key_id="rzp_test_key", key_secret="test_secret", webhook_secret="whsec")
    monkeypatch.setattr("app.routers.billing.get_razorpay_config", lambda: cfg)
    return cfg


@pytest.fixture
def rzp_orders(monkeypatch) -> list[dict]:
    """Stub the Razorpay SDK client; returns the list of order.create payloads."""
    created: list[dict] = []

    class _Orders:
        def create(self, payload: dict) -> dict:
            created.append(payload)
            return {"id": f"order_test{len(created)}"}

    class _Client:
        order = _Orders()

    monkeypatch.setattr("app.routers.billing._razorpay_client", lambda cfg: _Client())
    return created


@pytest.fixture
def otp_codes(monkeypatch) -> list[str]:
    """Capture generated OTP codes instead of delivering them."""
    codes: list[str] = []

    def fake_deliver(code: str, *, email, phone):
        codes.append(code)
        return (email or phone or "test@x.com", "email")

    monkeypatch.setattr("app.services.otp._deliver", fake_deliver)
    return codes


def assert_dt_close(value: str | datetime, expected: datetime, tolerance_s: float = 120) -> None:
    actual = datetime.fromisoformat(value) if isinstance(value, str) else value
    assert abs((actual - expected).total_seconds()) <= tolerance_s, (
        f"{actual} not within {tolerance_s}s of {expected}"
    )


def iso_in(days: int = 0, minutes: int = 0) -> str:
    from app.models.common import utc_now

    return (utc_now() + timedelta(days=days, minutes=minutes)).isoformat()
