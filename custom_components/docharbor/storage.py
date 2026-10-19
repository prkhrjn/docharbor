"""Per-config-entry persistent storage with legacy key and schema preserved."""
from copy import deepcopy
from homeassistant.helpers.storage import Store
from .const import STORAGE_KEY, STORAGE_VERSION

DEFAULT_CATEGORIES = ["Medical", "STCW", "Certificate of Competency", "Passport", "CDC", "Visa", "Other"]

async def load_directory(hass, entry):
    store = Store(hass, STORAGE_VERSION, f"{STORAGE_KEY}_{entry.entry_id}")
    saved = await store.async_load() or {}
    data = {"documents": saved.get("documents", []),
            "categories": saved.get("categories", DEFAULT_CATEGORIES.copy()),
            "joining_date": saved.get("joining_date"),
                "signoff_date": saved.get("signoff_date"),
                "start_date": saved.get("start_date", saved.get("joining_date")),
                "end_date": saved.get("end_date", saved.get("signoff_date")),
            "buffer_days": saved.get("buffer_days", 14),
            "reminder_history": saved.get("reminder_history", {})}
    return store, data

async def save_directory(store, data, coordinator):
    await store.async_save(data)
    coordinator.async_set_updated_data(deepcopy(data))
