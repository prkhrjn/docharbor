"""Document, category and sailing operations for one directory."""
from __future__ import annotations
import uuid
from datetime import date
import voluptuous as vol
from homeassistant.core import ServiceCall
from homeassistant.exceptions import HomeAssistantError
from .expiry import directory_type as _get_directory_type

def _parse_date(value: str) -> str:
    return date.fromisoformat(value).isoformat()

def create_document_handlers(hass, entry, data, persist, instance, coordinator):
    async def add_document(call: ServiceCall):
        name = call.data["name"].strip()
        if not name:
            raise vol.Invalid("Document name cannot be empty")

        category = call.data["category"].strip()
        if not any(
            existing.strip().casefold() == category.casefold()
            for existing in data["categories"]
        ):
            raise vol.Invalid("Selected category does not exist")

        expiry = _parse_date(call.data["expiry_date"])
        issue_date = (
            _parse_date(call.data["issue_date"])
            if call.data.get("issue_date")
            else None
        )

        if issue_date and expiry < issue_date:
            raise HomeAssistantError(
                "Issue Date cannot be after Expiry Date"
            )

        document = {
            "id": str(uuid.uuid4()),
            "name": name,
            "uin": call.data.get("uin", "").strip(),
            "issue_date": issue_date,
            "expiry_date": expiry,
            "category": category,
            "renewal_lead_days": call.data["renewal_lead_days"],
            "notes": call.data["notes"],
            "icon": (
                call.data.get("icon", "").strip()
                or "mdi:file-document-outline"
            ),
        }

        data["documents"].append(document)
        await persist()

        add_entities = instance["add_entities"]
        if add_entities:
            from .sensor import DocumentDaysSensor

            add_entities([
                DocumentDaysSensor(
                    coordinator, entry, document["id"]
                )
            ])

    async def add_category(call: ServiceCall):
        name = call.data["name"].strip()
        if not name:
            raise vol.Invalid("Category name cannot be empty")

        categories = data["categories"]

        if any(
            existing.strip().casefold() == name.casefold()
            for existing in categories
        ):
            raise vol.Invalid("Category already exists")

        categories.append(name)
        categories.sort(key=str.casefold)
        await persist()

    async def update_document(call: ServiceCall):
        document_id = call.data["document_id"]

        document = next(
            (d for d in data["documents"] if d["id"] == document_id),
            None,
        )

        if document is None:
            raise vol.Invalid("Document not found")

        # Calculate the proposed dates before modifying the document.
        new_issue_date = document.get("issue_date")
        new_expiry_date = document["expiry_date"]

        if "issue_date" in call.data:
            new_issue_date = (
                _parse_date(call.data["issue_date"])
                if call.data["issue_date"]
                else None
            )

        if "expiry_date" in call.data:
            new_expiry_date = _parse_date(
                call.data["expiry_date"]
            )

        # Reject invalid date combinations before making any changes.
        if (
            new_issue_date
            and new_expiry_date
            and new_expiry_date < new_issue_date
        ):
            raise HomeAssistantError(
                "Issue Date cannot be after Expiry Date"
            )

        proposed = dict(document)
        for key in ("name", "uin", "category", "renewal_lead_days", "notes", "icon"):
            if key in call.data:
                proposed[key] = call.data[key]
        if not str(proposed["name"]).strip():
            raise vol.Invalid("Document name cannot be empty")
        if not any(str(cat).casefold() == str(proposed.get("category", "Other")).strip().casefold()
                   for cat in data["categories"]):
            raise vol.Invalid("Selected category does not exist")
        proposed["issue_date"] = new_issue_date
        proposed["expiry_date"] = new_expiry_date
        document.clear()
        document.update(proposed)

        await persist()

    async def remove_category(call: ServiceCall):
        name = call.data["name"].strip()
        if not name:
            raise vol.Invalid("Category name cannot be empty")

        categories = data["categories"]

        matching_category = next(
            (
                category
                for category in categories
                if category.strip().casefold() == name.casefold()
            ),
            None,
        )

        if matching_category is None:
            raise vol.Invalid("Category does not exist")

        in_use = any(
            str(document.get("category", "Other")).strip().casefold()
            == matching_category.strip().casefold()
            for document in data["documents"]
        )

        if in_use:
            raise vol.Invalid(
                "This category is in use by one or more documents. "
                "Move those documents to another category before deleting it."
            )

        if matching_category.strip().casefold() == "other":
            raise vol.Invalid("The Other category cannot be deleted")

        categories.remove(matching_category)
        await persist()

    async def remove_document(call: ServiceCall):
        document_id = call.data["document_id"]
        old_count = len(data["documents"])

        data["documents"] = [
            d for d in data["documents"]
            if d["id"] != document_id
        ]

        if len(data["documents"]) == old_count:
            raise vol.Invalid("Document not found")

        await persist()
        await hass.config_entries.async_reload(entry.entry_id)

    async def set_sailing_dates(call: ServiceCall):
        if _get_directory_type(entry) not in ("schedule_based", "seafarer"):
            raise vol.Invalid(
                "Schedule dates are available only for Schedule-Based directories."
            )

        joining = data.get("start_date", data.get("joining_date"))
        signoff = data.get("end_date", data.get("signoff_date"))

        if call.data.get("clear_start_date") or call.data.get("clear_joining_date"):
            joining = None
        elif "start_date" in call.data:
            joining = (_parse_date(call.data["start_date"])
                       if call.data["start_date"] else None)
        elif "joining_date" in call.data:
            joining = (_parse_date(call.data["joining_date"])
                       if call.data["joining_date"] else None)

        if call.data.get("clear_end_date") or call.data.get("clear_signoff_date"):
            signoff = None
        elif "end_date" in call.data:
            signoff = (_parse_date(call.data["end_date"])
                       if call.data["end_date"] else None)
        elif "signoff_date" in call.data:
            signoff = (_parse_date(call.data["signoff_date"])
                       if call.data["signoff_date"] else None)

        if joining and signoff and signoff < joining:
            raise vol.Invalid(
                "Scheduled end date must be on or after scheduled start date"
            )

        data["start_date"] = joining
        data["end_date"] = signoff
        # Keep legacy fields synchronized during migration.
        data["joining_date"] = joining
        data["signoff_date"] = signoff

        if "buffer_days" in call.data:
            data["buffer_days"] = call.data["buffer_days"]

        await persist()

    return add_document, update_document, remove_document, add_category, remove_category, set_sailing_dates
