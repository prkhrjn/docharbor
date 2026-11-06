"""Behavioural tests for configurable notification navigation paths."""

import asyncio
import importlib.util
import sys
import types
from datetime import date
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).parents[1]


class FakeServices:
    def __init__(self):
        self.calls = []

    def async_services(self):
        return {"notify": {"mobile_app_test_phone": object()}}

    async def async_call(self, domain, service, data, blocking=False):
        self.calls.append((domain, service, data, blocking))


class FakeStore:
    async def async_save(self, data):
        pass


def load_notifications(monkeypatch):
    """Load notification handlers with minimal Home Assistant interfaces."""

    homeassistant = types.ModuleType("homeassistant")
    homeassistant.__path__ = []

    core = types.ModuleType("homeassistant.core")
    core.ServiceCall = object

    exceptions = types.ModuleType("homeassistant.exceptions")

    class HomeAssistantError(Exception):
        pass

    exceptions.HomeAssistantError = HomeAssistantError

    package = types.ModuleType("custom_components")
    package.__path__ = []

    integration = types.ModuleType("custom_components.docharbor")
    integration.__path__ = []

    expiry = types.ModuleType("custom_components.docharbor.expiry")
    expiry.directory_type = lambda entry: "general"
    expiry.local_today = lambda: date(2026, 11, 6)
    expiry.evaluate = lambda *args: {
        "reason": "Renewal window reached",
        "days_remaining": 10,
        "priority": 3,
    }

    for name, module in {
        "homeassistant": homeassistant,
        "homeassistant.core": core,
        "homeassistant.exceptions": exceptions,
        "custom_components": package,
        "custom_components.docharbor": integration,
        "custom_components.docharbor.expiry": expiry,
    }.items():
        monkeypatch.setitem(sys.modules, name, module)

    module_name = "custom_components.docharbor.notifications"
    spec = importlib.util.spec_from_file_location(
        module_name,
        ROOT / "custom_components/docharbor/notifications.py",
    )
    module = importlib.util.module_from_spec(spec)
    monkeypatch.setitem(sys.modules, module_name, module)
    assert spec.loader
    spec.loader.exec_module(module)
    return module


def make_handlers(monkeypatch, navigation_path):
    notifications = load_notifications(monkeypatch)

    entry = SimpleNamespace(
        entry_id="test-entry",
        title="Test Registry",
        options={
            "notify_services": ["mobile_app_test_phone"],
            "navigation_path": navigation_path,
        },
    )

    data = {
        "documents": [
            {
                "name": "Passport",
                "category": "Other",
                "expiry_date": "2026-11-16",
                "renewal_lead_days": 30,
            }
        ],
    }

    services = FakeServices()
    hass = SimpleNamespace(services=services)

    handlers = notifications.create_notification_handlers(
        hass, entry, data, FakeStore()
    )
    return handlers, services


@pytest.mark.parametrize("handler_index", [0, 2])
@pytest.mark.parametrize(
    ("configured_path", "expected_path"),
    [
        ("/dashboard-mushroom/default_view", "/dashboard-mushroom/default_view"),
        ("  /dashboard-mushroom/default_view  ", "/dashboard-mushroom/default_view"),
        ("", None),
        ("https://example.com", None),
        ("//example.com/path", None),
        ("dashboard-mushroom/default_view", None),
        (None, None),
        (42, None),
    ],
)
def test_notification_navigation_path(
    monkeypatch, handler_index, configured_path, expected_path
):
    """Only valid local paths are added to notification payloads."""

    handlers, services = make_handlers(monkeypatch, configured_path)

    if handler_index == 0:
        asyncio.run(handlers[0]())
    else:
        asyncio.run(handlers[2](SimpleNamespace()))

    notify_calls = [
        call for call in services.calls if call[0] == "notify"
    ]
    assert len(notify_calls) == 1

    payload = notify_calls[0][2]
    notification_data = payload.get("data", {})

    assert notification_data.get("url") == expected_path
    assert notification_data.get("clickAction") == expected_path

    if handler_index == 2:
        if expected_path is None:
            assert "data" not in payload
