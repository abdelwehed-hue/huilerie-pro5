from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from lib.auth import require_admin
from lib.db import db

router = APIRouter(prefix="/attendance", tags=["attendance"])
LOCAL_TZ = ZoneInfo("Africa/Tunis")


def _now():
    return datetime.now(LOCAL_TZ)


class AttendanceDateInput(BaseModel):
    attendance_date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")


@router.get("/today")
async def get_today_attendance(_: dict = Depends(require_admin)):
    today = _now().date().isoformat()
    workers = await db.users.find(
        {"role": "worker", "active": True},
        {"_id": 0, "id": 1, "full_name": 1, "username": 1},
    ).sort("full_name", 1).to_list(1000)
    records = await db.worker_attendance.find(
        {"attendance_date": today}, {"_id": 0}
    ).to_list(2000)
    by_worker = {record["worker_id"]: record for record in records}
    return {
        "attendance_date": today,
        "workers": [
            {
                **worker,
                "attendance": by_worker.get(worker["id"]),
                "status": (
                    "absent" if worker["id"] not in by_worker
                    else "present" if not by_worker[worker["id"]].get("check_out")
                    else "completed"
                ),
            }
            for worker in workers
        ],
    }


@router.post("/{worker_id}/check-in")
async def check_in_worker(worker_id: str, _: dict = Depends(require_admin)):
    worker = await db.users.find_one(
        {"id": worker_id, "role": "worker", "active": True},
        {"_id": 0, "id": 1, "full_name": 1},
    )
    if not worker:
        raise HTTPException(404, "Active worker not found")
    now = _now()
    day = now.date().isoformat()
    record = {
        "worker_id": worker_id,
        "worker_name": worker.get("full_name", ""),
        "attendance_date": day,
        "check_in": now.strftime("%H:%M"),
        "check_out": None,
        "created_at": now.isoformat(),
        "updated_at": now.isoformat(),
    }
    try:
        await db.worker_attendance.insert_one(record)
    except Exception as exc:
        # Duplicate-key means the worker already has an attendance record today.
        if getattr(exc, "code", None) == 11000:
            raise HTTPException(409, "Attendance already recorded for this worker today")
        raise
    record.pop("_id", None)
    return record


@router.post("/{worker_id}/check-out")
async def check_out_worker(worker_id: str, _: dict = Depends(require_admin)):
    now = _now()
    day = now.date().isoformat()
    record = await db.worker_attendance.find_one_and_update(
        {
            "worker_id": worker_id,
            "attendance_date": day,
            "check_in": {"$exists": True, "$ne": None},
            "$or": [{"check_out": None}, {"check_out": {"$exists": False}}],
        },
        {"$set": {"check_out": now.strftime("%H:%M"), "updated_at": now.isoformat()}},
        return_document=True,
        projection={"_id": 0},
    )
    if not record:
        existing = await db.worker_attendance.find_one(
            {"worker_id": worker_id, "attendance_date": day}, {"_id": 0}
        )
        if not existing:
            raise HTTPException(409, "Worker has no check-in record today")
        raise HTTPException(409, "Worker check-out was already recorded today")
    return record
