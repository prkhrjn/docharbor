"""Regression coverage for the review fixes without a running HA instance."""

from __future__ import annotations

import asyncio
import importlib.util
import sys
import types
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).parents[1]


def _load_documents_module():
    """Load document handlers with just the HA interfaces they use mocked."""
    homeassistant = types.ModuleType("homeassistant")
    core = types.ModuleType("homeassistant.core")
    exceptions = types.ModuleType("homeassistant.exceptions")
    core.ServiceCall = object

    class HomeAssistantError(Exception):
        pass

    exceptions.HomeAssistantError = HomeAssistantError
    sys.modules.update(
        {
            "homeassistant": homeassistant,
            "homeassistant.core": core,
            "homeassistant.exceptions": exceptions,
        }
    )

    package = types.ModuleType("custom_components")
    integration = types.ModuleType("custom_components.docharbor")
    expiry = types.ModuleType("custom_components.docharbor.expiry")
    expiry.directory_type = lambda entry: "general"
    sys.modules.update(
        {
            "custom_components": package,
            "custom_components.docharbor": integration,
            "custom_components.docharbor.expiry": expiry,
        }
    )

    module_name = "custom_components.docharbor.documents"
    spec = importlib.util.spec_from_file_location(
        module_name,
        ROOT / "custom_components/docharbor/documents.py",
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    assert spec.loader
    spec.loader.exec_module(module)
    return module


def test_document_details_are_response_only_and_include_sensitive_values():
    """The dashboard can retrieve private fields without state persistence."""
    documents = _load_documents_module()
    data = {
        "categories": ["Other"],
        "documents": [
            {
                "id": "passport",
                "name": "Passport",
                "uin": "A1234567",
                "notes": "Issued by Example Authority",
                "expiry_date": "2030-01-01",
                "category": "Other",
                "renewal_lead_days": 180,
            }
        ],
    }
    handlers = documents.create_document_handlers(
        SimpleNamespace(config_entries=SimpleNamespace()),
        SimpleNamespace(entry_id="entry"),
        data,
        lambda: None,
        {"add_entities": None},
        None,
    )

    response = asyncio.run(
        handlers[-1](SimpleNamespace(data={"document_id": "passport"}))
    )

    assert response["document"]["uin"] == "A1234567"
    assert response["document"]["notes"] == "Issued by Example Authority"
    assert data["documents"][0]["uin"] == "A1234567"


def test_sensitive_fields_are_not_sensor_attributes():
    source = (ROOT / "custom_components/docharbor/sensor.py").read_text()
    attrs = source.split("def extra_state_attributes", 1)[1]
    assert '"uin": doc.get' not in attrs
    assert '"notes": doc.get' not in attrs


def test_response_service_and_card_use_the_response_contract():
    service_source = (ROOT / "custom_components/docharbor/services.py").read_text()
    card_source = (
        ROOT / "custom_components/docharbor/frontend/docharbor-card.js"
    ).read_text()

    assert "get_document_details" in service_source
    assert "SupportsResponse.ONLY" in service_source
    assert "get_document_details" in card_source
    assert "result?.response?.document" in card_source
    assert "attrs.uin" not in card_source
    assert "attrs.notes" not in card_source
    assert "normalize(fields.uin)" not in card_source


def test_setup_preserves_user_device_names_and_entity_areas():
    source = (ROOT / "custom_components/docharbor/__init__.py").read_text()
    assert "name_by_user" not in source
    assert "entity_registry" not in source
    assert "_async_apply_area" not in source
    assert "_async_update_configured_area" in source
    assert "if previous_area_id == area_id:" in source
    assert 'instance["area_id"] = entry.options.get("area_id") or None' in source

    sensor_source = (ROOT / "custom_components/docharbor/sensor.py").read_text()
    assert "suggested_area=get_suggested_area" in sensor_source
    assert "name=entry.title" in sensor_source


def test_notification_has_no_hard_coded_dashboard_destination():
    source = (ROOT / "custom_components/docharbor/notifications.py").read_text()
    assert "/dashboard-mushroom/default_view#docs" not in source

def test_notification_digest_never_includes_document_uin():
    """Routine notification text must not expose document numbers."""
    source = (ROOT / "custom_components/docharbor/notifications.py").read_text()

    assert '"uin": doc.get' not in source
    assert 'item["uin"]' not in source
    assert "UIN:" not in source
    # Keep useful renewal details in the digest.
    assert "message_lines.append(f\"{item['name']} ({item['category']})\")" in source
    assert "Issue date: {format_date(item['issue_date'])}" in source
    assert "Expiry date: {expiry_text}" in source

def test_area_selection_is_only_available_when_creating_a_directory():
    """Existing directory settings must not expose area reassignment."""
    source = (ROOT / "custom_components/docharbor/config_flow.py").read_text()

    creation_schema = source.split(
        "def _user_schema(user_input=None):", 1
    )[1].split(
        "@staticmethod", 1
    )[0]
    directory_settings = source.split(
        "async def async_step_directory_settings(", 1
    )[1].split(
        "async def async_step_add_document(", 1
    )[0]

    assert 'vol.Optional("area_id")' in creation_schema
    assert '"area_id"' not in directory_settings
    assert "area_field()" not in directory_settings
    assert "options = dict(self._config_entry.options)" in directory_settings

