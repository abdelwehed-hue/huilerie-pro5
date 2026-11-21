from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from routers.attendance import _minutes_between, _parse_range, _record_out


def test_work_minutes_are_full_elapsed_time_without_break_deduction():
    check_in = datetime(2026, 11, 20, 8, 0, tzinfo=timezone.utc)
    check_out = datetime(2026, 11, 20, 17, 0, tzinfo=timezone.utc)

    assert _minutes_between(check_in, check_out) == 9 * 60


def test_overnight_shift_is_attributed_as_full_elapsed_duration():
    check_in = datetime(2026, 11, 20, 22, 0, tzinfo=timezone.utc)
    check_out = datetime(2026, 11, 21, 6, 0, tzinfo=timezone.utc)

    assert _minutes_between(check_in, check_out) == 8 * 60


def test_missing_checkout_has_no_final_duration():
    check_in = datetime(2026, 11, 20, 8, 0, tzinfo=timezone.utc)

    assert _minutes_between(check_in, None) is None
    record = _record_out({
        "id": "attendance-1",
        "worker_id": "worker-1",
        "worker_name": "Worker",
        "day": "2026-11-20",
        "status": "present",
        "check_in": check_in,
        "check_out": None,
        "created_at": check_in,
        "updated_at": check_in,
    })
    assert record["duration_minutes"] is None


def test_invalid_or_overlong_shift_is_not_counted():
    start = datetime(2026, 11, 20, 8, 0, tzinfo=timezone.utc)

    assert _minutes_between(start, start) is None
    assert _minutes_between(start, start + timedelta(hours=24, minutes=1)) is None
    assert _minutes_between(start + timedelta(hours=1), start) is None


def test_date_range_validation():
    start, end = _parse_range("2026-11-01", "2026-11-30")
    assert (end - start).days == 29

    with pytest.raises(HTTPException) as exc:
        _parse_range("2026-11-20", "2026-11-19")
    assert exc.value.status_code == 422

    with pytest.raises(HTTPException) as exc:
        _parse_range("2025-01-01", "2026-11-20")
    assert exc.value.status_code == 422


def test_shift_over_24_hours_is_flagged_for_review_and_not_counted():
    check_in = datetime(2026, 11, 20, 8, 0, tzinfo=timezone.utc)
    check_out = check_in + timedelta(hours=25)
    record = _record_out({
        "id": "attendance-long-shift",
        "worker_id": "worker-1",
        "worker_name": "Worker",
        "day": "2026-11-20",
        "status": "present",
        "check_in": check_in,
        "check_out": check_out,
        "created_at": check_in,
        "updated_at": check_out,
    })

    assert record["duration_minutes"] is None
    assert record["duration_review_required"] is True


class FakeAttendanceCollection:
    def __init__(self):
        self.docs = []

    async def create_index(self, *_args, **_kwargs):
        return "index"

    async def find_one(self, query, projection=None, sort=None):
        rows = [
            doc for doc in self.docs
            if all(doc.get(key) == value for key, value in query.items())
        ]
        if sort:
            key, direction = sort[0]
            rows.sort(key=lambda doc: doc.get(key), reverse=direction < 0)
        return dict(rows[0]) if rows else None

    async def insert_one(self, doc):
        if any(
            row["worker_id"] == doc["worker_id"] and row["day"] == doc["day"]
            for row in self.docs
        ):
            from pymongo.errors import DuplicateKeyError
            raise DuplicateKeyError("worker/day already exists")
        self.docs.append(dict(doc))

    async def find_one_and_update(self, query, update, **_kwargs):
        for doc in self.docs:
            if all(doc.get(key) == value for key, value in query.items()):
                doc.update(update.get("$set", {}))
                return dict(doc)
        return None


@pytest.mark.asyncio
async def test_check_in_and_check_out_are_single_per_worker_day(monkeypatch):
    from types import SimpleNamespace
    from routers import attendance as attendance_routes
    from fastapi import HTTPException

    collection = FakeAttendanceCollection()
    users = SimpleNamespace(find_one=lambda query, projection=None: None)

    async def find_worker(query, projection=None):
        return {"id": "worker-1", "full_name": "Worker One", "active": True}

    users.find_one = find_worker
    monkeypatch.setattr(attendance_routes, "db", SimpleNamespace(attendance=collection, users=users))

    started = await attendance_routes.attendance_check_in("worker-1", {"id": "admin-1"})
    assert started["status"] == "present"
    assert started["check_in"] is not None
    assert started["check_out"] is None
    assert started["duration_minutes"] is None

    with pytest.raises(HTTPException) as duplicate_open:
        await attendance_routes.attendance_check_in("worker-1", {"id": "admin-1"})
    assert duplicate_open.value.status_code == 409

    finished = await attendance_routes.attendance_check_out("worker-1", {"id": "admin-1"})
    assert finished["check_out"] is not None
    assert finished["duration_minutes"] is not None
    assert finished["duration_review_required"] is False

    with pytest.raises(HTTPException) as duplicate_day:
        await attendance_routes.attendance_check_in("worker-1", {"id": "admin-1"})
    assert duplicate_day.value.status_code == 409


@pytest.mark.asyncio
async def test_checkout_without_checkin_and_inactive_checkin_are_rejected(monkeypatch):
    from types import SimpleNamespace
    from routers import attendance as attendance_routes
    from fastapi import HTTPException

    collection = FakeAttendanceCollection()

    async def find_active_worker(query, projection=None):
        return {"id": "worker-1", "full_name": "Worker One", "active": True}

    async def find_inactive_worker(query, projection=None):
        return {"id": "worker-2", "full_name": "Worker Two", "active": False}

    users = SimpleNamespace(find_one=find_active_worker)
    monkeypatch.setattr(attendance_routes, "db", SimpleNamespace(attendance=collection, users=users))

    with pytest.raises(HTTPException) as no_checkin:
        await attendance_routes.attendance_check_out("worker-1", {"id": "admin-1"})
    assert no_checkin.value.status_code == 409

    users.find_one = find_inactive_worker
    with pytest.raises(HTTPException) as inactive:
        await attendance_routes.attendance_check_in("worker-2", {"id": "admin-1"})
    assert inactive.value.status_code == 409


@pytest.mark.asyncio
async def test_absence_requires_manager_action_and_cannot_duplicate(monkeypatch):
    from types import SimpleNamespace
    from routers import attendance as attendance_routes
    from fastapi import HTTPException

    collection = FakeAttendanceCollection()

    async def find_worker(query, projection=None):
        return {"id": "worker-1", "full_name": "Worker One", "active": True}

    users = SimpleNamespace(find_one=find_worker)
    monkeypatch.setattr(attendance_routes, "db", SimpleNamespace(attendance=collection, users=users))

    today = attendance_routes._local_today()
    absent = await attendance_routes.attendance_mark_absent(
        "worker-1", attendance_routes.AbsenceIn(day=today), {"id": "admin-1"}
    )
    assert absent["status"] == "absent"
    assert absent["duration_minutes"] is None

    with pytest.raises(HTTPException) as duplicate:
        await attendance_routes.attendance_mark_absent(
            "worker-1", attendance_routes.AbsenceIn(day=today), {"id": "admin-1"}
        )
    assert duplicate.value.status_code == 409
