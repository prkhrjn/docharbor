"""Scheduled and manual notification delivery. No notifications on data persistence."""
from __future__ import annotations
import logging
from datetime import date
from homeassistant.core import ServiceCall
from homeassistant.exceptions import HomeAssistantError
from homeassistant.util import dt as dt_util
from .expiry import evaluate, directory_type as _get_directory_type, local_today

_LOGGER = logging.getLogger(__name__)

def format_date(value: str) -> str:
    return date.fromisoformat(value).strftime("%d/%m/%Y")

def create_notification_handlers(hass, entry, data, store):
    async def async_daily_reminder(
        now=None,
        force=False,
        refresh_only=False,
    ):
        """Send a daily digest or refresh the registry's live status."""
        if refresh_only:
            return
        if (
            not force
            and not refresh_only
            and now is not None
            and now.hour < 9
        ):
            return

        today = local_today()
        today_text = today.isoformat()
        directory_type = _get_directory_type(entry)
        history = data.setdefault("reminder_history", {})

        # A live refresh must still happen if today's digest was sent.
        if (
            not force
            and not refresh_only
            and history.get("last_digest_date") == today_text
        ):
            return

        # Preserve the existing daily delivery retry history.
        delivery = history.get("delivery", {})
        if not isinstance(delivery, dict):
            delivery = {}

        if (
            not refresh_only
            and (
                force
                or delivery.get("date") != today_text
            )
        ):
            delivery = {
                "date": today_text,
                "successful_services": [],
            }
            history["delivery"] = delivery

        if not isinstance(
            delivery.get("successful_services"), list
        ):
            delivery["successful_services"] = []

        joining_text = data.get("joining_date")
        signoff_text = data.get("signoff_date")

        joining = (
            date.fromisoformat(joining_text)
            if joining_text else None
        )
        signoff = (
            date.fromisoformat(signoff_text)
            if signoff_text else None
        )

        attention = []
        for doc in data["documents"]:
            result = evaluate(doc, data, directory_type, today)
            if result["reason"] is None:
                continue
            attention.append({
                "name": doc["name"], "category": doc.get("category", "Other"),
                "uin": doc.get("uin", ""), "issue_date": doc.get("issue_date"),
                "expiry_date": doc["expiry_date"],
                "days_remaining": result["days_remaining"],
                "reason": result["reason"], "priority": result["priority"],
                "icon": doc.get("icon") or "mdi:file-document-outline",
            })

        def attention_priority(item):
            if item["days_remaining"] < 0:
                return 0
            if item["reason"] == "Expires before scheduled start":
                return 1
            if item["reason"] == "Expires during scheduled period":
                return 2
            return 3

        attention.sort(
            key=lambda item: (
                attention_priority(item),
                item["days_remaining"],
            )
        )

        live_tag = f"docharbor_v1_{entry.entry_id}"

        notify_services = entry.options.get(
            "notify_services", []
        )
        if not isinstance(notify_services, list):
            notify_services = []

        selected_services = [
            service_name
            for service_name in notify_services
            if (
                isinstance(service_name, str)
                and service_name.startswith("mobile_app_")
            )
        ]

        available_services = (
            hass.services.async_services().get("notify", {})
        )

        # Nothing needs attention: dismiss the digest and clear the
        # existing tagged Live Activity/Live Update on selected phones.
        if not attention:
            await hass.services.async_call(
                "persistent_notification",
                "dismiss",
                {
                    "notification_id":
                        f"docharbor_daily_{entry.entry_id}",
                },
                blocking=True,
            )

            for service_name in selected_services:
                if service_name not in available_services:
                    continue

                try:
                    await hass.services.async_call(
                        "notify",
                        service_name,
                        {
                            "message": "clear_notification",
                            "data": {"tag": live_tag},
                        },
                        blocking=True,
                    )
                except HomeAssistantError:
                    _LOGGER.exception(
                        "Could not clear Live Activity using %s",
                        service_name,
                    )

            if not refresh_only:
                history["last_digest_date"] = today_text
                await store.async_save(data)

            return

        # Compose a detailed Home Assistant digest and a concise
        # phone Live Activity, preserving the existing delivery logic.
        message_lines = [
            f"{len(attention)} document(s) need attention.",
            "",
        ]

        if directory_type in ("schedule_based", "seafarer"):
            if joining_text:
                message_lines.append(
                    f"Scheduled start date: {format_date(joining_text)}"
                )
            if signoff_text:
                message_lines.append(
                    f"Scheduled end date: {format_date(signoff_text)}"
                )
            if joining_text or signoff_text:
                message_lines.append("")

        for item in attention:
            days = item["days_remaining"]
            expiry_text = format_date(item["expiry_date"])

            if days < 0:
                status = f"EXPIRED {abs(days)} day(s) ago"
                action = "Arrange renewal immediately"
            elif days == 0:
                status = "EXPIRES TODAY"
                action = "Arrange renewal immediately"
            elif days == 1:
                status = "1 day remaining"
                action = "Start the renewal process urgently"
            else:
                status = f"{days} days remaining"

                if item["reason"] == "Expires before scheduled start":
                    action = "Renew before scheduled start"
                elif (
                    item["reason"]
                    == "Expires during scheduled period"
                ):
                    action = "Renew before scheduled start"
                elif days <= 30:
                    action = "Prioritise renewal"
                else:
                    action = "Plan renewal within the renewal window"

            message_lines.append(
                f"{item['name']} ({item['category']})"
            )

            if item.get("uin"):
                message_lines.append(f"  UIN: {item['uin']}")

            if item.get("issue_date"):
                message_lines.append(
                    f"  Issue date: {format_date(item['issue_date'])}"
                )

            message_lines.extend([
                f"  Expiry date: {expiry_text}",
                f"  Status: {status}",
                f"  Reason: {item['reason']}",
                f"  Action: {action}",
                "",
            ])

        message = "\n".join(message_lines).strip()

        title = f"{entry.title} — Renewal Reminder"

        # Keep the same stable tag so phone Live Activities update
        # in place rather than creating a new notification each time.
        most_urgent = attention[0]
        live_title = most_urgent["name"]
        # Use the same days_remaining value calculated by the expiry
        # engine for sensors, reminders and the Live Activity.
        days_remaining = most_urgent["days_remaining"]
        expiry_short = date.fromisoformat(
            most_urgent["expiry_date"]
        ).strftime("%d %b %Y")

        if days_remaining > 0:
            days_text = (
                f"{days_remaining} "
                f"{'Day' if days_remaining == 1 else 'Days'} Left"
            )
        elif days_remaining == 0:
            days_text = "Expires Today"
        else:
            days_expired = abs(days_remaining)
            days_text = (
                f"Expired {days_expired} "
                f"{'Day' if days_expired == 1 else 'Days'} Ago"
            )

        live_message = (
            f"{entry.title} · Expires {expiry_short} · {days_text}"
        )

        # Preserve the detailed digest inside Home Assistant.
        await hass.services.async_call(
            "persistent_notification",
            "create",
            {
                "title": title,
                "message": message,
                "notification_id":
                    f"docharbor_daily_{entry.entry_id}",
            },
            blocking=True,
        )

        successful_services = delivery["successful_services"]

        for service_name in selected_services:
            # On a normal scheduled digest, do not resend to devices
            # whose notification services already accepted the call.
            if (
                not refresh_only
                and service_name in successful_services
            ):
                continue

            if service_name not in available_services:
                _LOGGER.warning(
                    "Reminder pending: notification service %s "
                    "is unavailable for registry %s",
                    service_name,
                    entry.entry_id,
                )
                continue

            try:
                await hass.services.async_call(
                    "notify",
                    service_name,
                    {
                        "title": live_title,
                        "message": live_message,
                        "data": {
                            "tag": live_tag,
                            "live_update": True,
                            "notification_icon": (
                                most_urgent.get("icon")
                                or "mdi:file-document-outline"
                            ),
                            # DocHarbor visual theme. Keep the icon
                            # selected from the most urgent document.
                            "notification_icon_color": "#FF657C",
                            "background_color": "#0B1830D9",
                            "text_color": "#F5F7FF",
                            "color": "#A82945",
                            "critical_text": "Expiring",
                            "critical_text_color": "#A82945",
                            "relevance_score": 0.8,
                            "url": "/dashboard-mushroom/default_view#docs",
                        },
                    },
                    blocking=True,
                )

                if not refresh_only:
                    successful_services.append(service_name)
                    await store.async_save(data)

                _LOGGER.info(
                    "Live reminder accepted by %s for registry %s",
                    service_name,
                    entry.entry_id,
                )

            except HomeAssistantError:
                _LOGGER.exception(
                    "Reminder delivery failed using %s for registry %s",
                    service_name,
                    entry.entry_id,
                )

        # Live refreshes must never modify daily delivery history.
        if refresh_only:
            return

        failed_services = [
            service_name
            for service_name in selected_services
            if service_name not in successful_services
        ]

        if failed_services:
            _LOGGER.warning(
                "Reminder delivery incomplete for registry %s; "
                "pending services: %s",
                entry.entry_id,
                ", ".join(failed_services),
            )
        else:
            history["last_digest_date"] = today_text

        await store.async_save(data)

    async def run_reminder_now(call: ServiceCall):
        """Run the reminder immediately for this registry."""
        await async_daily_reminder(force=True)

    async def send_test_notification(call: ServiceCall):
        """Send a test notification without changing reminder history."""
        title = "DocHarbor — Test Notification"
        message = (
            "Test successful: the DocHarbor integration "
            "is attempting to send notifications to your selected phones."
        )

        await hass.services.async_call(
            "persistent_notification",
            "create",
            {
                "title": title,
                "message": message,
                "notification_id":
                    f"docharbor_test_{entry.entry_id}",
            },
            blocking=True,
        )

        notify_services = entry.options.get("notify_services", [])
        if not isinstance(notify_services, list):
            notify_services = []

        available_services = (
            hass.services.async_services().get("notify", {})
        )

        sent_count = 0

        for service_name in notify_services:
            if (
                not isinstance(service_name, str)
                or not service_name.startswith("mobile_app_")
            ):
                continue

            if service_name not in available_services:
                _LOGGER.warning(
                    "Test notification service %s is unavailable",
                    service_name,
                )
                continue

            try:
                await hass.services.async_call(
                    "notify",
                    service_name,
                    {
                        "title": title,
                        "message": message,
                    },
                    blocking=True,
                )
                sent_count += 1
                _LOGGER.info(
                    "Test notification accepted by %s",
                    service_name,
                )
            except HomeAssistantError:
                _LOGGER.exception(
                    "Test notification failed using %s",
                    service_name,
                )

        _LOGGER.info(
            "Test completed for registry %s; %d mobile service(s) "
            "accepted the call",
            entry.entry_id,
            sent_count,
        )

    return async_daily_reminder, run_reminder_now, send_test_notification
