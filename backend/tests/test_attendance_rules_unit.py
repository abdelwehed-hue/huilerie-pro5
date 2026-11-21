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
