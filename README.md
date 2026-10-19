# DocHarbor

A custom Home Assistant integration for managing documents, expiry dates, reminders, and scheduled periods.

## Features

- Create multiple document directories.
- Organize documents into categories.
- Track document expiry dates.
- Manage document details through a dashboard.
- Configure expiry reminders and notification devices.
- Manage scheduled periods in Schedule-Based directories.
- Add the DocHarbor dashboard card directly from Home Assistant's card picker.

## Directory Types

**General:** Track documents, expiry dates, and renewal reminders.

**Schedule-Based:** Track documents alongside planned work, travel,
deployment, or other scheduled periods. DocHarbor can warn when a
document expires before or during a scheduled period.

## Quick Installation

### Install through HACS

[![Open in HACS](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=prkhrjn&repository=docharbor&category=integration)

**GitHub repository:** https://github.com/prkhrjn/docharbor

### Add DocHarbor to Home Assistant

[![Add Integration](https://my.home-assistant.io/badges/config_flow_start.svg)](https://my.home-assistant.io/redirect/config_flow_start/?domain=docharbor)

Install DocHarbor and restart Home Assistant before using the Add Integration button.

## Installation

### HACS (after public release)

1. Open HACS in Home Assistant.
2. Find DocHarbor in the integration catalog.
3. Download the integration.
4. Restart Home Assistant.
5. Go to **Settings > Devices & Services > Add Integration**.
6. Search for **DocHarbor**.
7. Create your first document directory.

Until DocHarbor is listed in HACS, installation will require adding its GitHub repository as a custom repository.

## Add the dashboard card

1. Open a Home Assistant dashboard.
2. Select **Edit Dashboard > Add Card**.
3. Search for **DocHarbor**.
4. Select **DocHarbor Documents**.
5. Add the card.

The dashboard JavaScript resource is registered automatically in storage-mode Lovelace.

### Dashboard card not appearing?

After installing DocHarbor and restarting Home Assistant, refresh
your browser using **Cmd + Shift + R** (Mac) or
**Ctrl + Shift + R** (Windows/Linux).

Then reopen **Edit Dashboard > Add Card** and search for
**DocHarbor Documents**.

If the card still does not appear, check that DocHarbor is loaded
under **Settings > Devices & services**.


## Configuration

Create directories through the DocHarbor integration configuration flow.

Use the dashboard to add and manage documents, configure notifications, and manage available document categories.

## Compatibility

Tested with Home Assistant 2026.10.2.

## Release status

DocHarbor is currently in pre-release testing.

## Privacy and Data Storage

DocHarbor stores document records, scheduled dates, configuration,
and reminder history in Home Assistant's local storage.

The integration does not require a separate DocHarbor cloud account.

### Notifications

- Detailed renewal reminders are created as Home Assistant
  persistent notifications.
- These reminders may include document names, categories,
  identification numbers, issue dates, expiry dates, and
  scheduled start/end dates.
- If mobile notifications are enabled, DocHarbor sends concise
  expiry reminders through the selected Home Assistant mobile
  app notification services.
- Mobile notification delivery may use external push
  infrastructure operated by the configured notification provider.

Users should avoid entering sensitive identification information
unless they are comfortable storing it in Home Assistant and
including it in local reminder notifications.

### Backups

Document records and reminder history are stored within
Home Assistant's configuration storage. Include Home Assistant
configuration data in backups to preserve this information.

## License

DocHarbor is released under the MIT License.

See the [LICENSE](LICENSE) file for the full license text.
