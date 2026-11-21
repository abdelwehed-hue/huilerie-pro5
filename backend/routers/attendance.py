"""Administrator-managed employee attendance.

All business dates use Africa/Tunis. Timestamps are stored as UTC-aware datetimes.
A shift belongs to the local calendar date on which check-in was recorded; a shift
may finish after midnight and its full elapsed duration is attributed to that day.
"""
import uuid
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from lib.auth import require_admin
from lib.db import db

router = APIRouter(tags=["attendance"])
TUNIS_TZ = ZoneInfo("Africa/Tunis")


class AbsenceIn(BaseModel):
    day: date


def _local_today() -> date:
    return datetime.now(TUNIS_TZ).date()


def _parse_range(start_date: str, end_date: str) -> tuple[date, date]:
    try:
        start = date.fromisoformat(start_date)
        end = date.fromisoformat(end_date)
    except ValueError:
        raise HTTPException(422, "invalid_date_format_use_YYYY_MM_DD")
    if end < start:
        raise HTTPException(422, "end_date_before_start_date")
    if (end - start).days > 400:
        raise HTTPException(422, "date_range_too_large")
    return start, end


def _minutes_between(check_in: datetime, check_out: datetime | None) -> int | None:
    if check_out is None:
        return None
    if check_in.tzinfo is None:
        check_in = check_in.replace(tzinfo=timezone.utc)
    if check_out.tzinfo is None:
        check_out = check_out.replace(tzinfo=timezone.utc)
    seconds = (check_out - check_in).total_seconds()
    if seconds <= 0 or seconds > 24 * 60 * 60:
        return None
    return int(seconds // 60)


def _record_out(doc: dict) -> dict:
    check_in = doc.get("check_in")
    check_out = doc.get("check_out")
    minutes = _minutes_between(check_in, check_out) if check_in and check_out else None
    return {
        "id": doc["id"],
        "worker_id": doc["worker_id"],
        "worker_name": doc["worker_name"],
        "day": doc["day"],
        "status": doc["status"],
        "check_in": check_in,
        "check_out": check_out,
        "duration_minutes": minutes,
        "created_at": doc["created_at"],
        "updated_at": doc["updated_at"],
    }


async def _worker(worker_id: str) -> dict:
    worker = await db.users.find_one(
        {"id": worker_id, "role": "worker"},
        {"_id": 0, "id": 1, "full_name": 1, "active": 1},
    )
    if not worker:
        raise HTTPException(404, "worker_not_found")
    return worker


@router.get("/attendance")
async def attendance_register(
    start_date: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$"),
    end_date: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$"),
    _: dict = Depends(require_admin),
):
    start, end = _parse_range(start_date, end_date)
    workers = await db.users.find(
        {"role": "worker"},
        {"_id": 0, "id": 1, "full_name": 1, "active": 1},
    ).sort([("active", -1), ("full_name", 1)]).to_list(1000)
    records = await db.attendance.find(
        {"day": {"$gte": start.isoformat(), "$lte": end.isoformat()}},
        {"_id": 0},
    ).sort([("day", 1), ("worker_name", 1)]).to_list(10000)
    return {
        "timezone": "Africa/Tunis",
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "workers": workers,
        "records": [_record_out(record) for record in records],
    }


@router.post("/attendance/{worker_id}/check-in")
async def attendance_check_in(worker_id: str, admin: dict = Depends(require_admin)):
    worker = await _worker(worker_id)
    now = datetime.now(timezone.utc)
    local_day = now.astimezone(TUNIS_TZ).date().isoformat()
    doc = {
        "id": str(uuid.uuid4()),
        "worker_id": worker_id,
        "worker_name": worker["full_name"],
        "day": local_day,
        "status": "present",
        "check_in": now,
        "check_out": None,
        "created_by": admin.get("id"),
        "updated_by": admin.get("id"),
        "created_at": now,
        "updated_at": now,
    }
    try:
        await db.attendance.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(409, "attendance_record_already_exists_for_today")
    return _record_out(doc)


@router.post("/attendance/{worker_id}/check-out")
async def attendance_check_out(worker_id: str, admin: dict = Depends(require_admin)):
    await _worker(worker_id)
    now = datetime.now(timezone.utc)
    local_day = now.astimezone(TUNIS_TZ).date().isoformat()
    current = await db.attendance.find_one(
        {"worker_id": worker_id, "day": local_day, "status": "present"},
        {"_id": 0, "check_in": 1},
    )
    if not current:
        raise HTTPException(409, "check_in_required_before_check_out")
    minutes = _minutes_between(current["check_in"], now)
    if minutes is None:
        raise HTTPException(409, "invalid_shift_duration")
    updated = await db.attendance.find_one_and_update(
        {"worker_id": worker_id, "day": local_day, "status": "present", "check_out": None},
        {"$set": {"check_out": now, "updated_at": now, "updated_by": admin.get("id")}},
        projection={"_id": 0},
        return_document=ReturnDocument.AFTER,
    )
    if not updated:
        raise HTTPException(409, "check_out_already_recorded")
    return _record_out(updated)


@router.post("/attendance/{worker_id}/absence")
async def attendance_mark_absent(
    worker_id: str,
    body: AbsenceIn,
    admin: dict = Depends(require_admin),
):
    worker = await _worker(worker_id)
    if body.day > _local_today():
        raise HTTPException(422, "cannot_mark_future_absence")
    day = body.day.isoformat()
    now = datetime.now(timezone.utc)
    doc = {
        "id": str(uuid.uuid4()),
        "worker_id": worker_id,
        "worker_name": worker["full_name"],
        "day": day,
        "status": "absent",
        "check_in": None,
        "check_out": None,
        "created_by": admin.get("id"),
        "updated_by": admin.get("id"),
        "created_at": now,
        "updated_at": now,
    }
    try:
        await db.attendance.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(409, "attendance_record_already_exists_for_day")
    return _record_out(doc)
