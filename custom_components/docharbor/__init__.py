
from __future__ import annotations

from datetime import date, timedelta
import logging
from copy import deepcopy

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator
from homeassistant.helpers.event import async_track_time_change
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers import device_registry as dr
from homeassistant.exceptions import HomeAssistantError

from pathlib import Path
from homeassistant.components.http import StaticPathConfig

from homeassistant.components.lovelace.resources import ResourceStorageCollection
from .const import DOMAIN, PLATFORMS
from .services import (ADD_SCHEMA, UPDATE_SCHEMA, REMOVE_SCHEMA, SCHEDULE_SCHEMA, SAILING_SCHEMA, ADD_CATEGORY_SCHEMA, REMOVE_CATEGORY_SCHEMA, TEST_NOTIFICATION_SCHEMA, RUN_REMINDER_SCHEMA, _register_services)
from .expiry import evaluate, directory_type, local_today
from .storage import load_directory, save_directory

_LOGGER = logging.getLogger(__name__)

def _parse_date(value: str) -> str:
    """Validate and normalize an ISO date."""
    return date.fromisoformat(value).isoformat()


def format_date(value: str) -> str:
    """Format an ISO date for user-facing notifications."""
    return date.fromisoformat(value).strftime("%d/%m/%Y")


def _get_directory_type(entry: ConfigEntry) -> str:
    return directory_type(entry)


async def _async_apply_area(
    hass: HomeAssistant,
    entry: ConfigEntry,
) -> None:
    """Assign the configured area to the device and its entities."""
    area_id = entry.options.get("area_id") or None

    entity_registry = er.async_get(hass)
    device_registry = dr.async_get(hass)

    # Assign the area to the integration device.
    devices = dr.async_entries_for_config_entry(
        device_registry,
        entry.entry_id,
    )

    for device in devices:
        changes = {}

        if device.area_id != area_id:
            changes["area_id"] = area_id

        if device.name_by_user != entry.title:
            changes["name_by_user"] = entry.title

        if changes:
            device_registry.async_update_device(
                device.id,
                **changes,
            )

    # Also assign the area directly to every entity.
    entities = er.async_entries_for_config_entry(
        entity_registry,
        entry.entry_id,
    )

    for entity in entities:
        if entity.area_id != area_id:
            entity_registry.async_update_entity(
                entity.entity_id,
                area_id=area_id,
            )

    _LOGGER.debug(
        "Applied area %s to directory %s (%d devices, %d entities)",
        area_id,
        entry.entry_id,
        len(devices),
        len(entities),
    )



async def async_update_options(
    hass: HomeAssistant,
    entry: ConfigEntry,
) -> None:
    """Apply directory setting changes."""
    instance = hass.data.get(DOMAIN, {}).get(entry.entry_id)

    previous_type = (
        instance.get("directory_type")
        if instance
        else _get_directory_type(entry)
    )
    current_type = _get_directory_type(entry)

    # Apply the latest area and directory name immediately.
    await _async_apply_area(hass, entry)

    # Sensors cache directory_type, so recreate them if it changed.
    if previous_type != current_type:
        _LOGGER.info(
            "Directory type changed from %s to %s; reloading %s",
            previous_type,
            current_type,
            entry.title,
        )
        await hass.config_entries.async_reload(entry.entry_id)
        return

    if instance:
        instance["directory_type"] = current_type

        coordinator = instance.get("coordinator")
        if coordinator:
            coordinator.async_set_updated_data(
                deepcopy(coordinator.data)
            )



async def _async_register_dashboard_resource(hass: HomeAssistant) -> None:
    """Register the DocHarbor dashboard card in storage-mode Lovelace."""
    lovelace_data = hass.data.get("lovelace")
    if lovelace_data is None:
        _LOGGER.warning("DocHarbor: Lovelace is not available")
        return

    resources = lovelace_data.resources

    if not isinstance(resources, ResourceStorageCollection):
        _LOGGER.info(
            "DocHarbor: YAML-managed Lovelace resources; "
            "manual resource registration is required"
        )
        return

    await resources._async_ensure_loaded()

    card_url = "/docharbor/seafarer-documents-card.js"

    existing_urls = {
        item.get("url", "").split("?")[0]
        for item in resources.async_items()
    }

    legacy_url = "/local/seafarer-documents-card.js"

    if card_url in existing_urls or legacy_url in existing_urls:
        _LOGGER.info(
            "DocHarbor dashboard resource already exists; "
            "skipping automatic registration"
        )
        return

    await resources.async_create_item({
        "res_type": "module",
        "url": card_url,
    })

    _LOGGER.info("DocHarbor dashboard resource registered automatically")


async def async_setup(
    hass: HomeAssistant,
    config: dict,
) -> bool:
    """Set up the integration domain."""
    hass.data.setdefault(DOMAIN, {})

    card_path = Path(__file__).parent / "frontend" / "seafarer-documents-card.js"
    if not card_path.is_file():
        _LOGGER.error("DocHarbor dashboard card is missing: %s", card_path)
        return False

    await hass.http.async_register_static_paths(
        [StaticPathConfig(
            "/docharbor/seafarer-documents-card.js",
            str(card_path),
            cache_headers=False,
        )]
    )
    await _async_register_dashboard_resource(hass)
    return True


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
) -> bool:
    """Set up one DocHarbor directory."""
    store, data = await load_directory(hass, entry)

    async def async_refresh_data():
        return deepcopy(data)

    coordinator = DataUpdateCoordinator(
        hass,
        _LOGGER,
        name=DOMAIN,
        update_method=async_refresh_data,
        update_interval=timedelta(hours=1),
    )

    await coordinator.async_config_entry_first_refresh()

    async def persist():
        """Save and refresh sensors. Never send mobile notifications on edits."""
        await save_directory(store, data, coordinator)

    instance = {
        "data": data,
        "coordinator": coordinator,
        "persist": persist,
        "add_entities": None,
        "service_handlers": {},
        "directory_type": _get_directory_type(entry),
    }

    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = instance

    from .notifications import create_notification_handlers
    async_daily_reminder, run_reminder_now, send_test_notification = create_notification_handlers(hass, entry, data, store)

    from .documents import create_document_handlers
    add_document, update_document, remove_document, add_category, remove_category, set_sailing_dates = create_document_handlers(hass, entry, data, persist, instance, coordinator)

    services = {
        "set_schedule_dates": (set_sailing_dates, SCHEDULE_SCHEMA),
        "add_document": (add_document, ADD_SCHEMA),
        "update_document": (update_document, UPDATE_SCHEMA),
        "remove_document": (remove_document, REMOVE_SCHEMA),
        "set_sailing_dates": (
            set_sailing_dates,
            SAILING_SCHEMA,
        ),
        "add_category": (add_category, ADD_CATEGORY_SCHEMA),
        "remove_category": (remove_category, REMOVE_CATEGORY_SCHEMA),
        "send_test_notification": (
            send_test_notification,
            TEST_NOTIFICATION_SCHEMA,
        ),
        "run_reminder_now": (
            run_reminder_now,
            RUN_REMINDER_SCHEMA,
        ),
    }

    instance["service_handlers"] = {
        service_name: handler
        for service_name, (handler, _) in services.items()
    }

    _register_services(hass)

    await hass.config_entries.async_forward_entry_setups(
        entry, PLATFORMS
    )

    # Apply the configured area after the entities have been created.
    await _async_apply_area(hass, entry)

    # Reapply area assignment whenever directory options change.
    entry.async_on_unload(
        entry.add_update_listener(async_update_options)
    )

    instance["unsubscribe_reminder"] = async_track_time_change(
        hass,
        async_daily_reminder,
        hour=9,
        minute=[0, 15, 30, 45],
        second=0,
    )

    # Check on startup; the existing daily deduplication is preserved.
    await async_daily_reminder()

    return True


async def async_unload_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
) -> bool:
    """Unload one DocHarbor directory."""
    unload_ok = await hass.config_entries.async_unload_platforms(
        entry,
        PLATFORMS,
    )

    if unload_ok:
        instance = hass.data[DOMAIN].get(entry.entry_id)

        if instance and instance.get("unsubscribe_reminder"):
            instance["unsubscribe_reminder"]()

        hass.data[DOMAIN].pop(entry.entry_id, None)

        if hass.data[DOMAIN]:
            _register_services(hass)
        else:
            for service_name in (
                "add_document",
                "update_document",
                "remove_document",
                "set_sailing_dates",
                "set_schedule_dates",
                "add_category",
                "remove_category",
                "send_test_notification",
                "run_reminder_now",
            ):
                if hass.services.has_service(DOMAIN, service_name):
                    hass.services.async_remove(DOMAIN, service_name)

    return unload_ok
