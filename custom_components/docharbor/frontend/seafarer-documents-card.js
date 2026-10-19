/* DocHarbor migration build: updated production card UI; services and config flow use docharbor. */
class SeafarerDocumentsCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = {};
    this._hass = null;
    this._selectedDirectoryId = null;
    this._initialized = false;
    this._activeDialog = null;
    this._missingDirectorySince = null;
  }
  _getSavedDirectoryId() {
    try {
      return localStorage.getItem(
        "seafarer-documents-card-selected-directory"
      );
    } catch (error) {
      return null;
    }
  }
  _saveDirectoryId(directoryId) {
    try {
      localStorage.setItem(
        "seafarer-documents-card-selected-directory",
        directoryId
      );
    } catch (error) {
      console.warn(
        "Documents: unable to save directory selection",
        error
      );
    }
  }
  setConfig(config) {
    this._config = {
      title: "Documents",
      ...config,
    };
    this._render(true);
  }
  set hass(hass) {
    this._hass = hass;
    if (this._initialized) {
      this._updateContent();
    } else {
      this._render(true);
    }
  }
  get hass() {
    return this._hass;
  }
  getCardSize() {
    return 6;
  }
  _escape(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[char]);
  }
  _formatDate(dateString) {
    if (!dateString) return "—";
    const match = String(dateString).match(
      /^(\d{4})-(\d{2})-(\d{2})/
    );
    if (!match) return dateString;
    const [, year, month, day] = match;
    const date = new Date(
      Number(year),
      Number(month) - 1,
      Number(day)
    );
    if (
      date.getFullYear() !== Number(year) ||
      date.getMonth() !== Number(month) - 1 ||
      date.getDate() !== Number(day)
    ) {
      return dateString;
    }
    const monthName = [
      "Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ][Number(month) - 1];
    return `${day} ${monthName} ${year}`;
  }
  _statusClass(status) {
    const allowed = [
      "valid",
      "urgent",
      "expired",
      "expires_during_schedule",
        "expires_during_sailing",
      "renewal_due",
    ];
    return allowed.includes(status) ? status : "unknown";
  }
  _statusLabel(status) {
    return String(status || "unknown")
      .replace(/_/g, " ")
      .replace(/\b\w/g, letter => letter.toUpperCase());
  }
  _iconFor(document) {
    const category = String(document.category || "").toLowerCase();
    const name = String(document.name || "").toLowerCase();
    if (category.includes("passport") || name.includes("passport")) {
      return "mdi:book-account";
    }
    if (category.includes("visa") || name.includes("visa")) {
      return "mdi:passport";
    }
    if (category.includes("medical") || name.includes("medical")) {
      return "mdi:medical-bag";
    }
    if (category.includes("stcw") || name.includes("stcw")) {
      return "mdi:ship-wheel";
    }
    if (
      category.includes("certificate") ||
      category.includes("competency") ||
      name.includes("coc")
    ) {
      return "mdi:certificate";
    }
    if (name.includes("cdc")) {
      return "mdi:card-account-details";
    }
    return "mdi:file-document-outline";
  }
  _iconStorageKey(directoryId, documentId) {
    return `seafarer-doc-icon:${encodeURIComponent(directoryId)}:${encodeURIComponent(documentId)}`;
  }
  _iconFingerprint(directoryId, fields) {
    const normalize = value =>
      String(value ?? "").trim().toLowerCase();
    return `seafarer-doc-icon-fingerprint:${encodeURIComponent(
      directoryId
    )}:${encodeURIComponent(JSON.stringify([
      normalize(fields.uin),
      normalize(fields.name),
      normalize(fields.category),
      normalize(fields.issueDate ?? fields.issue_date),
      normalize(fields.expiryDate ?? fields.expiry_date),
    ]))}`;
  }
  _getDocumentIcon(document) {
    const sensorIcon = typeof document?.icon === "string"
      ? document.icon.trim() : "";
    if (sensorIcon) return sensorIcon;
    // Earlier integrations did not publish the stored icon as an attribute.
    // Restore the user's custom selection from the browser when available.
    try {
      const directoryId = this._selectedDirectoryId;
      if (directoryId && document?.documentId) {
        const saved = localStorage.getItem(
          this._iconStorageKey(directoryId, document.documentId)
        );
        if (saved) return saved;
      }
      if (directoryId) {
        const fingerprint = localStorage.getItem(
          this._iconFingerprint(directoryId, document)
        );
        if (fingerprint) return fingerprint;
      }
    } catch (error) {
      console.warn("Documents: unable to read saved document icon", error);
    }
    return this._iconFor(document);
  }
  _saveDocumentIcon(directoryId, document, icon) {
    if (!directoryId || !icon) return;
    try {
      if (document.documentId) {
        localStorage.setItem(
          this._iconStorageKey(directoryId, document.documentId),
          icon
        );
      }
      localStorage.setItem(
        this._iconFingerprint(directoryId, document),
        icon
      );
    } catch (error) {
      console.warn("Documents: unable to save document icon", error);
    }
  }
  _iconPickerMarkup(prefix, selectedIcon) {
    const selected = selectedIcon || "mdi:file-document-outline";
    return `
      <div class="form-field icon-picker-field">
        <label>Document icon</label>
        <div class="icon-picker-native">
          <ha-icon-picker class="icon-picker-control" label="Search and select an icon">
          </ha-icon-picker>
        </div>
        <input type="hidden"
          name="${prefix}_icon"
          value="${this._escape(selected)}">
      </div>
    `;
  }
  _attachIconPicker(backdrop, prefix, initialIcon) {
    const hidden = backdrop.querySelector(
      `[name="${prefix}_icon"]`
    );
    const picker = backdrop.querySelector("ha-icon-picker");
    const selected = initialIcon || hidden.value ||
      "mdi:file-document-outline";
    picker.hass = this._hass;
    picker.value = selected;
    picker.addEventListener("value-changed", event => {
      const icon = event.detail?.value;
      if (icon) hidden.value = icon;
    });
    hidden.value = selected;
  }
  _getDirectories(states) {
    const directories = new Map();
    Object.values(states).forEach((entity) => {
      const attributes = entity?.attributes || {};
      const directoryId = attributes.directory_id;
      const directoryName = attributes.directory_name;
      if (!directoryId || !directoryName) return;
      const isSummarySensor = attributes.instance_id === directoryId;
      const existing = directories.get(directoryId);
      if (!existing || isSummarySensor) {
        directories.set(directoryId, {
          id: directoryId,
          name: directoryName,
          type: attributes.directory_type || existing?.type || "general",
        });
      }
    });
    return Array.from(directories.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }
  _getDocuments(states, directoryId) {
    return Object.entries(states)
      .filter(([, entity]) => {
        const attrs = entity.attributes || {};
        return (
          attrs.directory_id === directoryId &&
          typeof attrs.document_id === "string" &&
          typeof attrs.expiry_date === "string" &&
          attrs.days_remaining !== undefined &&
          attrs.days_remaining !== null
        );
      })
      .map(([entityId, entity]) => {
        const attrs = entity.attributes || {};
        const days = Number(attrs.days_remaining);
        return {
          entityId,
          documentId: attrs.document_id,
          name: attrs.name || attrs.friendly_name || entityId,
          icon: attrs.icon || "",
          category: attrs.category || "",
          status: attrs.status || "unknown",
          expiryDate: attrs.expiry_date,
          daysRemaining: Number.isFinite(days) ? days : null,
          uin: attrs.UIN || attrs.uin || "",
          issueDate: attrs.issue_date || "",
          renewalLeadDays:
            attrs.renewal_lead_days != null
              ? Number(attrs.renewal_lead_days)
              : null,
          notes: attrs.notes || "",
          joiningDate: attrs.joining_date || "",
          expectedSignoffDate: attrs.expected_signoff_date || "",
          expiresDuringSailing: attrs.expires_during_schedule === true || attrs.expires_during_sailing === true,
          expiresBeforeJoining: attrs.expires_before_joining === true,
          renewBeforeJoining: attrs.renew_before_joining === true,
        };
      })
      .sort((a, b) =>
        (a.daysRemaining ?? Infinity) -
        (b.daysRemaining ?? Infinity)
      );
  }
  _getCategories(states, directoryId) {
    const categories = new Set();
    let savedCategoriesFound = false;
    Object.values(states || {}).forEach(entity => {
      const attrs = entity.attributes || {};
      if (attrs.directory_id !== directoryId) return;
      // Use the authoritative category list from the summary sensor.
      if (Array.isArray(attrs.categories)) {
        savedCategoriesFound = true;
        attrs.categories.forEach(category => {
          if (typeof category === "string" && category.trim()) {
            categories.add(category.trim());
          }
        });
      }
    });
    // Fallback for cases where the summary sensor has not been found.
    if (!savedCategoriesFound) {
      categories.add("Other");
    }
    if (!categories.has("Other")) {
      categories.add("Other");
    }
    return [...categories].sort((a, b) => {
      if (a === "Other") return 1;
      if (b === "Other") return -1;
      return a.localeCompare(b);
    });
  }
  _render(force = false) {
    if (!this._hass?.states) return;
    if (!this._initialized || force) {
      this.shadowRoot.innerHTML = `

        <style>
          :host {
            display: block;
            color: var(--primary-text-color);
            --sd-tile-background: var(--ha-card-background, var(--card-background-color));
            --sd-tile-radius: 14px;
            --sd-tile-padding: 14px;
            --sd-tile-gap: 12px;
            --sd-status-valid: var(--success-color, #57966b);
            --sd-status-warning: var(--warning-color, #c18a35);
            --sd-status-expired: var(--error-color, #c75b5b);
            --sd-icon-background: var(--secondary-background-color);
          }

          ha-card {
            padding: var(--sd-card-padding, 16px);
            overflow: hidden;
            background: var(--sd-card-background, var(--ha-card-background, var(--card-background-color)));
            color: var(--primary-text-color);
            border-radius: var(--sd-card-radius, var(--ha-card-border-radius, 18px));
            box-shadow: var(--ha-card-glass-inset-shadow);
          }

          .header {
            font-size: 1.2rem;
            font-weight: 600;
            margin-bottom: 16px;
          }

          .selector-label {
            display: block;
            font-size: .85rem;
            color: var(--secondary-text-color);
            margin-bottom: 6px;
          }

          select {
            width: 100%;
            box-sizing: border-box;
            padding: 11px 12px;
            margin-bottom: 14px;
            border: 1px solid var(--divider-color);
            border-radius: 10px;
            background: var(--card-background-color);
            color: var(--primary-text-color);
            font: inherit;
          }

          .directory-toolbar {
            align-items: center;
          }

          .directory-toolbar select,
          .directory-toolbar .toolbar-chip {
            align-self: center;
            margin-top: 0;
            margin-bottom: 0;
          }

          .directory-toolbar .toolbar-chip {
            transform: translateY(-2px);
          }

          .directory-toolbar {
            display: flex;
            align-items: center;
            gap: 8px;
            width: 100%;
            margin-bottom: 12px;
          }

          .directory-toolbar select {
            flex: 1 1 0;
            width: 0;
            min-width: 0;
          }

          .directory-toolbar select {
            box-shadow: var(--ha-card-glass-inset-shadow);
            transition: transform 0.15s ease;
          }

          .directory-toolbar select:active {
            transform: scale(0.96);
            transition: 0s;
          }

          .toolbar-chip {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            flex: 0 0 40px;
            width: 40px;
            min-width: 40px;
            height: 40px;
            padding: 0;
            border: 1px solid rgba(255, 255, 255, 0.16);
            background: rgba(255, 255, 255, 0.08);;
            border-radius: 50%;
            color: var(--primary-text-color);
            cursor: pointer;
            box-shadow: var(--ha-card-glass-inset-shadow);
          }

          .toolbar-chip:active {
            transform: scale(0.96);
            transition: 0s;
          }

          .toolbar-chip ha-icon {
            --mdc-icon-size: 21px;
            display: flex;
            align-items: center;
            justify-content: center;
          }

          .directory-summary {
            color: var(--secondary-text-color);
            font-size: .82rem;
            margin-bottom: 12px;
          }

          .document-list-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            margin: 8px 0 12px;
          }

          .document-list-title {
            font-size: 1rem;
            font-weight: 600;
            color: var(--primary-text-color);
          }

          #toggle-document-list {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            min-height: 36px;
            padding: 6px 10px;
            border: 1px solid rgba(255, 255, 255, 0.15);
            border-radius: 12px;
            background: rgba(22, 27, 38, 0.4);
            color: var(--primary-text-color);
            box-shadow: var(--ha-card-glass-inset-shadow);
            font: inherit;
            font-size: 0.8rem;
            cursor: pointer;
          }

          #toggle-document-list ha-icon {
            --mdc-icon-size: 20px;
          }

          #toggle-document-list:active {
            transform: scale(0.96);
            transition: 0s;
          }

          :host([dark-mode]) #toggle-document-list {
            box-shadow: 0 2px 4px 0 rgba(0, 0, 0, 0.8);
          }

          .roller-window {
            display: inline-block;
            height: 1.2em;
            line-height: 1.2em;
            overflow: hidden;
            vertical-align: middle;
          }

          .roller-track {
            display: flex;
            flex-direction: column;
            transform: translateY(-1.2em);
            transition: transform 600ms ease-in-out;
          }

          .roller-track > span {
            display: block;
            flex: 0 0 1.2em;
            height: 1.2em;
            line-height: 1.2em;
            white-space: nowrap;
          }

          #toggle-document-list[aria-expanded="true"] .roller-track {
            transform: translateY(0);
          }

          #toggle-document-list[aria-expanded="false"] .roller-track {
            transform: translateY(-1.2em);
          }

          @media (prefers-reduced-motion: reduce) {
            .roller-track {
              transition: none;
            }
          }

          #document-list-toggle-icon {
            transition: transform 700ms ease;
          }

          #toggle-document-list[aria-expanded="true"] #document-list-toggle-icon {
            transform: rotate(360deg);
          }

          #toggle-document-list[aria-expanded="false"] #document-list-toggle-icon {
            transform: rotate(0deg);
          }

          #document-list {
            display: grid;
            grid-template-rows: 1fr;
            opacity: 1;
            overflow: hidden;
            transition: grid-template-rows 900ms ease, opacity 1500ms ease, margin 200ms ease;
            margin-top: 0;
          }

          #document-list[hidden] {
            display: grid !important;
            grid-template-rows: 0fr;
            opacity: 0;
            margin-top: 0;
            pointer-events: none;
          }

          #document-list > .document-grid {
            min-height: 0;
            overflow: hidden;
          }

          @media (prefers-reduced-motion: reduce) {
            #document-list {
              transition: none;
            }
          }

          .document-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: var(--sd-tile-gap);
          }

          .document-tile {
            min-width: 0;
            box-sizing: border-box;
            padding: var(--sd-tile-padding);
            border-radius: var(--sd-tile-radius);
            background: var(--sd-tile-background);
            border: 1px solid var(--sd-tile-border, var(--divider-color));
            display: flex;
            flex-direction: column;
            gap: 12px;
            box-shadow: var(--ha-card-glass-inset-shadow);
            transition: 0s;
            cursor: pointer;
          }

          .document-tile:active {
            transform: scale(0.96);
          }

          :host([dark-mode]) .document-tile {
            box-shadow: 0 2px 4px 0 rgba(0, 0, 0, 0.8);
          }

          .tile-top {
            display: flex;
            align-items: flex-start;
            gap: 10px;
            min-width: 0;
          }

          .document-icon {
            width: var(--sd-icon-size, 42px);
            height: var(--sd-icon-size, 42px);
            flex: 0 0 var(--sd-icon-size, 42px);
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: var(--sd-icon-radius, 12px);
            background: none;
            color: var(--primary-text-color);
          }

          .document-icon ha-icon {
            --mdc-icon-size: 28px;
          }

          .tile-heading {
            flex: 1;
            min-width: 0;
          }

          .document-name {
            font-size: var(--sd-name-size, .94rem);
            font-weight: 600;
            line-height: 1.3;
            overflow-wrap: anywhere;
          }

          .document-category {
            margin-top: 4px;
            font-size: .75rem;
            color: var(--secondary-text-color);
            overflow-wrap: anywhere;
          }

          .expiry-label {
            font-size: .73rem;
            color: var(--secondary-text-color);
            margin-bottom: 4px;
          }

          .expiry-date {
            font-size: .86rem;
            font-weight: 500;
            overflow-wrap: anywhere;
          }

          .category-editor {
            display: flex;
            flex-direction: column;
            gap: 20px;
          }

          .category-section {
            padding: 16px;
            border: 1px solid var(--divider-color, #444);
            border-radius: 14px;
          }

          .category-section h3 {
            margin: 0 0 14px;
            font-size: 16px;
            font-weight: 600;
          }

          .category-section .save-button,
          .category-section .delete-category-button {
            width: 100%;
            min-height: 42px;
            margin-top: 12px;
          }

          .category-section select {
            box-sizing: border-box;
            width: 100%;
            min-height: 42px;
            padding: 8px 12px;
            color: var(--primary-text-color);
            background: var(--card-background-color);
            border: 1px solid var(--divider-color);
            border-radius: 8px;
            font: inherit;
          }

          .category-warning {
            margin: 10px 0 0;
            color: var(--secondary-text-color);
            font-size: 12px;
            line-height: 1.5;
          }

          .delete-category-button {
            color: rgba(255, 0, 0, 0.7);
            background: transparent;
            border: 1px solid rgba(255, 0, 0, 0.7);
            border-radius: 22px;
            padding: 10px 16px;
            cursor: pointer;
          }

          .delete-category-button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }

          .delete-document-button {
            padding: 10px 16px;
            border: 1px solid var(--error-color, #f44336);
            border-radius: 10px;
            background: transparent;
            color: var(--error-color, #f44336);
            cursor: pointer;
          }

          .delete-document-button:hover {
            background: rgba(244, 67, 54, 0.12);
          }

          .delete-document-button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }

          .management-toolbar {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 10px;
            margin-top: 18px;
            margin-bottom: 0;
            width: 100%;
          }

          .management-toolbar button {
            border: 1px solid rgba(255, 255, 255, 0.15);
            border-radius: 14px;
            background: rgba(22, 27, 38, 0.4);
            color: var(--primary-text-color);
            font-size: .85rem;
            cursor: pointer;
            box-shadow: var(--ha-card-glass-inset-shadow);
            box-sizing: border-box;
            height: 44px;
            min-height: 44px;
            padding: 8px 12px;
            margin: 0;
            font: inherit;
            white-space: normal;
            max-width: auto;
          }

          .management-toolbar button:active {
            transform: scale(0.96);
            transition: 0s;
          }

          :host([dark-mode]) .management-toolbar button {
            box-shadow: 0 2px 4px 0 rgba(0, 0, 0, 0.8);
          }

          .tile-status {
            position: relative;
            isolation: isolate;
            display: inline-flex;
            align-items: center;
            align-self: stretch;
            gap: 6px;
            max-width: 100%;
            box-sizing: border-box;
            padding: 7px 9px;
            border-radius: 999px;
            font-size: .75rem;
            line-height: 1.35;
            overflow: hidden;
            overflow-wrap: anywhere;
            background: var(--secondary-background-color);
            color: var(--secondary-text-color);
          }

          .validity-progress-fill {
            position: absolute;
            z-index: -1;
            inset: 0 auto 0 0;
            width: var(--validity-progress, 0%);
            border-radius: 999px 0 0 999px;
            opacity: 0.24;
            transition: width 800ms ease;
            pointer-events: none;
          }

          .tile-status.valid .validity-progress-fill {
            background: var(--sd-status-valid);
          }

          .tile-status.urgent .validity-progress-fill,
          .tile-status.renewal_due .validity-progress-fill,
          .tile-status.expires_during_schedule, .tile-status.expires_during_sailing .validity-progress-fill {
            background: var(--sd-status-warning);
          }

          .tile-status.expired .validity-progress-fill {
            background: var(--sd-status-expired);
          }

          .tile-status.unknown .validity-progress-fill {
            background: var(--secondary-text-color);
          }

          .tile-status-text {
            position: relative;
            min-width: 0;
          }

          .tile-status .status-dot {
            position: relative;
            flex: 0 0 7px;
          }

          .tile-sailing-warning {
            display: flex;
            align-items: center;
            gap: 6px;
            color: #f44336;
            font-size: 0.75rem;
            font-weight: 600;
            line-height: 1.35;
            overflow-wrap: anywhere;
          }

          .tile-sailing-warning ha-icon {
            flex: 0 0 auto;
            color: #f44336;
            --mdc-icon-size: 18px;
            animation: sailing-icon-blink 1s ease-in-out infinite;
          }

          @keyframes sailing-icon-blink {
            0%, 100% {
              opacity: 1;
            }

            50% {
              opacity: 0.2;
            }
          }

          @media (prefers-reduced-motion: reduce) {
            .tile-sailing-warning ha-icon {
              animation: none;
            }
          }

          @media (prefers-reduced-motion: reduce) {
            .tile-sailing-warning {
              animation: none;
            }
          }

          .sailing-dates-toolbar {
            display: grid;
            grid-template-columns: minmax(0, 1fr);
            gap: 10px;
            margin-top: 18px;
            margin-bottom: 0;
            width: 100%;
          }

          .sailing-dates-toolbar button {
            border: 1px solid rgba(255, 255, 255, 0.15);
            border-radius: 14px;
            background: rgba(22, 27, 38, 0.4);
            color: var(--primary-text-color);
            font-size: 0.85rem;
            cursor: pointer;
            box-shadow: var(--ha-card-glass-inset-shadow);
            box-sizing: border-box;
            width: 100%;
            height: 44px;
            min-height: 44px;
            padding: 8px 12px;
            margin: 0;
            font: inherit;
            white-space: normal;
          }

          .sailing-dates-toolbar button:active {
            transform: scale(0.96);
            transition: 0s;
          }

          :host([dark-mode]) .sailing-dates-toolbar button {
            box-shadow: 0 2px 4px 0 rgba(0, 0, 0, 0.8);
          }

          .sailing-dates-toolbar[hidden],
          .sailing-dates-toolbar button[hidden] {
            display: none !important;
          }

          .status-dot {
            width: 7px;
            height: 7px;
            flex: 0 0 7px;
            border-radius: 50%;
            background: currentColor;
          }

          .tile-status.valid {
            color: var(--sd-status-valid);
            background: color-mix(in srgb, var(--sd-status-valid) 10%, var(--card-background-color));
          }

          .tile-status.urgent,
          .tile-status.renewal_due,
          .tile-status.expires_during_schedule, .tile-status.expires_during_sailing {
            color: var(--sd-status-warning);
            background: color-mix(in srgb, var(--sd-status-warning) 10%, var(--card-background-color));
          }

          .tile-status.expired {
            color: var(--sd-status-expired);
            background: color-mix(in srgb, var(--sd-status-expired) 10%, var(--card-background-color));
          }

          .tile-status.unknown {
            color: var(--secondary-text-color);
            background: var(--secondary-background-color);
          }

          .message {
            padding: 8px 0;
            color: var(--secondary-text-color);
          }

          @media (max-width: 340px) {}

          .summary-grid {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 8px;
            margin: 14px 0 18px;
          }

          .summary-tile {
            box-shadow: var(--ha-card-glass-inset-shadow);
            transition: transform 0s;
            cursor: pointer;
          }

          .summary-tile:active {
            transform: scale(0.96);
          }

          :host([dark-mode]) .summary-tile {
            box-shadow: var(--ha-card-glass-inset-shadow);
          }

          .summary-tile {
            min-width: 0;
            padding: 12px 8px;
            border: 1px solid var(--divider-color);
            border-radius: 14px;
            background: var(--sd-tile-background);
            box-sizing: border-box;
          }

          .summary-icon {
            display: block;
            margin-bottom: 8px;
            --mdc-icon-size: 21px;
            color: white;
          }

          .summary-value {
            font-size: 1.35rem;
            font-weight: 700;
            line-height: 1.2;
            overflow-wrap: anywhere;
          }

          .summary-label {
            margin-top: 5px;
            font-size: 0.72rem;
            line-height: 1.3;
            color: var(--secondary-text-color);
            overflow-wrap: anywhere;
          }

          .summary-tile.expiring .summary-icon {
            color: var(--sd-status-warning);
          }

          .summary-tile.expired .summary-icon {
            color: var(--sd-status-expired);
          }

          @media (max-width: 420px) {
            .summary-grid {
              gap: 6px;
            }

            .summary-tile {
              padding: 10px 6px;
            }

            .summary-value {
              font-size: 1.2rem;
            }

            .summary-label {
              font-size: 0.68rem;
            }
          }

          .document-grid {
            gap: 7px;
          }

          .document-tile {
            padding: 9px;
            gap: 9px;
          }

          .tile-top {
            flex-direction: column;
            gap: 8px;
          }

          #directory-select,
          .directory-select {
            width: 100%;
            min-width: 0;
            box-sizing: border-box;
            padding: 10px 38px 10px 13px;
            border: 1px solid rgba(255, 255, 255, 0.16);
            border-radius: 14px;
            outline: none;
            background-color: rgba(22, 27, 38, 0.4);
            color: rgba(255, 255, 255, 0.94);
            font: inherit;
            cursor: pointer;
            color-scheme: dark;
            box-shadow: var(--ha-card-glass-inset-shadow);
          }

          #directory-select:focus,
          .directory-select:focus {
            border-color: rgba(255, 255, 255, 0.32);
            box-shadow: var(--ha-card-glass-inset-shadow);
          }

          #directory-select option,
          .directory-select option,
          .form-field option {
            background: #171c28;
            color: #f4f5f8;
          }

          .directory-select:active {
            transform: scale(0.96);
            transition: 0s;
          }

          .details-backdrop {
            position: fixed;
            inset: 0;
            z-index: 1000;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 16px;
            box-sizing: border-box;
            background: rgba(3, 7, 15, 0.48);
            -webkit-backdrop-filter: blur(10px);
            backdrop-filter: blur(10px);
          }

          .details-dialog {
            display: block;
            width: 100%;
            max-width: 440px;
            max-height: 85%;
            overflow-y: auto;
            box-sizing: border-box;
            padding: 20px;
            border-radius: 24px;
            background: rgba(0, 0, 0, 0.45);
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            border: 1px solid var(--sd-popup-border, rgba(255, 255, 255, 0.16));
            box-shadow: var(--ha-card-glass-inset-shadow);
            color: rgba(255, 255, 255, 0.94);
          }

          .details-header {
            display: flex;
            flex-direction: row;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            width: 100%;
            margin-bottom: 20px;
          }

          .details-heading {
            display: flex;
            flex: 1 1 auto;
            flex-direction: row;
            align-items: center;
            gap: 12px;
            min-width: 0;
          }

          .details-icon {
            width: 52px;
            height: 52px;
            flex: 0 0 52px;
            display: flex;
            align-items: center;
            justify-content: center;
            border: none !important;
            border-radius: 0 !important;
            background: transparent !important;
            box-shadow: none !important;
          }

          .details-icon ha-icon {
            --mdc-icon-size: 30px;
            color: rgba(255, 255, 255, 0.92);
          }

          .details-title {
            flex: 1 1 auto;
            min-width: 0;
            font-size: 1.15rem;
            font-weight: 600;
            line-height: 1.4;
            color: rgba(255, 255, 255, 0.96);
            overflow-wrap: anywhere;
          }

          .details-actions {
            display: flex;
            align-items: center;
            justify-content: flex-end;
            flex: 0 0 auto;
            gap: 8px;
          }

          .form-close {
            width: 34px;
            height: 34px;
            flex: 0 0 34px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            box-sizing: border-box;
            padding: 0;
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.10);
            color: rgba(255, 255, 255, 0.95);
            font: inherit;
            font-size: 23px;
            line-height: 1;
            cursor: pointer;
          }

          .form-close:hover {
            background: rgba(255, 255, 255, 0.17);
          }

          .details-content {
            display: flex;
            flex-direction: column;
            gap: 0;
            width: 100%;
            min-width: 0;
            box-sizing: border-box;
          }

          .details-row {
            display: flex;
            flex-direction: column;
            align-items: stretch;
            width: 100%;
            min-width: 0;
            box-sizing: border-box;
            padding: 12px 0;
            border-bottom: 1px solid rgba(255, 255, 255, 0.11);
          }

          .details-row:last-child {
            border-bottom: 0;
          }

          .details-label {
            display: block;
            width: 100%;
            min-width: 0;
            margin: 0 0 5px;
            box-sizing: border-box;
            font-size: .78rem;
            line-height: 1.4;
            text-align: left;
            color: rgba(255, 255, 255, 0.60);
            overflow-wrap: anywhere;
          }

          .details-value {
            display: block;
            width: 100%;
            min-width: 0;
            margin: 0;
            box-sizing: border-box;
            font-size: .95rem;
            line-height: 1.5;
            text-align: left;
            color: rgba(255, 255, 255, 0.92);
            overflow-wrap: anywhere;
            white-space: normal;
          }

          .icon-picker-preview {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 12px;
            border: 1px solid rgba(255, 255, 255, 0.14);
            border-radius: 12px;
            background: rgba(255, 255, 255, 0.05);
          }

          .icon-picker-current {
            --mdc-icon-size: 30px;
            flex: 0 0 auto;
            color: var(--primary-color);
          }

          .icon-picker-current-name {
            overflow-wrap: anywhere;
            color: rgba(255, 255, 255, 0.9);
            font-size: 0.85rem;
          }

          .icon-picker-search {
            width: 100% !important;
            max-width: 100% !important;
          }

          .icon-picker-grid {
            display: grid;
            grid-template-columns: repeat(6, minmax(0, 1fr));
            gap: 7px;
          }

          .icon-picker-option {
            display: flex;
            align-items: center;
            justify-content: center;
            min-width: 0;
            aspect-ratio: 1;
            padding: 5px;
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 10px;
            background: rgba(255, 255, 255, 0.05);
            color: rgba(255, 255, 255, 0.85);
            cursor: pointer;
          }

          .icon-picker-option ha-icon {
            --mdc-icon-size: 23px;
          }

          .icon-picker-option:hover {
            background: rgba(255, 255, 255, 0.12);
          }

          .icon-picker-option.selected {
            border-color: var(--primary-color);
            background: rgba(100, 150, 220, 0.22);
            color: var(--primary-color);
          }

          .icon-picker-option[hidden] {
            display: none;
          }

          .icon-picker-hint {
            font-size: 0.75rem;
            color: rgba(255, 255, 255, 0.55);
          }

          .form-backdrop {
            position: fixed;
            inset: 0;
            z-index: 1000;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 16px;
            box-sizing: border-box;
            background: rgba(0, 0, 0, 0.45);
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
          }

          .form-backdrop,
          .details-backdrop {
            position: fixed !important;
            inset: 0 !important;
            z-index: 999999 !important;
          }

          .form-dialog {
            width: min(440px, calc(100vw - 32px));
            max-width: 100%;
            max-height: 90vh;
            overflow-y: auto;
            box-sizing: border-box;
            padding: 20px;
            border-radius: 20px;
            background: rgba(28, 30, 38, 0.6);
            border: 1px solid rgba(255, 255, 255, 0.12);
            box-shadow: var(--ha-card-glass-inset-shadow);
            backdrop-filter: blur(24px);
            -webkit-backdrop-filter: blur(24px);
          }

          .form-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            margin-bottom: 18px;
            font-size: 1.15rem;
            font-weight: 600;
            color: rgba(255, 255, 255, 0.95);
          }

          .form-title {
            min-width: 0;
          }

          .document-form {
            display: flex;
            flex-direction: column;
            gap: 14px;
          }

          .document-form *,
          .document-form *::before,
          .document-form *::after {
            box-sizing: border-box;
          }

          .document-form input,
          .document-form select,
          .document-form textarea {
            display: block;
            width: 90%;
            max-width: 90%;
            min-width: 0;
            margin: 0;
          }

          .form-field {
            display: flex;
            flex-direction: column;
            gap: 6px;
            min-width: 0;
            color: rgba(255, 255, 255, 0.68);
            font-size: .8rem;
          }

          .form-field input,
          .form-field select,
          .form-field textarea {
            width: 100%;
            min-width: 0;
            box-sizing: border-box;
            padding: 11px 12px;
            border: 1px solid rgba(255, 255, 255, 0.16);
            border-radius: 12px;
            outline: none;
            background: rgba(255, 255, 255, 0.06);
            color: rgba(255, 255, 255, 0.94);
            font: inherit;
            font-size: .9rem;
            color-scheme: dark;
          }

          .form-field textarea {
            min-height: 80px;
            resize: vertical;
          }

          .form-field input:focus,
          .form-field select:focus,
          .form-field textarea:focus {
            border-color: rgba(255, 255, 255, 0.38);
          }

          .form-actions {
            display: flex;
            gap: 10px;
            margin-top: 5px;
          }

          .form-actions button {
            flex: 1;
            min-width: 0;
            padding: 12px;
            border: 1px solid rgba(255, 255, 255, 0.16);
            border-radius: 13px;
            background: rgba(255, 255, 255, 0.08);
            color: white;
            font: inherit;
            cursor: pointer;
          }

          .form-dialog .form-actions button {
            border-radius: 999px !important;
          }

          .form-actions .primary {
            background: rgba(100, 150, 220, 0.7);
            border-color: rgba(140, 180, 240, 0.35);
          }

          .form-actions button:disabled {
            opacity: .55;
            cursor: wait;
          }

          .form-error {
            color: #ff9999;
            font-size: .85rem;
            white-space: pre-wrap;
          }

          .form-actions {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 10px;
            align-items: center;
          }

          .form-actions .cancel-button,
          .form-actions .save-button,
          .form-actions .delete-document-button {
            box-sizing: border-box;
            width: 100%;
            min-height: 42px;
            padding: 10px 16px;
            border-radius: 999px;
            font: inherit;
            cursor: pointer;
          }

          .form-actions .cancel-button {
            grid-column: 1;
            grid-row: 1;
          }

          .form-actions .save-button {
            grid-column: 2;
            grid-row: 1;
          }

          .form-actions .delete-document-button {
            grid-column: 1 / -1;
            grid-row: 2;
            justify-self: center;
            width: calc(50% - 5px);
            border: 1px solid rgba(255, 0, 0, 0.7);
            background: transparent;
            color: rgba(255, 0, 0, 0.7);
          }

          .form-actions .delete-document-button:hover {
            background: rgba(244, 67, 54, 0.12);
          }

          .form-actions button:disabled {
            opacity: 0.55;
            cursor: not-allowed;
          }

          .dialog-backdrop {
            position: fixed;
            inset: 0;
            z-index: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            box-sizing: border-box;
            padding: 16px;
            background: rgba(0, 0, 0, 0.55);
            -webkit-backdrop-filter: blur(10px);
            backdrop-filter: blur(10px);
          }

          .dialog {
            display: flex;
            flex-direction: column;
            width: min(440px, calc(100vw - 32px));
            max-width: 100%;
            max-height: 90vh;
            overflow-y: auto;
            box-sizing: border-box;
            padding: 20px;
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 20px;
            background: rgba(28, 30, 38, 0.6);
            color: rgba(255, 255, 255, 0.95);
            box-shadow: var(--ha-card-glass-inset-shadow);
            backdrop-filter: blur(24px);
            -webkit-backdrop-filter: blur(24px);
          }

          .dialog-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            margin-bottom: 18px;
            font-size: 1.15rem;
            font-weight: 600;
            color: rgba(255, 255, 255, 0.95);
          }

          .dialog-header h2 {
            min-width: 0;
            margin: 0;
            font-size: inherit;
            font-weight: inherit;
          }

          .dialog-close {
            width: 36px;
            height: 36px;
            flex: 0 0 36px;
            border: 1px solid rgba(255, 255, 255, 0.16);
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.08);
            color: white;
            font-size: 24px;
            cursor: pointer;
          }

          .dialog-body {
            display: flex;
            flex-direction: column;
            gap: 12px;
            min-width: 0;
            line-height: 1.5;
          }

          .dialog-body p {
            margin: 0 0 4px;
            overflow-wrap: anywhere;
          }

          .dialog-body button {
            box-sizing: border-box;
            width: 100%;
            min-height: 42px;
            padding: 10px 16px;
            border: 1px solid rgba(255, 255, 255, 0.16);
            border-radius: 999px;
            background: rgba(255, 255, 255, 0.08);
            color: white;
            font: inherit;
            cursor: pointer;
          }

          .dialog-body button.primary-button {
            background: rgba(70, 125, 205, 0.85);
            border-color: rgba(140, 180, 240, 0.4);
          }

          .dialog-body button:disabled {
            opacity: 0.55;
            cursor: not-allowed;
          }

          #directory-flow-fields {
            display: flex;
            flex-direction: column;
            gap: 4px;
          }

          #directory-flow-fields label {
            color: rgba(255, 255, 255, 0.75);
            font-size: 0.85rem;
            text-transform: capitalize;
          }

          #directory-flow-fields input,
          #directory-flow-fields select {
            display: block;
            width: 100%;
            min-width: 0;
            min-height: 42px;
            padding: 11px 12px;
            box-sizing: border-box;
            border: 1px solid rgba(255, 255, 255, 0.16);
            border-radius: 12px;
            outline: none;
            background: rgba(255, 255, 255, 0.06);
            color: rgba(255, 255, 255, 0.94);
            font: inherit;
            font-size: 0.9rem;
            color-scheme: dark;
          }

          #directory-flow-fields input:focus,
          #directory-flow-fields select:focus {
            border-color: rgba(255, 255, 255, 0.38);
          }

          #directory-flow-error {
            color: #ff9999;
            white-space: pre-wrap;
            overflow-wrap: anywhere;
          }

          @media (max-width: 420px) {
            .dialog {
              padding: 16px;
            }
          }

          /* Compatibility: prevent external-theme flex/shrink overrides. */
          .directory-toolbar {
            display: flex !important;
            width: 100%;
            min-width: 0;
          }

          #directory-select {
            flex: 1 1 auto;
            min-width: 0;
          }

          #manage-directory-button,
          #notify-devices-button {
            display: inline-flex !important;
            visibility: visible !important;
            opacity: 1 !important;
            flex: 0 0 40px;
            width: 40px;
            min-width: 40px;
            height: 40px;
            position: relative;
          }

          #manage-directory-button ha-icon,
          #notify-devices-button ha-icon {
            display: flex !important;
            visibility: visible !important;
            opacity: 1 !important;
            width: 21px;
            height: 21px;
          }
        </style>

        <ha-card>
          <div class="header"></div>
          <div class="directory-toolbar">
            <select id="directory-select" aria-label="Select directory"></select>
            <button type="button" id="manage-directory-button" class="toolbar-chip" aria-label="Add or edit directory" title="Add or edit directory" >
              <ha-icon icon="mdi:folder-edit-outline"></ha-icon>
            </button>
            <button type="button" id="notify-devices-button" class="toolbar-chip" aria-label="Notify devices" title="Notify devices" >
              <ha-icon icon="mdi:bell-outline"></ha-icon>
            </button>
          </div>
          <div class="directory-summary"></div>
          <div class="sailing-dates-toolbar" id="sailing-dates-toolbar" hidden>
            <button id="sailing-dates-button" type="button">
              Schedule Planner
            </button>
          </div>
          <div class="summary-grid">
            <div class="summary-tile">
              <ha-icon class="summary-icon" icon="mdi:file-multiple"></ha-icon>
              <div class="summary-value" id="summary-total">0</div>
              <div class="summary-label">Total Documents</div>
            </div>
            <div class="summary-tile expiring">
              <ha-icon class="summary-icon" icon="mdi:calendar-clock"></ha-icon>
              <div class="summary-value" id="summary-expiring">0</div>
              <div class="summary-label">Expiring Soon</div>
            </div>
            <div class="summary-tile expired">
              <ha-icon class="summary-icon" icon="mdi:calendar-alert"></ha-icon>
              <div class="summary-value" id="summary-expired">0</div>
              <div class="summary-label">Expired</div>
            </div>
          </div>
          <div class="document-list-header">
            <span class="document-list-title">Documents</span>
            <button id="toggle-document-list" type="button" aria-expanded="false" aria-controls="document-list">
              <span class="roller-window">
                <span id="document-list-toggle-label" class="roller-track">
                  <span>Collapse</span>
                  <span>Expand</span>
                </span>
              </span>
              <ha-icon id="document-list-toggle-icon" icon="mdi:chevron-down"></ha-icon>
            </button>
          </div>
          <div id="document-list" hidden></div>
          <div class="management-toolbar">
            <button id="add-document-button" type="button">
              <span>+</span> Add Document
            </button>
            <button id="add-category-button" type="button">
              Edit Category
            </button>
          </div>
        </ha-card>
      `;
      this.shadowRoot.querySelector(".header").textContent =
        this._config.title;
      this.shadowRoot
        .querySelector("#directory-select")
        .addEventListener("change", event => {
          this._selectedDirectoryId = event.target.value;
          this._saveDirectoryId(this._selectedDirectoryId);
          this._updateContent();
        });
      this.shadowRoot
        .querySelector("#manage-directory-button")
        .addEventListener("click", () => {
          this._showDirectoryManager();
        });
      this.shadowRoot
        .querySelector("#notify-devices-button")
        .addEventListener("click", () => {
          this._showNotifyDevices();
        });
      this.shadowRoot
        .querySelector("#add-document-button")
        .addEventListener("click", () => {
          this._showAddDocumentForm();
        });
      this.shadowRoot
        .querySelector("#add-category-button")
        .addEventListener("click", () => {
          this._showAddCategoryForm();
        });
      this.shadowRoot
      .querySelector("#sailing-dates-button")
      ?.addEventListener("click", () => this._showSailingDatesDialog());
      this.shadowRoot
        .querySelector("#toggle-document-list")
        ?.addEventListener("click", () => {
          const list = this.shadowRoot.querySelector("#document-list");
          const button = this.shadowRoot.querySelector(
            "#toggle-document-list"
          );
          const label = this.shadowRoot.querySelector(
            "#document-list-toggle-label"
          );
          const icon = this.shadowRoot.querySelector(
            "#document-list-toggle-icon"
          );
          const willExpand = list.hidden;
          list.hidden = !willExpand;
          button.setAttribute("aria-expanded", String(willExpand));
          icon.setAttribute(
            "icon",
            willExpand ? "mdi:chevron-up" : "mdi:chevron-down"
          );
        });
      this._initialized = true;
    }
    this._updateContent();
  }
  _updateContent() {
    const states = this._hass?.states;
    if (!states || !this._initialized) return;
    const directories = this._getDirectories(states);
    const selector = this.shadowRoot.querySelector("#directory-select");
    const currentOptions = [...selector.options].map(option => ({
      value: option.value,
      text: option.textContent,
    }));
    const optionsChanged =
      currentOptions.length !== directories.length ||
      directories.some((directory, index) =>
        currentOptions[index]?.value !== directory.id ||
        currentOptions[index]?.text !== directory.name
      );
    if (optionsChanged) {
      selector.replaceChildren(
        ...directories.map(directory => {
          const option = window.document.createElement("option");
          option.value = directory.id;
          option.textContent = directory.name;
          return option;
        })
      );
    }
    if (!this._selectedDirectoryId) {
      this._selectedDirectoryId = this._getSavedDirectoryId();
    }
    const selectedIsPresent = directories.some(
      d => d.id === this._selectedDirectoryId
    );
    if (!selectedIsPresent && this._selectedDirectoryId) {
      // A directory-type change reloads sensors and can remove this directory
      // from hass.states momentarily. Never persist a different selection while
      // the selected directory is being reloaded.
      if (this._missingDirectorySince === null) {
        this._missingDirectorySince = Date.now();
      }
      // After 30 seconds of confirmed absence, fall back to a valid directory
      // (for example, if the selected entry was actually deleted).
      if (Date.now() - this._missingDirectorySince > 30000) {
        this._selectedDirectoryId = directories[0]?.id || null;
        this._missingDirectorySince = null;
      }
    } else if (!this._selectedDirectoryId) {
      this._selectedDirectoryId = directories[0]?.id || null;
      this._missingDirectorySince = null;
    } else {
      this._missingDirectorySince = null;
    }
    if (this._selectedDirectoryId && (
      selectedIsPresent || this._missingDirectorySince === null
    )) {
      this._saveDirectoryId(this._selectedDirectoryId);
    }
    // Do not switch to the first option during a transient backend reload.
    if (directories.some(d => d.id === this._selectedDirectoryId)) {
      selector.value = this._selectedDirectoryId;
    } else {
      selector.selectedIndex = -1;
    }
    const selected = directories.find(
      d => d.id === this._selectedDirectoryId
    );
    const sailingDatesToolbar = this.shadowRoot.querySelector(
      "#sailing-dates-toolbar"
    );
    if (sailingDatesToolbar) {
      sailingDatesToolbar.hidden =
        !["schedule_based", "seafarer"].includes(selected?.type);
    }
    const documents = selected
      ? this._getDocuments(states, selected.id)
      : [];
    const summary = Object.values(states).find(entity =>
      entity?.attributes?.directory_id === selected?.id &&
      entity.attributes.instance_id === selected?.id
    )?.attributes;
    const totalCount = Number.isFinite(Number(summary?.total_documents))
      ? Number(summary.total_documents) : documents.length;
    const expiredCountFallback = documents.filter(document =>
      document.daysRemaining !== null &&
      document.daysRemaining < 0
    ).length;
    const expiredCount = Number.isFinite(Number(summary?.expired_documents))
      ? Number(summary.expired_documents) : expiredCountFallback;
    const expiringCount = documents.filter(document =>
      document.daysRemaining !== null &&
      document.daysRemaining >= 0 &&
      document.renewalLeadDays !== null &&
      document.daysRemaining <= document.renewalLeadDays
    ).length;
    this.shadowRoot.querySelector("#summary-total").textContent =
      totalCount;
    this.shadowRoot.querySelector("#summary-expiring").textContent =
      expiringCount;
    this.shadowRoot.querySelector("#summary-expired").textContent =
      expiredCount;
    const list = this.shadowRoot.querySelector("#document-list");
    if (!directories.length) {
      list.innerHTML = "";
      const message = window.document.createElement("div");
      message.className = "message";
      message.textContent = "No directories found.";
      list.appendChild(message);
      return;
    }
    if (!documents.length) {
      list.innerHTML = "";
      const message = window.document.createElement("div");
      message.className = "message";
      message.textContent = "No documents found in this directory.";
      list.appendChild(message);
      return;
    }
    const tiles = documents.map(document => {
      const status = this._statusClass(document.status);
      const expiryTime = Date.parse(
        `${document.expiryDate}T00:00:00`
      );
      const issueTime = Date.parse(
        `${document.issueDate}T00:00:00`
      );
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const todayTime = now.getTime();
      let progress = 0;
      if (
        Number.isFinite(issueTime) &&
        Number.isFinite(expiryTime) &&
        expiryTime > issueTime
      ) {
        progress = Math.max(
          0,
          Math.min(
            100,
            ((expiryTime - todayTime) /
              (expiryTime - issueTime)) * 100
          )
        );
      }
      const days = document.daysRemaining;
      let daysText = "Days remaining unavailable";
      if (days !== null) {
        if (days < 0) {
          const elapsed = Math.abs(days);
          daysText = `Expired ${elapsed} day${elapsed === 1 ? "" : "s"} ago`;
        } else if (days === 0) {
          daysText = "Expires today";
        } else {
          daysText = `${days} day${days === 1 ? "" : "s"} remaining`;
        }
      }
      const sailingWarnings = [];
      if (document.expiresDuringSailing) {
        sailingWarnings.push("Expires during scheduled period");
      }
      if (document.expiresBeforeJoining) {
        sailingWarnings.push("Expires before scheduled start");
      }
      if (document.renewBeforeJoining) {
        sailingWarnings.push("Renew before scheduled start");
      }
      return `
        <div class="document-tile">
          <div class="tile-top">
            <div class="document-icon">
              <ha-icon icon="${this._escape(
                this._getDocumentIcon(document)
              )}"></ha-icon>
            </div>
            <div class="tile-heading">
              <div class="document-name">
                ${this._escape(document.name)}
              </div>
              ${
                document.category
                  ? `<div class="document-category">
                      ${this._escape(document.category)}
                    </div>`
                  : ""
              }
            </div>
          </div>
          <div class="tile-expiry">
            <div class="expiry-label">Expiry date</div>
            <div class="expiry-date">
              ${this._escape(this._formatDate(document.expiryDate))}
            </div>
          </div>
          ${sailingWarnings.length
            ? `<div class="tile-sailing-warning">
                <ha-icon icon="mdi:alert-circle-outline"></ha-icon>
                <span>${sailingWarnings.map(w => this._escape(w)).join(" · ")}</span>
              </div>`
            : ""}
          <div class="tile-status ${status}"
            style="--validity-progress: ${progress}%">
            <span class="validity-progress-fill"></span>
            <span class="status-dot"></span>
            <span class="tile-status-text">
              ${this._escape(this._statusLabel(document.status))} ·
              ${this._escape(daysText)}
            </span>
          </div>
        </div>
      `;
    }).join("");
    list.innerHTML = `<div class="document-grid">${tiles}</div>`;
    list.querySelectorAll(".document-tile").forEach((tile, index) => {
      tile.style.cursor = "pointer";
      tile.addEventListener("click", () => {
        this._showDocumentDetails(documents[index]);
      });
    });
  }
  _mountDialog(backdrop) {
    // Remove any previously open dialog.
    if (this._activeDialog) {
      this._closeDialog(this._activeDialog);
    }
    // Create an overlay outside the Bubble Card stacking context.
    const host = document.createElement("div");
    host.style.cssText = `
      position: fixed;
      inset: 0;
      width: 100%;
      height: 100%;
      z-index: 2147483647;
      pointer-events: none;
    `;
    // Keep the dialog styles isolated from the rest of Home Assistant.
    const overlayRoot = host.attachShadow({ mode: "open" });
    // Copy the card's existing CSS so glass styling is preserved.
    this.shadowRoot.querySelectorAll("style").forEach((style) => {
      overlayRoot.appendChild(style.cloneNode(true));
    });
    backdrop.style.position = "fixed";
    backdrop.style.inset = "0";
    backdrop.style.zIndex = "1";
    backdrop.style.display = "flex";
    backdrop.style.alignItems = "center";
    backdrop.style.justifyContent = "center";
    backdrop.style.pointerEvents = "auto";
    overlayRoot.appendChild(backdrop);
    document.body.appendChild(host);
    this._activeDialog = host;
  }
  _closeDialog(dialogOrBackdrop) {
    if (!dialogOrBackdrop) return;
    // Accept either the overlay host or the backdrop element.
    const host =
      dialogOrBackdrop.shadowRoot
        ? dialogOrBackdrop
        : dialogOrBackdrop.getRootNode?.().host;
    if (host && host !== document.body && host.parentNode) {
      host.remove();
    } else {
      dialogOrBackdrop.remove?.();
    }
    if (
      this._activeDialog === host ||
      this._activeDialog === dialogOrBackdrop
    ) {
      this._activeDialog = null;
    }
  }
  _showDirectoryManager() {
    customElements.whenDefined("ha-adaptive-dialog").then(() => {
      customElements.whenDefined("ha-icon-button").then(() => {
        if (this._activeDialog) {
          this._closeDialog(this._activeDialog);
        }
        const host = document.createElement("div");
        host.style.cssText =
          "position:fixed;inset:0;z-index:2147483647;";
        const root = host.attachShadow({ mode: "open" });
        this.shadowRoot.querySelectorAll("style").forEach((style) => {
          root.appendChild(style.cloneNode(true));
        });
        const template = document.createElement("template");
        template.innerHTML = `

          <style>
            .manager-content {
              box-sizing: border-box;
              width: 100%;
              max-height: min(78dvh, 760px);
              overflow-y: auto;
              padding: 0 20px 20px;
              color: var(--primary-text-color);
            }

            .manager-description {
              line-height: 1.6;
              color: var(--secondary-text-color);
              margin: 8px 0 22px;
            }

            .manager-actions {
              display: grid;
              grid-template-columns: 1fr;
              gap: 12px;
            }

            .manager-actions button {
              box-sizing: border-box;
              border: 1px solid rgba(255, 255, 255, 0.16);
              background: rgba(255, 255, 255, 0.08);
              color: var(--primary-text-color);
              width: 100%;
              min-width: 0;
              height: 48px;
              min-height: 48px;
              padding: 10px 16px;
              margin: 0;
              font: inherit;
              line-height: normal;
              border-radius: 999px;
              box-shadow: var(--ha-card-glass-inset-shadow);
            }

            .manager-actions button:active {
              transform: scale(0.96);
              transition: 0s;
            }

            .manager-actions .primary {
              background: var(--primary-color);
              border-color: var(--primary-color);
              color: var(--text-primary-color, white);
            }

            .manager-actions button:disabled {
              opacity: 0.55;
              cursor: default;
            }

            #directory-manager-message {
              margin-top: 16px;
              color: var(--secondary-text-color);
              white-space: pre-wrap;
              overflow-wrap: anywhere;
            }
          </style>

          <ha-adaptive-dialog>
            <ha-icon-button slot="headerNavigationIcon" label="Close" aria-label="Close Manage Directories" path="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12Z">
            </ha-icon-button>
            <span slot="headerTitle">Manage Directories</span>
            <div class="manager-content">
              <p class="manager-description">
                Create a new document directory or edit an existing one.
                Your existing documents will be preserved when you edit
                a directory.
              </p>
              <div class="manager-actions">
                <button type="button" id="create-directory-action" class="primary">
                  Create Directory
                </button>
                <button type="button" id="edit-directory-action">
                  Edit Existing Directory
                </button>
              </div>
              <p id="directory-manager-message" role="status" aria-live="polite">
              </p>
            </div>
          </ha-adaptive-dialog>
        `;
        root.appendChild(template.content.cloneNode(true));
        const dialog = root.querySelector("ha-adaptive-dialog");
        const closeButton = root.querySelector("ha-icon-button");
        const createButton = root.querySelector(
          "#create-directory-action"
        );
        const editButton = root.querySelector(
          "#edit-directory-action"
        );
        let closed = false;
        const cleanup = () => {
          if (closed) return;
          closed = true;
          host.remove();
          if (this._activeDialog === host) {
            this._activeDialog = null;
          }
        };
        const closeManager = () => {
          dialog.open = false;
        };
        dialog.addEventListener("closed", cleanup, { once: true });
        closeButton.addEventListener("click", closeManager);
        createButton.addEventListener("click", () => {
          closeManager();
          this._startDirectoryFlow("create");
        });
        editButton.addEventListener("click", () => {
          if (!this._selectedDirectoryId) {
            root.querySelector(
              "#directory-manager-message"
            ).textContent = "Select a directory first.";
            return;
          }
          closeManager();
          this._startDirectoryFlow("edit");
        });
        document.body.appendChild(host);
        this._activeDialog = host;
        dialog.open = true;
      });
    }).catch((error) => {
      console.error(
        "Documents: could not load adaptive dialog",
        error
      );
      alert("Could not open Manage Directories.");
    });
  }
  async _showNotifyDevices() {
    const directoryId = this._selectedDirectoryId;
    if (!directoryId) {
      alert("Please select a directory first.");
      return;
    }
    try {
      const flow = await this._hass.callApi(
        "POST",
        "config/config_entries/options/flow",
        { handler: directoryId }
      );
      if (!flow?.flow_id) {
        throw new Error(
          "Home Assistant did not return an options flow."
        );
      }
      const notifyFlow = await this._hass.callApi(
        "POST",
        `config/config_entries/options/flow/${flow.flow_id}`,
        { next_step_id: "notification_devices" }
      );
      if (notifyFlow?.type !== "form") {
        throw new Error(
          "Notification form was not returned: " +
          JSON.stringify(notifyFlow)
        );
      }
      this._showDirectoryFlowStep(notifyFlow, "notify");
    } catch (error) {
      console.error(
        "Documents: Notify Devices failed",
        error
      );
      alert(
        "Could not open Notify Devices. See the browser console for details."
      );
    }
  }
  async _startDirectoryFlow(action) {
    const getMessage = () =>
      this._activeDialog?.shadowRoot?.querySelector(
        "#directory-manager-message"
      );
    const setMessage = (text) => {
      const message = getMessage();
      if (message) message.textContent = text;
    };
    if (!this._hass) {
      setMessage("Home Assistant is not available.");
      return;
    }
    try {
      let flow;
      if (action === "create") {
        flow = await this._hass.callApi(
          "POST",
          "config/config_entries/flow",
          {
            handler: "docharbor",
          }
        );
      } else {
        const directoryId = this._selectedDirectoryId;
        const selectedDirectory = this._getDirectories(
          this._hass.states
        ).find((directory) => directory.id === directoryId);
        if (!directoryId) {
          setMessage("Select a directory first.");
          return;
        }
        flow = await this._hass.callApi(
          "POST",
          "config/config_entries/options/flow",
          {
            handler: directoryId,
          }
        );
      }
      await this._showDirectoryFlowStep(flow, action);
    } catch (error) {
      console.error("Seafarer Documents directory flow failed:", error);
      setMessage(
        `Directory flow error: ${
          error?.message || JSON.stringify(error) || String(error)
        }`
      );
    }
  }
  async _showDirectoryFlowStep(flow, action) {
    const message = this.shadowRoot.querySelector(
      "#directory-manager-message"
    );
    const setMessage = (text) => {
      if (message) message.textContent = text;
    };
    if (!flow || flow.type === "abort") {
      setMessage(flow?.description_placeholders?.reason ||
        "The flow was closed.");
      return;
    }
    if (flow.type === "create_entry") {
      this._closeDialog(this._activeDialog);
      await new Promise((resolve) => setTimeout(resolve, 500));
      await this._updateContent(true);
      return;
    }
    if (flow.type === "menu") {
      const stepId = action === "edit"
        ? "directory_settings"
        : null;
      const availableOptions =
        flow.menu_options || flow.options || [];
      if (!stepId || !availableOptions.includes(stepId)) {
        setMessage(
          "The requested settings step is unavailable: " +
          (stepId || "no setup step")
        );
        return;
      }
      const nextFlow = await this._hass.callApi(
        "POST",
        `config/config_entries/options/flow/${flow.flow_id}`,
        {
          next_step_id: stepId,
        }
      );
      await this._showDirectoryFlowStep(nextFlow, action);
      return;
    }
    if (flow.type !== "form") {
      setMessage("Unexpected response from Home Assistant.");
      return;
    }
    if (action === "notify") {
      await this._showNotifyDevicesForm(flow);
      return;
    }
    if (action === "create" || action === "edit") {
      await this._showDirectoryAdaptiveForm(flow, action);
      return;
    }
    let backdrop =
      this._activeDialog?.shadowRoot?.querySelector(
        ".dialog-backdrop"
      ) || this.shadowRoot.querySelector(".dialog-backdrop");
    if (!backdrop && action === "notify") {
      backdrop = document.createElement("div");
      backdrop.className = "dialog-backdrop";
      backdrop.innerHTML = `
        <div class="dialog" role="dialog" aria-modal="true">
          <div class="dialog-header">
            <h2>Notify Devices</h2>
            <button type="button" class="dialog-close" aria-label="Close">×</button>
          </div>
          <div class="dialog-body"></div>
        </div>
      `;
      this._mountDialog(backdrop);
      backdrop.querySelector(".dialog-close")
        .addEventListener("click", () => {
          this._closeDialog(backdrop);
        });
      backdrop.addEventListener("click", (event) => {
        if (event.target === backdrop) {
          this._closeDialog(backdrop);
        }
      });
    }
    if (!backdrop) {
      console.error("Documents: dialog backdrop not found");
      return;
    }
    const body = backdrop.querySelector(".dialog-body");
    if (!body) {
      console.error("Seafarer Documents: dialog body not found");
      return;
    }
    const schema = flow.data_schema || [];
    body.innerHTML = `
      <p>${action === "create"
        ? "Create a new directory."
        : "Edit the selected directory's settings."}</p>
      <form id="directory-flow-form">
        <div id="directory-flow-fields"></div>
        <p id="directory-flow-error" role="alert"></p>
        <button type="submit" class="primary-button">
          Save
        </button>
        <button type="button" id="directory-flow-cancel" class="secondary-button">
          Cancel
        </button>
      </form>
    `;
    const fields = body.querySelector("#directory-flow-fields");
    for (const field of schema) {
      const name = field.name;
      const selector = field.selector || {};
      const label = document.createElement("label");
      label.textContent = name.replaceAll("_", " ");
      label.style.display = "block";
      label.style.margin = "12px 0 4px";
      let input;
      if (selector.select?.options) {
        input = document.createElement("select");
        if (selector.select.multiple) {
          input.multiple = true;
          input.size = Math.min(
            selector.select.options.length || 6,
            8
          );
        }
        for (const option of selector.select.options) {
          const value = typeof option === "string"
            ? option
            : option.value ?? option.label;
          const text = typeof option === "string"
            ? option
            : option.label ?? option.value;
          if (value !== undefined && value !== null) {
            input.add(new Option(String(text), String(value)));
          }
        }
      } else if (selector.area) {
        input = document.createElement("select");
        input.add(new Option("No area", ""));
        try {
          const areas = await this._hass.callWS({
            type: "config/area_registry/list",
          });
          for (const area of areas) {
            input.add(new Option(area.name, area.area_id));
          }
        } catch (error) {
          console.warn("Could not load Home Assistant areas:", error);
        }
      } else {
        input = document.createElement("input");
        if (selector.number) {
          input.type = "number";
        } else if (selector.date) {
          input.type = "date";
        } else {
          input.type = "text";
        }
      }
      input.name = name;
      input.style.width = "100%";
      input.style.boxSizing = "border-box";
      input.style.padding = "10px";
      input.style.borderRadius = "8px";
      input.style.border = "1px solid var(--divider-color)";
      input.style.background = "var(--card-background-color)";
      input.style.color = "var(--primary-text-color)";
      if (field.required) input.required = true;
      const selectedValues = field.value ?? field.default;
      if (Array.isArray(selectedValues) && input.multiple) {
        const selectedSet = new Set(
          selectedValues.map((value) => String(value))
        );
        for (const option of input.options) {
          option.selected = selectedSet.has(option.value);
        }
      } else if (
        selectedValues !== undefined &&
        selectedValues !== null
      ) {
        input.value = selectedValues;
      }
      fields.append(label, input);
    }
    body.querySelector("#directory-flow-cancel")
      .addEventListener("click", () => {
        this._closeDialog(this._activeDialog);
      });
    body.querySelector("#directory-flow-form")
      .addEventListener("submit", async (event) => {
        event.preventDefault();
        const errorBox = body.querySelector("#directory-flow-error");
        const submit = body.querySelector('button[type="submit"]');
        const data = {};
        for (const input of fields.querySelectorAll("[name]")) {
          if (input.multiple && input.tagName === "SELECT") {
            data[input.name] = Array.from(
              input.selectedOptions,
              (option) => option.value
            );
          } else if (input.value !== "") {
            data[input.name] = input.value;
          }
        }
        submit.disabled = true;
        errorBox.textContent = "";
        try {
          const nextFlow = await this._hass.callApi(
            "POST",
            action === "create"
              ? `config/config_entries/flow/${flow.flow_id}`
              : `config/config_entries/options/flow/${flow.flow_id}`,
            data
          );
          if (nextFlow.type === "form" && nextFlow.errors) {
            errorBox.textContent =
              "Validation error:\n" +
              JSON.stringify(nextFlow.errors, null, 2) +
              "\n\nSubmitted fields:\n" +
              JSON.stringify(data, null, 2);
            submit.disabled = false;
            return;
          }
          if (nextFlow.type === "form" && nextFlow.errors) {
            errorBox.textContent = Object.entries(nextFlow.errors)
              .map(([key, value]) => `${key}: ${value}`)
              .join(", ");
            submit.disabled = false;
            return;
          }
          await this._showDirectoryFlowStep(nextFlow, action);
        } catch (error) {
          errorBox.textContent =
            `Save error: ${
              error?.message || JSON.stringify(error) || String(error)
            }`;
          submit.disabled = false;
        }
      });
  }
  async _showDirectoryAdaptiveForm(flow, action) {
    await customElements.whenDefined("ha-adaptive-dialog");
    await customElements.whenDefined("ha-icon-button");
    const host = document.createElement("div");
    host.style.cssText =
      "position:fixed;inset:0;z-index:2147483647;";
    const root = host.attachShadow({ mode: "open" });
    this.shadowRoot.querySelectorAll("style").forEach((style) => {
      root.appendChild(style.cloneNode(true));
    });
    const isCreate = action === "create";
    const title = isCreate ? "Create Directory" : "Edit Directory";
    const template = document.createElement("template");
    template.innerHTML = `

      <style>
        .directory-content {
          box-sizing: border-box;
          width: 100%;
          max-height: min(78dvh, 760px);
          overflow-y: auto;
          padding: 0 20px 20px;
          color: var(--primary-text-color);
        }

        .directory-content label {
          display: block;
          margin: 14px 0 6px;
          font-weight: 500;
        }

        .directory-content input,
        .directory-content select,
        .directory-content textarea {
          display: block;
          box-sizing: border-box;
          width: 100%;
          min-width: 0;
          min-height: 44px;
          padding: 10px 13px;
          border: 1px solid rgba(255, 255, 255, 0.16);
          border-radius: 14px;
          background-color: rgba(22, 27, 38, 0.4);
          color: rgba(255, 255, 255, 0.94);
          font: inherit;
          outline: none;
          color-scheme: dark;
          box-shadow: var(--ha-card-glass-inset-shadow);
        }

        .directory-content input:focus,
        .directory-content select:focus,
        .directory-content textarea:focus {
          border-color: rgba(255, 255, 255, 0.32);
          box-shadow: var(--ha-card-glass-inset-shadow);
        }

        .directory-content option {
          background: #171c28;
          color: #f4f5f8;
        }

        .directory-content select[multiple] {
          min-height: 140px;
        }

        .directory-error {
          color: var(--error-color);
          white-space: pre-wrap;
          overflow-wrap: anywhere;
        }

        .directory-actions {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
          margin-top: 20px;
        }

        .directory-actions button {
          box-sizing: border-box;
          border: 1px solid rgba(255, 255, 255, 0.16);
          background: rgba(22, 27, 38, 0.4);
          color: rgba(255, 255, 255, 0.94);
          width: 100%;
          min-width: 0;
          height: 44px;
          min-height: 44px;
          padding: 8px 12px;
          margin: 0;
          font: inherit;
          line-height: normal;
          border-radius: 999px;
          box-shadow: var(--ha-card-glass-inset-shadow);
        }

        .directory-actions button:active {
          transform: scale(0.96);
          transition: 0s;
        }

        .directory-actions .primary {
          background: var(--primary-color);
          border-color: var(--primary-color);
          color: var(--text-primary-color, white);
        }

        .directory-actions button:disabled {
          opacity: 0.55;
          cursor: default;
        }
      </style>

      <ha-adaptive-dialog>
        <ha-icon-button slot="headerNavigationIcon" label="Close" aria-label="Close directory form" path="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12Z">
        </ha-icon-button>
        <span slot="headerTitle">${title}</span>
        <div class="directory-content">
          <p>
            ${isCreate
              ? "Create a new directory."
              : "Edit the selected directory's settings."}
          </p>
          <form class="directory-form">
            <div class="directory-fields"></div>
            <p class="directory-error" role="alert"></p>
            <div class="directory-actions">
              <button type="button" class="cancel-button">
                Cancel
              </button>
              <button type="submit" class="primary save-button">
                Save
              </button>
            </div>
          </form>
        </div>
      </ha-adaptive-dialog>
    `;
    root.appendChild(template.content.cloneNode(true));
    const dialog = root.querySelector("ha-adaptive-dialog");
    const form = root.querySelector(".directory-form");
    const fields = root.querySelector(".directory-fields");
    const errorBox = root.querySelector(".directory-error");
    const saveButton = root.querySelector(".save-button");
    let closed = false;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      host.remove();
      if (this._activeDialog === host) {
        this._activeDialog = null;
      }
    };
    const closeForm = () => {
      dialog.open = false;
    };
    dialog.addEventListener("closed", cleanup, { once: true });
    root.querySelector("ha-icon-button")
      .addEventListener("click", closeForm);
    root.querySelector(".cancel-button")
      .addEventListener("click", closeForm);
    try {
      for (const field of flow.data_schema || []) {
        const name = field.name;
        const selector = field.selector || {};
        const label = document.createElement("label");
        const labelText = name === "instance_name"
          ? "Directory name"
          : name === "area_id"
            ? "Area"
            : name.replaceAll("_", " ");

        label.textContent =
          labelText.charAt(0).toUpperCase() + labelText.slice(1);
        let input;
        if (selector.select?.options) {
          input = document.createElement("select");
          if (selector.select.multiple) {
            input.multiple = true;
            input.size = Math.min(
              selector.select.options.length || 6,
              8
            );
          }
          for (const option of selector.select.options) {
            const value = typeof option === "string"
              ? option
              : option.value ?? option.label;
            const text = typeof option === "string"
              ? option
              : option.label ?? option.value;
            if (value !== undefined && value !== null) {
              input.add(new Option(String(text), String(value)));
            }
          }
        } else if (selector.area) {
          input = document.createElement("select");
          input.add(new Option("No area", ""));
          try {
            const areas = await this._hass.callWS({
              type: "config/area_registry/list",
            });
            for (const area of areas) {
              input.add(new Option(area.name, area.area_id));
            }
          } catch (error) {
            console.warn("Could not load Home Assistant areas:", error);
          }
        } else {
          input = document.createElement("input");
          if (selector.number) {
            input.type = "number";
          } else if (selector.date) {
            input.type = "date";
          } else {
            input.type = "text";
          }
        }
        input.name = name;
        input.id = `directory-field-${name}`;
        input.required = Boolean(field.required);
        const selectedValues = field.value ?? field.default;
        if (Array.isArray(selectedValues) && input.multiple) {
          const selectedSet = new Set(selectedValues.map(String));
          for (const option of input.options) {
            option.selected = selectedSet.has(option.value);
          }
        } else if (
          selectedValues !== undefined &&
          selectedValues !== null
        ) {
          input.value = String(selectedValues);
        }
        label.htmlFor = input.id;
        fields.append(label, input);
      }
      document.body.appendChild(host);
      this._activeDialog = host;
      dialog.open = true;
    } catch (error) {
      console.error("Documents: directory form failed to open", error);
      cleanup();
      alert("Could not open the directory form. Check the browser console.");
      return;
    }
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      errorBox.textContent = "";
      saveButton.disabled = true;
      saveButton.textContent = "Saving…";
      const data = {};
      for (const input of fields.querySelectorAll("[name]")) {
        if (input.multiple && input.tagName === "SELECT") {
          data[input.name] = Array.from(
            input.selectedOptions,
            (option) => option.value
          );
        } else if (input.value !== "") {
          data[input.name] = input.value;
        }
      }
      try {
        const nextFlow = await this._hass.callApi(
          "POST",
          isCreate
            ? `config/config_entries/flow/${flow.flow_id}`
            : `config/config_entries/options/flow/${flow.flow_id}`,
          data
        );
        if (nextFlow?.type === "form" && nextFlow.errors) {
          errorBox.textContent = Object.entries(nextFlow.errors)
            .map(([key, value]) => `${key}: ${value}`)
            .join("\n");
          saveButton.disabled = false;
          saveButton.textContent = "Save";
          return;
        }
        if (nextFlow?.type === "form") {
          closeForm();
          await this._showDirectoryFlowStep(nextFlow, action);
          return;
        }
        if (
          nextFlow?.type === "create_entry" ||
          nextFlow?.type === "abort" ||
          nextFlow?.type === "menu"
        ) {
          closeForm();
          await this._showDirectoryFlowStep(nextFlow, action);
          return;
        }
        errorBox.textContent =
          "Unexpected response from Home Assistant.";
        saveButton.disabled = false;
        saveButton.textContent = "Save";
      } catch (error) {
        console.error("Documents: saving directory failed", error);
        errorBox.textContent =
          error?.message || "Unable to save directory settings.";
        saveButton.disabled = false;
        saveButton.textContent = "Save";
      }
    });
  }
  async _showNotifyDevicesForm(flow) {
    await customElements.whenDefined("ha-adaptive-dialog");
    await customElements.whenDefined("ha-icon-button");
    if (this._activeDialog) {
      this._closeDialog(this._activeDialog);
    }
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;inset:0;z-index:2147483647;";
    const root = host.attachShadow({ mode: "open" });
    this.shadowRoot.querySelectorAll("style").forEach(style => {
      root.appendChild(style.cloneNode(true));
    });
    const template = document.createElement("template");
    template.innerHTML = `
      <style>
        .notify-content {
          box-sizing: border-box;
          width: 100%;
          max-height: min(78dvh, 760px);
          overflow-y: auto;
          padding: 0 20px 20px;
          color: var(--primary-text-color);
        }

        .notify-content select {
          box-sizing: border-box;
          display: block;
          width: 100%;
          min-height: 180px;
          padding: 10px;
          border: 1px solid var(--divider-color);
          border-radius: 8px;
          background: var(--secondary-background-color);
          color: var(--primary-text-color);
          font: inherit;
        }

        .notify-help {
          color: var(--secondary-text-color);
          font-size: 0.9rem;
          line-height: 1.5;
        }

        .notify-error {
          color: var(--error-color);
          white-space: pre-wrap;
          overflow-wrap: anywhere;
        }

        .notify-actions {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
          margin-top: 20px;
        }

        .notify-actions button {
          box-sizing: border-box;
          border: 1px solid rgba(255, 255, 255, 0.16);
          background: rgba(255, 255, 255, 0.08);
          color: white;
          width: 100%;
          min-width: 0;
          height: 44px;
          min-height: 44px;
          padding: 8px 12px;
          margin: 0;
          font: inherit;
          line-height: normal;
          border-radius: 999px;
          box-shadow: var(--ha-card-glass-inset-shadow);
        }

        .notify-actions .primary {
          background: var(--primary-color);
          border-color: var(--primary-color);
          color: var(--text-primary-color, white);
        }

        .notify-actions button:disabled {
          opacity: 0.55;
        }

        .notify-actions button:active {
          transform: scale(0.96);
          transition: 0s;
        }

        .device-picker-trigger {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          text-align: left;
          width: 100%;
          min-height: 44px;
          border: 1px solid rgba(255, 255, 255, 0.16);
          border-radius: 14px;
          padding: 10px 13px;
          background-color: rgba(22, 27, 38, 0.4);
          color: rgba(255, 255, 255, 0.94);
          font: inherit;
          cursor: pointer;
          box-shadow: var(--ha-card-glass-inset-shadow);
          outline: none;
        }

        .device-picker-trigger:focus {
          border-color: rgba(255, 255, 255, 0.32);
          box-shadow: var(--ha-card-glass-inset-shadow);
        }

        .device-picker-trigger ha-icon {
          --mdc-icon-size: 20px;
        }

        .device-picker-panel {
          margin-top: 8px;
          padding: 10px;
          border: 1px solid rgba(255, 255, 255, 0.16);
          border-radius: 14px;
          background-color: rgba(22, 27, 38, 0.4);
          color: rgba(255, 255, 255, 0.94);
          box-shadow: var(--ha-card-glass-inset-shadow);
        }

        .device-picker-panel[hidden] {
          display: none !important;
        }

        .device-picker-options {
          max-height: 240px;
          overflow-y: auto;
        }

        .device-picker-row {
          display: flex;
          align-items: center;
          gap: 12px;
          min-height: 42px;
          padding: 8px 6px;
          color: rgba(255, 255, 255, 0.94);
          cursor: pointer;
          overflow-wrap: anywhere;
        }

        .device-picker-row input {
          width: 18px;
          height: 18px;
          flex-shrink: 0;
          accent-color: var(--primary-color);
        }

        .notify-content .device-picker-done {
          width: 100%;
          min-height: 40px;
          margin-top: 10px;
          border: 1px solid var(--primary-color);
          border-radius: 999px;
          background: var(--primary-color);
          color: var(--text-primary-color, white);
          font: inherit;
          cursor: pointer;
          box-shadow: var(--ha-card-glass-inset-shadow);
        }

        .notify-content .device-picker-done:active {
          transform: scale(0.96);
          transition: 0s;
        }
      </style>

      <ha-adaptive-dialog>
        <ha-icon-button slot="headerNavigationIcon" label="Close" aria-label="Close Notify Devices" path="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12Z">
        </ha-icon-button>
        <span slot="headerTitle">Notify Devices</span>
        <div class="notify-content">
          <p>Select one or more phones to receive document reminders.</p>
          <p class="notify-help">
            On a phone or tablet, tap each device you want to select.
            Select devices, then tap Done to preview your changes before saving.
          </p>
          <form class="notify-form">
            <label for="notify-services">Devices to Notify</label>
            <button type="button" class="device-picker-trigger" aria-expanded="false"
              aria-controls="device-picker-panel" aria-label="Choose notification devices">
              <span class="device-picker-count">0 Devices</span>
              <ha-icon icon="mdi:chevron-down"></ha-icon>
            </button>
            <div id="device-picker-panel" class="device-picker-panel" hidden>
              <div class="device-picker-options" role="group" aria-label="Available devices"></div>
              <button type="button" class="device-picker-done">Done</button>
            </div>
            <p class="notify-error" role="alert"></p>
            <div class="notify-actions">
              <button type="button" class="cancel-button">Cancel</button>
              <button type="submit" class="primary save-button">Save</button>
            </div>
          </form>
        </div>
      </ha-adaptive-dialog>
    `;
    root.appendChild(template.content.cloneNode(true));
    const dialog = root.querySelector("ha-adaptive-dialog");
    const closeButton = root.querySelector("ha-icon-button");
    const form = root.querySelector(".notify-form");
    const trigger = root.querySelector(".device-picker-trigger");
    const countLabel = root.querySelector(".device-picker-count");
    const pickerPanel = root.querySelector("#device-picker-panel");
    const pickerOptions = root.querySelector(".device-picker-options");
    const doneButton = root.querySelector(".device-picker-done");
    const selectedDevices = new Set();
    const updateDeviceCount = () => {
      const count = selectedDevices.size;
      countLabel.textContent = `${count} ${count === 1 ? "Device" : "Devices"}`;
    };
    const setPickerOpen = (open) => {
      pickerPanel.hidden = !open;
      trigger.setAttribute("aria-expanded", String(open));
    };
    trigger.addEventListener("click", () => setPickerOpen(pickerPanel.hidden));
    doneButton.addEventListener("click", () => setPickerOpen(false));
    const errorBox = root.querySelector(".notify-error");
    const saveButton = root.querySelector(".save-button");
    const cleanup = () => {
      host.remove();
      if (this._activeDialog === host) {
        this._activeDialog = null;
      }
    };
    dialog.addEventListener("closed", cleanup, { once: true });
    const closeForm = () => {
      dialog.open = false;
    };
    closeButton.addEventListener("click", closeForm);
    root.querySelector(".cancel-button").addEventListener("click", closeForm);
    try {
      const schema = flow.data_schema || [];
      const field = schema.find(item => item.name === "notify_services");
      const selector = field?.selector?.select;
      const options = selector?.options || [];
      const selectedValues = field?.value ?? field?.default ?? [];
      for (const value of Array.isArray(selectedValues) ? selectedValues : []) {
        selectedDevices.add(String(value));
      }
      // Only count services that are selectable in the current flow.
      const available = new Set();
      for (const option of options) {
        const value = typeof option === "string"
          ? option : option.value ?? option.label;
        const label = typeof option === "string"
          ? option : option.label ?? option.value;
        if (value === undefined || value === null) continue;
        available.add(String(value));
        const row = document.createElement("label");
        row.className = "device-picker-row";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = String(value);
        checkbox.checked = selectedDevices.has(checkbox.value);
        const caption = document.createElement("span");
        caption.textContent = String(label);
        row.append(checkbox, caption);
        pickerOptions.appendChild(row);
        checkbox.addEventListener("change", () => {
          if (checkbox.checked) selectedDevices.add(checkbox.value);
          else selectedDevices.delete(checkbox.value);
          updateDeviceCount();
        });
      }
      for (const value of [...selectedDevices]) {
        if (!available.has(value)) selectedDevices.delete(value);
      }
      updateDeviceCount();
      form.addEventListener("submit", async event => {
        event.preventDefault();
        errorBox.textContent = "";
        saveButton.disabled = true;
        saveButton.textContent = "Saving…";
        const data = {
          notify_services: Array.from(selectedDevices),
        };
        try {
          const nextFlow = await this._hass.callApi(
            "POST",
            `config/config_entries/options/flow/${flow.flow_id}`,
            data
          );
          if (nextFlow?.type === "form") {
            errorBox.textContent = Object.entries(nextFlow.errors || {})
              .map(([key, value]) => `${key}: ${value}`)
              .join("\n") || "Home Assistant returned the form again.";
            saveButton.disabled = false;
            saveButton.textContent = "Save";
            return;
          }
          if (nextFlow?.type === "create_entry" || nextFlow?.type === "abort") {
            closeForm();
            await this._updateContent(true);
            return;
          }
          errorBox.textContent = "Unexpected response from Home Assistant.";
          saveButton.disabled = false;
          saveButton.textContent = "Save";
        } catch (error) {
          console.error("Documents: saving notification devices failed", error);
          errorBox.textContent =
            error?.message || "Unable to save notification devices.";
          saveButton.disabled = false;
          saveButton.textContent = "Save";
        }
      });
      document.body.appendChild(host);
      this._activeDialog = host;
      dialog.open = true;
    } catch (error) {
      console.error("Documents: opening notification devices failed", error);
      cleanup();
      alert("Could not display notification devices. Check the browser console.");
    }
  }
  async _showAddCategoryForm() {
    const directoryId = this._selectedDirectoryId;
    if (!directoryId || !this._hass) return;
    await customElements.whenDefined("ha-adaptive-dialog");
    await customElements.whenDefined("ha-icon-button");
    if (this._activeDialog) {
      this._closeDialog(this._activeDialog);
    }
    const host = document.createElement("div");
    host.style.cssText = `
      position: fixed;
      inset: 0;
      z-index: 2147483647;
    `;
    const root = host.attachShadow({ mode: "open" });
    this.shadowRoot.querySelectorAll("style").forEach(style => {
      root.appendChild(style.cloneNode(true));
    });
    const template = document.createElement("template");
    template.innerHTML = `
      <style>
        .category-dialog-content {
          box-sizing: border-box;
          width: 100%;
          max-width: 100%;
          min-width: 0;
          max-height: min(78dvh, 760px);
          overflow-x: hidden;
          overflow-y: auto;
          overscroll-behavior: contain;
          padding: 0 20px 20px;
          color: var(--primary-text-color);
        }

        .category-dialog-content *,
        .category-dialog-content *::before,
        .category-dialog-content *::after {
          box-sizing: border-box;
        }

        .category-editor {
          display: flex;
          flex-direction: column;
          gap: 20px;
          width: 100%;
          min-width: 0;
        }

        .category-section {
          width: 100%;
          min-width: 0;
          padding: 16px;
          border: 1px solid var(--divider-color);
          border-radius: 14px;
        }

        .category-section h3 {
          margin: 0 0 14px;
          color: var(--primary-text-color);
          font-size: 16px;
          font-weight: 600;
        }

        .category-section form {
          display: flex;
          flex-direction: column;
          gap: 12px;
          min-width: 0;
        }

        .category-dialog-content .form-field {
          display: flex;
          flex-direction: column;
          gap: 6px;
          width: 100%;
          min-width: 0;
          color: var(--secondary-text-color);
          font-size: 0.85rem;
        }

        .category-dialog-content .form-field input,
        .category-dialog-content .form-field select {
          display: block;
          width: 100%;
          max-width: 100%;
          min-width: 0;
          height: 44px;
          margin: 0;
          padding: 10px 13px;
          border: 1px solid rgba(255, 255, 255, 0.16);
          border-radius: 14px;
          background-color: rgba(22, 27, 38, 0.4);
          color: rgba(255, 255, 255, 0.94);
          font: inherit;
          color-scheme: dark;
          outline: none;
          box-shadow: var(--ha-card-glass-inset-shadow);
        }

        .category-dialog-content .form-field input:focus,
        .category-dialog-content .form-field select:focus {
          border-color: rgba(255, 255, 255, 0.32);
          box-shadow: var(--ha-card-glass-inset-shadow);
          outline: none;
        }

        .category-dialog-content .form-field option {
          background: #171c28;
          color: #f4f5f8;
        }

        .category-warning {
          margin: 0;
          color: var(--secondary-text-color);
          font-size: 0.8rem;
          line-height: 1.5;
        }

        .category-dialog-content button {
          box-sizing: border-box;
          width: 100%;
          max-width: 100%;
          min-width: 0;
          min-height: 42px;
          padding: 10px 16px;
          border: 1px solid var(--divider-color);
          border-radius: 999px;
          background: var(--secondary-background-color);
          color: var(--primary-text-color);
          font: inherit;
          cursor: pointer;
          box-shadow: var(--ha-card-glass-inset-shadow);
        }

        .category-dialog-content button:active {
          transform: scale(0.96);
          transition: 0s;
        }

        .category-dialog-content .primary {
          border-color: var(--primary-color);
          background: var(--primary-color);
          color: var(--text-primary-color, white);
        }

        .category-dialog-content .delete-category-button {
          border-color: var(--error-color);
          background: transparent;
          color: var(--error-color);
        }

        .category-dialog-content button:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }

        .category-dialog-content .form-error {
          margin-top: 12px;
          color: var(--error-color);
          font-size: 0.85rem;
          white-space: pre-wrap;
          overflow-wrap: anywhere;
        }

        .category-dialog-content .form-error[hidden] {
          display: none;
        }
      </style>

      <ha-adaptive-dialog>
        <ha-icon-button slot="headerNavigationIcon" label="Close" aria-label="Close category manager" path="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12Z">
        </ha-icon-button>
        <span slot="headerTitle">Edit Category</span>
        <div class="category-dialog-content">
          <div class="category-editor">
            <section class="category-section">
              <h3>Add Category</h3>
              <form class="add-category-form">
                <div class="form-field">
                  <label for="new-category-name">
                    Category name *
                  </label>
                  <input id="new-category-name" name="name" type="text" maxlength="100" required autocomplete="off" placeholder="e.g. Medical Certificate">
                </div>
                <button class="primary save-button" type="submit">
                  Create Category
                </button>
              </form>
            </section>
            <section class="category-section">
              <h3>Delete Category</h3>
              <form class="delete-category-form">
                <div class="form-field">
                  <label for="delete-category-select">
                    Select category
                  </label>
                  <select id="delete-category-select" name="category" required>
                    <option value="">Select a category</option>
                  </select>
                </div>
                <p class="category-warning">
                  Categories in use by documents cannot be deleted.
                  The built-in Other category is protected.
                </p>
                <button class="delete-category-button" type="submit">
                  Delete Category
                </button>
              </form>
            </section>
          </div>
          <div class="form-error" role="alert" hidden></div>
        </div>
      </ha-adaptive-dialog>
    `;
    root.appendChild(template.content.cloneNode(true));
    const dialog = root.querySelector("ha-adaptive-dialog");
    const closeButton = root.querySelector("ha-icon-button");
    const addForm = root.querySelector(".add-category-form");
    const deleteForm = root.querySelector(".delete-category-form");
    const nameInput = addForm.elements.name;
    const categorySelect = deleteForm.elements.category;
    const errorBox = root.querySelector(".form-error");
    const addButton = addForm.querySelector(".save-button");
    const deleteButton = deleteForm.querySelector(
      ".delete-category-button"
    );
    const cleanup = () => {
      host.remove();
      if (this._activeDialog === host) {
        this._activeDialog = null;
      }
    };
    dialog.addEventListener("closed", cleanup, { once: true });
    const closeForm = () => {
      dialog.open = false;
    };
    const showError = message => {
      errorBox.textContent = message;
      errorBox.hidden = false;
    };
    const clearError = () => {
      errorBox.textContent = "";
      errorBox.hidden = true;
    };
    const populateCategories = () => {
      const categories = this._getCategories(
        this._hass.states,
        directoryId
      );
      categorySelect.replaceChildren(
        new Option("Select a category", "")
      );
      categories
        .filter(category =>
          category.trim().toLowerCase() !== "other"
        )
        .forEach(category => {
          categorySelect.add(new Option(category, category));
        });
    };
    closeButton.addEventListener("click", closeForm);
    addForm.addEventListener("submit", async event => {
      event.preventDefault();
      clearError();
      const name = nameInput.value.trim();
      if (!name) {
        showError("Enter a category name.");
        return;
      }
      const categories = this._getCategories(
        this._hass.states,
        directoryId
      );
      if (categories.some(
        category =>
          category.trim().toLowerCase() === name.toLowerCase()
      )) {
        showError("This category already exists.");
        return;
      }
      addButton.disabled = true;
      addButton.textContent = "Creating…";
      try {
        await this._hass.callService(
          "docharbor",
          "add_category",
          { directory: directoryId, name }
        );
        // Refresh Home Assistant's frontend state cache.
        await this._hass.callWS({ type: "get_states" }).then(states => {
          this._hass = {
            ...this._hass,
            states: Object.fromEntries(
              states.map(entity => [entity.entity_id, entity])
            ),
          };
        });
        nameInput.value = "";
        populateCategories();
        showError("Category created successfully.");
      } catch (error) {
        console.error(
          "Documents: failed to create category",
          error
        );
        showError(
          error?.message || "Unable to create category."
        );
      } finally {
        addButton.disabled = false;
        addButton.textContent = "Create Category";
      }
    });
    deleteForm.addEventListener("submit", async event => {
      event.preventDefault();
      clearError();
      const name = categorySelect.value;
      if (!name) {
        showError("Select a category to delete.");
        categorySelect.focus();
        return;
      }
      if (!window.confirm(
        `Delete the category "${name}"?\n\n` +
        "This is allowed only when no documents use it."
      )) {
        return;
      }
      deleteButton.disabled = true;
      deleteButton.textContent = "Deleting…";
      try {
        await this._hass.callService(
          "docharbor",
          "remove_category",
          { directory: directoryId, name }
        );
        await this._hass.callWS({ type: "get_states" }).then(states => {
          this._hass = {
            ...this._hass,
            states: Object.fromEntries(
              states.map(entity => [entity.entity_id, entity])
            ),
          };
        });
        populateCategories();
        categorySelect.value = "";
        showError(`Category "${name}" deleted successfully.`);
      } catch (error) {
        console.error(
          "Documents: failed to delete category",
          error
        );
        showError(
          error?.message ||
          "Unable to delete category. Check whether documents still use it."
        );
      } finally {
        deleteButton.disabled = false;
        deleteButton.textContent = "Delete Category";
      }
    });
    populateCategories();
    document.body.appendChild(host);
    this._activeDialog = host;
    dialog.open = true;
  }
  async _showAddDocumentForm() {
    const directoryId = this._selectedDirectoryId;
    if (!directoryId || !this._hass) return;
    await customElements.whenDefined("ha-adaptive-dialog");
    await customElements.whenDefined("ha-icon-button");
    await customElements.whenDefined("ha-icon-picker");
    // Close any previously open dialog.
    if (this._activeDialog) {
      this._closeDialog(this._activeDialog);
    }
    const categories = this._getCategories(
      this._hass.states,
      directoryId
    );
    // Keep the dialog outside the card/Bubble Card stacking context.
    const host = document.createElement("div");
    host.style.cssText = `
      position: fixed;
      inset: 0;
      z-index: 2147483647;
    `;
    const root = host.attachShadow({ mode: "open" });
    // Preserve the existing card styles inside the isolated dialog.
    this.shadowRoot.querySelectorAll("style").forEach(style => {
      root.appendChild(style.cloneNode(true));
    });
    const template = document.createElement("template");
    template.innerHTML = `
      <style>
        .add-document-content {
          box-sizing: border-box;
          width: 100%;
          max-width: 100%;
          min-width: 0;
          max-height: min(78dvh, 760px);
          overflow-x: hidden;
          overflow-y: auto;
          overscroll-behavior: contain;
          padding: 0 20px 20px;
          color: var(--primary-text-color);
        }

        .add-document-content *,
        .add-document-content *::before,
        .add-document-content *::after {
          box-sizing: border-box;
        }

        .add-document-content .document-form {
          width: 100%;
          max-width: 100%;
          min-width: 0;
        }

        .add-document-content .form-field {
          width: 100%;
          max-width: 100%;
          min-width: 0;
          color: var(--secondary-text-color);
        }

        .add-document-content .form-field input,
        .add-document-content .form-field select,
        .add-document-content .form-field textarea {
          box-sizing: border-box;
          display: block;
          width: 100%;
          max-width: 100%;
          min-width: 0;
          height: 44px;
          padding: 10px 13px;
          margin: 0;
          background-color: rgba(22, 27, 38, 0.4);
          color: rgba(255, 255, 255, 0.94);
          border: 1px solid rgba(255, 255, 255, 0.16);
          border-radius: 14px;
          outline: none;
          font: inherit;
          color-scheme: dark;
          box-shadow: var(--ha-card-glass-inset-shadow);
        }

        .add-document-content .form-field input:focus,
        .add-document-content .form-field select:focus,
        .add-document-content .form-field textarea:focus {
          border-color: rgba(255, 255, 255, 0.32);
          box-shadow: var(--ha-card-glass-inset-shadow);
        }

        .add-document-content .form-field option {
          background: #171c28;
          color: #f4f5f8;
        }

        .add-document-content .form-field input[type="date"] {
          appearance: none;
          -webkit-appearance: none;
        }

        .add-document-content .form-actions {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
          width: 100%;
          max-width: 100%;
          min-width: 0;
        }

        .add-document-content .form-actions button {
          box-sizing: border-box;
          width: 100%;
          min-width: 0;
          height: 44px;
          min-height: 44px;
          padding: 8px 12px;
          margin: 0;
          font: inherit;
          line-height: normal;
          border-radius: 999px;
          box-shadow: var(--ha-card-glass-inset-shadow);
        }

        .add-document-content .form-actions button:active {
          transform: scale(0.96);
          transition: 0s;
        }

        .add-document-content .form-actions .primary {
          background: var(--primary-color);
          color: var(--text-primary-color, white);
          border-color: var(--primary-color);
        }

        .add-document-content .form-error {
          color: var(--error-color);
        }

        .add-document-content .icon-picker-native {
          width: 100%;
          max-width: 100%;
          min-width: 0;
        }

        .add-document-content ha-icon-picker {
          display: block;
          width: 100%;
          max-width: 100%;
          min-width: 0;
          --mdc-theme-primary: var(--primary-color);
        }
      </style>
      <ha-adaptive-dialog>
        <ha-icon-button slot="headerNavigationIcon" label="Close" aria-label="Close Add Document" path="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12Z">
        </ha-icon-button>
        <span slot="headerTitle">Add Document</span>
        <div class="add-document-content">
          <form class="document-form">
            <div class="form-field">
              <label for="doc-name">Document name *</label>
              <input id="doc-name" name="name" type="text" maxlength="200" required placeholder="e.g. Passport">
            </div>
            <div class="form-field">
              <label for="doc-uin">UIN / Document number</label>
              <input id="doc-uin" name="uin" type="text" maxlength="200" placeholder="Enter document number">
            </div>
            <div class="form-field">
              <label for="doc-category">Category</label>
              <select id="doc-category" name="category">
                ${categories.map(category => `
                  <option value="${this._escape(category)}"
                    ${category === "Other" ? "selected" : ""}>
                    ${this._escape(category)}
                  </option>
                `).join("")}
              </select>
            </div>
            ${this._iconPickerMarkup(
              "add",
              "mdi:file-document-outline"
            )}
            <div class="form-field">
              <label for="doc-issue-date">Issue date</label>
              <input id="doc-issue-date" name="issue_date" type="date">
            </div>
            <div class="form-field">
              <label for="doc-expiry-date">Expiry date *</label>
              <input id="doc-expiry-date" name="expiry_date" type="date" required>
            </div>
            <div class="form-field">
              <label for="doc-renewal-days">
                Renewal lead time (days)
              </label>
              <input id="doc-renewal-days" name="renewal_lead_days" type="number" min="0" max="730" step="1" value="180" required>
            </div>
            <div class="form-field">
              <label for="doc-notes">Notes (optional)</label>
              <textarea id="doc-notes" name="notes" maxlength="2000" placeholder="Additional details"></textarea>
            </div>
            <div class="form-error" role="alert"></div>
            <div class="form-actions">
              <button class="cancel-button" type="button">Cancel</button>
              <button class="primary submit-button" type="submit">Save</button>
            </div>
          </form>
        </div>
      </ha-adaptive-dialog>
    `;
    root.appendChild(template.content.cloneNode(true));
    const dialog = root.querySelector("ha-adaptive-dialog");
    const closeButton = root.querySelector("ha-icon-button");
    const form = root.querySelector(".document-form");
    const errorBox = root.querySelector(".form-error");
    const submitButton = root.querySelector(".submit-button");
    const cleanup = () => {
      host.remove();
      if (this._activeDialog === host) {
        this._activeDialog = null;
      }
    };
    // Handles the native close button, swipe dismissal and other
    // native dialog close events.
    dialog.addEventListener("closed", cleanup, { once: true });
    const closeForm = () => {
      dialog.open = false;
    };
    closeButton.addEventListener("click", closeForm);
    root.querySelector(".cancel-button")
      .addEventListener("click", closeForm);
    this._attachIconPicker(
      root,
      "add",
      "mdi:file-document-outline"
    );
    form.addEventListener("submit", async event => {
      event.preventDefault();
      errorBox.textContent = "";
      errorBox.style.display = "";
      const name = form.elements.name.value.trim();
      const expiryDate = form.elements.expiry_date.value;
      const issueDate = form.elements.issue_date.value;
      const renewalLeadDays = Number(
        form.elements.renewal_lead_days.value
      );
      if (!name || !expiryDate) {
        errorBox.textContent =
          "Document name and expiry date are required.";
        return;
      }
      if (issueDate && expiryDate && expiryDate < issueDate) {
        errorBox.textContent =
          "Issue date cannot be later than expiry date.";
        errorBox.style.display = "block";
        return;
      }
      if (
        !Number.isInteger(renewalLeadDays) ||
        renewalLeadDays < 0 ||
        renewalLeadDays > 730
      ) {
        errorBox.textContent =
          "Renewal lead time must be between 0 and 730 days.";
        return;
      }
      const selectedIcon =
        (form.elements.add_icon.value || "mdi:file-document-outline").trim();
      const serviceData = {
        directory: directoryId,
        name,
        expiry_date: expiryDate,
        category: form.elements.category.value || "Other",
        renewal_lead_days: renewalLeadDays,
        icon: selectedIcon,
      };
      const uin = form.elements.uin.value.trim();
      const notes = form.elements.notes.value.trim();
      if (uin) serviceData.uin = uin;
      if (issueDate) serviceData.issue_date = issueDate;
      if (notes) serviceData.notes = notes;
      submitButton.disabled = true;
      submitButton.textContent = "Saving…";
      try {
        await this._hass.callService(
          "docharbor",
          "add_document",
          serviceData
        );
        this._saveDocumentIcon(directoryId, {
          name,
          uin,
          category: serviceData.category,
          issueDate,
          expiryDate,
        }, form.elements.add_icon.value);
        closeForm();
        // Home Assistant normally publishes the new sensor asynchronously.
        // The hass setter will refresh the list when that state arrives.
        this._updateContent();
      } catch (error) {
        console.error("Documents: add failed", error);
        errorBox.textContent =
          error?.message ||
          "Unable to save the document. Please try again.";
        submitButton.disabled = false;
        submitButton.textContent = "Save";
      }
    });
    document.body.appendChild(host);
    this._activeDialog = host;
    dialog.open = true;
  }
  async _showEditDocumentForm(document) {
    if (!document) return;
    if (!document.documentId) {
      alert(
        "Document ID is missing. Check that _getDocuments() " +
        "includes documentId: attrs.document_id."
      );
      return;
    }
    if (!this._hass || !this._selectedDirectoryId) return;
    await customElements.whenDefined("ha-adaptive-dialog");
    await customElements.whenDefined("ha-icon-button");
    await customElements.whenDefined("ha-icon-picker");
    if (this._activeDialog) {
      this._closeDialog(this._activeDialog);
    }
    const directoryId = this._selectedDirectoryId;
    const currentIcon = this._getDocumentIcon(document, directoryId);
    const categories = this._getCategories(
      this._hass.states,
      directoryId
    );
    if (
      document.category &&
      !categories.includes(document.category)
    ) {
      categories.push(document.category);
      categories.sort((a, b) => {
        if (a === "Other") return 1;
        if (b === "Other") return -1;
        return a.localeCompare(b);
      });
    }
    const host = window.document.createElement("div");
    host.style.cssText = `
      position: fixed;
      inset: 0;
      z-index: 2147483647;
    `;
    const root = host.attachShadow({ mode: "open" });
    this.shadowRoot.querySelectorAll("style").forEach(style => {
      root.appendChild(style.cloneNode(true));
    });
    const template = window.document.createElement("template");
    template.innerHTML = `
      <style>
        .edit-document-content {
          box-sizing: border-box;
          width: 100%;
          max-width: 100%;
          min-width: 0;
          max-height: min(78dvh, 760px);
          overflow-x: hidden;
          overflow-y: auto;
          overscroll-behavior: contain;
          padding: 0 20px 20px;
          color: var(--primary-text-color);
        }

        .edit-document-content *,
        .edit-document-content *::before,
        .edit-document-content *::after {
          box-sizing: border-box;
        }

        .edit-document-content .document-form,
        .edit-document-content .form-field,
        .edit-document-content .icon-picker-native {
          width: 100%;
          max-width: 100%;
          min-width: 0;
        }

        .edit-document-content .form-field {
          color: var(--secondary-text-color);
        }

        .edit-document-content .form-field input,
        .edit-document-content .form-field select,
        .edit-document-content .form-field textarea {
          display: block;
          width: 100%;
          max-width: 100%;
          min-width: 0;
          margin: 0;
          padding: 10px 13px;
          background-color: rgba(22, 27, 38, 0.4);
          color: rgba(255, 255, 255, 0.94);
          border: 1px solid rgba(255, 255, 255, 0.16);
          border-radius: 14px;
          outline: none;
          font: inherit;
          color-scheme: dark;
          box-shadow: var(--ha-card-glass-inset-shadow);
        }

        .edit-document-content .form-field input,
        .edit-document-content .form-field select {
          height: 44px;
        }

        .edit-document-content .form-field input:focus,
        .edit-document-content .form-field select:focus,
        .edit-document-content .form-field textarea:focus {
          border-color: rgba(255, 255, 255, 0.32);
          box-shadow: var(--ha-card-glass-inset-shadow);
        }

        .edit-document-content .form-field option {
          background: #171c28;
          color: #f4f5f8;
        }

        .edit-document-content .form-field input[type="date"] {
          appearance: none;
          -webkit-appearance: none;
        }

        .edit-document-content .form-field textarea {
          min-height: 80px;
          resize: vertical;
        }

        .edit-document-content .form-actions {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
          width: 100%;
          max-width: 100%;
          min-width: 0;
        }

        .edit-document-content .form-actions button {
          box-sizing: border-box;
          width: 100%;
          min-width: 0;
          height: 44px;
          min-height: 44px;
          padding: 8px 12px;
          margin: 0;
          font: inherit;
          line-height: normal;
          border-radius: 999px;
          box-shadow: var(--ha-card-glass-inset-shadow);
        }

        .edit-document-content .form-actions button:active {
          transform: scale(0.96);
          transition: 0s;
        }

        .edit-document-content .form-actions .primary {
          background: var(--primary-color);
          color: var(--text-primary-color, white);
          border-color: var(--primary-color);
        }

        .edit-document-content .form-actions .delete-document-button {
          grid-column: 1 / -1;
          color: var(--error-color);
        }

        .edit-document-content .form-error {
          color: var(--error-color);
          overflow-wrap: anywhere;
        }

        .edit-document-content ha-icon-picker {
          display: block;
          width: 100%;
          max-width: 100%;
          min-width: 0;
          --mdc-theme-primary: var(--primary-color);
        }
      </style>
      <ha-adaptive-dialog>
        <ha-icon-button slot="headerNavigationIcon" label="Close" aria-label="Close Edit Document" path="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12Z">
        </ha-icon-button>
        <span slot="headerTitle">Edit Document</span>
        <div class="edit-document-content">
          <form class="document-form">
            <div class="form-field">
              <label for="edit-doc-name">Document name *</label>
              <input id="edit-doc-name" name="name" type="text" maxlength="200" required>
            </div>
            <div class="form-field">
              <label for="edit-doc-uin">UIN / Document number</label>
              <input id="edit-doc-uin" name="uin" type="text" maxlength="200">
            </div>
            <div class="form-field">
              <label for="edit-doc-category">Category</label>
              <select id="edit-doc-category" name="category">
                ${categories.map(category => `
                  <option value="${this._escape(category)}"
                    ${category === document.category ? "selected" : ""}>
                    ${this._escape(category)}
                  </option>
                `).join("")}
              </select>
            </div>
            ${this._iconPickerMarkup("edit", currentIcon)}
            <div class="form-field">
              <label for="edit-doc-issue-date">Issue date</label>
              <input id="edit-doc-issue-date" name="issue_date" type="date">
            </div>
            <div class="form-field">
              <label for="edit-doc-expiry-date">Expiry date *</label>
              <input id="edit-doc-expiry-date" name="expiry_date" type="date" required>
            </div>
            <div class="form-field">
              <label for="edit-doc-renewal-days">
                Renewal lead time (days)
              </label>
              <input id="edit-doc-renewal-days" name="renewal_lead_days" type="number" min="0" max="730" step="1" required>
            </div>
            <div class="form-field">
              <label for="edit-doc-notes">Notes (optional)</label>
              <textarea id="edit-doc-notes" name="notes" maxlength="2000"></textarea>
            </div>
            <div class="form-error" role="alert"></div>
            <div class="form-actions">
              <button class="cancel-button" type="button">
                Cancel
              </button>
              <button class="primary save-button" type="submit">
                Save
              </button>
              <button type="button" class="delete-document-button">
                Delete Document
              </button>
            </div>
          </form>
        </div>
      </ha-adaptive-dialog>
    `;
    root.appendChild(template.content.cloneNode(true));
    const dialog = root.querySelector("ha-adaptive-dialog");
    const closeButton = root.querySelector("ha-icon-button");
    const form = root.querySelector(".document-form");
    const errorBox = root.querySelector(".form-error");
    const saveButton = root.querySelector(".save-button");
    const deleteButton = root.querySelector(".delete-document-button");
    // Populate values as properties so special characters remain safe.
    form.elements.name.value = document.name || "";
    form.elements.uin.value = document.uin || "";
    form.elements.issue_date.value = document.issueDate || "";
    form.elements.expiry_date.value = document.expiryDate || "";
    form.elements.renewal_lead_days.value =
      document.renewalLeadDays ?? 180;
    form.elements.notes.value = document.notes || "";
    const cleanup = () => {
      host.remove();
      if (this._activeDialog === host) {
        this._activeDialog = null;
      }
    };
    dialog.addEventListener("closed", cleanup, { once: true });
    const closeForm = () => {
      dialog.open = false;
    };
    closeButton.addEventListener("click", closeForm);
    root.querySelector(".cancel-button")
      .addEventListener("click", closeForm);
    this._attachIconPicker(root, "edit", currentIcon);
    const refreshStates = async () => {
      const states = await this._hass.callWS({
        type: "get_states",
      });
      this._hass = {
        ...this._hass,
        states: Object.fromEntries(
          states.map(entity => [entity.entity_id, entity])
        ),
      };
    };
    deleteButton.addEventListener("click", async () => {
      const confirmed = window.confirm(
        `Delete "${document.name}"? This action cannot be undone.`
      );
      if (!confirmed) return;
      deleteButton.disabled = true;
      deleteButton.textContent = "Deleting…";
      try {
        await this._hass.callService(
          "docharbor",
          "remove_document",
          {
            directory: directoryId,
            document_id: document.documentId,
          }
        );
        await refreshStates();
        closeForm();
        this._updateContent();
      } catch (error) {
        console.error(
          "Documents: failed to delete document",
          error
        );
        errorBox.textContent =
          error?.message || "Unable to delete document.";
        deleteButton.disabled = false;
        deleteButton.textContent = "Delete Document";
      }
    });
    form.addEventListener("submit", async event => {
      event.preventDefault();
      errorBox.textContent = "";
      errorBox.style.display = "";
      const name = form.elements.name.value.trim();
      const expiryDate = form.elements.expiry_date.value;
      const issueDate = form.elements.issue_date.value;
      const renewalLeadDays = Number(
        form.elements.renewal_lead_days.value
      );
      if (!name || !expiryDate) {
        errorBox.textContent =
          "Document name and expiry date are required.";
        return;
      }
      if (issueDate && expiryDate && expiryDate < issueDate) {
        errorBox.textContent =
          "Issue date cannot be later than expiry date.";
        errorBox.style.display = "block";
        return;
      }
      if (
        !Number.isInteger(renewalLeadDays) ||
        renewalLeadDays < 0 ||
        renewalLeadDays > 730
      ) {
        errorBox.textContent =
          "Renewal lead time must be between 0 and 730 days.";
        return;
      }
      const selectedIcon =
        (form.elements.edit_icon.value || currentIcon || "mdi:file-document-outline").trim();
      const serviceData = {
        directory: directoryId,
        document_id: document.documentId,
        name,
        uin: form.elements.uin.value.trim(),
        issue_date: issueDate,
        expiry_date: expiryDate,
        category: form.elements.category.value || "Other",
        renewal_lead_days: renewalLeadDays,
        notes: form.elements.notes.value.trim(),
        icon: selectedIcon,
      };
      saveButton.disabled = true;
      saveButton.textContent = "Saving…";
      try {
        await this._hass.callService(
          "docharbor",
          "update_document",
          serviceData
        );
        await refreshStates();
        this._saveDocumentIcon(directoryId, {
          documentId: document.documentId,
          name,
          uin: serviceData.uin,
          category: serviceData.category,
          issueDate,
          expiryDate,
        }, form.elements.edit_icon.value);
        closeForm();
        this._updateContent();
      } catch (error) {
        console.error(
          "Documents: failed to update document",
          error
        );
        errorBox.textContent =
          error?.message ||
          "Could not update the document. Check Home Assistant logs.";
        saveButton.disabled = false;
        saveButton.textContent = "Save";
      }
    });
    window.document.body.appendChild(host);
    this._activeDialog = host;
    dialog.open = true;
  }
  async _showDocumentDetails(document) {
    if (!document) return;
    await customElements.whenDefined("ha-adaptive-dialog");
    await customElements.whenDefined("ha-icon-button");
    if (this._activeDialog) {
      this._closeDialog(this._activeDialog);
    }
    const days = document.daysRemaining;
    let daysText = "Unavailable";
    if (days !== null && days !== undefined) {
      if (days < 0) {
        daysText = `Expired ${Math.abs(days)} day(s) ago`;
      } else if (days === 0) {
        daysText = "Expires today";
      } else {
        daysText = `${days} day(s) remaining`;
      }
    }
    const details = [
      ["Category", document.category],
      ["UIN", document.uin],
      ["Issue date", this._formatDate(document.issueDate)],
      ["Expiry date", this._formatDate(document.expiryDate)],
      ["Status", this._statusLabel(document.status)],
      ["Days remaining", daysText],
      [
        "Renewal lead time",
        document.renewalLeadDays != null
          ? `${document.renewalLeadDays} days`
          : null,
      ],
      ["Notes", document.notes],
    ].filter(([, value]) =>
      value !== null && value !== undefined && value !== ""
    );
    const host = window.document.createElement("div");
    host.style.cssText =
      "position:fixed;inset:0;z-index:2147483647;";
    const root = host.attachShadow({ mode: "open" });
    // Reuse the card's existing styles.
    this.shadowRoot.querySelectorAll("style").forEach(style => {
      root.appendChild(style.cloneNode(true));
    });
    const dialog = window.document.createElement(
      "ha-adaptive-dialog"
    );
    dialog.setAttribute("aria-label", document.name || "Document details");
    dialog.innerHTML = `
      <ha-icon-button slot="headerNavigationIcon" dialogAction="cancel" aria-label="Close details">
        <ha-icon icon="mdi:close"></ha-icon>
      </ha-icon-button>
      <span slot="headerTitle">Document Details</span>
      <div class="native-details-content">
        <div class="details-heading">
          <div class="details-icon">
            <ha-icon icon="${this._escape(
              this._getDocumentIcon(document)
            )}"></ha-icon>
          </div>
          <div class="details-title">
            ${this._escape(document.name || "Untitled document")}
          </div>
          <button class="edit-document-button" type="button">
            Edit
          </button>
        </div>
        <div class="details-content">
          ${details.map(([label, value]) => `
            <div class="details-row">
              <div class="details-label">
                ${this._escape(label)}
              </div>
              <div class="details-value">
                ${this._escape(String(value))}
              </div>
            </div>
          `).join("")}
        </div>
      </div>
    `;
    const style = window.document.createElement("style");
    style.textContent = `
      :host {
        color: var(--primary-text-color);
      }
      .native-details-content {
        box-sizing: border-box;
        width: 100%;
        min-width: 0;
        padding: 0 16px 20px;
        overflow-wrap: anywhere;
      }
      .details-heading {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 8px 0 18px;
        border-bottom: 1px solid var(--divider-color);
      }
      .details-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        width: 44px;
        height: 44px;
        border-radius: 12px;
        background: var(--secondary-background-color);
        color: var(--primary-color);
      }
      .details-icon ha-icon {
        --mdc-icon-size: 25px;
      }
      .details-title {
        flex: 1;
        min-width: 0;
        font-size: 18px;
        font-weight: 600;
        overflow-wrap: anywhere;
      }
      .edit-document-button {
        flex-shrink: 0;
        border: none;
        border-radius: 999px;
        padding: 8px 18px;
        background: var(--primary-color);
        color: var(--text-primary-color, white);
        font: inherit;
        font-weight: 500;
        cursor: pointer;
        box-shadow: var(--ha-card-glass-inset-shadow);
      }
      .edit-document-button:active {
        transform: scale(0.96);
        transition: 0s;
      }
      .details-content {
        display: flex;
        flex-direction: column;
      }
      .details-row {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 13px 0;
        border-bottom: 1px solid var(--divider-color);
      }
      .details-row:last-child {
        border-bottom: none;
      }
      .details-label {
        color: var(--secondary-text-color);
        font-size: 12px;
        font-weight: 500;
      }
      .details-value {
        color: var(--primary-text-color);
        font-size: 14px;
        line-height: 1.5;
        white-space: normal;
      }
      @media (min-width: 600px) {
        .details-row {
          display: grid;
          grid-template-columns: minmax(130px, 0.8fr) minmax(0, 1.5fr);
          gap: 16px;
        }
      }
    `;
    root.appendChild(style);
    root.appendChild(dialog);
    const closeButton = dialog.querySelector(
      'ha-icon-button[slot="headerNavigationIcon"]'
    );
    closeButton?.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      cleanup();
    });
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      host.remove();
      if (this._activeDialog === host) {
        this._activeDialog = null;
      }
    };
    dialog.addEventListener("closed", cleanup);
    dialog.addEventListener("cancel", cleanup);
    dialog.addEventListener("click", event => {
      const editButton = event.composedPath().find(
        element =>
          element?.classList?.contains("edit-document-button")
      );
      if (!editButton) return;
      event.preventDefault();
      cleanup();
      this._showEditDocumentForm(document);
    });
    window.document.body.appendChild(host);
    this._activeDialog = host;
    dialog.open = true;
  }
  static getStubConfig() {
    return { title: "Documents" };
  }
  async _showSailingDatesDialog() {
    const directoryId = this._selectedDirectoryId;
    if (!directoryId || !this._hass) return;
    await customElements.whenDefined("ha-adaptive-dialog");
    await customElements.whenDefined("ha-icon-button");
    // Close any previously open dialog.
    if (this._activeDialog) {
      this._closeDialog(this._activeDialog);
    }
    // Read the current sailing dates for the selected directory.
    const sensor = Object.values(this._hass.states).find(
      (entity) => {
        const attributes = entity?.attributes || {};
        return (
          attributes.directory_id === directoryId &&
          (
            attributes.instance_id === directoryId ||
            entity.entity_id?.includes(
              "documents_needing_attention"
            )
          )
        );
      }
    );
    const attributes = sensor?.attributes || {};
    if (!sensor) {
      console.warn(
        "Seafarer Documents: summary sensor not found for directory",
        directoryId
      );
      return;
    }
    const joiningDate = attributes.joining_date || "";
    const expectedSignoffDate =
      attributes.expected_signoff_date || "";
    const bufferDays = Number(attributes.buffer_days ?? 14);
    // Keep the dialog outside the card/Bubble Card stacking context.
    const host = document.createElement("div");
    host.style.cssText = `
      position: fixed;
      inset: 0;
      z-index: 2147483647;
    `;
    const root = host.attachShadow({ mode: "open" });
    // Preserve existing card styles.
    this.shadowRoot.querySelectorAll("style").forEach(style => {
      root.appendChild(style.cloneNode(true));
    });
    const template = document.createElement("template");
    template.innerHTML = `
      <style>
        .sailing-dates-content {
          box-sizing: border-box;
          width: 100%;
          max-width: 100%;
          min-width: 0;
          max-height: min(78dvh, 760px);
          overflow-x: hidden;
          overflow-y: auto;
          overscroll-behavior: contain;
          padding: 0 20px 20px;
          color: var(--primary-text-color);
        }

        .sailing-dates-content *,
        .sailing-dates-content *::before,
        .sailing-dates-content *::after {
          box-sizing: border-box;
        }

        .sailing-dates-content .form-field {
          width: 100%;
          max-width: 100%;
          min-width: 0;
          margin-bottom: 16px;
          color: var(--secondary-text-color);
        }

        .sailing-dates-content .form-field label {
          display: block;
          margin-bottom: 8px;
        }

        .sailing-dates-content .form-field input {
          box-sizing: border-box;
          display: block;
          width: 100%;
          max-width: 100%;
          min-width: 0;
          height: 44px;
          padding: 10px 13px;
          margin: 0;
          background-color: rgba(22, 27, 38, 0.4);
          color: rgba(255, 255, 255, 0.94);
          border: 1px solid rgba(255, 255, 255, 0.16);
          border-radius: 14px;
          outline: none;
          font: inherit;
          color-scheme: dark;
          box-shadow: var(--ha-card-glass-inset-shadow);
        }

        .sailing-dates-content .form-field input:focus {
          border-color: rgba(255, 255, 255, 0.32);
          box-shadow: var(--ha-card-glass-inset-shadow);
        }

        .sailing-dates-content .form-field input[type="date"] {
          appearance: none;
          -webkit-appearance: none;
        }

        .sailing-dates-content .form-actions {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
          width: 100%;
        }

        .sailing-dates-content .form-actions button {
          box-sizing: border-box;
          width: 100%;
          min-width: 0;
          height: 44px;
          min-height: 44px;
          padding: 8px 12px;
          margin: 0;
          font: inherit;
          border: 1px solid var(--divider-color);
          border-radius: 999px;
          cursor: pointer;
          box-shadow: var(--ha-card-glass-inset-shadow);
        }

        .sailing-dates-content .form-actions button:active {
          transform: scale(0.96);
          transition: 0s;
        }

        .sailing-dates-content .form-actions .primary {
          background: var(--primary-color);
          color: var(--text-primary-color, white);
          border-color: var(--primary-color);
        }

        .sailing-dates-content .form-error {
          color: var(--error-color);
          margin-bottom: 12px;
        }
      </style>
      <ha-adaptive-dialog>
        <ha-icon-button slot="headerNavigationIcon" label="Close" aria-label="Close Schedule Planner" path="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12Z">
        </ha-icon-button>
        <span slot="headerTitle">Schedule Planner</span>
        <div class="sailing-dates-content">
          <form class="sailing-dates-form">
            <div class="form-field">
              <label for="joining-date">
                Scheduled Start Date
              </label>
              <input
                id="joining-date"
                name="joining_date"
                type="date"
                value="${this._escape(joiningDate)}">
            </div>
            <div class="form-field">
              <label for="expected-signoff-date">
                Scheduled End Date
              </label>
              <input
                id="expected-signoff-date"
                name="expected_signoff_date"
                type="date"
                value="${this._escape(expectedSignoffDate)}">
            </div>
            <div class="form-field">
              <label for="buffer-days">
                Planning Buffer (days)
              </label>
              <input
                id="buffer-days"
                name="buffer_days"
                type="number"
                min="0"
                max="180"
                step="1"
                value="${bufferDays}"
                required>
            </div>
            <div class="form-error" role="alert"></div>
            <div class="form-actions">
              <button class="cancel-button" type="button">
                Cancel
              </button>
              <button class="primary submit-button" type="submit">
                Save
              </button>
            </div>
            <div class="form-actions" style="margin-top:10px;grid-template-columns:1fr">
              <button class="clear-sailing-dates-button" type="button"
                aria-label="Clear both saved schedule dates">Clear Both Dates</button>
            </div>
          </form>
        </div>
      </ha-adaptive-dialog>
    `;
    root.appendChild(template.content.cloneNode(true));
    const dialog = root.querySelector("ha-adaptive-dialog");
    const closeButton = root.querySelector("ha-icon-button");
    const form = root.querySelector(".sailing-dates-form");
    const errorBox = root.querySelector(".form-error");
    const submitButton = root.querySelector(".submit-button");
    const cleanup = () => {
      host.remove();
      if (this._activeDialog === host) {
        this._activeDialog = null;
      }
    };
    // Use the same close and cleanup pattern as Add Document.
    dialog.addEventListener("closed", cleanup, { once: true });
    const closeForm = () => {
      dialog.open = false;
    };
    closeButton.addEventListener("click", closeForm);
    root.querySelector(".cancel-button")
      .addEventListener("click", closeForm);
    // Unlike the native date input's Reset action, this deliberately clears
    // persisted dates. The user must still select Save to commit the change.
    root.querySelector(".clear-sailing-dates-button")
      .addEventListener("click", () => {
        form.elements.joining_date.value = "";
        form.elements.expected_signoff_date.value = "";
        errorBox.textContent = "Dates cleared in form. Press Save to apply.";
      });
    form.addEventListener("submit", async event => {
      event.preventDefault();
      errorBox.textContent = "";
      const joiningDate =
        form.elements.joining_date.value;
      const expectedSignoffDate =
        form.elements.expected_signoff_date.value;
      const bufferInput = form.elements.buffer_days;
      const bufferDays = Number(bufferInput.value);
      if (
        !Number.isInteger(bufferDays) ||
        bufferDays < 0 ||
        bufferDays > 180
      ) {
        errorBox.textContent =
          "Planning buffer must be a whole number from 0 to 180.";
        bufferInput.focus();
        return;
      }
      if (
        joiningDate &&
        expectedSignoffDate &&
        expectedSignoffDate < joiningDate
      ) {
        errorBox.textContent =
          "Scheduled end date cannot be before scheduled start date.";
        form.elements.expected_signoff_date.focus();
        return;
      }
      const serviceData = {
        directory: directoryId,
        buffer_days: bufferDays,
      };
      // Use explicit clearing flags. Never send an empty ISO date string.
      // Requires matching services.py and documents.py (Round 4).
      if (joiningDate) serviceData.joining_date = joiningDate;
      else serviceData.clear_joining_date = true;
      if (expectedSignoffDate) serviceData.signoff_date = expectedSignoffDate;
      else serviceData.clear_signoff_date = true;
      submitButton.disabled = true;
      submitButton.textContent = "Saving…";
      try {
        await this._hass.callService(
          "docharbor",
          "set_sailing_dates",
          serviceData
        );
        closeForm();
        this._updateContent();
      } catch (error) {
        console.error("Documents: sailing dates save failed", error);
        errorBox.textContent =
          error?.message ||
          "Unable to save schedule dates. Please try again.";
        submitButton.disabled = false;
        submitButton.textContent = "Save";
      }
    });
    document.body.appendChild(host);
    this._activeDialog = host;
    dialog.open = true;
  }
}
if (!customElements.get("seafarer-documents-card")) {
  customElements.define(
    "seafarer-documents-card",
    SeafarerDocumentsCard
  );
}


// Register DocHarbor in Home Assistant's Add Card dialog.
window.customCards = window.customCards || [];

if (!window.customCards.some(
  card => card.type === "seafarer-documents-card"
)) {
  window.customCards.push({
    type: "seafarer-documents-card",
    name: "DocHarbor Documents",
    description: "Manage documents, expiry reminders and scheduled periods.",
    preview: false,
  });
}
