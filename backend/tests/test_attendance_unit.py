from datetime import datetime
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from routers import attendance


class FakeCursor:
    def __init__(self, rows):
        self.rows = list(rows)

    def sort(self, key, direction):
        self.rows.sort(key=lambda row: row.get(key, ""), reverse=direction < 0)
        return self

    async def to_list(self, _length):
        return list(self.rows)


class FakeUsers:
    def __init__(self, rows):
        self.rows = rows

    def find(self, query, projection=None):
        assert query == {"role": "worker", "active": True}
        return FakeCursor(self.rows)

    async def find_one(self, query, projection=None):
        return next((row.copy() for row in self.rows if all(row.get(key) == value for key, value in query.items())), None)


class DuplicateKeyError(Exception):
    code = 11000


class FakeAttendance:
    def __init__(self, rows=None):
        self.rows = list(rows or [])
        self.last_update_options = None

    def find(self, query, projection=None):
        return FakeCursor([row.copy() for row in self.rows if row.get("attendance_date") == query["attendance_date"]])

    async def insert_one(self, record):
        if any(row["worker_id"] == record["worker_id"] and row["attendance_date"] == record["attendance_date"] for row in self.rows):
            raise DuplicateKeyError("duplicate attendance")
        self.rows.append(record.copy())
        return SimpleNamespace(inserted_id="attendance-id")

    async def find_one_and_update(self, query, update, **kwargs):
        self.last_update_options = kwargs
        for row in self.rows:
            if row.get("worker_id") == query["worker_id"] and row.get("attendance_date") == query["attendance_date"] and row.get("check_in") and not row.get("check_out"):
                row.update(update["$set"])
                return row.copy()
        return None

    async def find_one(self, query, projection=None):
        return next((row.copy() for row in self.rows if row.get("worker_id") == query["worker_id"] and row.get("attendance_date") == query["attendance_date"]), None)


def fixed_now():
    return datetime.fromisoformat("2026-11-20T08:35:00+01:00")


@pytest.mark.asyncio
async def test_today_attendance_lists_active_workers_and_status(monkeypatch):
    workers = [
        {"id": "worker-1", "full_name": "Worker One", "username": "one"},
        {"id": "worker-2", "full_name": "Worker Two", "username": "two"},
    ]
    attendance_rows = [
        {"worker_id": "worker-1", "attendance_date": "2026-11-20", "check_in": "07:55", "check_out": None},
        {"worker_id": "worker-2", "attendance_date": "2026-11-20", "check_in": "07:30", "check_out": "08:20"},
    ]
    monkeypatch.setattr(attendance, "_now", fixed_now)
    monkeypatch.setattr(attendance, "db", SimpleNamespace(users=FakeUsers(workers), worker_attendance=FakeAttendance(attendance_rows)))

    result = await attendance.get_today_attendance()

    assert result["attendance_date"] == "2026-11-20"
    assert [row["status"] for row in result["workers"]] == ["present", "completed"]
    assert result["workers"][0]["attendance"]["check_in"] == "07:55"


@pytest.mark.asyncio
async def test_check_in_records_tunis_local_time_and_duplicate_is_conflict(monkeypatch):
    users = FakeUsers([{"id": "worker-1", "full_name": "Worker One"}])
    records = FakeAttendance()
    monkeypatch.setattr(attendance, "_now", fixed_now)
    monkeypatch.setattr(attendance, "db", SimpleNamespace(users=users, worker_attendance=records))

    result = await attendance.check_in_worker("worker-1")
    assert result["attendance_date"] == "2026-11-20"
    assert result["check_in"] == "08:35"
    assert result["worker_name"] == "Worker One"

    with pytest.raises(HTTPException) as exc:
        await attendance.check_in_worker("worker-1")
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_check_out_updates_existing_open_check_in(monkeypatch):
    users = FakeUsers([{"id": "worker-1", "full_name": "Worker One"}])
    records = FakeAttendance([{
        "worker_id": "worker-1",
        "attendance_date": "2026-11-20",
        "check_in": "07:45",
        "check_out": None,
    }])
    monkeypatch.setattr(attendance, "_now", fixed_now)
    monkeypatch.setattr(attendance, "db", SimpleNamespace(users=users, worker_attendance=records))

    result = await attendance.check_out_worker("worker-1")

    assert result["check_in"] == "07:45"
    assert result["check_out"] == "08:35"
    assert records.last_update_options["return_document"] is True


@pytest.mark.asyncio
async def test_check_out_without_check_in_returns_conflict(monkeypatch):
    monkeypatch.setattr(attendance, "_now", fixed_now)
    monkeypatch.setattr(attendance, "db", SimpleNamespace(worker_attendance=FakeAttendance()))

    with pytest.raises(HTTPException) as exc:
        await attendance.check_out_worker("worker-1")
    assert exc.value.status_code == 409
