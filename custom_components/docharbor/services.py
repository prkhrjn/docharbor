"""Home Assistant service schemas and routing."""

from types import SimpleNamespace

import voluptuous as vol
from homeassistant.core import HomeAssistant, ServiceCall, SupportsResponse
from homeassistant.helpers import config_validation as cv

from .const import DOMAIN

ADD_SCHEMA = vol.Schema(
    {
        vol.Required("name"): cv.string,
        vol.Optional("uin", default=""): cv.string,
        vol.Optional("issue_date", default=""): cv.string,
        vol.Required("expiry_date"): cv.string,
        vol.Optional("category", default="Other"): cv.string,
        vol.Optional("renewal_lead_days", default=180): vol.All(
            vol.Coerce(int), vol.Range(min=0, max=730)
        ),
        vol.Optional("notes", default=""): cv.string,
        vol.Optional("icon", default="mdi:file-document-outline"): cv.string,
    }
)

ADD_CATEGORY_SCHEMA = vol.Schema(
    {
        vol.Required("name"): cv.string,
    }
)

REMOVE_CATEGORY_SCHEMA = vol.Schema(
    {
        vol.Required("name"): cv.string,
    }
)

UPDATE_SCHEMA = vol.Schema(
    {
        vol.Required("document_id"): cv.string,
        vol.Optional("name"): cv.string,
        vol.Optional("uin"): cv.string,
        vol.Optional("issue_date"): cv.string,
        vol.Optional("expiry_date"): cv.string,
        vol.Optional("category"): cv.string,
        vol.Optional("renewal_lead_days"): vol.All(
            vol.Coerce(int), vol.Range(min=0, max=730)
        ),
        vol.Optional("notes"): cv.string,
        vol.Optional("icon"): cv.string,
    }
)

REMOVE_SCHEMA = vol.Schema(
    {
        vol.Required("document_id"): cv.string,
    }
)

SCHEDULE_SCHEMA = vol.Schema(
    {
        vol.Optional("start_date"): cv.string,
        vol.Optional("end_date"): cv.string,
        vol.Optional("clear_start_date", default=False): cv.boolean,
        vol.Optional("clear_end_date", default=False): cv.boolean,
        vol.Optional("buffer_days"): vol.All(
            vol.Coerce(int), vol.Range(min=0, max=180)
        ),
    }
)

SAILING_SCHEMA = vol.Schema(
    {
        vol.Optional("joining_date"): cv.string,
        vol.Optional("signoff_date"): cv.string,
        vol.Optional("clear_joining_date", default=False): cv.boolean,
        vol.Optional("clear_signoff_date", default=False): cv.boolean,
        vol.Optional("buffer_days"): vol.All(
            vol.Coerce(int), vol.Range(min=0, max=180)
        ),
    }
)

TEST_NOTIFICATION_SCHEMA = vol.Schema({})
RUN_REMINDER_SCHEMA = vol.Schema({})
GET_DOCUMENT_DETAILS_SCHEMA = vol.Schema(
    {
        vol.Required("document_id"): cv.string,
    }
)


def _service_schema_with_registry(
    hass: HomeAssistant,
    service_schema: vol.Schema,
) -> vol.Schema:
    """Require a registry ID and validate service data."""
    return vol.Schema(
        {
            vol.Required("directory"): cv.string,
            **service_schema.schema,
        },
        extra=vol.ALLOW_EXTRA,
    )


def _make_service_dispatcher(
    hass: HomeAssistant,
    service_name: str,
    service_schema: vol.Schema,
):
    """Route a service call to the selected registry."""

    async def dispatch_service(call: ServiceCall):
        instance_id = call.data.get("directory")
        target = hass.data.get(DOMAIN, {}).get(instance_id)

        if target is None:
            raise vol.Invalid(f"DocHarbor registry not found: {instance_id}")

        handler = target.get("service_handlers", {}).get(service_name)

        if handler is None:
            raise vol.Invalid(f"Handler unavailable: {service_name}")

        payload = {key: value for key, value in call.data.items() if key != "directory"}

        validated = service_schema(payload)
        return await handler(SimpleNamespace(data=validated))

    return dispatch_service


def _register_services(hass: HomeAssistant) -> None:
    """Register shared services for all loaded registries."""
    schemas = {
        "add_document": ADD_SCHEMA,
        "update_document": UPDATE_SCHEMA,
        "remove_document": REMOVE_SCHEMA,
        "set_sailing_dates": SAILING_SCHEMA,
        "set_schedule_dates": SCHEDULE_SCHEMA,
        "add_category": ADD_CATEGORY_SCHEMA,
        "remove_category": REMOVE_CATEGORY_SCHEMA,
        "send_test_notification": TEST_NOTIFICATION_SCHEMA,
        "run_reminder_now": RUN_REMINDER_SCHEMA,
        "get_document_details": GET_DOCUMENT_DETAILS_SCHEMA,
    }

    for service_name, service_schema in schemas.items():
        if hass.services.has_service(DOMAIN, service_name):
            hass.services.async_remove(DOMAIN, service_name)

        registration_kwargs = {}
        if service_name == "get_document_details":
            registration_kwargs["supports_response"] = SupportsResponse.ONLY

        hass.services.async_register(
            DOMAIN,
            service_name,
            _make_service_dispatcher(hass, service_name, service_schema),
            schema=_service_schema_with_registry(hass, service_schema),
            **registration_kwargs,
        )
