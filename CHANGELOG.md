# Changelog

## [1.0.0] - 2026-11-07

### Added
- Configurable notification navigation path through the integration options.
- Navigation support for live and scheduled notifications, including Android notification tap actions.
- Expanded card appearance customization for summary tiles and toggle controls.
- Additional styling targets for directory management and the schedule planner.

### Improved
- Home Assistant theme-aware styling across the dashboard card, forms, dialogs, selectors, buttons and document details.
- Document privacy: sensitive document details, including document numbers and notes, are excluded from entity state and attributes and retrieved through a response-only action when needed.
- Notification privacy by removing document UINs from notification digests.
- Notification navigation path validation to reject invalid or external paths.
- Preservation of user-defined device names and areas.

### Changed
- Directory areas can be selected during directory creation but are no longer editable through Directory Settings.
- Refined notification and dashboard interactions.

## [0.2.1] - HACS Catalog Preparation

### Added
- Automated HACS integration validation.
- Automated Home Assistant Hassfest validation.
- HACS repository metadata.

### Improved
- Public HACS installation instructions and release documentation.
- Integration manifest metadata and formatting.
- Translation formatting for Hassfest compatibility.

### Compatibility
- No changes to document management or dashboard card functionality.


## [0.2.0] - 2026-10-20

### Added
- Native Home Assistant Lovelace visual card editor.
- Appearance customization for seven component groups.
- Individual button styling controls.
- Active HA Theme, preset, and custom CSS value options.
- Live card appearance preview.
- Editable card alert messages.

### Improved
- Clean, theme-aware card and document tile styling.
- Form inputs and buttons follow Home Assistant theme colors.
- Cancel button readability across document, directory, and notification dialogs.
- Custom styling support for DocHarbor dialog content.

### Changed
- Removed "Renew before scheduled start" from document tile warnings.

### Preserved
- Native Home Assistant adaptive dialogs.
- Existing roller and expand/collapse animations.
- Existing button dimensions and interaction behavior.
- Document management, scheduling, and notification functionality.
