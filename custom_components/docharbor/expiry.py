"""Single source of truth for renewal/sailing calculations."""
from __future__ import annotations
from datetime import date, timedelta
from homeassistant.util import dt as dt_util


def local_today() -> date:
    return dt_util.now().date()


def directory_type(entry) -> str:
    """Return the canonical directory type, including legacy entries."""
    value = entry.options.get("directory_type")

    if value in ("schedule_based", "seafarer"):
        return "schedule_based"

    if value == "general":
        return "general"

    if entry.title == "Seafarer Documents":
        return "schedule_based"

    return "general"


def evaluate(doc: dict, data: dict, kind: str = "general", today: date | None = None) -> dict:
    today = today or local_today()
    expiry = date.fromisoformat(doc["expiry_date"])
    days = (expiry - today).days
    lead = int(doc.get("renewal_lead_days", 90))
    joining = date.fromisoformat((data["start_date"] if "start_date" in data else data["joining_date"])) if kind in ("schedule_based", "seafarer") and (data.get("start_date") if "start_date" in data else data.get("joining_date")) else None
    signoff = date.fromisoformat((data["end_date"] if "end_date" in data else data["signoff_date"])) if kind in ("schedule_based", "seafarer") and (data.get("end_date") if "end_date" in data else data.get("signoff_date")) else None
    buffer_days = int(data.get("buffer_days", 14))
    before_joining = bool(joining and expiry <= joining)
    during_sailing = bool(joining and signoff and joining <= expiry <= signoff)
    renew_before_joining = bool(joining and expiry <= joining + timedelta(days=buffer_days))
    if days < 0:
        status, reason, priority = "expired", f"EXPIRED by {-days} day(s)", 0
    elif before_joining:
        status, reason, priority = "renewal_due", "Expires before scheduled start", 1
    elif during_sailing:
        status, reason, priority = "expires_during_schedule", "Expires during scheduled period", 2
    elif days <= 30:
        status, reason, priority = "urgent", "Renewal window reached", 3
    elif days <= lead:
        status, reason, priority = "renewal_due", "Renewal window reached", 3
    else:
        status, reason, priority = "valid", None, 4
    return dict(
        days_remaining=days, status=status,
        reason=reason, priority=priority,
        expires_before_schedule=before_joining,
        expires_during_schedule=during_sailing,
        renew_before_schedule=renew_before_joining,
        expires_before_joining=before_joining,
        expires_during_sailing=during_sailing,
        renew_before_joining=renew_before_joining,
        planning_buffer_days=buffer_days,
    )
