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
  let viewState     = { visibleFields: [], displayNames: {}, activePreset: null };
  let lastSummary   = null;   // { field, rows: [{ value, count }] }
  let sortState     = { field: null, dir: "asc" };
  let filterState   = { text: "", field: "" };  // "" field = search all columns

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

  // ── Business logic ────────────────────────────────────────────────────────

  function applyValueMappings(valueMapping) {
    if (!parsedData || !valueMapping || typeof valueMapping !== "object") return;

    const displayToField = {};
    Object.keys(viewState.displayNames).forEach(f => {
      displayToField[viewState.displayNames[f]] = f;
    });

    Object.entries(valueMapping).forEach(([column, rulesObj]) => {
      if (!rulesObj || typeof rulesObj !== "object") return;
      const fields  = parsedData.fields;
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
      });
    });
  }

  function applyPhisherLikePreset() {
    if (!parsedData) return;
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
    if (!needle) return sorted;

    const fields = filterState.field
      ? [filterState.field]
      : getEffectiveFields();

    return sorted.filter(row =>
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
    sortState   = { field: null, dir: "asc" };
    filterState = { text: "", field: "" };
    selectedRows.clear();
    lastSelectedRow = null;

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
      const preset = presets[viewState.activePreset];
      const badge  = document.createElement("span");
      badge.className   = "csv-preset-badge";
      badge.textContent = `⚡ ${preset?.label || viewState.activePreset}`;
      el.appendChild(badge);
    }
  }

  function updateDownloadBtn() {
    const btn = document.getElementById("csvDownloadBtn");
    if (btn) btn.disabled = !parsedData || !parsedData.rows.length;
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
    // Select
    const selectSection = panelSection("SELECT PRESET");

    const select = document.createElement("select");
    select.className = "panel-select";
    select.disabled  = !parsedData;

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = parsedData ? "Select a preset…" : "Load a file first";
    select.appendChild(placeholder);

    Object.values(presets).forEach(p => {
      const opt       = document.createElement("option");
      opt.value       = p.id;
      opt.textContent = p.label;
      select.appendChild(opt);
    });

    if (viewState.activePreset) select.value = viewState.activePreset;

    selectSection.appendChild(select);
    container.appendChild(selectSection);

    // Description
    const desc = document.createElement("div");
    desc.className = "preset-desc";
    desc.id        = "presetDesc";

    function updateDesc() {
      const p = presets[select.value];
      desc.textContent = p ? p.description : "";
      desc.style.display = p ? "block" : "none";
    }
    updateDesc();
    select.addEventListener("change", updateDesc);
    container.appendChild(desc);

    // Apply
    if (parsedData) {
      const applyBtn = applyButton("Apply preset");
      applyBtn.style.marginTop = "0.1rem";
      applyBtn.addEventListener("click", () => {
        const chosen = select.value;
        if (!chosen) return;
        if (chosen === "phisherLike") applyPhisherLikePreset();
        updateFileInfo();
        updateDownloadBtn();
        renderTablePreview();
        renderSummaryPanel();
        // Refresh this panel to show active preset status
        renderDrawerPanel("presets");
      });
      container.appendChild(applyBtn);
    }

    // Active preset status
    const divider = document.createElement("div");
    divider.className = "panel-divider";
    divider.style.marginTop = "0.5rem";
    container.appendChild(divider);

    const statusSection = panelSection("ACTIVE PRESET");
    if (viewState.activePreset) {
      const p = presets[viewState.activePreset];
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

  // Value mapping panel
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

    // Data cleanup (coming soon placeholder)
    const divider = document.createElement("div");
    divider.className = "panel-divider";
    divider.style.margin = "0.6rem 0 0.1rem";
    container.appendChild(divider);

    const cleanSection = panelSection("DATA CLEANUP");
    const comingSoon   = document.createElement("div");
    comingSoon.className   = "panel-hint";
    comingSoon.textContent = "Trim whitespace, normalize case, strip control chars — coming soon.";
    cleanSection.appendChild(comingSoon);
    container.appendChild(cleanSection);
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
      parsedData.fields.filter(f => f !== NOTE_COL).forEach(f => {
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
      exportSummaryCsv,
      exportSummaryXlsx,
      applyValueMappings,
      hasSummary: () => !!(lastSummary?.rows?.length),
    },
  });

})();
