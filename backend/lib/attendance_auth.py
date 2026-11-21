"""Authentication guard for attendance endpoints.

The application's temporary public mode intentionally bypasses normal login.
Attendance contains employee records and must never inherit that bypass.
"""
import os

from fastapi import HTTPException, Request

from lib.auth import current_user


async def require_attendance_admin(request: Request) -> dict:
    if os.environ.get("AUTH_DISABLED", "false").strip().lower() in {"1", "true", "yes", "on"}:
        raise HTTPException(503, "attendance_requires_authentication")
    user = await current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(403, "admin_only")
    return user
