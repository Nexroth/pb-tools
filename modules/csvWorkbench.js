// modules/csvWorkbench.js
// Layout: icon rail + slide-out drawer + table/summary content area.
// Business logic is unchanged; only the render layer is redesigned.

(function () {
  const CONTAINER_ID  = "moduleContainer";
  const ANNOTATION_KEY   = "pbToolsAnnotations";
  const NOTE_COL         = "StatusNote";
  // Annotation key: Email (unique per person) + Original Due Date (UTC) (scopes to campaign)
  // Falls back to Employee Number if Email is missing
  const KEY_COL_PRIMARY   = "Email";
  const KEY_COL_SECONDARY = "Employee Number";  // raw field name, pre-rename
  const KEY_COL_DATE      = "Original Due Date (UTC)";

  // Columns that are read-only — unique identifiers that should never be accidentally edited
  const PROTECTED_COLS = new Set([
    "Email",
    "Manager Email",
    "Employee Number",
    "EmployeeID",                // post-rename alias
    "Original Due Date (UTC)",   // used as campaign ID for annotation matching
  ]);

  // ── Module meta ───────────────────────────────────────────────────────────
  const meta = {
    title:    "CSV / Spreadsheet Workbench",
    subtitle: "Load, clean, and export CSV data. All processing happens locally.",
  };

  // ── In-memory state ───────────────────────────────────────────────────────
  let parsedData    = null;   // { fields: [...], rows: [...] }
  let currentFile   = null;   // File object for display name
  let viewState     = {
    visibleFields:   [],
    displayNames:    {},  // field → display name (only deltas from original stored in presets)
    activePreset:    null,
    appliedMappings: [],  // [{ column, from, to }, ...] — log of every mapping applied, for preset capture
  };
  let lastSummary   = null;   // { field, rows: [{ value, count }] }
  let undoSnapshot  = null;   // single undo — deep copy of parsedData.rows before last destructive op
  let sortState     = { field: null, dir: "asc" };
  let filterState   = { text: "", field: "" };  // "" field = search all columns
  let rowFilters    = [];  // [{ field, op, value }] — preset-applied exact filters; op: "eq"|"neq"|"contains"|"empty"|"notempty"

  // ── Drawer state ──────────────────────────────────────────────────────────
  let drawerState   = { open: false, panel: null };

  const PANEL_LABELS = {
    columns:  "Columns",
    presets:  "Presets",
    mapping:  "Value mapping",
    tools:    "Tools",
  };

  const PANEL_ICONS = {
    columns:  "☰",
    presets:  "⚡",
    mapping:  "⇄",
    tools:    "🔧",
  };

  // ── Annotation cache ──────────────────────────────────────────────────────
  let annotationsCache = null;

  function loadAnnotations() {
    if (annotationsCache) return annotationsCache;
    try {
      const raw = localStorage.getItem(ANNOTATION_KEY);
      annotationsCache = raw ? JSON.parse(raw) : {};
    } catch (_) { annotationsCache = {}; }
    return annotationsCache;
  }

  function saveAnnotations() {
    try {
      localStorage.setItem(ANNOTATION_KEY, JSON.stringify(annotationsCache || {}));
    } catch (_) {}
  }

  function makeAnnotationKey(row) {
    const person = row[KEY_COL_PRIMARY] || row[KEY_COL_SECONDARY];
    const date   = row[KEY_COL_DATE];
    if (!person || !date) return null;
    return `${String(person).trim().toLowerCase()}::${String(date).trim()}`;
  }

  // ── Presets ───────────────────────────────────────────────────────────────
  const presets = {
    phisherLike: {
      id: "phisherLike",
      label: "PhishER Fail Export",
      description: "Filters to core identity columns, renames Employee Number → EmployeeID, normalizes SBU values, and derives SBU from Location for blank rows.",
      keepFields: [
        "Email", "First Name", "Last Name", "Job Title",
        "Group", "Manager Name", "Manager Email", "Location",
        "Employee Number", "Content", "Department", "Custom Field 1",
      ],
      renameFields: { "Employee Number": "EmployeeID", "Custom Field 1": "SBU" },
      // Step 1: explicit value mappings on Custom Field 1 (raw field name, before rename)
      valueMapping: {
        "Custom Field 1": {
          "2101 Centerstone of Indiana*": "Indiana",
          // add more explicit SBU mappings here as needed
        },
      },
      // Step 2: if SBU still blank, derive from first 2 chars of Location field
      locationPrefixToSbu: {
        "TN": "Tennessee",
        "IN": "Indiana",
        "IL": "Illinois",
        "FL": "Florida",
        "KY": "Kentucky",
        "OH": "Ohio",
        "GA": "Georgia",
        "NC": "North Carolina",
        "TX": "Texas",
        "MO": "Missouri",
        "VA": "Virginia",
        "CO": "Colorado",
        "AZ": "Arizona",
        "CA": "California",
        "WA": "Washington",
        "PA": "Pennsylvania",
        "NY": "New York",
      },
      // Step 3: if Location prefix also unknown, fall back to this
      sbuFallbackForEmpty: "blank",
    },
  };

  // ── Undo ─────────────────────────────────────────────────────────────────

  function saveUndoSnapshot() {
    if (!parsedData) return;
    undoSnapshot = parsedData.rows.map(row => ({ ...row }));
    updateUndoBtn();
  }

  function applyUndo() {
    if (!undoSnapshot || !parsedData) return;
    parsedData.rows = undoSnapshot;
    undoSnapshot = null;
    updateUndoBtn();
    renderTablePreview();
    renderSummaryPanel();
    updateFileInfo();
  }

  function updateUndoBtn() {
    const btn = document.getElementById("csvUndoBtn");
    if (btn) btn.disabled = !undoSnapshot;
  }

  // ── Business logic ────────────────────────────────────────────────────────

  function applyValueMappings(valueMapping, skipLog = false) {
    if (!parsedData || !valueMapping || typeof valueMapping !== "object") return;
    if (!skipLog) saveUndoSnapshot();

    const displayToField = {};
    Object.keys(viewState.displayNames).forEach(f => {
      displayToField[viewState.displayNames[f]] = f;
    });

    Object.entries(valueMapping).forEach(([column, rulesObj]) => {
      if (!rulesObj || typeof rulesObj !== "object") return;
      const fields   = parsedData.fields;
      const fieldKey = fields.includes(column) ? column : displayToField[column];
      if (!fieldKey) return;

      Object.entries(rulesObj).forEach(([from, to]) => {
        const isPrefix = from.endsWith("*");
        const needle   = isPrefix ? from.slice(0, -1) : from;
        parsedData.rows.forEach(row => {
          const cur = row[fieldKey];
          if (cur == null) return;
          if ((!isPrefix && cur === needle) ||
              (isPrefix && String(cur).startsWith(needle))) {
            row[fieldKey] = to;
          }
        });

        // Log for preset capture (unless called from preset replay)
        if (!skipLog) {
          viewState.appliedMappings.push({ column: fieldKey, from, to });
        }
      });
    });
  }

  function applyPhisherLikePreset() {
    if (!parsedData) return;
    saveUndoSnapshot();
    const preset    = presets.phisherLike;
    const keepSet   = new Set(preset.keepFields);
    const effective = parsedData.fields.filter(f => keepSet.has(f));

    viewState.visibleFields = effective;

    // Ensure all keepFields have a display name entry
    preset.keepFields.forEach(f => {
      if (!viewState.displayNames[f]) viewState.displayNames[f] = f;
    });

    // Apply renames
    Object.entries(preset.renameFields || {}).forEach(([from, to]) => {
      if (viewState.displayNames[from] !== undefined) viewState.displayNames[from] = to;
    });

    // Step 1: explicit value mappings (runs on raw field name before rename)
    applyValueMappings(preset.valueMapping);

    // Step 2 & 3: for rows where SBU is still blank, derive from Location prefix
    const sbuKey      = parsedData.fields.includes("Custom Field 1") ? "Custom Field 1"
                      : parsedData.fields.includes("SBU") ? "SBU" : null;
    const locationKey = parsedData.fields.includes("Location") ? "Location" : null;

    if (sbuKey) {
      const locMap = preset.locationPrefixToSbu || {};
      parsedData.rows.forEach(row => {
        const v = row[sbuKey];
        const isEmpty = v === null || v === undefined || String(v).trim() === "";
        if (!isEmpty) return;

        // Step 2: try to derive from Location
        if (locationKey) {
          const loc    = String(row[locationKey] || "").trim();
          const prefix = loc.substring(0, 2).toUpperCase();
          if (prefix && locMap[prefix]) {
            row[sbuKey] = locMap[prefix];
            return;
          }
        }

        // Step 3: fallback
        row[sbuKey] = preset.sbuFallbackForEmpty;
      });
    }

    viewState.activePreset = preset.id;
    lastSummary = null;
    sortState   = { field: null, dir: "asc" };
  }

  function computeGroupAndCount(field) {
    if (!parsedData) return null;
    const counts = {};
    parsedData.rows.forEach(row => {
      const key = (row[field] == null || row[field] === "") ? "(empty)" : String(row[field]);
      counts[key] = (counts[key] || 0) + 1;
    });
    const rows = Object.entries(counts)
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
    return { field, rows };
  }

  function getEffectiveFields() {
    if (!parsedData) return [];
    return viewState.visibleFields.length ? viewState.visibleFields : parsedData.fields;
  }

  function getSortedRows() {
    if (!parsedData) return [];
    const rows = [...parsedData.rows];
    const { field, dir } = sortState;
    if (!field) return rows;
    return rows.sort((a, b) => {
      const av = String(a[field] ?? "");
      const bv = String(b[field] ?? "");
      const cmp = av.localeCompare(bv, undefined, { numeric: true, sensitivity: "base" });
      return dir === "asc" ? cmp : -cmp;
    });
  }

  function getFilteredSortedRows() {
    const sorted = getSortedRows();
    const needle = filterState.text.trim().toLowerCase();

    // Apply preset row filters first
    let filtered = sorted;
    if (rowFilters.length) {
      filtered = sorted.filter(row => rowFilters.every(rf => {
        const cell = String(row[rf.field] ?? "");
        switch (rf.op) {
          case "eq":       return cell.toLowerCase() === rf.value.toLowerCase();
          case "neq":      return cell.toLowerCase() !== rf.value.toLowerCase();
          case "contains": return cell.toLowerCase().includes(rf.value.toLowerCase());
          case "empty":    return cell.trim() === "";
          case "notempty": return cell.trim() !== "";
          default:         return true;
        }
      }));
    }

    // Then apply text search on top
    if (!needle) return filtered;
    const fields = filterState.field ? [filterState.field] : getEffectiveFields();
    return filtered.filter(row =>
      fields.some(f => String(row[f] ?? "").toLowerCase().includes(needle))
    );
  }

  // ── File handling ─────────────────────────────────────────────────────────

  function handleFile(file) {
    if (!file) return;
    currentFile = file;
    updateFileInfo(`Parsing ${file.name}…`);

    const ext = file.name.split(".").pop().toLowerCase();

    if (ext === "xlsx" || ext === "xls") {
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const wb    = XLSX.read(e.target.result, { type: "array" });
          const ws    = wb.Sheets[wb.SheetNames[0]];
          const json  = XLSX.utils.sheet_to_json(ws, { defval: "" });
          const fields = json.length ? Object.keys(json[0]) : [];
          ingestRows(fields, json);
        } catch (err) {
          console.error("[CSV Workbench] XLSX parse error:", err);
          updateFileInfo(`Error reading XLSX: ${err.message || err}`);
        }
      };
      reader.readAsArrayBuffer(file);
      return;
    }

    // CSV / TXT
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      complete: results => ingestRows(results.meta.fields || [], results.data || []),
      error: err => {
        console.error("[CSV Workbench] Parse error:", err);
        updateFileInfo(`Error parsing file: ${err.message || err}`);
        parsedData = null;
        viewState  = { visibleFields: [], displayNames: {}, activePreset: null };
        lastSummary = null;
        renderTablePreview();
        renderSummaryPanel();
      },
    });
  }

  function ingestRows(rawFields, rawRows) {
    let fields = rawFields.slice();
    if (!fields.includes(NOTE_COL)) fields.push(NOTE_COL);

    const annotations = loadAnnotations();
    rawRows.forEach(row => {
      if (row[NOTE_COL] === undefined) row[NOTE_COL] = "";
      const key = makeAnnotationKey(row);
      if (key && annotations[key]?.statusNote) row[NOTE_COL] = annotations[key].statusNote;
    });

    parsedData  = { fields, rows: rawRows };
    lastSummary = null;
    undoSnapshot = null;
    sortState   = { field: null, dir: "asc" };
    filterState = { text: "", field: "" };
    rowFilters  = [];
    selectedRows.clear();
    lastSelectedRow = null;
    viewState = {
      visibleFields:   [...fields],
      displayNames:    Object.fromEntries(fields.map(f => [f, f])),
      activePreset:    null,
      appliedMappings: [],
    };

    viewState.visibleFields  = [...fields];
    viewState.displayNames   = {};
    viewState.activePreset   = null;
    fields.forEach(f => { viewState.displayNames[f] = f; });

    updateFileInfo();
    updateDownloadBtn();

    // Reset search UI on new file
    const si = document.getElementById("csvSearchInput");
    const sf = document.getElementById("csvSearchField");
    const sc = document.getElementById("csvSearchClear");
    if (si) si.value = "";
    if (sc) sc.style.display = "none";
    if (sf) populateSearchFieldSelect(sf);

    // Refresh whatever drawer is open
    if (drawerState.open && drawerState.panel) {
      renderDrawerPanel(drawerState.panel);
    }
    renderTablePreview();
    renderSummaryPanel();
  }

  // ── Exports ───────────────────────────────────────────────────────────────

  function buildExportRows() {
    const fields = getEffectiveFields();
    return parsedData.rows.map(row => {
      const obj = {};
      fields.forEach(f => { obj[viewState.displayNames[f] || f] = row[f]; });
      return obj;
    });
  }

  function downloadCurrentCsv() {
    if (!parsedData) return;
    const csv  = Papa.unparse(buildExportRows());
    triggerDownload(new Blob([csv], { type: "text/csv;charset=utf-8;" }), "pb-tools-export.csv");
  }

  function downloadCurrentXlsx() {
    if (!parsedData) return;
    const ws = XLSX.utils.json_to_sheet(buildExportRows());
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Data");
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    triggerDownload(
      new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      "pb-tools-export.xlsx"
    );
  }

  function downloadCurrentHtml() {
    if (!parsedData) return;
    const fields   = getEffectiveFields();
    const rows     = parsedData.rows;
    const headers  = fields.map(f => viewState.displayNames[f] || f);
    const filename = parsedData.filename ? parsedData.filename.replace(/\.[^.]+$/, "") : "pb-tools-export";

    const thead = `<thead><tr>${headers.map(h => `<th>${escHtml(h)}</th>`).join("")}</tr></thead>`;
    const tbody = `<tbody>${rows.map(row =>
      `<tr>${fields.map(f => `<td>${escHtml(String(row[f] ?? ""))}</td>`).join("")}</tr>`
    ).join("")}</tbody>`;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escHtml(filename)}</title>
<style>
  *,*::before,*::after{box-sizing:border-box}
  body{font-family:system-ui,-apple-system,sans-serif;font-size:13px;color:#111;margin:0;padding:1.5rem 2rem;background:#fff}
  h1{font-size:1.1rem;margin:0 0 0.25rem;color:#111}
  .meta{font-size:0.75rem;color:#6b7280;margin-bottom:1rem}
  table{border-collapse:collapse;width:100%;font-size:12px}
  th{background:#f3f4f6;color:#374151;font-weight:600;text-align:left;padding:0.4rem 0.6rem;border:1px solid #e5e7eb;white-space:nowrap}
  td{padding:0.35rem 0.6rem;border:1px solid #e5e7eb;vertical-align:top}
  tr:nth-child(even) td{background:#f9fafb}
  @media print{body{padding:0.5rem}th{background:#e5e7eb!important;-webkit-print-color-adjust:exact}}
</style>
</head>
<body>
<h1>${escHtml(filename)}</h1>
<div class="meta">Exported ${new Date().toLocaleString()} &mdash; ${rows.length.toLocaleString()} rows &mdash; ${headers.length} columns</div>
<table>${thead}${tbody}</table>
</body>
</html>`;

    triggerDownload(new Blob([html], { type: "text/html;charset=utf-8;" }), `${filename}.html`);
  }

  function escHtml(str) {
    return str.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  function exportSummaryHtml() {
    if (!lastSummary?.rows.length) return;
    const dn  = viewState.displayNames[lastSummary.field] || lastSummary.field;
    const rows = lastSummary.rows;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Summary — ${escHtml(dn)}</title>
<style>
  *,*::before,*::after{box-sizing:border-box}
  body{font-family:system-ui,-apple-system,sans-serif;font-size:13px;color:#111;margin:0;padding:1.5rem 2rem;background:#fff}
  h1{font-size:1.1rem;margin:0 0 0.25rem}
  .meta{font-size:0.75rem;color:#6b7280;margin-bottom:1rem}
  table{border-collapse:collapse;width:auto;min-width:280px;font-size:12px}
  th{background:#f3f4f6;color:#374151;font-weight:600;text-align:left;padding:0.4rem 0.6rem;border:1px solid #e5e7eb}
  td{padding:0.35rem 0.6rem;border:1px solid #e5e7eb}
  td:last-child{text-align:right}
  tr:nth-child(even) td{background:#f9fafb}
  @media print{th{background:#e5e7eb!important;-webkit-print-color-adjust:exact}}
</style>
</head>
<body>
<h1>Summary — ${escHtml(dn)}</h1>
<div class="meta">Exported ${new Date().toLocaleString()} &mdash; ${rows.length.toLocaleString()} distinct values</div>
<table>
<thead><tr><th>${escHtml(dn)}</th><th>Count</th></tr></thead>
<tbody>${rows.map(r => `<tr><td>${escHtml(String(r.value))}</td><td>${r.count.toLocaleString()}</td></tr>`).join("")}</tbody>
</table>
</body>
</html>`;

    triggerDownload(new Blob([html], { type: "text/html;charset=utf-8;" }), "pb-tools-summary.html");
  }

  function exportSummaryCsv() {
    if (!lastSummary?.rows.length) return;
    const dn   = viewState.displayNames[lastSummary.field] || lastSummary.field;
    const data = lastSummary.rows.map(r => ({ [dn]: r.value, Count: r.count }));
    triggerDownload(new Blob([Papa.unparse(data)], { type: "text/csv;charset=utf-8;" }), "pb-tools-summary.csv");
  }

  function exportSummaryXlsx() {
    if (!lastSummary?.rows.length) return;
    const dn   = viewState.displayNames[lastSummary.field] || lastSummary.field;
    const data = lastSummary.rows.map(r => ({ [dn]: r.value, Count: r.count }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Summary");
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    triggerDownload(
      new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      "pb-tools-summary.xlsx"
    );
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a   = document.createElement("a");
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ── Render skeleton ───────────────────────────────────────────────────────
  // Called once on module show(). Builds the stable DOM structure.
  // All data areas are populated by targeted update functions afterwards.

  function render() {
    const container = document.getElementById(CONTAINER_ID);
    if (!container) return;

    // Tell the container which module is active (drives CSS padding rules)
    container.className = "module-container module-container--csvWorkbench";

    container.innerHTML = `
      <div class="csv-module">

        <!-- Row 1: Load button + inline drop zone -->
        <div class="csv-load-row">
          <button class="btn btn-secondary" id="csvFileButton" style="padding:0.3rem 0.7rem;font-size:0.75rem;flex-shrink:0;">
            📂 Load file
          </button>
          <input type="file" id="csvFileInput" accept=".csv,.txt,.xlsx" style="display:none">
          <div class="csv-dropzone" id="csvDropzone">
            <span class="dropzone-icon">⬇</span>
            <span class="dropzone-label">Drop a <strong>CSV</strong> or <strong>XLSX</strong> file here to load or merge</span>
          </div>
        </div>

        <!-- Row 2: File info + preset badge + export actions -->
        <div class="csv-infobar" id="csvInfoBar">
          <div class="csv-file-info" id="csvFileInfo"></div>
          <div class="csv-toolbar-actions">
            <button class="btn btn-secondary" id="csvUndoBtn" style="padding:0.3rem 0.6rem;font-size:0.75rem;" disabled title="Undo last operation">
              ↩ Undo
            </button>
            <button class="btn btn-secondary" id="csvDownloadBtn" style="padding:0.3rem 0.6rem;font-size:0.75rem;" disabled>
              ↓ CSV
            </button>
            <button class="btn" id="exportOpenButton" style="padding:0.3rem 0.65rem;font-size:0.75rem;">
              Export…
            </button>
          </div>
        </div>

        <!-- Row 3: Search bar -->
        <div class="csv-searchbar" id="csvSearchBar">
          <span class="search-icon">🔍</span>
          <input
            type="text"
            id="csvSearchInput"
            class="search-input"
            placeholder="Search across all columns…"
            autocomplete="off"
            spellcheck="false"
          >
          <select id="csvSearchField" class="search-field-select">
            <option value="">All columns</option>
          </select>
          <button class="search-clear" id="csvSearchClear" title="Clear search" style="display:none;">✕</button>
        </div>

        <!-- Row 4: Active row filter badges (hidden when empty) -->
        <div class="csv-row-filter-bar" id="csvRowFilterBar" style="display:none;"></div>

        <!-- Workspace: rail | drawer | content -->
        <div class="csv-workspace">

          <div class="ops-rail" id="opsRail">
            ${Object.entries(PANEL_ICONS).map(([key, icon]) => `
              <button class="rail-btn" data-panel="${key}" title="${PANEL_LABELS[key]}">
                ${icon}
                <span class="rail-tooltip">${PANEL_LABELS[key]}</span>
              </button>
            `).join("")}
          </div>

          <!-- Slide-out drawer -->
          <div class="ops-drawer" id="opsDrawer">
            <div class="ops-drawer-header">
              <span class="ops-drawer-title" id="opsDrawerTitle"></span>
              <button class="ops-drawer-close" id="opsDrawerClose" aria-label="Close panel">✕</button>
            </div>
            <div class="ops-drawer-body" id="opsDrawerBody"></div>
          </div>

          <!-- Table + summary -->
          <div class="csv-content">
            <div class="csv-table-area" id="csvTableContainer"></div>
            <div class="csv-summary-area" id="csvSummaryArea"></div>
          </div>

        </div>
      </div>
    `;

    wireEvents();
    updateFileInfo();
    updateDownloadBtn();
    updateRailState();
    if (drawerState.open && drawerState.panel) {
      openDrawer(drawerState.panel);
    }
    renderRowFilterBadges();
    renderTablePreview();
    renderSummaryPanel();
  }

  // ── Event wiring ──────────────────────────────────────────────────────────

  function wireEvents() {
    const root = document.getElementById(CONTAINER_ID);
    if (!root) return;

    // File picker
    const fileBtn   = root.querySelector("#csvFileButton");
    const fileInput = root.querySelector("#csvFileInput");
    if (fileBtn && fileInput) {
      fileBtn.addEventListener("click", () => { fileInput.value = ""; fileInput.click(); });
      fileInput.addEventListener("change", e => {
        const f = e.target.files?.[0];
        if (f) handleFile(f);
      });
    }

    // Drop zone — drag and drop only, no click
    const dz = root.querySelector("#csvDropzone");
    if (dz) {
      dz.addEventListener("dragover",  e => { e.preventDefault(); dz.classList.add("dragover"); });
      dz.addEventListener("dragleave", e => { e.preventDefault(); dz.classList.remove("dragover"); });
      dz.addEventListener("drop", e => {
        e.preventDefault();
        dz.classList.remove("dragover");
        const f = e.dataTransfer.files?.[0];
        if (f) handleFile(f);
      });
    }

    // CSV quick-download
    const dlBtn = root.querySelector("#csvDownloadBtn");
    if (dlBtn) dlBtn.addEventListener("click", () => downloadCurrentCsv());

    // Undo
    const undoBtn = root.querySelector("#csvUndoBtn");
    if (undoBtn) undoBtn.addEventListener("click", () => applyUndo());

    // Rail buttons
    const rail = root.querySelector("#opsRail");
    if (rail) {
      rail.addEventListener("click", e => {
        const btn = e.target.closest(".rail-btn");
        if (!btn) return;
        const panel = btn.dataset.panel;
        if (drawerState.open && drawerState.panel === panel) {
          closeDrawer();
        } else {
          openDrawer(panel);
        }
      });
    }

    // Drawer close button
    const closeBtn = root.querySelector("#opsDrawerClose");
    if (closeBtn) closeBtn.addEventListener("click", closeDrawer);

    // Search bar
    const searchInput  = root.querySelector("#csvSearchInput");
    const searchField  = root.querySelector("#csvSearchField");
    const searchClear  = root.querySelector("#csvSearchClear");

    if (searchInput) {
      searchInput.value = filterState.text;
      searchInput.addEventListener("input", () => {
        filterState.text = searchInput.value;
        if (searchClear) searchClear.style.display = filterState.text ? "flex" : "none";
        renderTablePreview();
      });
    }

    if (searchField) {
      populateSearchFieldSelect(searchField);
      searchField.value = filterState.field;
      searchField.addEventListener("change", () => {
        filterState.field = searchField.value;
        renderTablePreview();
      });
    }

    if (searchClear) {
      if (filterState.text) searchClear.style.display = "flex";
      searchClear.addEventListener("click", () => {
        filterState.text  = "";
        filterState.field = "";
        if (searchInput) searchInput.value = "";
        if (searchField) searchField.value = "";
        searchClear.style.display = "none";
        renderTablePreview();
      });
    }
  }

  function renderRowFilterBadges() {
    const bar = document.getElementById("csvRowFilterBar");
    if (!bar) return;
    bar.innerHTML = "";
    if (!rowFilters.length) {
      bar.style.display = "none";
      return;
    }
    bar.style.display = "flex";

    const OP_LABELS = { eq: "=", neq: "≠", contains: "contains", empty: "is empty", notempty: "is not empty" };

    rowFilters.forEach((rf, i) => {
      const badge = document.createElement("div");
      badge.className = "row-filter-badge";
      const fieldLabel = viewState.displayNames[rf.field] || rf.field;
      const opLabel    = OP_LABELS[rf.op] || rf.op;
      const valLabel   = (rf.op === "empty" || rf.op === "notempty") ? "" : ` "${rf.value}"`;
      badge.innerHTML  = `<span>${fieldLabel} ${opLabel}${valLabel}</span><button class="row-filter-remove" data-idx="${i}" title="Remove filter">✕</button>`;
      bar.appendChild(badge);
    });

    const clearAll = document.createElement("button");
    clearAll.className   = "btn btn-ghost";
    clearAll.style.cssText = "font-size:0.68rem;padding:0.1rem 0.4rem;";
    clearAll.textContent = "Clear all filters";
    clearAll.addEventListener("click", () => {
      rowFilters = [];
      renderRowFilterBadges();
      renderTablePreview();
    });
    bar.appendChild(clearAll);

    bar.querySelectorAll(".row-filter-remove").forEach(btn => {
      btn.addEventListener("click", () => {
        rowFilters.splice(parseInt(btn.dataset.idx), 1);
        renderRowFilterBadges();
        renderTablePreview();
      });
    });
  }

  function populateSearchFieldSelect(select) {
    // Keep the "All columns" option, clear the rest
    while (select.options.length > 1) select.remove(1);
    if (!parsedData) return;
    getEffectiveFields().forEach(f => {
      const opt       = document.createElement("option");
      opt.value       = f;
      opt.textContent = viewState.displayNames[f] || f;
      select.appendChild(opt);
    });
  }

  // ── Drawer control ────────────────────────────────────────────────────────

  function openDrawer(panel) {
    drawerState = { open: true, panel };
    const drawer    = document.getElementById("opsDrawer");
    const titleEl   = document.getElementById("opsDrawerTitle");
    if (drawer)  drawer.classList.add("open");
    if (titleEl) titleEl.textContent = PANEL_LABELS[panel] || panel;
    updateRailState();
    renderDrawerPanel(panel);
  }

  function closeDrawer() {
    drawerState = { open: false, panel: null };
    const drawer = document.getElementById("opsDrawer");
    if (drawer) drawer.classList.remove("open");
    updateRailState();
  }

  function updateRailState() {
    document.querySelectorAll(".rail-btn").forEach(btn => {
      btn.classList.toggle("active",
        drawerState.open && btn.dataset.panel === drawerState.panel
      );
    });
  }

  function renderDrawerPanel(panel) {
    const body = document.getElementById("opsDrawerBody");
    if (!body) return;
    body.innerHTML = "";
    switch (panel) {
      case "columns":  buildColumnsPanel(body);  break;
      case "presets":  buildPresetsPanel(body);  break;
      case "mapping":  buildMappingPanel(body);  break;
      case "tools":    buildToolsPanel(body);    break;
    }
  }

  // ── Toolbar helpers ───────────────────────────────────────────────────────

  function updateFileInfo(overrideText) {
    const el = document.getElementById("csvFileInfo");
    if (!el) return;
    el.innerHTML = "";

    if (overrideText) {
      const span = document.createElement("span");
      span.className   = "csv-no-file";
      span.textContent = overrideText;
      el.appendChild(span);
      return;
    }

    if (!parsedData || !currentFile) {
      const span = document.createElement("span");
      span.className   = "csv-no-file";
      span.textContent = "No file loaded";
      el.appendChild(span);
      return;
    }

    const nameSpan = document.createElement("span");
    nameSpan.className   = "csv-file-name";
    nameSpan.textContent = currentFile.name;

    const metaSpan = document.createElement("span");
    metaSpan.className   = "csv-file-meta";
    metaSpan.textContent = `${parsedData.rows.length.toLocaleString()} rows · ${parsedData.fields.length} cols`;

    el.appendChild(nameSpan);
    el.appendChild(metaSpan);

    if (viewState.activePreset) {
      const allPresets = { ...presets, ...loadUserPresets() };
      const p    = allPresets[viewState.activePreset];
      const badge = document.createElement("span");
      badge.className   = "csv-preset-badge";
      badge.textContent = `⚡ ${p?.label || viewState.activePreset}`;
      el.appendChild(badge);
    }
  }

  function updateDownloadBtn() {
    const btn = document.getElementById("csvDownloadBtn");
    if (btn) btn.disabled = !parsedData || !parsedData.rows.length;
  }

  // ── User preset storage ───────────────────────────────────────────────────
  const USER_PRESETS_KEY = "pbToolsUserPresets";

  function loadUserPresets() {
    try {
      const raw = localStorage.getItem(USER_PRESETS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  }

  function saveUserPresets(map) {
    try { localStorage.setItem(USER_PRESETS_KEY, JSON.stringify(map)); } catch {}
  }

  function captureCurrentAsPreset(name, capturedRowFilters) {
    if (!parsedData) return null;

    // Save display names for all visible fields (not just deltas)
    // so renames back to original names are also preserved
    const renames = {};
    viewState.visibleFields.forEach(field => {
      renames[field] = viewState.displayNames[field] || field;
    });

    // Collapse appliedMappings into { column: { from: to } } structure
    const valueMappings = {};
    viewState.appliedMappings.forEach(({ column, from, to }) => {
      if (!valueMappings[column]) valueMappings[column] = {};
      valueMappings[column][from] = to;
    });

    const id = `user_${Date.now()}`;
    return {
      id,
      label:        name,
      description:  `User preset — saved ${new Date().toLocaleDateString()}`,
      keepFields:   [...viewState.visibleFields],
      renameFields: renames,
      valueMapping: valueMappings,
      rowFilters:   capturedRowFilters || [],
      isUserPreset: true,
      savedAt:      Date.now(),
    };
  }

  // ── Panel builders ────────────────────────────────────────────────────────

  // Columns panel
  function buildColumnsPanel(container) {
    if (!parsedData) {
      noDataMessage(container, "Load a file to manage columns.");
      return;
    }

    const section = panelSection("VISIBLE · RENAME");
    const list    = document.createElement("div");
    list.style.display        = "flex";
    list.style.flexDirection  = "column";
    list.style.gap            = "0.2rem";

    parsedData.fields.forEach(field => {
      const row = document.createElement("div");
      row.className = "col-field-row";

      const cb = document.createElement("input");
      cb.type        = "checkbox";
      cb.checked     = viewState.visibleFields.includes(field);
      cb.dataset.field = field;

      const nameSpan  = document.createElement("span");
      nameSpan.className    = "col-field-name";
      nameSpan.textContent  = field;
      nameSpan.title        = field;

      const renameInput = document.createElement("input");
      renameInput.type        = "text";
      renameInput.className   = "panel-rename-input";
      renameInput.value       = viewState.displayNames[field] || field;
      renameInput.dataset.field = field;
      renameInput.placeholder = "Display name";

      row.appendChild(cb);
      row.appendChild(nameSpan);
      row.appendChild(renameInput);
      list.appendChild(row);
    });

    section.appendChild(list);
    container.appendChild(section);

    const applyBtn = applyButton("Apply changes");
    applyBtn.addEventListener("click", () => applyColumnChanges(container));
    container.appendChild(applyBtn);
  }

  function applyColumnChanges(panelContainer) {
    if (!parsedData) return;

    const newVisible = [];
    const newNames   = { ...viewState.displayNames };

    panelContainer.querySelectorAll("input[type='checkbox'][data-field]").forEach(cb => {
      if (cb.checked) newVisible.push(cb.dataset.field);
    });
    panelContainer.querySelectorAll("input[type='text'][data-field]").forEach(inp => {
      const f = inp.dataset.field;
      if (f) newNames[f] = inp.value.trim() || f;
    });

    viewState.visibleFields = parsedData.fields.filter(f => newVisible.includes(f));
    viewState.displayNames  = newNames;

    renderTablePreview();
    renderSummaryPanel();
  }

  // Presets panel
  function buildPresetsPanel(container) {
    const userPresets = loadUserPresets();
    const allUserPresets = Object.values(userPresets).sort((a,b) => b.savedAt - a.savedAt);

    // ── BUILT-IN PRESETS ────────────────────────────────────────────────────
    const builtinSection = panelSection("BUILT-IN PRESETS");
    Object.values(presets).forEach(p => {
      const row = document.createElement("div");
      row.className = "preset-list-row";

      const nameEl = document.createElement("div");
      nameEl.className   = "preset-list-name";
      nameEl.textContent = p.label;
      if (viewState.activePreset === p.id) nameEl.classList.add("active");

      const descEl = document.createElement("div");
      descEl.className   = "preset-list-desc";
      descEl.textContent = p.description;

      row.appendChild(nameEl);
      row.appendChild(descEl);

      if (parsedData) {
        const actions = document.createElement("div");
        actions.className = "preset-list-actions";

        const applyBtn = document.createElement("button");
        applyBtn.className   = "btn btn-ghost preset-apply-btn";
        applyBtn.textContent = viewState.activePreset === p.id ? "✓ Applied" : "Apply";
        applyBtn.disabled    = viewState.activePreset === p.id;
        applyBtn.addEventListener("click", () => {
          if (p.id === "phisherLike") applyPhisherLikePreset();
          updateFileInfo();
          renderTablePreview();
          renderSummaryPanel();
          renderDrawerPanel("presets");
        });
        actions.appendChild(applyBtn);
        row.appendChild(actions);
      }

      builtinSection.appendChild(row);
    });
    container.appendChild(builtinSection);

    // ── USER PRESETS ─────────────────────────────────────────────────────────
    const divider1 = document.createElement("div");
    divider1.className = "panel-divider";
    container.appendChild(divider1);

    const userSection = panelSection("MY PRESETS");

    if (allUserPresets.length === 0) {
      const empty = document.createElement("div");
      empty.className   = "panel-hint";
      empty.textContent = 'No saved presets yet. Shape your data then use "Save as preset" below.';
      userSection.appendChild(empty);
    } else {
      const scrollWrap = document.createElement("div");
      scrollWrap.className = "preset-user-scroll";
      allUserPresets.forEach(p => {
        const row = document.createElement("div");
        row.className = "preset-list-row";

        const nameEl = document.createElement("div");
        nameEl.className   = "preset-list-name";
        nameEl.textContent = p.label;
        if (viewState.activePreset === p.id) nameEl.classList.add("active");

        const descEl = document.createElement("div");
        descEl.className   = "preset-list-desc";
        descEl.textContent = p.description;

        row.appendChild(nameEl);
        row.appendChild(descEl);

        // Show row filter summary if preset has any
        if (p.rowFilters?.length) {
          const rfSummary = document.createElement("div");
          rfSummary.className = "preset-rf-summary";
          const OP_LABELS = { eq: "=", neq: "≠", contains: "contains", empty: "is empty", notempty: "is not empty" };
          rfSummary.textContent = "Filters: " + p.rowFilters.map(rf => {
            const fieldLabel = rf.field;
            const opLabel    = OP_LABELS[rf.op] || rf.op;
            const valLabel   = (rf.op === "empty" || rf.op === "notempty") ? "" : ` "${rf.value}"`;
            return `${fieldLabel} ${opLabel}${valLabel}`;
          }).join(" AND ");
          row.appendChild(rfSummary);
        }

        const actions = document.createElement("div");
        actions.className = "preset-list-actions";

        if (parsedData) {
          const applyBtn = document.createElement("button");
          applyBtn.className   = "btn btn-ghost preset-apply-btn";
          applyBtn.textContent = viewState.activePreset === p.id ? "✓ Applied" : "Apply";
          applyBtn.disabled    = viewState.activePreset === p.id;
          applyBtn.addEventListener("click", () => {
            applyUserPreset(p);
            renderDrawerPanel("presets");
          });
          actions.appendChild(applyBtn);
        }

        const exportBtn = document.createElement("button");
        exportBtn.className   = "btn btn-ghost";
        exportBtn.textContent = "⬆ Export";
        exportBtn.title       = "Export preset as JSON";
        exportBtn.addEventListener("click", () => exportPresetAsJson(p));
        actions.appendChild(exportBtn);

        const renameBtn = document.createElement("button");
        renameBtn.className   = "btn btn-ghost";
        renameBtn.textContent = "✏ Rename";
        renameBtn.addEventListener("click", () => {
          const currentName = p.label;
          const input = document.createElement("input");
          input.type      = "text";
          input.className = "panel-input";
          input.value     = currentName;

          nameEl.replaceWith(input);
          input.focus();
          input.select();

          function commitRename() {
            const newName = input.value.trim() || currentName;
            const map = loadUserPresets();
            if (map[p.id]) { map[p.id].label = newName; saveUserPresets(map); }
            renderDrawerPanel("presets");
          }
          input.addEventListener("blur", commitRename);
          input.addEventListener("keydown", e => {
            if (e.key === "Enter")  { e.preventDefault(); commitRename(); }
            if (e.key === "Escape") { e.preventDefault(); renderDrawerPanel("presets"); }
          });
        });
        actions.appendChild(renameBtn);

        const deleteBtn = document.createElement("button");
        deleteBtn.className   = "btn btn-ghost preset-delete-btn";
        deleteBtn.textContent = "✕ Delete";
        let deleteTimeout = null;
        let confirming    = false;
        deleteBtn.addEventListener("click", () => {
          if (!confirming) {
            confirming = true;
            deleteBtn.textContent = "Sure? (click again)";
            deleteBtn.classList.add("preset-delete-confirming");
            deleteTimeout = setTimeout(() => {
              confirming = false;
              deleteBtn.textContent = "✕ Delete";
              deleteBtn.classList.remove("preset-delete-confirming");
            }, 3000);
          } else {
            clearTimeout(deleteTimeout);
            const map = loadUserPresets();
            delete map[p.id];
            saveUserPresets(map);
            renderDrawerPanel("presets");
          }
        });
        actions.appendChild(deleteBtn);

        row.appendChild(actions);
        scrollWrap.appendChild(row);
      });
      userSection.appendChild(scrollWrap);
    }

    container.appendChild(userSection);

    // ── SAVE AS PRESET ────────────────────────────────────────────────────────
    const divider2 = document.createElement("div");
    divider2.className = "panel-divider";
    container.appendChild(divider2);

    const saveSection = panelSection("SAVE CURRENT STATE AS PRESET");

    if (!parsedData) {
      const hint = document.createElement("div");
      hint.className   = "panel-hint";
      hint.textContent = "Load a file and configure columns/mappings first.";
      saveSection.appendChild(hint);
    } else {
      const nameInput = document.createElement("input");
      nameInput.type        = "text";
      nameInput.className   = "panel-input";
      nameInput.placeholder = "Preset name…";

      const saveStatus = document.createElement("div");
      saveStatus.className = "panel-hint";
      saveStatus.style.marginTop = "0.2rem";

      saveSection.appendChild(nameInput);

      // ── Row filter builder ───────────────────────────────────────────────
      const rfLabel = document.createElement("div");
      rfLabel.className   = "panel-label";
      rfLabel.style.marginTop = "0.4rem";
      rfLabel.textContent = "ROW FILTERS (optional)";
      saveSection.appendChild(rfLabel);

      const rfHint = document.createElement("div");
      rfHint.className   = "panel-hint";
      rfHint.textContent = "Only show rows matching these conditions when preset is applied.";
      saveSection.appendChild(rfHint);

      const rfList = document.createElement("div");
      rfList.className = "rf-list";
      saveSection.appendChild(rfList);

      const OP_OPTIONS = [
        { value: "eq",       label: "equals" },
        { value: "neq",      label: "not equals" },
        { value: "contains", label: "contains" },
        { value: "empty",    label: "is empty" },
        { value: "notempty", label: "is not empty" },
      ];

      function addRfRow(initField = "", initOp = "eq", initVal = "") {
        const row = document.createElement("div");
        row.className = "rf-row";

        const fieldSel = document.createElement("select");
        fieldSel.className = "panel-select rf-field-select";
        const ph = document.createElement("option");
        ph.value = ""; ph.textContent = "Column…";
        fieldSel.appendChild(ph);
        parsedData.fields.filter(f => f !== NOTE_COL).forEach(f => {
          const opt = document.createElement("option");
          opt.value = f;
          opt.textContent = viewState.displayNames[f] || f;
          if (f === initField) opt.selected = true;
          fieldSel.appendChild(opt);
        });

        const opSel = document.createElement("select");
        opSel.className = "panel-select rf-op-select";
        OP_OPTIONS.forEach(({ value, label }) => {
          const opt = document.createElement("option");
          opt.value = value; opt.textContent = label;
          if (value === initOp) opt.selected = true;
          opSel.appendChild(opt);
        });

        const valInput = document.createElement("input");
        valInput.type        = "text";
        valInput.className   = "panel-input rf-val-input";
        valInput.placeholder = "Value…";
        valInput.value       = initVal;

        // Hide value input for empty/notempty
        function syncValVisibility() {
          const op = opSel.value;
          valInput.style.display = (op === "empty" || op === "notempty") ? "none" : "";
        }
        opSel.addEventListener("change", syncValVisibility);
        syncValVisibility();

        const removeBtn = document.createElement("button");
        removeBtn.className   = "btn btn-ghost";
        removeBtn.style.cssText = "padding:0.1rem 0.3rem;font-size:0.7rem;flex-shrink:0;";
        removeBtn.textContent = "✕";
        removeBtn.title       = "Remove filter";
        removeBtn.addEventListener("click", () => row.remove());

        row.appendChild(fieldSel);
        row.appendChild(opSel);
        row.appendChild(valInput);
        row.appendChild(removeBtn);
        rfList.appendChild(row);
      }

      // Pre-populate with existing rowFilters if any are active
      if (rowFilters.length) {
        rowFilters.forEach(rf => addRfRow(rf.field, rf.op, rf.value || ""));
      } else {
        addRfRow(); // start with one blank row
      }

      const addRfBtn = document.createElement("button");
      addRfBtn.className   = "btn btn-ghost";
      addRfBtn.style.cssText = "font-size:0.72rem;padding:0.15rem 0.45rem;align-self:flex-start;margin-top:0.1rem;";
      addRfBtn.textContent = "+ Add filter rule";
      addRfBtn.addEventListener("click", () => addRfRow());
      saveSection.appendChild(addRfBtn);

      saveSection.appendChild(saveStatus);

      function collectRowFilters() {
        const filters = [];
        rfList.querySelectorAll(".rf-row").forEach(row => {
          const field = row.querySelector(".rf-field-select").value;
          const op    = row.querySelector(".rf-op-select").value;
          const value = row.querySelector(".rf-val-input").value.trim();
          if (!field || !op) return;
          if ((op === "empty" || op === "notempty") || value) {
            filters.push({ field, op, value: op === "empty" || op === "notempty" ? "" : value });
          }
        });
        return filters;
      }

      const saveBtn = applyButton("Save as preset");
      saveBtn.style.marginTop = "0.25rem";
      saveBtn.addEventListener("click", () => {
        const name = nameInput.value.trim();
        if (!name) { nameInput.focus(); return; }

        const capturedFilters = collectRowFilters();
        const map      = loadUserPresets();
        const existing = Object.values(map).find(p => p.label.toLowerCase() === name.toLowerCase());

        if (existing) {
          if (saveStatus.dataset.awaitingOverwrite === "1") {
            const preset = captureCurrentAsPreset(name, capturedFilters);
            if (!preset) return;
            preset.id = existing.id;
            map[preset.id] = preset;
            saveUserPresets(map);
            nameInput.value = "";
            saveStatus.textContent = "";
            saveStatus.dataset.awaitingOverwrite = "";
            renderDrawerPanel("presets");
          } else {
            saveStatus.textContent = `"${name}" already exists. Click Save again to overwrite.`;
            saveStatus.style.color = "#f59e0b";
            saveStatus.dataset.awaitingOverwrite = "1";
            setTimeout(() => {
              saveStatus.textContent = "";
              saveStatus.dataset.awaitingOverwrite = "";
            }, 4000);
          }
        } else {
          const preset = captureCurrentAsPreset(name, capturedFilters);
          if (!preset) return;
          map[preset.id] = preset;
          saveUserPresets(map);
          nameInput.value = "";
          saveStatus.textContent = "";
          saveStatus.dataset.awaitingOverwrite = "";
          renderDrawerPanel("presets");
        }
      });
      saveSection.appendChild(saveBtn);
    }

    container.appendChild(saveSection);

    // ── IMPORT ────────────────────────────────────────────────────────────────
    const divider3 = document.createElement("div");
    divider3.className = "panel-divider";
    container.appendChild(divider3);

    const importSection = panelSection("IMPORT PRESET FROM JSON");
    const importHint = document.createElement("div");
    importHint.className   = "panel-hint";
    importHint.textContent = "Import a preset shared by a colleague.";
    importSection.appendChild(importHint);

    const importBtn = document.createElement("button");
    importBtn.className   = "btn btn-ghost";
    importBtn.textContent = "⬇ Import JSON…";
    importBtn.style.marginTop = "0.2rem";
    importBtn.addEventListener("click", () => {
      const fileInput = document.createElement("input");
      fileInput.type   = "file";
      fileInput.accept = ".json";
      fileInput.addEventListener("change", () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = e => {
          try {
            const p = JSON.parse(e.target.result);
            if (!p.id || !p.label || !p.keepFields) throw new Error("Invalid preset file.");
            // Assign a new ID to avoid collision
            p.id = `user_${Date.now()}`;
            p.isUserPreset = true;
            const map = loadUserPresets();
            map[p.id] = p;
            saveUserPresets(map);
            renderDrawerPanel("presets");
          } catch (err) {
            alert(`Could not import preset: ${err.message}`);
          }
        };
        reader.readAsText(file);
      });
      fileInput.click();
    });
    importSection.appendChild(importBtn);
    container.appendChild(importSection);

    // ── ACTIVE PRESET STATUS ──────────────────────────────────────────────────
    const divider4 = document.createElement("div");
    divider4.className = "panel-divider";
    container.appendChild(divider4);

    const statusSection = panelSection("ACTIVE PRESET");
    if (viewState.activePreset) {
      const allPresets = { ...presets, ...loadUserPresets() };
      const p = allPresets[viewState.activePreset];
      const badge = document.createElement("div");
      badge.className   = "panel-status";
      badge.textContent = `✓ ${p?.label || viewState.activePreset}`;
      statusSection.appendChild(badge);
    } else {
      const none = document.createElement("div");
      none.className   = "panel-status-inactive";
      none.textContent = "No preset applied";
      statusSection.appendChild(none);
    }
    container.appendChild(statusSection);
  }

  function applyUserPreset(preset) {
    if (!parsedData) return;
    const keepSet   = new Set(preset.keepFields);
    const effective = parsedData.fields.filter(f => keepSet.has(f));
    viewState.visibleFields = effective;

    // Apply all stored display names (full map, not just deltas)
    effective.forEach(f => {
      viewState.displayNames[f] = (preset.renameFields && preset.renameFields[f]) || f;
    });

    if (preset.valueMapping) {
      applyValueMappings(preset.valueMapping, true);
    }

    // Apply row filters
    rowFilters = (preset.rowFilters || []).filter(rf => rf.field && rf.op);
    renderRowFilterBadges();

    viewState.activePreset = preset.id;
    updateFileInfo();
    renderTablePreview();
    renderSummaryPanel();
  }

  function exportPresetAsJson(preset) {
    const blob = new Blob([JSON.stringify(preset, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `${preset.label.replace(/\s+/g, "-").toLowerCase()}-preset.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  function buildMappingPanel(container) {
    if (!parsedData) {
      noDataMessage(container, "Load a file to configure value mappings.");
      return;
    }

    // Column selector
    const colSection = panelSection("TARGET COLUMN");
    const colSelect  = document.createElement("select");
    colSelect.className = "panel-select";
    colSelect.id        = "vmColSelect";

    const ph = document.createElement("option");
    ph.value       = "";
    ph.textContent = "Select column…";
    colSelect.appendChild(ph);

    parsedData.fields.forEach(f => {
      const opt       = document.createElement("option");
      opt.value       = f;
      opt.textContent = viewState.displayNames[f] || f;
      colSelect.appendChild(opt);
    });

    colSection.appendChild(colSelect);
    container.appendChild(colSection);

    // Rules
    const rulesSection = panelSection("RULES");
    const rulesList    = document.createElement("div");
    rulesList.id       = "vmRulesList";
    rulesList.style.display       = "flex";
    rulesList.style.flexDirection = "column";
    rulesList.style.gap           = "0.25rem";
    rulesSection.appendChild(rulesList);

    function addMappingRow(fromVal = "", toVal = "") {
      const row = document.createElement("div");
      row.className = "mapping-row";

      const fromInput = document.createElement("input");
      fromInput.type        = "text";
      fromInput.className   = "panel-input";
      fromInput.placeholder = "From";
      fromInput.value       = fromVal;

      const arrow = document.createElement("span");
      arrow.className   = "mapping-arrow";
      arrow.textContent = "→";

      const toInput = document.createElement("input");
      toInput.type        = "text";
      toInput.className   = "panel-input";
      toInput.placeholder = "To";
      toInput.value       = toVal;

      const delBtn = document.createElement("button");
      delBtn.className  = "mapping-delete";
      delBtn.textContent = "✕";
      delBtn.title      = "Remove row";
      delBtn.addEventListener("click", () => row.remove());

      row.appendChild(fromInput);
      row.appendChild(arrow);
      row.appendChild(toInput);
      row.appendChild(delBtn);
      rulesList.appendChild(row);
    }

    addMappingRow();
    container.appendChild(rulesSection);

    const addRowBtn = document.createElement("button");
    addRowBtn.className   = "btn btn-ghost";
    addRowBtn.textContent = "+ Add rule";
    addRowBtn.style.cssText = "font-size:0.72rem;padding:0.2rem 0.5rem;align-self:flex-start;";
    addRowBtn.addEventListener("click", () => addMappingRow());
    container.appendChild(addRowBtn);

    const hint = document.createElement("div");
    hint.className   = "panel-hint";
    hint.textContent = "Append * to the From value for a prefix match.";
    container.appendChild(hint);

    // Apply
    const applyBtn = applyButton("Apply mappings");
    applyBtn.addEventListener("click", () => {
      const col  = colSelect.value;
      if (!col) return;

      const rules = {};
      rulesList.querySelectorAll(".mapping-row").forEach(row => {
        const inputs = row.querySelectorAll("input");
        const from   = inputs[0]?.value.trim();
        const to     = inputs[1]?.value.trim();
        if (from && to) rules[from] = to;
      });

      if (!Object.keys(rules).length) return;
      applyValueMappings({ [col]: rules });
      renderTablePreview();
    });
    container.appendChild(applyBtn);
  }

  // Tools panel
  function buildToolsPanel(container) {
    // Remove duplicates
    const dedupSection = panelSection("REMOVE DUPLICATES");

    if (!parsedData) {
      noDataMessage(container, "Load a file to use tools.");
      return;
    }

    const colSelect = document.createElement("select");
    colSelect.className = "panel-select";
    colSelect.id        = "dedupColSelect";

    const ph = document.createElement("option");
    ph.value       = "";
    ph.textContent = "Key column…";
    colSelect.appendChild(ph);

    parsedData.fields.filter(f => f !== NOTE_COL).forEach(f => {
      const opt       = document.createElement("option");
      opt.value       = f;
      opt.textContent = viewState.displayNames[f] || f;
      colSelect.appendChild(opt);
    });
    dedupSection.appendChild(colSelect);

    const keepFirstRow = radioRow("keepDedup", "keep-first", "Keep first occurrence", true);
    const keepLastRow  = radioRow("keepDedup", "keep-last",  "Keep last occurrence");
    dedupSection.appendChild(keepFirstRow);
    dedupSection.appendChild(keepLastRow);

    const dedupMsg = document.createElement("div");
    dedupMsg.className    = "panel-hint";
    dedupMsg.id           = "dedupMsg";
    dedupSection.appendChild(dedupMsg);

    container.appendChild(dedupSection);

    const runDedupBtn = applyButton("Remove duplicates");
    runDedupBtn.addEventListener("click", () => {
      const col = colSelect.value;
      if (!col || !parsedData) return;
      saveUndoSnapshot();
      const keepLast = keepLastRow.querySelector("input").checked;
      const before   = parsedData.rows.length;
      const seenKeys = new Set();
      const result   = [];
      const rowsToProcess = keepLast ? [...parsedData.rows].reverse() : parsedData.rows;
      rowsToProcess.forEach(row => {
        const key = String(row[col] ?? "");
        if (!seenKeys.has(key)) { seenKeys.add(key); result.push(row); }
      });
      parsedData.rows = keepLast ? result.reverse() : result;

      const removed = before - parsedData.rows.length;
      dedupMsg.textContent = removed > 0
        ? `✓ Removed ${removed.toLocaleString()} duplicate${removed !== 1 ? "s" : ""}.`
        : "No duplicates found.";
      dedupMsg.style.color = removed > 0 ? "#4ade80" : "#6b7280";

      updateFileInfo();
      renderTablePreview();
      renderSummaryPanel();
    });
    container.appendChild(runDedupBtn);

    // Data cleanup
    const divider = document.createElement("div");
    divider.className = "panel-divider";
    divider.style.margin = "0.6rem 0 0.1rem";
    container.appendChild(divider);

    const cleanSection = panelSection("DATA CLEANUP");

    if (!parsedData) {
      const hint = document.createElement("div");
      hint.className   = "panel-hint";
      hint.textContent = "Load a file to use cleanup tools.";
      cleanSection.appendChild(hint);
      container.appendChild(cleanSection);
      return;
    }

    // Column selector
    const cleanColSelect = document.createElement("select");
    cleanColSelect.className = "panel-select";

    const cleanPh = document.createElement("option");
    cleanPh.value       = "";
    cleanPh.textContent = "Select column… (or all)";
    cleanColSelect.appendChild(cleanPh);

    const allOpt = document.createElement("option");
    allOpt.value       = "__all__";
    allOpt.textContent = "— All visible columns —";
    cleanColSelect.appendChild(allOpt);

    parsedData.fields.filter(f => f !== NOTE_COL).forEach(f => {
      const opt       = document.createElement("option");
      opt.value       = f;
      opt.textContent = viewState.displayNames[f] || f;
      cleanColSelect.appendChild(opt);
    });
    cleanSection.appendChild(cleanColSelect);

    // Operation selector
    const opSelect = document.createElement("select");
    opSelect.className = "panel-select";
    opSelect.style.marginTop = "0.2rem";

    [
      { value: "",             label: "Select operation…" },
      { value: "trim",         label: "Trim whitespace" },
      { value: "upper",        label: "UPPERCASE" },
      { value: "lower",        label: "lowercase" },
      { value: "title",        label: "Title Case" },
      { value: "strip-ctrl",   label: "Strip control characters" },
      { value: "to-number",    label: "Convert to number" },
    ].forEach(({ value, label }) => {
      const opt = document.createElement("option");
      opt.value       = value;
      opt.textContent = label;
      opSelect.appendChild(opt);
    });
    cleanSection.appendChild(opSelect);

    const cleanMsg = document.createElement("div");
    cleanMsg.className = "panel-hint";
    cleanMsg.style.marginTop = "0.2rem";
    cleanSection.appendChild(cleanMsg);

    container.appendChild(cleanSection);

    const runCleanBtn = applyButton("Apply cleanup");
    runCleanBtn.addEventListener("click", () => {
      const col = cleanColSelect.value;
      const op  = opSelect.value;
      if (!col || !op || !parsedData) return;
      saveUndoSnapshot();

      const targetFields = col === "__all__"
        ? getEffectiveFields().filter(f => f !== NOTE_COL && !PROTECTED_COLS.has(f))
        : PROTECTED_COLS.has(col) ? [] : [col];

      if (targetFields.length === 0) {
        cleanMsg.textContent = "No editable columns selected.";
        cleanMsg.style.color = "#f87171";
        return;
      }

      let changed = 0;

      parsedData.rows.forEach(row => {
        targetFields.forEach(f => {
          const raw = row[f];
          if (raw == null) return;
          const str = String(raw);
          let result = str;

          switch (op) {
            case "trim":
              result = str.trim();
              break;
            case "upper":
              result = str.toUpperCase();
              break;
            case "lower":
              result = str.toLowerCase();
              break;
            case "title":
              result = str.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
              break;
            case "strip-ctrl":
              // Remove control chars (0x00-0x1F, 0x7F) except normal whitespace
              result = str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
              break;
            case "to-number": {
              const n = Number(str.replace(/[, ]/g, ""));
              result = isNaN(n) ? str : String(n);
              break;
            }
          }

          if (result !== str) {
            row[f] = result;
            changed++;
          }
        });
      });

      cleanMsg.textContent = changed > 0
        ? `✓ Updated ${changed.toLocaleString()} cell${changed !== 1 ? "s" : ""}.`
        : "No changes made.";
      cleanMsg.style.color = changed > 0 ? "#4ade80" : "#6b7280";

      renderTablePreview();
      renderSummaryPanel();
    });
    container.appendChild(runCleanBtn);

    // ── Join / Lookup ─────────────────────────────────────────────────────────
    const joinDivider = document.createElement("div");
    joinDivider.className = "panel-divider";
    joinDivider.style.margin = "0.6rem 0 0.1rem";
    container.appendChild(joinDivider);

    const joinSection = panelSection("JOIN / LOOKUP");

    const joinHint = document.createElement("div");
    joinHint.className   = "panel-hint";
    joinHint.textContent = "Load a second file (e.g. master list) and pull columns from it into your current data by matching on a shared key.";
    joinSection.appendChild(joinHint);

    // Lookup file drop zone
    const joinDropzone = document.createElement("div");
    joinDropzone.className = "join-dropzone";
    joinDropzone.id        = "joinDropzone";
    joinDropzone.innerHTML = `<span>⬇ Drop lookup file here or click to browse</span>`;
    joinSection.appendChild(joinDropzone);

    const joinFileInput = document.createElement("input");
    joinFileInput.type   = "file";
    joinFileInput.accept = ".csv,.txt,.xlsx";
    joinFileInput.style.display = "none";
    joinSection.appendChild(joinFileInput);

    // Lookup file status
    const joinFileStatus = document.createElement("div");
    joinFileStatus.className = "panel-hint";
    joinFileStatus.id        = "joinFileStatus";
    joinSection.appendChild(joinFileStatus);

    container.appendChild(joinSection);

    // Config area — shown after lookup file is loaded
    const joinConfig = document.createElement("div");
    joinConfig.id = "joinConfig";
    joinConfig.style.display = "none";
    joinConfig.style.display = "flex";
    joinConfig.style.flexDirection = "column";
    joinConfig.style.gap = "0.35rem";
    joinConfig.style.display = "none";
    container.appendChild(joinConfig);

    // State for lookup file
    let lookupData = null; // { fields, rows }

    function buildJoinConfig() {
      joinConfig.innerHTML = "";
      joinConfig.style.display = "flex";

      // Key column in current file
      const keyALabel = document.createElement("div");
      keyALabel.className   = "panel-label";
      keyALabel.textContent = "Match key — current file";
      joinConfig.appendChild(keyALabel);

      const keyASelect = document.createElement("select");
      keyASelect.className = "panel-select";
      keyASelect.id        = "joinKeyA";
      const phA = document.createElement("option");
      phA.value = ""; phA.textContent = "Select column…";
      keyASelect.appendChild(phA);
      parsedData.fields.forEach(f => {
        const opt = document.createElement("option");
        opt.value = f;
        opt.textContent = viewState.displayNames[f] || f;
        keyASelect.appendChild(opt);
      });
      joinConfig.appendChild(keyASelect);

      // Key column in lookup file
      const keyBLabel = document.createElement("div");
      keyBLabel.className   = "panel-label";
      keyBLabel.textContent = "Match key — lookup file";
      joinConfig.appendChild(keyBLabel);

      const keyBSelect = document.createElement("select");
      keyBSelect.className = "panel-select";
      keyBSelect.id        = "joinKeyB";
      const phB = document.createElement("option");
      phB.value = ""; phB.textContent = "Select column…";
      keyBSelect.appendChild(phB);
      lookupData.fields.forEach(f => {
        const opt = document.createElement("option");
        opt.value = f; opt.textContent = f;
        keyBSelect.appendChild(opt);
      });
      joinConfig.appendChild(keyBSelect);

      // Columns to import
      const importLabel = document.createElement("div");
      importLabel.className   = "panel-label";
      importLabel.textContent = "Columns to bring in";
      joinConfig.appendChild(importLabel);

      const importList = document.createElement("div");
      importList.className = "join-import-list";
      importList.id        = "joinImportList";

      lookupData.fields.forEach(f => {
        const row = document.createElement("label");
        row.className = "join-import-row";
        const cb  = document.createElement("input");
        cb.type   = "checkbox";
        cb.value  = f;
        cb.checked = true;
        const span = document.createElement("span");
        span.textContent = f;
        row.appendChild(cb);
        row.appendChild(span);
        importList.appendChild(row);
      });
      joinConfig.appendChild(importList);

      // Fallback for no match
      const fallbackLabel = document.createElement("div");
      fallbackLabel.className   = "panel-label";
      fallbackLabel.textContent = "Value when no match found";
      joinConfig.appendChild(fallbackLabel);

      const fallbackInput = document.createElement("input");
      fallbackInput.type        = "text";
      fallbackInput.className   = "panel-input";
      fallbackInput.placeholder = "(leave blank)";
      fallbackInput.value       = "";
      joinConfig.appendChild(fallbackInput);

      // Case-sensitive toggle
      const caseRow = document.createElement("label");
      caseRow.className = "radio-row";
      const caseCb = document.createElement("input");
      caseCb.type    = "checkbox";
      caseCb.id      = "joinCaseSensitive";
      caseCb.checked = false;
      const caseSpan = document.createElement("span");
      caseSpan.textContent = "Case-sensitive matching";
      caseRow.appendChild(caseCb);
      caseRow.appendChild(caseSpan);
      joinConfig.appendChild(caseRow);

      // Result message
      const joinMsg = document.createElement("div");
      joinMsg.className = "panel-hint";
      joinMsg.id        = "joinMsg";
      joinConfig.appendChild(joinMsg);

      // Apply button
      const applyJoinBtn = applyButton("Apply lookup");
      applyJoinBtn.addEventListener("click", () => {
        const keyA        = keyASelect.value;
        const keyB        = keyBSelect.value;
        const caseSens    = caseCb.checked;
        const fallback    = fallbackInput.value;
        const importFields = [...importList.querySelectorAll("input:checked")].map(cb => cb.value).filter(f => f !== keyB);

        if (!keyA || !keyB) {
          joinMsg.textContent = "Select key columns on both sides.";
          joinMsg.style.color = "#f87171";
          return;
        }
        if (!importFields.length) {
          joinMsg.textContent = "Select at least one column to bring in.";
          joinMsg.style.color = "#f87171";
          return;
        }

        saveUndoSnapshot();

        // Build lookup index from lookup file: keyValue -> row
        const lookupIndex = {};
        lookupData.rows.forEach(row => {
          const raw = row[keyB] == null ? "" : String(row[keyB]);
          const key = caseSens ? raw.trim() : raw.trim().toLowerCase();
          if (!lookupIndex[key]) lookupIndex[key] = row; // keep first match
        });

        // Add new columns to parsedData if not already present
        importFields.forEach(f => {
          if (!parsedData.fields.includes(f)) {
            parsedData.fields.push(f);
            viewState.visibleFields.push(f);
            viewState.displayNames[f] = f;
          }
        });

        let matched = 0;
        let unmatched = 0;

        parsedData.rows.forEach(row => {
          const raw    = row[keyA] == null ? "" : String(row[keyA]);
          const key    = caseSens ? raw.trim() : raw.trim().toLowerCase();
          const source = lookupIndex[key];

          importFields.forEach(f => {
            if (source) {
              row[f] = source[f] ?? fallback;
            } else {
              if (row[f] === undefined) row[f] = fallback;
            }
          });

          if (source) matched++; else unmatched++;
        });

        joinMsg.textContent = `✓ Matched ${matched.toLocaleString()} rows. ${unmatched > 0 ? `${unmatched.toLocaleString()} rows had no match (set to "${fallback || "blank"}").` : "All rows matched."}`;
        joinMsg.style.color = unmatched > 0 ? "#f59e0b" : "#4ade80";

        renderColumnsPanel(parsedData.fields);
        renderTablePreview();
        renderSummaryPanel();
      });
      joinConfig.appendChild(applyJoinBtn);
    }

    function handleLookupFile(file) {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: false,
        complete: results => {
          lookupData = { fields: results.meta.fields || [], rows: results.data || [] };
          joinFileStatus.textContent = `✓ ${file.name} — ${lookupData.rows.length.toLocaleString()} rows, ${lookupData.fields.length} columns`;
          joinFileStatus.style.color = "#4ade80";
          buildJoinConfig();
        },
        error: err => {
          joinFileStatus.textContent = `Error: ${err.message}`;
          joinFileStatus.style.color = "#f87171";
        },
      });
    }

    joinDropzone.addEventListener("click", () => { joinFileInput.value = ""; joinFileInput.click(); });
    joinFileInput.addEventListener("change", e => { const f = e.target.files?.[0]; if (f) handleLookupFile(f); });
    joinDropzone.addEventListener("dragover",  e => { e.preventDefault(); joinDropzone.classList.add("dragover"); });
    joinDropzone.addEventListener("dragleave", e => { e.preventDefault(); joinDropzone.classList.remove("dragover"); });
    joinDropzone.addEventListener("drop", e => {
      e.preventDefault();
      joinDropzone.classList.remove("dragover");
      const f = e.dataTransfer.files?.[0];
      if (f) handleLookupFile(f);
    });
  }

  // ── Row selection state ───────────────────────────────────────────────────
  let selectedRows    = new Set(); // rowIdx values in current preview
  let lastSelectedRow = null;

  function refreshRowSelection() {
    document.querySelectorAll("#csvTableContainer tbody tr").forEach((tr, i) => {
      const isSelected = selectedRows.has(i);
      tr.classList.toggle("row-selected", isSelected);
      const gutter = tr.querySelector(".row-gutter");
      if (gutter) gutter.classList.toggle("row-selected", isSelected);
    });
  }

  const ctxMenu = {
    el: null,

    init() {
      if (this.el) return;
      const el = document.createElement("div");
      el.id        = "pbContextMenu";
      el.className = "ctx-menu hidden";
      document.body.appendChild(el);
      this.el = el;

      // Dismiss on outside click or Escape
      document.addEventListener("mousedown", e => {
        if (!this.el.contains(e.target)) this.hide();
      });
      document.addEventListener("keydown", e => {
        if (e.key === "Escape") this.hide();
      });
    },

    show(x, y, items) {
      this.init();
      this.el.innerHTML = "";

      items.forEach(item => {
        if (item === "---") {
          const sep = document.createElement("div");
          sep.className = "ctx-separator";
          this.el.appendChild(sep);
          return;
        }

        const btn = document.createElement("button");
        btn.className   = "ctx-item";
        btn.textContent = item.label;
        if (item.danger)    btn.classList.add("ctx-item--danger");
        if (item.disabled)  btn.classList.add("ctx-item--disabled");
        if (!item.disabled) {
          btn.addEventListener("click", () => {
            this.hide();
            item.action();
          });
        }
        this.el.appendChild(btn);
      });

      this.el.classList.remove("hidden");

      // Position — keep within viewport
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      this.el.style.left = "0";
      this.el.style.top  = "0";
      const w = this.el.offsetWidth;
      const h = this.el.offsetHeight;
      this.el.style.left = `${Math.min(x, vw - w - 8)}px`;
      this.el.style.top  = `${Math.min(y, vh - h - 8)}px`;
    },

    hide() {
      if (this.el) this.el.classList.add("hidden");
    },
  };

  function showCellContextMenu(e, field, cellValue, row, tr, dataIdx) {
    e.preventDefault();
    const hasNote    = !!(row[NOTE_COL] && String(row[NOTE_COL]).trim());
    const displayName = viewState.displayNames[field] || field;

    ctxMenu.show(e.clientX, e.clientY, [
      {
        label: `Copy cell value`,
        action: () => navigator.clipboard?.writeText(cellValue),
      },
      {
        label: `Filter by this value`,
        action: () => {
          filterState.text  = cellValue;
          filterState.field = field;
          const si = document.getElementById("csvSearchInput");
          const sf = document.getElementById("csvSearchField");
          const sc = document.getElementById("csvSearchClear");
          if (si) si.value = cellValue;
          if (sf) sf.value = field;
          if (sc) sc.style.display = "flex";
          renderTablePreview();
        },
      },
      {
        label: `Send to value mapping`,
        action: () => {
          // If mapping drawer is already open, just append — don't re-render
          const alreadyOpen = drawerState.open && drawerState.panel === "mapping";
          if (!alreadyOpen) openDrawer("mapping");

          setTimeout(() => {
            const colSelect = document.getElementById("vmColSelect");
            const rulesList = document.getElementById("vmRulesList");
            if (!colSelect || !rulesList) return;

            // Set column selector (only if not already set to something)
            if (!colSelect.value) colSelect.value = field;
            else colSelect.value = field; // always match the cell's column

            // Append a pre-filled mapping row — reuse last empty row if one exists
            const existingRows = rulesList.querySelectorAll(".mapping-row");
            const lastRow = existingRows[existingRows.length - 1];
            const lastFrom = lastRow?.querySelector("input[placeholder='From']");
            let rowEl, toInput;

            if (lastFrom && lastFrom.value.trim() === "") {
              // Reuse the existing empty row
              rowEl   = lastRow;
              lastFrom.value = cellValue;
              toInput = lastRow.querySelector("input[placeholder='To']");
            } else {
              // Append a new row
              rowEl = document.createElement("div");
              rowEl.className = "mapping-row";

              const fromInput = document.createElement("input");
              fromInput.type        = "text";
              fromInput.className   = "panel-input";
              fromInput.placeholder = "From";
              fromInput.value       = cellValue;

              const arrow = document.createElement("span");
              arrow.className   = "mapping-arrow";
              arrow.textContent = "→";

              toInput = document.createElement("input");
              toInput.type        = "text";
              toInput.className   = "panel-input";
              toInput.placeholder = "To";

              const delBtn = document.createElement("button");
              delBtn.className   = "mapping-delete";
              delBtn.textContent = "✕";
              delBtn.title       = "Remove row";
              delBtn.addEventListener("click", () => rowEl.remove());

              rowEl.appendChild(fromInput);
              rowEl.appendChild(arrow);
              rowEl.appendChild(toInput);
              rowEl.appendChild(delBtn);
              rulesList.appendChild(rowEl);
            }
            toInput.focus();
          }, alreadyOpen ? 0 : 50);
        },
      },
      "---",
      {
        label: hasNote ? "Clear note for this row" : "Add note",
        danger: hasNote,
        action: () => {
          if (hasNote) {
            // Clear the note
            if (dataIdx >= 0) parsedData.rows[dataIdx][NOTE_COL] = "";
            const key = makeAnnotationKey(row);
            if (key) {
              const ann = loadAnnotations();
              if (ann[key]) { ann[key].statusNote = ""; annotationsCache = ann; saveAnnotations(); }
            }
            tr.classList.remove("annotated");
            // Update the note cell in the row visually
            const noteTd = [...tr.querySelectorAll("td")].find(td => td.classList.contains("cell-note"));
            if (noteTd) noteTd.textContent = "";
          } else {
            // Focus the note cell for this row to let user type
            const noteTd = [...tr.querySelectorAll("td")].find(td => td.classList.contains("cell-note"));
            if (noteTd) noteTd.click();
          }
        },
      },
    ]);
  }

  function showRowContextMenu(e, row, tr, dataIdx, rowIdx) {
    e.preventDefault();
    const hasNote  = !!(row[NOTE_COL] && String(row[NOTE_COL]).trim());
    const fields   = getEffectiveFields();
    const selCount = selectedRows.size;

    // Build HTML table string for clipboard
    function buildHtmlTable(rows) {
      const headers = fields.map(f => viewState.displayNames[f] || f);
      const ths = headers.map(h => `<th style="border:1px solid #ccc;padding:4px 8px;background:#f3f4f6;">${h}</th>`).join("");
      const trs = rows.map(r =>
        "<tr>" + fields.map(f => `<td style="border:1px solid #ccc;padding:4px 8px;">${r[f] ?? ""}</td>`).join("") + "</tr>"
      ).join("");
      return `<table style="border-collapse:collapse;font-family:sans-serif;font-size:13px;"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
    }

    function copyHtmlTable(rows) {
      const html = buildHtmlTable(rows);
      const blob = new Blob([html], { type: "text/html" });
      const item = new ClipboardItem({ "text/html": blob });
      navigator.clipboard?.write([item]);
    }

    ctxMenu.show(e.clientX, e.clientY, [
      {
        label: "Copy row as CSV",
        action: () => {
          const vals = fields.map(f => {
            const v = String(row[f] ?? "");
            return v.includes(",") || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v;
          });
          navigator.clipboard?.writeText(vals.join(","));
        },
      },
      {
        label: selCount > 1 ? `Copy ${selCount} selected rows as table` : "Copy row as table",
        action: () => {
          const rowsToCopy = selCount > 1
            ? [...selectedRows].sort((a,b) => a-b).map(i => getFilteredSortedRows()[i]).filter(Boolean)
            : [row];
          copyHtmlTable(rowsToCopy);
        },
      },
      "---",
      {
        label: selCount > 1 ? `Hide ${selCount} selected rows` : "Hide row",
        action: () => {
          saveUndoSnapshot();
          if (selCount > 1) {
            const toRemove = new Set(
              [...selectedRows].map(i => getFilteredSortedRows()[i]).filter(Boolean)
            );
            parsedData.rows = parsedData.rows.filter(r => !toRemove.has(r));
            selectedRows.clear();
          } else {
            if (dataIdx >= 0) parsedData.rows.splice(dataIdx, 1);
          }
          updateFileInfo();
          renderTablePreview();
          renderSummaryPanel();
        },
      },
      "---",
      {
        label: "Clear note for this row",
        danger: true,
        disabled: !hasNote,
        action: () => {
          if (dataIdx >= 0) parsedData.rows[dataIdx][NOTE_COL] = "";
          const key = makeAnnotationKey(row);
          if (key) {
            const ann = loadAnnotations();
            if (ann[key]) { ann[key].statusNote = ""; annotationsCache = ann; saveAnnotations(); }
          }
          tr.classList.remove("annotated");
          const noteTd = [...tr.querySelectorAll("td")].find(td => td.classList.contains("cell-note"));
          if (noteTd) noteTd.textContent = "";
        },
      },
    ]);
  }

  function showColumnContextMenu(e, field) {
    e.preventDefault();
    e.stopPropagation(); // don't trigger sort click

    const displayName = viewState.displayNames[field] || field;
    // Use all filtered+sorted rows (not just preview) for column copies
    const allRows = getFilteredSortedRows();

    function buildColHtmlTable() {
      const th  = `<th style="border:1px solid #ccc;padding:4px 8px;background:#f3f4f6;">${displayName}</th>`;
      const tds = allRows.map(r => `<tr><td style="border:1px solid #ccc;padding:4px 8px;">${r[field] ?? ""}</td></tr>`).join("");
      return `<table style="border-collapse:collapse;font-family:sans-serif;font-size:13px;"><thead><tr>${th}</tr></thead><tbody>${tds}</tbody></table>`;
    }

    ctxMenu.show(e.clientX, e.clientY, [
      {
        label: `Copy column with header`,
        action: () => {
          const html = buildColHtmlTable();
          const blob = new Blob([html], { type: "text/html" });
          navigator.clipboard?.write([new ClipboardItem({ "text/html": blob })]);
        },
      },
      {
        // Plain newline-separated values — pastes cleanly as a list in email/doc
        label: `Copy values`,
        action: () => {
          const text = allRows.map(r => r[field] ?? "").join("\n");
          navigator.clipboard?.writeText(text);
        },
      },
      "---",
      {
        label: "Hide column",
        action: () => {
          viewState.visibleFields = viewState.visibleFields.filter(f => f !== field);
          renderTablePreview();
          renderSummaryPanel();
          // Sync checkbox in columns panel if drawer is open
          const cb = document.querySelector(`#csvColumnsPanel input[type="checkbox"][data-field="${field}"]`);
          if (cb) cb.checked = false;
        },
      },
    ]);
  }

  function renderTablePreview() {
    const container = document.getElementById("csvTableContainer");
    if (!container) return;
    container.innerHTML = "";

    if (!parsedData?.fields.length || !parsedData.rows.length) {
      const empty = document.createElement("div");
      empty.className = "csv-empty-state";
      empty.innerHTML = `
        <div class="csv-empty-icon">📂</div>
        <div class="csv-empty-title">No data loaded</div>
        <div class="csv-empty-sub">Drop a CSV or XLSX file, or use the Load button above.</div>
      `;
      container.appendChild(empty);
      return;
    }

    const fields      = getEffectiveFields();
    const filteredRows = getFilteredSortedRows();
    const MAX_ROWS    = 500;
    const previewRows = filteredRows.slice(0, MAX_ROWS);

    const info = document.createElement("div");
    info.className = "csv-table-info";
    const total = parsedData.rows.length;
    const shown = filteredRows.length;
    if (filterState.text) {
      info.textContent = previewRows.length < shown
        ? `${shown.toLocaleString()} matches (showing first ${MAX_ROWS}) of ${total.toLocaleString()} rows`
        : `${shown.toLocaleString()} of ${total.toLocaleString()} rows match`;
      info.style.color = shown === 0 ? "#f87171" : "#60a5fa";
    } else {
      info.textContent = shown > MAX_ROWS
        ? `Showing first ${MAX_ROWS.toLocaleString()} of ${shown.toLocaleString()} rows.`
        : `${shown.toLocaleString()} row${shown !== 1 ? "s" : ""}`;
      info.style.color = "";
    }
    container.appendChild(info);

    const tableWrap = document.createElement("div");

    const table = document.createElement("table");
    table.className = "data-table";

    // Header
    const thead = document.createElement("thead");
    const hRow  = document.createElement("tr");

    // Gutter header
    const gutterTh = document.createElement("th");
    gutterTh.className = "row-gutter-th";
    hRow.appendChild(gutterTh);

    fields.forEach(field => {
      const th = document.createElement("th");
      const dn = viewState.displayNames[field] || field;
      th.title = field;

      const label = document.createElement("span");
      label.textContent = dn;
      th.appendChild(label);

      if (sortState.field === field) {
        const ind = document.createElement("span");
        ind.className   = "sort-indicator";
        ind.textContent = sortState.dir === "asc" ? "▲" : "▼";
        th.appendChild(ind);
      }

      th.addEventListener("click", () => {
        if (sortState.field === field) {
          sortState.dir = sortState.dir === "asc" ? "desc" : "asc";
        } else {
          sortState = { field, dir: "asc" };
        }
        renderTablePreview();
      });

      th.addEventListener("contextmenu", e => showColumnContextMenu(e, field));

      hRow.appendChild(th);
    });
    thead.appendChild(hRow);
    table.appendChild(thead);

    // Body
    const tbody = document.createElement("tbody");
    previewRows.forEach((row, rowIdx) => {
      const tr = document.createElement("tr");
      if (row[NOTE_COL] && String(row[NOTE_COL]).trim()) tr.classList.add("annotated");

      // Find the actual index in parsedData.rows for annotation writes
      const dataIdx = parsedData.rows.indexOf(row);

      // Row gutter cell (row number + selection + row-level right-click)
      const gutterTd = document.createElement("td");
      gutterTd.className   = "row-gutter";
      gutterTd.textContent = rowIdx + 1;
      if (selectedRows.has(rowIdx)) {
        gutterTd.classList.add("row-selected");
        tr.classList.add("row-selected");
      }
      gutterTd.addEventListener("click", e => {
        if (e.shiftKey && lastSelectedRow !== null) {
          // Range select
          const lo = Math.min(lastSelectedRow, rowIdx);
          const hi = Math.max(lastSelectedRow, rowIdx);
          for (let i = lo; i <= hi; i++) selectedRows.add(i);
        } else {
          if (selectedRows.has(rowIdx) && selectedRows.size === 1) {
            selectedRows.clear();
          } else {
            selectedRows.clear();
            selectedRows.add(rowIdx);
          }
        }
        lastSelectedRow = rowIdx;
        refreshRowSelection();
      });
      gutterTd.addEventListener("contextmenu", e => showRowContextMenu(e, row, tr, dataIdx, rowIdx));
      tr.appendChild(gutterTd);

      fields.forEach(field => {
        const td  = document.createElement("td");
        const val = row[field];
        const displayVal = val == null ? "" : String(val);
        const isProtected = PROTECTED_COLS.has(field);

        td.textContent = displayVal;
        if (field === NOTE_COL) td.classList.add("cell-note");
        if (isProtected) {
          td.classList.add("cell-protected");
          td.title = "This column is read-only";
          td.addEventListener("contextmenu", e => showCellContextMenu(e, field, displayVal, row, tr, dataIdx));
          tr.appendChild(td);
          return;
        }

        td.addEventListener("contextmenu", e => showCellContextMenu(e, field, displayVal, row, tr, dataIdx));

        td.addEventListener("click", () => {
          if (td.querySelector("input")) return; // already editing
          const original = td.textContent;

          const input = document.createElement("input");
          input.type       = "text";
          input.value      = original;
          input.className  = "cell-edit-input";
          input.spellcheck = false;

          td.textContent = "";
          td.appendChild(input);
          input.focus();
          input.select();

          function commit() {
            const newVal = input.value;
            td.textContent = newVal;
            if (field === NOTE_COL) td.classList.add("cell-note");

            // Write back to parsedData
            if (dataIdx >= 0) parsedData.rows[dataIdx][field] = newVal;

            // For StatusNote, also persist annotation
            if (field === NOTE_COL) {
              const key = makeAnnotationKey(row);
              if (key) {
                const ann = loadAnnotations();
                if (!ann[key]) ann[key] = {};
                ann[key].statusNote = newVal;
                annotationsCache = ann;
                saveAnnotations();
              }
              tr.classList.toggle("annotated", !!newVal.trim());
            }
          }

          function cancel() {
            td.textContent = original;
            if (field === NOTE_COL) td.classList.add("cell-note");
          }

          input.addEventListener("keydown", e => {
            if (e.key === "Enter")  { e.preventDefault(); commit(); }
            if (e.key === "Escape") { e.preventDefault(); cancel(); }
          });

          input.addEventListener("blur", () => commit());
        });

        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    container.appendChild(tableWrap);
  }

  // ── Summary panel ─────────────────────────────────────────────────────────

  function renderSummaryPanel() {
    const area = document.getElementById("csvSummaryArea");
    if (!area) return;
    area.innerHTML = "";

    // Controls row
    const controls = document.createElement("div");
    controls.className = "csv-summary-controls";

    const label = document.createElement("span");
    label.className   = "summary-label";
    label.textContent = "Group by:";

    const select = document.createElement("select");
    select.className = "summary-select";
    select.disabled  = !parsedData;

    const ph = document.createElement("option");
    ph.value       = "";
    ph.textContent = parsedData ? "Select column…" : "Load a file first";
    select.appendChild(ph);

    if (parsedData) {
      getEffectiveFields().filter(f => f !== NOTE_COL).forEach(f => {
        const opt       = document.createElement("option");
        opt.value       = f;
        opt.textContent = viewState.displayNames[f] || f;
        select.appendChild(opt);
      });
      if (lastSummary?.field) select.value = lastSummary.field;
    }

    const runBtn = document.createElement("button");
    runBtn.className = "btn btn-secondary";
    runBtn.style.cssText = "padding:0.2rem 0.55rem;font-size:0.72rem;";
    runBtn.textContent = "Run";
    runBtn.disabled    = !parsedData;

    controls.appendChild(label);
    controls.appendChild(select);
    controls.appendChild(runBtn);
    area.appendChild(controls);

    // Results
    const results = document.createElement("div");
    results.className = "csv-summary-results";
    results.id        = "csvSummaryResults";
    area.appendChild(results);

    runBtn.addEventListener("click", () => {
      const field = select.value;
      if (!field) return;
      lastSummary = computeGroupAndCount(field);
      renderSummaryResults(results);
    });

    if (lastSummary?.rows?.length) {
      renderSummaryResults(results);
    }
  }

  function renderSummaryResults(container) {
    container.innerHTML = "";
    if (!lastSummary?.rows.length) return;

    const dn = viewState.displayNames[lastSummary.field] || lastSummary.field;

    const info = document.createElement("div");
    info.className   = "summary-info";
    info.textContent = `Grouped by "${dn}" — ${lastSummary.rows.length.toLocaleString()} distinct values.`;
    container.appendChild(info);

    const table = document.createElement("table");
    table.className = "summary-table";

    const thead = document.createElement("thead");
    const hr    = document.createElement("tr");
    ["Value", "Count"].forEach((text, i) => {
      const th = document.createElement("th");
      th.textContent = text;
      if (i > 0) th.style.textAlign = "right";
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    lastSummary.rows.forEach(row => {
      const tr  = document.createElement("tr");
      const tdV = document.createElement("td");
      const tdC = document.createElement("td");
      tdV.textContent = row.value;
      tdC.textContent = row.count.toLocaleString();
      tr.appendChild(tdV);
      tr.appendChild(tdC);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    container.appendChild(table);
  }

  // ── UI helpers ────────────────────────────────────────────────────────────

  function panelSection(labelText) {
    const section = document.createElement("div");
    section.className = "panel-section";
    if (labelText) {
      const lbl = document.createElement("div");
      lbl.className   = "panel-label";
      lbl.textContent = labelText;
      section.appendChild(lbl);
    }
    return section;
  }

  function applyButton(text) {
    const btn = document.createElement("button");
    btn.className   = "btn";
    btn.style.cssText = "font-size:0.75rem;padding:0.3rem 0.65rem;margin-top:0.15rem;";
    btn.textContent = text;
    return btn;
  }

  function radioRow(name, value, labelText, checked = false) {
    const wrap  = document.createElement("label");
    wrap.className = "radio-row";
    const input = document.createElement("input");
    input.type    = "radio";
    input.name    = name;
    input.value   = value;
    input.checked = checked;
    const span = document.createElement("span");
    span.textContent = labelText;
    wrap.appendChild(input);
    wrap.appendChild(span);
    return wrap;
  }

  function noDataMessage(container, text) {
    const msg = document.createElement("div");
    msg.className   = "panel-hint";
    msg.textContent = text;
    container.appendChild(msg);
  }

  // ── Module lifecycle ──────────────────────────────────────────────────────

  function init() {}

  function show() {
    render();
    // Reopen drawer to the last open panel (persists across module switches)
    if (drawerState.open && drawerState.panel) {
      openDrawer(drawerState.panel);
    }
  }

  function hide() {}

  // ── Registration ──────────────────────────────────────────────────────────

  window.SecOpsWorkbench.registerModule("csvWorkbench", {
    meta,
    init,
    show,
    hide,
    api: {
      exportMainCsv:     downloadCurrentCsv,
      exportMainXlsx:    downloadCurrentXlsx,
      exportMainHtml:    downloadCurrentHtml,
      exportSummaryCsv,
      exportSummaryXlsx,
      exportSummaryHtml,
      applyValueMappings,
      hasSummary: () => !!(lastSummary?.rows?.length),
      // Used by Report Builder to read the active session
      getData: () => parsedData ? {
        fields:       parsedData.fields,
        rows:         parsedData.rows,
        visibleFields: viewState.visibleFields,
        displayNames: viewState.displayNames,
        filename:     parsedData.filename || "export",
      } : null,
      computeGroupAndCount,
    },
  });

})();
