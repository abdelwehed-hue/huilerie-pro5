import pytest
from fastapi import HTTPException

from lib import attendance_auth


@pytest.mark.asyncio
async def test_attendance_is_unavailable_when_public_auth_bypass_is_enabled(monkeypatch):
    monkeypatch.setenv("AUTH_DISABLED", "true")

    with pytest.raises(HTTPException) as exc:
        await attendance_auth.require_attendance_admin(None)

    assert exc.value.status_code == 503
    assert exc.value.detail == "attendance_requires_authentication"


@pytest.mark.asyncio
async def test_attendance_accepts_authenticated_admin_when_public_mode_is_disabled(monkeypatch):
    monkeypatch.setenv("AUTH_DISABLED", "false")

    async def authenticated_admin(_request):
        return {"id": "admin-1", "role": "admin"}

    monkeypatch.setattr(attendance_auth, "current_user", authenticated_admin)

    assert await attendance_auth.require_attendance_admin(None) == {
        "id": "admin-1",
        "role": "admin",
    }


@pytest.mark.asyncio
async def test_attendance_rejects_authenticated_non_admin(monkeypatch):
    monkeypatch.setenv("AUTH_DISABLED", "false")

    async def authenticated_worker(_request):
        return {"id": "worker-1", "role": "worker"}

    monkeypatch.setattr(attendance_auth, "current_user", authenticated_worker)

    with pytest.raises(HTTPException) as exc:
        await attendance_auth.require_attendance_admin(None)

    assert exc.value.status_code == 403
    assert exc.value.detail == "admin_only"
