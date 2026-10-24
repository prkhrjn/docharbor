from __future__ import annotations

import logging
from copy import deepcopy
from datetime import date, timedelta
from pathlib import Path

from homeassistant.components.http import StaticPathConfig
from homeassistant.components.lovelace.resources import ResourceStorageCollection
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers.event import async_track_time_change
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator

from .const import DOMAIN, PLATFORMS
from .expiry import directory_type
from .services import _register_services
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


async def _async_update_configured_area(
    hass: HomeAssistant,
    entry: ConfigEntry,
    previous_area_id: str | None,
) -> None:
    """Apply an explicit area-option change to the integration device.

    Entity areas and user-assigned device names are owned by the user and are
    therefore deliberately left untouched.
    """
    area_id = entry.options.get("area_id") or None
    device_registry = dr.async_get(hass)

    if previous_area_id == area_id:
        return

    devices = dr.async_entries_for_config_entry(
        device_registry,
        entry.entry_id,
    )

    for device in devices:
        if device.area_id != area_id:
            device_registry.async_update_device(
                device.id,
                area_id=area_id,
            )

    _LOGGER.debug(
        "Updated configured area to %s for directory %s (%d devices)",
        area_id,
        entry.entry_id,
        len(devices),
    )


async def async_update_options(
    hass: HomeAssistant,
    entry: ConfigEntry,
) -> None:
    """Apply directory setting changes."""
    instance = hass.data.get(DOMAIN, {}).get(entry.entry_id)

    previous_type = (
        instance.get("directory_type") if instance else _get_directory_type(entry)
    )
    current_type = _get_directory_type(entry)

    previous_area_id = instance.get("area_id") if instance else None
    await _async_update_configured_area(hass, entry, previous_area_id)

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
        instance["area_id"] = entry.options.get("area_id") or None

        coordinator = instance.get("coordinator")
        if coordinator:
            coordinator.async_set_updated_data(deepcopy(coordinator.data))


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

    card_url = "/docharbor/docharbor-card.js"

    existing_urls = {
        item.get("url", "").split("?")[0] for item in resources.async_items()
    }

    if card_url in existing_urls:
        _LOGGER.info(
            "DocHarbor dashboard resource already exists; "
            "skipping automatic registration"
        )
        return

    await resources.async_create_item(
        {
            "res_type": "module",
            "url": card_url,
        }
    )

    _LOGGER.info("DocHarbor dashboard resource registered automatically")


async def async_setup(
    hass: HomeAssistant,
    config: dict,
) -> bool:
    """Set up the integration domain."""
    hass.data.setdefault(DOMAIN, {})
    _register_services(hass)

    card_path = Path(__file__).parent / "frontend" / "docharbor-card.js"
    if not card_path.is_file():
        _LOGGER.error("DocHarbor dashboard card is missing: %s", card_path)
        return False

    await hass.http.async_register_static_paths(
        [
            StaticPathConfig(
                "/docharbor/docharbor-card.js",
                str(card_path),
                cache_headers=False,
            )
        ]
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
        "area_id": entry.options.get("area_id") or None,
    }

    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = instance

    from .notifications import create_notification_handlers

    async_daily_reminder, run_reminder_now, send_test_notification = (
        create_notification_handlers(hass, entry, data, store)
    )

    from .documents import create_document_handlers

    (
        add_document,
        update_document,
        remove_document,
        add_category,
        remove_category,
        set_sailing_dates,
        get_document_details,
    ) = create_document_handlers(hass, entry, data, persist, instance, coordinator)

    services = {
        "set_schedule_dates": set_sailing_dates,
        "add_document": add_document,
        "update_document": update_document,
        "remove_document": remove_document,
        "set_sailing_dates": set_sailing_dates,
        "add_category": add_category,
        "remove_category": remove_category,
        "send_test_notification": send_test_notification,
        "run_reminder_now": run_reminder_now,
        "get_document_details": get_document_details,
    }

    instance["service_handlers"] = {
        service_name: handler for service_name, handler in services.items()
    }

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    entry.async_on_unload(entry.add_update_listener(async_update_options))

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

    return unload_ok
