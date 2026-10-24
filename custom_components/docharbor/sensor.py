from __future__ import annotations

from datetime import date

from homeassistant.components.sensor import SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN
from .expiry import directory_type, evaluate, local_today


def days_remaining(expiry_date: str) -> int:
    return (date.fromisoformat(expiry_date) - local_today()).days


def get_directory_type(entry: ConfigEntry) -> str:
    return directory_type(entry)


def get_suggested_area(coordinator, entry: ConfigEntry) -> str | None:
    """Return the configured area name for a newly created device only."""
    area_id = entry.options.get("area_id")
    if not area_id:
        return None

    area = ar.async_get(coordinator.hass).async_get_area(area_id)
    return area.name if area else None


def get_status(doc: dict, data: dict, directory_type: str = "general") -> str:
    return evaluate(doc, data, directory_type)["status"]


class DocumentDaysSensor(CoordinatorEntity, SensorEntity):
    """Sensor for a document's remaining validity."""

    _attr_native_unit_of_measurement = "days"

    def __init__(
        self,
        coordinator,
        entry: ConfigEntry,
        document_id: str,
    ) -> None:
        super().__init__(coordinator)

        self._directory_type = get_directory_type(entry)
        self.document_id = document_id
        self._directory_id = entry.entry_id
        self._entry = entry

        # Keep existing entity IDs stable.
        self._attr_unique_id = f"{entry.entry_id}_{document_id}_days"

        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry.entry_id)},
            name=entry.title,
            suggested_area=get_suggested_area(coordinator, entry),
            manufacturer="Custom",
            model=(
                "Schedule-Based Directory"
                if self._directory_type in ("schedule_based", "seafarer")
                else "General Directory"
            ),
        )

    @property
    def document(self):
        return next(
            (
                item
                for item in self.coordinator.data["documents"]
                if item["id"] == self.document_id
            ),
            None,
        )

    @property
    def name(self):
        doc = self.document

        return doc["name"] if doc else "Removed Document"

    @property
    def available(self):
        return self.document is not None

    @property
    def native_value(self):
        doc = self.document

        return days_remaining(doc["expiry_date"]) if doc else None

    @property
    def icon(self):
        doc = self.document

        if not doc:
            return "mdi:file-question-outline"

        # Prefer the icon saved from the dashboard.
        selected_icon = doc.get("icon")
        if isinstance(selected_icon, str) and selected_icon.strip():
            return selected_icon.strip()

        # Backward-compatible fallback for older documents.
        status = get_status(
            doc,
            self.coordinator.data,
            self._directory_type,
        )

        icons = {
            "expired": "mdi:alert-circle",
            "urgent": "mdi:calendar-alert",
            "renewal_due": "mdi:certificate-outline",
            "expires_during_schedule": "mdi:calendar-alert",
            "valid": "mdi:card-account-details-outline",
        }

        return icons.get(
            status,
            "mdi:card-account-details-outline",
        )

    @property
    def extra_state_attributes(self):
        doc = self.document

        if not doc:
            return {}

        data = self.coordinator.data
        days = days_remaining(doc["expiry_date"])
        lead = int(doc.get("renewal_lead_days", 90))
        buffer_days = int(data.get("buffer_days", 14))

        joining_text = (
            data["start_date"] if "start_date" in data else data.get("joining_date")
        )
        signoff_text = (
            data["end_date"] if "end_date" in data else data.get("signoff_date")
        )

        result = evaluate(doc, data, self._directory_type)
        expires_during_sailing = result["expires_during_schedule"]
        expires_before_joining = result["expires_before_schedule"]
        renew_before_joining = result["renew_before_schedule"]
        status = result["status"]

        return {
            # Directory metadata for the custom frontend card.
            "directory_id": self._directory_id,
            "directory_name": self._entry.title,
            # Existing document attributes.
            "document_id": doc["id"],
            "icon": doc.get("icon") or "mdi:file-document-outline",
            "name": doc["name"],
            "issue_date": doc.get("issue_date"),
            "category": doc.get("category", "Other"),
            "expiry_date": doc["expiry_date"],
            "days_remaining": days,
            "renewal_lead_days": lead,
            "status": status,
            "start_date": joining_text,
            "joining_date": joining_text,
            "end_date": signoff_text,
            "expected_signoff_date": signoff_text,
            "expires_during_schedule": expires_during_sailing,
            "expires_during_sailing": expires_during_sailing,
            "expires_before_schedule": expires_before_joining,
            "expires_before_joining": expires_before_joining,
            "renew_before_schedule": renew_before_joining,
            "renew_before_joining": renew_before_joining,
            "planning_buffer_days": buffer_days,
        }


class DocumentsSummarySensor(CoordinatorEntity, SensorEntity):
    """Summary of documents requiring attention."""

    _attr_name = "Documents Needing Attention"
    _attr_icon = "mdi:clipboard-alert-outline"
    _attr_native_unit_of_measurement = "documents"

    def __init__(
        self,
        coordinator,
        entry: ConfigEntry,
    ) -> None:
        super().__init__(coordinator)

        self._directory_type = get_directory_type(entry)
        self._instance_id = entry.entry_id
        self._entry = entry

        # Keep the existing summary sensor unique ID stable.
        self._attr_unique_id = f"{entry.entry_id}_attention"

        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry.entry_id)},
            name=entry.title,
            suggested_area=get_suggested_area(coordinator, entry),
            manufacturer="Custom",
            model=(
                "Schedule-Based Directory"
                if self._directory_type in ("schedule_based", "seafarer")
                else "General Directory"
            ),
        )

    @property
    def attention_documents(self):
        """Return documents that need attention."""
        data = self.coordinator.data
        attention = []

        for doc in data["documents"]:
            status = get_status(doc, data, self._directory_type)

            if status != "valid":
                attention.append(doc)

        return attention

    @property
    def native_value(self):
        return len(self.attention_documents)

    @property
    def extra_state_attributes(self):
        data = self.coordinator.data
        documents = data["documents"]

        return {
            # Directory metadata for the custom frontend card.
            "directory_id": self._instance_id,
            "directory_name": self._entry.title,
            "directory_type": self._directory_type,
            # Preserve the existing summary attributes.
            "instance_id": self._instance_id,
            "total_documents": len(documents),
            "expired_documents": sum(
                days_remaining(doc["expiry_date"]) < 0 for doc in documents
            ),
            "expiring_within_30_days": sum(
                0 <= days_remaining(doc["expiry_date"]) <= 30 for doc in documents
            ),
            "documents_needing_attention": [
                {
                    "name": doc["name"],
                    "issue_date": doc.get("issue_date"),
                    "expiry_date": doc["expiry_date"],
                    "category": doc.get("category", "Other"),
                    "days_remaining": days_remaining(doc["expiry_date"]),
                    "status": get_status(doc, data, self._directory_type),
                }
                for doc in self.attention_documents
            ],
            "categories": data.get("categories", []),
            "joining_date": data.get("joining_date"),
            "expected_signoff_date": data.get("signoff_date"),
            "buffer_days": data.get("buffer_days", 14),
        }


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up document sensors."""
    instance = hass.data[DOMAIN][entry.entry_id]
    coordinator = instance["coordinator"]

    instance["add_entities"] = async_add_entities

    entities = [DocumentsSummarySensor(coordinator, entry)]

    entities.extend(
        DocumentDaysSensor(coordinator, entry, doc["id"])
        for doc in coordinator.data["documents"]
    )

    async_add_entities(entities)
