from __future__ import annotations

import logging
import uuid
from datetime import date

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.core import callback
from homeassistant.helpers import selector

from .const import DOMAIN


_LOGGER = logging.getLogger(__name__)


DEFAULT_CATEGORIES = [
    "Medical",
    "STCW",
    "Certificate of Competency",
    "Passport",
    "CDC",
    "Visa",
    "Other",
]


def text_field():
    return selector.TextSelector()


def date_field():
    return selector.DateSelector()


def number_field(minimum, maximum):
    return selector.NumberSelector(
        selector.NumberSelectorConfig(
            min=minimum,
            max=maximum,
            step=1,
            mode=selector.NumberSelectorMode.BOX,
        )
    )


def category_field(categories):
    return selector.SelectSelector(
        selector.SelectSelectorConfig(
            options=[
                {"label": category, "value": category}
                for category in categories
            ],
            mode=selector.SelectSelectorMode.DROPDOWN,
        )
    )


def directory_type_field():
    return selector.SelectSelector(
        selector.SelectSelectorConfig(
            options=[
                {"label": "Schedule-Based", "value": "schedule_based"},
                {"label": "General", "value": "general"},
            ],
            mode=selector.SelectSelectorMode.DROPDOWN,
        )
    )


def area_field():
    return selector.AreaSelector()


class SeafarerDocumentsConfigFlow(
    config_entries.ConfigFlow,
    domain=DOMAIN,
):
    VERSION = 1

    async def async_step_user(self, user_input=None):
        """Create a new DocHarbor integration instance."""
        if user_input is not None:
            name = user_input["instance_name"].strip()

            if not name:
                return self.async_show_form(
                    step_id="user",
                    data_schema=self._user_schema(user_input),
                    errors={"instance_name": "required"},
                )

            directory_type = user_input.get(
                "directory_type", "general"
            )

            return self.async_create_entry(
                title=name,
                data={"instance_name": name},
                options={
                    "directory_type": directory_type,
                    "area_id": user_input.get("area_id"),
                },
            )

        return self.async_show_form(
            step_id="user",
            data_schema=self._user_schema(),
        )

    @staticmethod
    def _user_schema(user_input=None):
        """Schema for creating an integration instance."""
        user_input = user_input or {}

        schema = {
            vol.Required(
                "instance_name",
                default=user_input.get(
                    "instance_name",
                    "Personal Certificates",
                ),
            ): str,
            vol.Required(
                "directory_type",
                default=user_input.get(
                    "directory_type", "general"
                ),
            ): directory_type_field(),
            vol.Optional("area_id"): area_field(),
        }

        if user_input.get("area_id"):
            schema = {
                vol.Required(
                    "instance_name",
                    default=user_input.get(
                        "instance_name",
                        "Personal Certificates",
                    ),
                ): str,
                vol.Required(
                    "directory_type",
                    default=user_input.get(
                        "directory_type", "general"
                    ),
                ): directory_type_field(),
                vol.Optional(
                    "area_id",
                    default=user_input["area_id"],
                ): area_field(),
            }

        return vol.Schema(schema)

    @staticmethod
    @callback
    def async_get_options_flow(config_entry):
        return SeafarerDocumentsOptionsFlow(config_entry)


class SeafarerDocumentsOptionsFlow(config_entries.OptionsFlow):
    """Manage directory settings, documents, categories, and sailing dates."""

    def __init__(self, config_entry):
        self._entry_id = config_entry.entry_id
        self._config_entry = config_entry
        self._selected_document_id = None

    def _directory_type(self):
        """Return the directory type, including a legacy fallback."""
        saved_type = self._config_entry.options.get(
            "directory_type"
        )

        if saved_type in ("seafarer", "schedule_based"):
            return "schedule_based"
        if saved_type == "general":
            return "general"

        if self._config_entry.title == "Seafarer Documents":
            return "schedule_based"

        return "general"

    def _create_options_entry(self, updates=None):
        """Preserve existing options when saving integration options."""
        options = dict(self._config_entry.options)
        options.update(updates or {})
        options.setdefault(
            "directory_type", self._directory_type()
        )

        return self.async_create_entry(
            title="",
            data=options,
        )

    def _instance(self):
        return self.hass.data.get(DOMAIN, {}).get(
            self._entry_id, {}
        )

    def _data(self):
        instance = self._instance()
        data = instance.get("data", {})
        data.setdefault(
            "categories", DEFAULT_CATEGORIES.copy()
        )
        data.setdefault("documents", [])
        return data

    def _documents(self):
        return self._data().get("documents", [])

    def _categories(self):
        return self._data().get(
            "categories", DEFAULT_CATEGORIES
        )

    def _document_options(self):
        return [
            {
                "label": (
                    f"{doc['name']} — {doc['expiry_date']}"
                ),
                "value": doc["id"],
            }
            for doc in self._documents()
        ]

    def _category_options(self):
        return [
            {"label": name, "value": name}
            for name in self._categories()
        ]

    async def _save_data(self):
        instance = self._instance()
        persist = instance.get("persist")

        if not persist:
            raise vol.Invalid(
                "Unable to save DocHarbor data."
            )

        await persist()

    async def _call_service(self, service, values):
        """Update only the selected integration instance."""
        instance = self._instance()

        if not instance:
            raise vol.Invalid(
                "The selected DocHarbor instance "
                "was not found."
            )

        data = self._data()
        values = dict(values)

        def normalize_date(value):
            if not value:
                return None

            if isinstance(value, date):
                return value.isoformat()

            return date.fromisoformat(
                str(value)[:10]
            ).isoformat()

        def validate_document_dates(issue_date, expiry_date):
            if not issue_date or not expiry_date:
                return

            issue = date.fromisoformat(str(issue_date)[:10])
            expiry = date.fromisoformat(str(expiry_date)[:10])

            if issue > expiry:
                raise vol.Invalid(
                    "Issue Date cannot be after Expiry Date."
                )

        if service == "add_document":
            name = values["name"].strip()

            if not name:
                raise vol.Invalid(
                    "Document name cannot be empty."
                )
            issue_date = normalize_date(
                values.get("issue_date")
            )
            expiry_date = normalize_date(
                values["expiry_date"]
            )

            validate_document_dates(
                issue_date, expiry_date
            )
            document = {
                "id": str(uuid.uuid4()),
                "name": name,
                "uin": values.get("uin", "").strip(),
                "issue_date": issue_date,
                "expiry_date": expiry_date,
                "category": values.get("category", "Other"),
                "renewal_lead_days": int(
                    values.get("renewal_lead_days", 180)
                ),
                "notes": values.get("notes", ""),
            }

            data["documents"].append(document)
            await self._save_data()

            add_entities = instance.get("add_entities")
            if add_entities:
                from .sensor import DocumentDaysSensor

                add_entities([
                    DocumentDaysSensor(
                        instance["coordinator"],
                        self._config_entry,
                        document["id"],
                    )
                ])

        elif service == "update_document":
            document_id = values.pop("document_id")

            document = next(
                (
                    item for item in data["documents"]
                    if item["id"] == document_id
                ),
                None,
            )

            if document is None:
                raise vol.Invalid("Document not found.")

            proposed = dict(document)
            issue_date = normalize_date(values.get("issue_date", proposed.get("issue_date")))
            expiry_date = normalize_date(values.get("expiry_date", proposed.get("expiry_date")))
            validate_document_dates(issue_date, expiry_date)
            for key in ("name", "uin", "category", "renewal_lead_days", "notes"):
                if key in values:
                    proposed[key] = values[key]
            if not str(proposed["name"]).strip():
                raise vol.Invalid("Document name cannot be empty")
            proposed["issue_date"] = issue_date
            proposed["expiry_date"] = expiry_date
            document.clear()
            document.update(proposed)

            await self._save_data()

        elif service == "remove_document":
            document_id = values["document_id"]
            old_count = len(data["documents"])

            data["documents"] = [
                item for item in data["documents"]
                if item["id"] != document_id
            ]

            if len(data["documents"]) == old_count:
                raise vol.Invalid("Document not found.")

            await self._save_data()

            await self.hass.config_entries.async_reload(
                self._entry_id
            )

        elif service == "set_sailing_dates":
            joining = data.get("joining_date")
            signoff = data.get("signoff_date")

            if "joining_date" in values:
                joining = normalize_date(
                    values["joining_date"]
                )

            if "signoff_date" in values:
                signoff = normalize_date(
                    values["signoff_date"]
                )

            if joining and signoff and signoff < joining:
                raise vol.Invalid(
                    "Sign-off date must be on or after "
                    "joining date."
                )

            data["joining_date"] = joining
            data["signoff_date"] = signoff

            if "buffer_days" in values:
                data["buffer_days"] = int(
                    values["buffer_days"]
                )

            await self._save_data()

        else:
            raise vol.Invalid(
                f"Unsupported operation: {service}"
            )

    async def async_step_init(self, user_input=None):
        """Show available integration settings."""
        menu_options = [
            "directory_settings",
            "add_document",
            "edit_select",
            "remove_document",
            "manage_categories",
            "notification_devices",
        ]

        if self._directory_type() == "schedule_based":
            menu_options.append("sailing_dates")

        return self.async_show_menu(
            step_id="init",
            menu_options=menu_options,
        )

    async def async_step_directory_settings(
        self, user_input=None
    ):
        """Edit the existing directory name and area."""
        current_name = self._config_entry.title
        current_area = self._config_entry.options.get(
            "area_id"
        )
        current_type = self._directory_type()

        if user_input is not None:
            name = user_input["instance_name"].strip()

            if not name:
                return self.async_show_form(
                    step_id="directory_settings",
                    data_schema=self._directory_settings_schema(
                                    current_name, current_area, current_type
                                ),
                    errors={"instance_name": "required"},
                )

            options = dict(self._config_entry.options)
            options["directory_type"] = user_input.get(
                "directory_type", current_type
            )
            options["area_id"] = user_input.get("area_id")

            self.hass.config_entries.async_update_entry(
                self._config_entry,
                title=name,
            )

            return self.async_create_entry(
                title="",
                data=options,
            )

        return self.async_show_form(
            step_id="directory_settings",
            data_schema=self._directory_settings_schema(
                            current_name, current_area, current_type
                        )
        )

    
    @staticmethod
    def _directory_settings_schema(
        current_name, current_area, current_type
    ):
        """Build the directory settings form."""
        schema = {
            vol.Required(
                "instance_name",
                default=current_name,
            ): text_field(),
            vol.Required(
                "directory_type",
                default=current_type,
            ): directory_type_field(),
        }

        if current_area:
            schema[
                vol.Optional("area_id", default=current_area)
            ] = area_field()
        else:
            schema[vol.Optional("area_id")] = area_field()

        return vol.Schema(schema)

    
    async def async_step_add_document(self, user_input=None):
        """Add a document and display validation errors in the form."""
        categories = self._categories()
        if "Other" not in categories:
            categories = categories + ["Other"]

        schema = vol.Schema({
            vol.Required("name"): text_field(),
            vol.Optional("uin", default=""): text_field(),
            vol.Optional("issue_date"): date_field(),
            vol.Required("expiry_date"): date_field(),
            vol.Required(
                "category", default="Other"
            ): category_field(categories),
            vol.Required(
                "renewal_lead_days", default=180
            ): number_field(0, 730),
            vol.Optional(
                "notes", default=""
            ): text_field(),
        })

        if user_input is not None:
            try:
                await self._call_service(
                    "add_document", user_input
                )
            except vol.Invalid as err:
                _LOGGER.warning(
                    "Unable to add document: %s", err
                )
                return self.async_show_form(
                    step_id="add_document",
                    data_schema=schema,
                    errors={"base": "invalid_date_range"},
                )

            return self._create_options_entry()

        return self.async_show_form(
            step_id="add_document",
            data_schema=schema,
        )


    async def async_step_edit_select(self, user_input=None):
        options = self._document_options()

        if not options:
            return self.async_abort(
                reason="no_documents_to_edit"
            )

        if user_input is not None:
            self._selected_document_id = user_input[
                "document_id"
            ]
            return await self.async_step_edit_document()

        return self.async_show_form(
            step_id="edit_select",
            data_schema=vol.Schema({
                vol.Required("document_id"): selector.SelectSelector(
                    selector.SelectSelectorConfig(
                        options=options,
                        mode=selector.SelectSelectorMode.DROPDOWN,
                    )
                )
            }),
        )

    
    async def async_step_edit_document(self, user_input=None):
        """Edit a document and display validation errors in the form."""
        document = next(
            (
                doc for doc in self._documents()
                if doc["id"] == self._selected_document_id
            ),
            None,
        )

        if document is None:
            return self.async_abort(
                reason="document_not_found"
            )

        categories = self._categories()
        current_category = document.get(
            "category", "Other"
        )

        if current_category not in categories:
            categories = categories + [current_category]

        schema = vol.Schema({
            vol.Required(
                "name", default=document["name"]
            ): text_field(),
            vol.Optional(
                "uin", default=document.get("uin", "")
            ): text_field(),
            vol.Optional(
                "issue_date",
                default=document.get("issue_date"),
            ): date_field(),
            vol.Required(
                "expiry_date",
                default=document["expiry_date"],
            ): date_field(),
            vol.Required(
                "category", default=current_category
            ): category_field(categories),
            vol.Required(
                "renewal_lead_days",
                default=int(
                    document.get("renewal_lead_days", 180)
                ),
            ): number_field(0, 730),
            vol.Optional(
                "notes", default=document.get("notes", "")
            ): text_field(),
        })

        if user_input is not None:
            user_input["document_id"] = document["id"]

            try:
                await self._call_service(
                    "update_document", user_input
                )
            except vol.Invalid as err:
                _LOGGER.warning(
                    "Unable to update document: %s", err
                )
                return self.async_show_form(
                    step_id="edit_document",
                    data_schema=schema,
                    errors={"base": "invalid_date_range"},
                )

            return self._create_options_entry()

        return self.async_show_form(
            step_id="edit_document",
            data_schema=schema,
        )


    async def async_step_remove_document(self, user_input=None):
        options = self._document_options()

        if not options:
            return self.async_abort(
                reason="no_documents_to_remove"
            )

        if user_input is not None:
            await self._call_service(
                "remove_document", user_input
            )

            return self._create_options_entry()

        return self.async_show_form(
            step_id="remove_document",
            data_schema=vol.Schema({
                vol.Required("document_id"): selector.SelectSelector(
                    selector.SelectSelectorConfig(
                        options=options,
                        mode=selector.SelectSelectorMode.DROPDOWN,
                    )
                )
            }),
        )

    async def async_step_manage_categories(
        self, user_input=None
    ):
        return self.async_show_menu(
            step_id="manage_categories",
            menu_options=[
                "add_category",
                "rename_category",
                "remove_category",
            ],
        )

    async def async_step_add_category(self, user_input=None):
        if user_input is not None:
            name = user_input["name"].strip()

            if name and name.casefold() not in {
                category.casefold()
                for category in self._categories()
            }:
                self._categories().append(name)
                await self._save_data()

            return self._create_options_entry()

        return self.async_show_form(
            step_id="add_category",
            data_schema=vol.Schema({
                vol.Required("name"): text_field(),
            }),
        )

    async def async_step_rename_category(
        self, user_input=None
    ):
        categories = self._categories()

        if user_input is not None:
            old_name = user_input["category"]
            new_name = user_input["new_name"].strip()

            if (
                new_name
                and new_name.casefold() not in {
                    category.casefold()
                    for category in categories
                    if category != old_name
                }
            ):
                index = categories.index(old_name)
                categories[index] = new_name

                for document in self._documents():
                    if document.get("category") == old_name:
                        document["category"] = new_name

                await self._save_data()

            return self._create_options_entry()

        if not categories:
            return self.async_abort(
                reason="no_categories"
            )

        return self.async_show_form(
            step_id="rename_category",
            data_schema=vol.Schema({
                vol.Required(
                    "category"
                ): category_field(categories),
                vol.Required("new_name"): text_field(),
            }),
        )

    async def async_step_remove_category(
        self, user_input=None
    ):
        categories = self._categories()

        if user_input is not None:
            category = user_input["category"]

            if category == "Other":
                return self.async_abort(
                    reason="cannot_remove_other"
                )

            in_use = any(
                document.get("category") == category
                for document in self._documents()
            )

            if in_use:
                return self.async_abort(
                    reason="category_in_use"
                )

            if category in categories:
                categories.remove(category)
                await self._save_data()

            return self._create_options_entry()

        removable = [
            category for category in categories
            if category != "Other"
        ]

        if not removable:
            return self.async_abort(
                reason="no_categories_to_remove"
            )

        return self.async_show_form(
            step_id="remove_category",
            data_schema=vol.Schema({
                vol.Required(
                    "category"
                ): category_field(removable),
            }),
        )

    async def async_step_sailing_dates(
        self, user_input=None
    ):
        if self._directory_type() != "schedule_based":
            return self.async_abort(
                reason="sailing_dates_unavailable"
            )

        data = self._data()

        if user_input is not None:
            await self._call_service(
                "set_sailing_dates", user_input
            )

            return self._create_options_entry()

        schema = {
            vol.Optional(
                "joining_date",
                default=data.get("joining_date"),
            ): date_field(),
            vol.Optional(
                "signoff_date",
                default=data.get("signoff_date"),
            ): date_field(),
            vol.Required(
                "buffer_days",
                default=int(data.get("buffer_days", 14)),
            ): number_field(0, 180),
        }

        return self.async_show_form(
            step_id="sailing_dates",
            data_schema=vol.Schema(schema),
        )

    async def async_step_notification_devices(
        self, user_input=None
    ):
        """Select mobile app devices for push reminders."""
        if user_input is not None:
            return self._create_options_entry({
                "notify_services": user_input.get(
                    "notify_services", []
                ),
            })

        services = self.hass.services.async_services().get(
            "notify", {}
        )

        options = [
            {
                "label": service_name.removeprefix(
                    "mobile_app_"
                ).replace("_", " ").title(),
                "value": service_name,
            }
            for service_name in sorted(services)
            if service_name.startswith("mobile_app_")
        ]

        current = list(
            self._config_entry.options.get(
                "notify_services", []
            )
        )

        known_values = {
            option["value"] for option in options
        }

        for service_name in current:
            if service_name not in known_values:
                options.append({
                    "label": service_name.replace(
                        "_", " "
                    ).title(),
                    "value": service_name,
                })

        schema = vol.Schema({
            vol.Optional(
                "notify_services",
                default=current,
            ): selector.SelectSelector(
                selector.SelectSelectorConfig(
                    options=options,
                    multiple=True,
                    mode=selector.SelectSelectorMode.LIST,
                )
            ),
        })

        return self.async_show_form(
            step_id="notification_devices",
            data_schema=schema,
        )