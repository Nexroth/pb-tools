// modules/csvWorkbench.js

(function () {
  const containerId = "moduleContainer";
  let rootEl = null;

  const meta = {
    title: "CSV / Spreadsheet Workbench",
    subtitle:
      "Load, inspect, annotate, and export PB Tools CSV data. All processing happens locally.",
  };

  // In-memory state
  let parsedData = null; // { fields: [...], rows: [...] }
  let viewState = {
    visibleFields: [],
    displayNames: {}, // fieldKey -> display name
    activePreset: null,
  };

  // Summary state
  let lastSummary = null; // { field, rows: [{ value, count }, ...] }

  // Annotation storage (localStorage)
  const ANNOTATION_STORAGE_KEY = "secopsWorkbenchAnnotations";
  const PERSON_KEY_COLUMN = "EmployeeID";
  const CAMPAIGN_KEY_COLUMN = "Campaign";
  const NOTE_COLUMN = "StatusNote";

  let annotationsCache = null;

  function loadAnnotations() {
    if (annotationsCache) return annotationsCache;
    try {
      const raw = localStorage.getItem(ANNOTATION_STORAGE_KEY);
      annotationsCache = raw ? JSON.parse(raw) : {};
    } catch (e) {
      annotationsCache = {};
    }
    return annotationsCache;
  }

  function saveAnnotations() {
    try {
      localStorage.setItem(
        ANNOTATION_STORAGE_KEY,
        JSON.stringify(annotationsCache || {})
      );
    } catch (e) {
      // ignore
    }
  }

  function makeAnnotationKey(row) {
    const person = row[PERSON_KEY_COLUMN];
    const campaign = row[CAMPAIGN_KEY_COLUMN];
    if (!person || !campaign) return null;
    return `${person}::${campaign}`;
  }

  // ---- Value mappings (bulk replace) ----

  function applyValueMappings(valueMapping) {
    if (!parsedData || !valueMapping || typeof valueMapping !== "object") return;

    const rows = parsedData.rows;

    // Build a quick lookup: display name -> field key
    const displayToField = {};
    Object.keys(viewState.displayNames).forEach((field) => {
      displayToField[viewState.displayNames[field]] = field;
    });

    Object.entries(valueMapping).forEach(([column, rulesObj]) => {
      if (!rulesObj || typeof rulesObj !== "object") return;

      const fields = parsedData && parsedData.fields ? parsedData.fields : [];
      const fieldKey = fields.includes(column)
        ? column
        : displayToField[column];

      if (!fieldKey) return;

      Object.entries(rulesObj).forEach(([from, to]) => {
        const isPrefix = from.endsWith("*");
        const needle = isPrefix ? from.slice(0, -1) : from;

        rows.forEach((row) => {
          const current = row[fieldKey];
          if (current == null) return;

          if (
            (!isPrefix && current === needle) ||
            (isPrefix && String(current).startsWith(needle))
          ) {
            row[fieldKey] = to;
          }
        });
      });
    });

    // Re-render table and summary after changes
    render();
  }
  
  // Example preset
  const presets = {
    phisherLike: {
      id: "phisherLike",
      label: "PhishER Fail Export",
      description:
        "Show core identity + campaign fields and normalize SBU values.",
      keepFields: [
        "Email",
        "First Name",
        "Last Name",
        "Job Title",
        "Group",
        "Manager Name",
        "Manager Email",
        "Location",
        "Employee Number",
        "Content",
        "Department",
        "Custom Field 1",
      ],
      renameFields: {
        "Employee Number": "EmployeeID",
        "Custom Field 1": "SBU",
      },
      valueMapping: {
        "Custom Field 1": {
          "2101 Centerstone of Indiana*": "Indiana",
          // add more SBU mappings here
        },
      },
      sbuFallbackForEmpty: "blank",
    },
  };

  function init() {}

  function render() {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = "";

    const wrapper = document.createElement("div");
    wrapper.className = "module-card";

    wrapper.innerHTML = `
      <div class="module-card-header">
        <div>
          <div class="module-card-title">CSV / Spreadsheet Workbench</div>
          <div class="module-card-subtitle">
            Drop campaign exports or other CSV files, then apply cleaning, annotations, summaries, and export operations.
          </div>
        </div>
        <span class="tag">Module 1</span>
      </div>

      <div class="module-card-body">
        <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">
          <button class="btn" id="csvFileButton">
            <span>Choose CSV file</span>
          </button>
          <input
            type="file"
            id="csvFileInput"
            accept=".csv,.txt,.xlsx"
            style="display:none"
          >
          <button class="btn btn-secondary" id="csvDownloadButton" disabled>
            <span>Download CSV (current)</span>
          </button>
        </div>

        <div
          id="csvDropzone"
          class="dropzone"
        >
          Drop file to import here or use the button above.
          <div style="margin-top:0.25rem;font-size:0.75rem;color:#6b7280;">
            Accepted: CSV (XLSX support planned).
          </div>
        </div>

        <div id="csvInfo" style="margin-top:0.75rem;font-size:0.8rem;color:#9ca3af;"></div>

        <div id="csvPresetsPanel" style="margin-top:0.75rem;"></div>

        <div style="margin-top:1rem;display:flex;gap:1rem;align-items:flex-start;">
          <div
            style="
              flex:0 0 280px;
              max-width:280px;
              display:flex;
              flex-direction:column;
              gap:0.75rem;
            "
          >
            <div id="csvColumnsPanel"></div>
            <div id="csvValueMappingPanel"></div>
            <!-- future: <div id="csvDeduplicatePanel"></div> -->
          </div>
          <div
            style="
              flex:1 1 auto;
              min-width:0;
              display:flex;
              flex-direction:column;
              gap:0.75rem;
            "
          >
            <div id="csvTableContainer"></div>
            <div id="csvSummaryPanel"></div>
          </div>
        </div>
    `;

    container.appendChild(wrapper);
    rootEl = wrapper;

    wireEvents();

    if (parsedData) {
      renderPresetsPanel();
      renderColumnsPanel(parsedData.fields);
      renderValueMappingPanel();
      renderTablePreview();
      renderSummaryPanel();
    } else {
      renderPresetsPanel();
      clearColumnsPanel();
      renderValueMappingPanel();
      clearTable();
      renderSummaryPanel();
    }

  }

  function wireEvents() {
    if (!rootEl) return;

    const fileButton = rootEl.querySelector("#csvFileButton");
    const fileInput = rootEl.querySelector("#csvFileInput");
    const dropzone = rootEl.querySelector("#csvDropzone");
    const infoEl = rootEl.querySelector("#csvInfo");
    const downloadBtn = rootEl.querySelector("#csvDownloadButton");

    if (fileButton && fileInput) {
      fileButton.addEventListener("click", () => {
        fileInput.value = "";
        fileInput.click();
      });

      fileInput.addEventListener("change", (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) {
          handleFile(file, infoEl, downloadBtn);
        }
      });
    }

    if (dropzone) {
      dropzone.addEventListener("dragover", (e) => {
        e.preventDefault();
        dropzone.classList.add("dragover");
      });

      dropzone.addEventListener("dragleave", (e) => {
        e.preventDefault();
        dropzone.classList.remove("dragover");
      });

      dropzone.addEventListener("drop", (e) => {
        e.preventDefault();
        dropzone.classList.remove("dragover");
        const file = e.dataTransfer.files && e.dataTransfer.files[0];
        if (file) {
          handleFile(file, infoEl, downloadBtn);
        }
      });
    }

    if (downloadBtn) {
      downloadBtn.addEventListener("click", () => {
        if (!parsedData) return;
        downloadCurrentCsv();
      });
    }
  }

  function handleFile(file, infoEl, downloadBtn) {
    if (!file) return;

    if (infoEl) {
      infoEl.textContent = `Selected file: ${file.name} (${file.size.toLocaleString()} bytes). Parsing…`;
    }

    // For now: treat everything as CSV or text; XLSX support will come later
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      complete: (results) => {
        let fields = results.meta.fields || [];
        const rows = results.data || [];

        if (!fields.includes(NOTE_COLUMN)) {
          fields = [...fields, NOTE_COLUMN];
        }

        const annotations = loadAnnotations();

        rows.forEach((row) => {
          if (row[NOTE_COLUMN] === undefined) {
            row[NOTE_COLUMN] = "";
          }
          const key = makeAnnotationKey(row);
          if (key && annotations[key] && annotations[key].statusNote) {
            row[NOTE_COLUMN] = annotations[key].statusNote;
          }
        });

        parsedData = { fields, rows };
        lastSummary = null;

        viewState.visibleFields = [...fields];
        viewState.displayNames = {};
        viewState.activePreset = null;
        fields.forEach((f) => {
          viewState.displayNames[f] = f;
        });

        if (infoEl) {
          infoEl.textContent = `Parsed ${rows.length.toLocaleString()} rows, ${fields.length.toLocaleString()} columns.`;
        }

        if (downloadBtn) {
          downloadBtn.disabled = rows.length === 0;
        }

        renderPresetsPanel();
        renderColumnsPanel(fields);
        renderTablePreview();
        renderSummaryPanel();
      },
      error: (err) => {
        console.error("[CSV Workbench] Parse error:", err);
        if (infoEl) {
          infoEl.textContent = `Error parsing file: ${err.message || err}`;
        }
        if (downloadBtn) {
          downloadBtn.disabled = true;
        }
        parsedData = null;
        viewState = {
          visibleFields: [],
          displayNames: {},
          activePreset: null,
        };
        lastSummary = null;
        renderPresetsPanel();
        clearColumnsPanel();
        clearTable();
        renderSummaryPanel();
      },
    });
  }

  function clearTable() {
    if (!rootEl) return;
    const tableContainer = rootEl.querySelector("#csvTableContainer");
    if (tableContainer) {
      tableContainer.innerHTML = "";
    }
  }

  function renderPresetsPanel() {
    if (!rootEl) return;
    const panel = rootEl.querySelector("#csvPresetsPanel");
    if (!panel) return;

    panel.innerHTML = "";

    const card = document.createElement("div");
    card.style.background = "#020617";
    card.style.borderRadius = "0.6rem";
    card.style.border = "1px solid rgba(148,163,184,0.35)";
    card.style.padding = "0.55rem 0.7rem";
    card.style.fontSize = "0.8rem";
    card.style.display = "flex";
    card.style.flexDirection = "column";
    card.style.gap = "0.4rem";

    const title = document.createElement("div");
    title.textContent = "Presets";
    title.style.fontWeight = "600";

    const desc = document.createElement("div");
    desc.style.fontSize = "0.75rem";
    desc.style.color = "#9ca3af";
    desc.textContent = parsedData
      ? "Apply predefined workflows for known exports. Start with a PhishER-like example."
      : "Apply predefined workflows for known exports. Load a CSV to enable presets.";

    card.appendChild(title);
    card.appendChild(desc);

    const controls = document.createElement("div");
    controls.style.display = "flex";
    controls.style.alignItems = "center";
    controls.style.gap = "0.4rem";
    controls.style.flexWrap = "wrap";

    const select = document.createElement("select");
    select.id = "presetSelect";
    select.disabled = !parsedData;
    select.style.fontSize = "0.8rem";
    select.style.padding = "0.25rem 0.45rem";
    select.style.borderRadius = "0.4rem";
    select.style.border = "1px solid rgba(148,163,184,0.5)";
    select.style.background = "#020617";
    select.style.color = "#e5e7eb";

    const optPlaceholder = document.createElement("option");
    optPlaceholder.value = "";
    optPlaceholder.textContent = parsedData ? "Select preset" : "Load a CSV first";
    select.appendChild(optPlaceholder);

    const phisherOpt = document.createElement("option");
    phisherOpt.value = presets.phisherLike.id;
    phisherOpt.textContent = presets.phisherLike.label;
    select.appendChild(phisherOpt);

    if (viewState.activePreset === presets.phisherLike.id) {
      select.value = presets.phisherLike.id;
    }

    const applyBtn = document.createElement("button");
    applyBtn.className = "btn btn-secondary";
    applyBtn.id = "applyPresetBtn";
    applyBtn.textContent = "Apply preset";
    applyBtn.disabled = !parsedData;

    controls.appendChild(select);
    controls.appendChild(applyBtn);
    card.appendChild(controls);

    panel.appendChild(card);

    if (parsedData) {
      applyBtn.addEventListener("click", () => {
        const chosen = select.value;
        if (!chosen) return;
        if (chosen === presets.phisherLike.id) {
          applyPhisherLikePreset();
        }
      });
    }
  }

  function applyPhisherLikePreset() {
    if (!parsedData) return;

    const preset = presets.phisherLike;

    const keepSet = new Set(preset.keepFields);
    const effectiveKeep = parsedData.fields.filter((f) => keepSet.has(f));

    viewState.visibleFields = effectiveKeep;

    preset.keepFields.forEach((field) => {
      if (!viewState.displayNames[field]) {
        viewState.displayNames[field] = field;
      }
    });

    Object.entries(preset.renameFields || {}).forEach(([from, to]) => {
      if (viewState.displayNames[from]) {
        viewState.displayNames[from] = to;
      }
    });

    if (preset.valueMapping) {
      applyValueMappings(preset.valueMapping);
    }

    const hasCustomField = parsedData.fields.includes("Custom Field 1");
    const hasSbuField = parsedData.fields.includes("SBU");
    const sbuFieldKey = hasCustomField ? "Custom Field 1" : (hasSbuField ? "SBU" : null);

    if (sbuFieldKey && preset.sbuFallbackForEmpty !== undefined) {
      parsedData.rows.forEach((row) => {
        const v = row[sbuFieldKey];
        if (v === null || v === undefined || String(v).trim() === "") {
          row[sbuFieldKey] = preset.sbuFallbackForEmpty;
        }
      });
    }

    viewState.activePreset = preset.id;
    lastSummary = null;

    renderColumnsPanel(parsedData.fields);
    renderTablePreview();
    renderSummaryPanel();
  }

  function clearColumnsPanel() {
    if (!rootEl) return;
    const panel = rootEl.querySelector("#csvColumnsPanel");
    if (panel) {
      panel.innerHTML = "";
    }
  }

  function renderColumnsPanel(fields) {
    if (!rootEl) return;
    const panel = rootEl.querySelector("#csvColumnsPanel");
    if (!panel) return;

    panel.innerHTML = "";

    if (!fields || !fields.length) {
      panel.textContent = "No columns.";
      return;
    }

    const card = document.createElement("div");
    card.style.background = "#020617";
    card.style.borderRadius = "0.6rem";
    card.style.border = "1px solid rgba(148,163,184,0.35)";
    card.style.padding = "0.6rem 0.7rem";
    card.style.fontSize = "0.8rem";
    card.style.width = "100%";
    card.style.maxWidth = "100%";

    const header = document.createElement("div");
    header.style.display = "flex";
    header.style.alignItems = "center";
    header.style.justifyContent = "space-between";
    header.style.marginBottom = "0.5rem";
    header.innerHTML =
      '<div style="font-weight:600">Columns</div>' +
      '<button class="btn btn-secondary" id="applyColumnsBtn" style="padding:0.25rem 0.6rem;font-size:0.75rem;">Apply column changes</button>';
    card.appendChild(header);

    const list = document.createElement("div");
    list.style.maxHeight = "300px";
    list.style.overflow = "auto";
    list.style.display = "flex";
    list.style.flexDirection = "column";
    list.style.gap = "0.2rem";

    fields.forEach((field) => {
      const visible = viewState.visibleFields.includes(field);
      const displayName = viewState.displayNames[field] || field;

      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.alignItems = "center";
      row.style.gap = "0.35rem";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = visible;
      checkbox.dataset.field = field;
      checkbox.style.cursor = "pointer";

      const label = document.createElement("span");
      label.textContent = field;
      label.style.flex = "0 0 auto";

      const input = document.createElement("input");
      input.type = "text";
      input.value = displayName;
      input.dataset.field = field;
      input.placeholder = "Display name";
      input.style.flex = "1 1 auto";
      input.style.minWidth = "0";
      input.style.fontSize = "0.75rem";
      input.style.padding = "0.15rem 0.25rem";
      input.style.borderRadius = "0.35rem";
      input.style.border = "1px solid rgba(148,163,184,0.5)";
      input.style.background = "#020617";
      input.style.color = "#e5e7eb";

      row.appendChild(checkbox);
      row.appendChild(label);
      row.appendChild(input);

      list.appendChild(row);
    });

    card.appendChild(list);
    panel.appendChild(card);

    const applyBtn = card.querySelector("#applyColumnsBtn");
    if (applyBtn) {
      applyBtn.addEventListener("click", () => {
        applyColumnChanges(card);
      });
    }
  }

  function applyColumnChanges(cardRoot) {
    if (!cardRoot || !parsedData) return;

    const checkboxes = cardRoot.querySelectorAll(
      'input[type="checkbox"][data-field]'
    );
    const inputs = cardRoot.querySelectorAll(
      'input[type="text"][data-field]'
    );

    const newVisibleFields = [];
    const newDisplayNames = { ...viewState.displayNames };

    checkboxes.forEach((cb) => {
      const field = cb.dataset.field;
      if (!field) return;
      if (cb.checked) {
        newVisibleFields.push(field);
      }
    });

    inputs.forEach((inp) => {
      const field = inp.dataset.field;
      if (!field) return;
      const val = inp.value.trim();
      newDisplayNames[field] = val || field;
    });

    viewState.visibleFields = parsedData.fields.filter((f) =>
      newVisibleFields.includes(f)
    );
    viewState.displayNames = newDisplayNames;

    renderTablePreview();
    renderSummaryPanel();
  }

  function renderValueMappingPanel() {
    if (!rootEl) return;
    const panel = rootEl.querySelector("#csvValueMappingPanel");
    if (!panel) return;

    panel.innerHTML = "";

    if (!parsedData || !parsedData.fields.length) {
      panel.textContent = "Load data to configure value mappings.";
      return;
    }

    const card = document.createElement("div");
    card.style.background = "#020617";
    card.style.borderRadius = "0.6rem";
    card.style.border = "1px solid rgba(148,163,184,0.35)";
    card.style.padding = "0.6rem 0.7rem";
    card.style.fontSize = "0.8rem";
    card.style.display = "flex";
    card.style.flexDirection = "column";
    card.style.gap = "0.4rem";
    card.style.width = "100%";
    card.style.maxWidth = "100%";

    const header = document.createElement("div");
    header.style.display = "flex";
    header.style.justifyContent = "space-between";
    header.style.alignItems = "center";
    header.innerHTML = '<div style="font-weight:600;">Value mapping</div>';
    card.appendChild(header);

    const colRow = document.createElement("div");
    colRow.style.display = "flex";
    colRow.style.gap = "0.35rem";
    colRow.style.alignItems = "center";

    const colLabel = document.createElement("span");
    colLabel.textContent = "Column";
    colLabel.style.fontSize = "0.75rem";

    const colSelect = document.createElement("select");
    colSelect.id = "valueMapColumn";
    colSelect.style.flex = "1 1 auto";
    colSelect.style.fontSize = "0.8rem";
    colSelect.style.padding = "0.25rem 0.45rem";
    colSelect.style.borderRadius = "0.4rem";
    colSelect.style.border = "1px solid rgba(148,163,184,0.5)";
    colSelect.style.background = "#020617";
    colSelect.style.color = "#e5e7eb";

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select column";
    colSelect.appendChild(placeholder);

    parsedData.fields.forEach((field) => {
      const opt = document.createElement("option");
      opt.value = field;
      opt.textContent = viewState.displayNames[field] || field;
      colSelect.appendChild(opt);
    });

    colRow.appendChild(colLabel);
    colRow.appendChild(colSelect);
    card.appendChild(colRow);

    const list = document.createElement("div");
    list.id = "valueMapList";
    list.style.display = "flex";
    list.style.flexDirection = "column";
    list.style.gap = "0.25rem";
    list.style.padding = "0.25rem 0";
    card.appendChild(list);    

    function addMappingRow(fromVal = "", toVal = "") {
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.flexDirection = "column";
      row.style.gap = "0.2rem";

      const fromInput = document.createElement("input");
      fromInput.type = "text";
      fromInput.placeholder = "From";
      fromInput.value = fromVal;
      fromInput.style.fontSize = "0.75rem";
      fromInput.style.padding = "0.15rem 0.25rem";
      fromInput.style.borderRadius = "0.35rem";
      fromInput.style.border = "1px solid rgba(148,163,184,0.5)";
      fromInput.style.background = "#020617";
      fromInput.style.color = "#e5e7eb";

      const toInput = document.createElement("input");
      toInput.type = "text";
      toInput.placeholder = "To";
      toInput.value = toVal;
      toInput.style.fontSize = "0.75rem";
      toInput.style.padding = "0.15rem 0.25rem";
      toInput.style.borderRadius = "0.35rem";
      toInput.style.border = "1px solid rgba(148,163,184,0.5)";
      toInput.style.background = "#020617";
      toInput.style.color = "#e5e7eb";

      row.appendChild(fromInput);
      row.appendChild(toInput);
      list.appendChild(row);
    }

    // start with a single From/To row
    addMappingRow();

    const addRowBtn = document.createElement("button");
    addRowBtn.type = "button";
    addRowBtn.textContent = "+ Add mapping";
    addRowBtn.style.alignSelf = "flex-start";
    addRowBtn.style.fontSize = "0.75rem";
    addRowBtn.style.marginTop = "0.2rem";
    addRowBtn.style.padding = "0.1rem 0.4rem";
    addRowBtn.style.borderRadius = "999px";
    addRowBtn.style.border = "1px solid rgba(148,163,184,0.5)";
    addRowBtn.style.background = "#020617";
    addRowBtn.style.color = "#e5e7eb";

    addRowBtn.addEventListener("click", () => addMappingRow());
    card.appendChild(addRowBtn);

    const footer = document.createElement("div");
    footer.style.display = "flex";
    footer.style.justifyContent = "space-between";
    footer.style.alignItems = "center";
    footer.style.marginTop = "0.4rem";

    const hint = document.createElement("span");
    hint.textContent = "Use * at end for prefix match.";
    hint.style.fontSize = "0.7rem";
    hint.style.color = "#9ca3af";

    const applyBtn = document.createElement("button");
    applyBtn.className = "btn btn-secondary";
    applyBtn.textContent = "Apply mappings";

    footer.appendChild(hint);
    footer.appendChild(applyBtn);
    card.appendChild(footer);

    panel.appendChild(card);

    applyBtn.addEventListener("click", () => {
      const colKey = colSelect.value;
      if (!colKey) return;

      const fromInputs = list.querySelectorAll("input[placeholder='From']");
      const toInputs = list.querySelectorAll("input[placeholder='To']");

      const rules = {};
      for (let i = 0; i < fromInputs.length; i++) {
        const from = fromInputs[i].value.trim();
        const to = toInputs[i].value.trim();
        if (!from || !to) continue;
        rules[from] = to;
      }

      if (Object.keys(rules).length === 0) return;

      const mapping = {
        [colKey]: rules,
      };

      applyValueMappings(mapping);
    });
  }

  function getEffectiveFields() {
    if (!parsedData) return [];
    if (!viewState.visibleFields || !viewState.visibleFields.length) {
      return parsedData.fields;
    }
    return viewState.visibleFields;
  }

  function renderTablePreview() {
    if (!rootEl) return;
    const tableContainer = rootEl.querySelector("#csvTableContainer");
    if (!tableContainer) return;

    tableContainer.innerHTML = "";

    if (!parsedData || !parsedData.fields.length || !parsedData.rows.length) {
      tableContainer.textContent = "No data to display.";
      return;
    }

    const fields = getEffectiveFields();
    const rows = parsedData.rows;

    const maxPreviewRows = 100;
    const previewRows = rows.slice(0, maxPreviewRows);

    const info = document.createElement("div");
    info.style.marginBottom = "0.4rem";
    info.style.fontSize = "0.75rem";
    info.style.color = "#9ca3af";
    info.textContent =
      rows.length > maxPreviewRows
        ? `Showing first ${maxPreviewRows.toLocaleString()} rows of ${rows.length.toLocaleString()} total.`
        : `Showing all ${rows.length.toLocaleString()} rows.`;

    const tableWrapper = document.createElement("div");
    tableWrapper.style.maxHeight = "420px";
    tableWrapper.style.overflow = "auto";
    tableWrapper.style.borderRadius = "0.6rem";
    tableWrapper.style.border = "1px solid rgba(31,41,55,0.8)";
    tableWrapper.style.background = "#020617";

    const table = document.createElement("table");
    table.style.width = "100%";
    table.style.borderCollapse = "collapse";
    table.style.fontSize = "0.8rem";

    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");

    fields.forEach((field) => {
      const th = document.createElement("th");
      const displayName = viewState.displayNames[field] || field;
      th.textContent = displayName;
      th.style.textAlign = "left";
      th.style.padding = "0.35rem 0.45rem";
      th.style.borderBottom = "1px solid rgba(148,163,184,0.4)";
      th.style.position = "sticky";
      th.style.top = "0";
      th.style.background = "#020617";
      th.style.zIndex = "1";
      headerRow.appendChild(th);
    });

    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");

    previewRows.forEach((row, rowIndex) => {
      const tr = document.createElement("tr");

      if (row[NOTE_COLUMN] && String(row[NOTE_COLUMN]).trim() !== "") {
        tr.style.backgroundColor = "rgba(248,250,252,0.04)";
      }

      fields.forEach((field) => {
        const td = document.createElement("td");
        const val = row[field];

        td.style.padding = "0.3rem 0.45rem";
        td.style.borderBottom = "1px solid rgba(31,41,55,0.6)";
        td.style.whiteSpace = "nowrap";
        td.style.textOverflow = "ellipsis";
        td.style.overflow = "hidden";

        if (field === NOTE_COLUMN) {
          td.contentEditable = "true";
          td.spellcheck = false;
          td.textContent =
            val === undefined || val === null ? "" : String(val);

          td.addEventListener("blur", () => {
            const newVal = td.textContent.trim();
            parsedData.rows[rowIndex][NOTE_COLUMN] = newVal;

            const fullRow = parsedData.rows[rowIndex];
            const key = makeAnnotationKey(fullRow);
            if (key) {
              const annotations = loadAnnotations();
              if (!annotations[key] && !newVal) {
                return;
              }
              if (!annotations[key]) {
                annotations[key] = {};
              }
              annotations[key].statusNote = newVal;
              annotationsCache = annotations;
              saveAnnotations();
            }

            if (newVal) {
              tr.style.backgroundColor = "rgba(248,250,252,0.04)";
            } else {
              tr.style.backgroundColor = "";
            }
          });
        } else {
          td.textContent =
            val === undefined || val === null ? "" : String(val);
        }

        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    tableWrapper.appendChild(table);

    tableContainer.appendChild(info);
    tableContainer.appendChild(tableWrapper);
  }

  // ---- Group & Count ----

  function renderSummaryPanel() {
    if (!rootEl) return;
    const panel = rootEl.querySelector("#csvSummaryPanel");
    if (!panel) return;

    panel.innerHTML = "";

    const card = document.createElement("div");
    card.style.background = "#020617";
    card.style.borderRadius = "0.6rem";
    card.style.border = "1px solid rgba(148,163,184,0.35)";
    card.style.padding = "0.6rem 0.7rem";
    card.style.fontSize = "0.8rem";
    card.style.marginTop = "0.5rem";

    const header = document.createElement("div");
    header.style.display = "flex";
    header.style.alignItems = "center";
    header.style.justifyContent = "space-between";
    header.style.marginBottom = "0.4rem";
    header.innerHTML = `
      <div style="font-weight:600;">Summary – Group & count</div>
    `;
    card.appendChild(header);

    const controls = document.createElement("div");
    controls.style.display = "flex";
    controls.style.alignItems = "center";
    controls.style.gap = "0.4rem";
    controls.style.flexWrap = "wrap";
    controls.style.marginBottom = "0.5rem";

    const label = document.createElement("span");
    label.textContent = "Group by:";
    controls.appendChild(label);

    const select = document.createElement("select");
    select.id = "summaryFieldSelect";
    select.style.fontSize = "0.8rem";
    select.style.padding = "0.25rem 0.45rem";
    select.style.borderRadius = "0.4rem";
    select.style.border = "1px solid rgba(148,163,184,0.5)";
    select.style.background = "#020617";
    select.style.color = "#e5e7eb";
    select.disabled = !parsedData;

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = parsedData
      ? "Select a column…"
      : "Load a CSV first";
    select.appendChild(placeholder);

    if (parsedData && parsedData.fields.length) {
      parsedData.fields.forEach((field) => {
        if (field === NOTE_COLUMN) return; // usually not interesting to group by notes
        const opt = document.createElement("option");
        opt.value = field;
        opt.textContent = viewState.displayNames[field] || field;
        select.appendChild(opt);
      });
    }

    const btn = document.createElement("button");
    btn.className = "btn btn-secondary";
    btn.id = "summaryRunBtn";
    btn.textContent = "Group & count";
    btn.disabled = !parsedData;

    controls.appendChild(select);
    controls.appendChild(btn);

    card.appendChild(controls);

    const body = document.createElement("div");
    body.id = "summaryResult";
    card.appendChild(body);

    panel.appendChild(card);

    if (parsedData) {
      btn.addEventListener("click", () => {
        const field = select.value;
        if (!field) return;
        lastSummary = computeGroupAndCount(field);
        renderSummaryResult(body);
      });

      if (lastSummary && lastSummary.rows && lastSummary.rows.length) {
        // If we have a previous summary, show it
        if (select.value === "" && lastSummary.field) {
          select.value = lastSummary.field;
        }
        renderSummaryResult(body);
      }
    } else {
      body.textContent = "Load a CSV to compute group & count summaries.";
    }
  }

  function computeGroupAndCount(field) {
    if (!parsedData) return null;
    const counts = {};
    parsedData.rows.forEach((row) => {
      const raw = row[field];
      const key = raw == null || raw === "" ? "(empty)" : String(raw);
      counts[key] = (counts[key] || 0) + 1;
    });
    const rows = Object.entries(counts)
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
    return { field, rows };
  }

  function renderSummaryResult(container) {
    container.innerHTML = "";

    if (!lastSummary || !lastSummary.rows.length) {
      container.textContent = "No summary computed yet.";
      return;
    }

    const info = document.createElement("div");
    info.style.fontSize = "0.75rem";
    info.style.color = "#9ca3af";
    const displayName =
      viewState.displayNames[lastSummary.field] || lastSummary.field;
    info.textContent = `Grouped by ${displayName}. ${lastSummary.rows.length.toLocaleString()} distinct values.`;
    container.appendChild(info);

    const wrap = document.createElement("div");
    wrap.style.maxHeight = "220px";
    wrap.style.overflow = "auto";
    wrap.style.marginTop = "0.3rem";
    wrap.style.borderRadius = "0.5rem";
    wrap.style.border = "1px solid rgba(31,41,55,0.8)";
    wrap.style.background = "#020617";

    const table = document.createElement("table");
    table.style.width = "100%";
    table.style.borderCollapse = "collapse";
    table.style.fontSize = "0.8rem";

    const thead = document.createElement("thead");
    const hr = document.createElement("tr");

    const hVal = document.createElement("th");
    hVal.textContent = "Value";
    hVal.style.textAlign = "left";
    hVal.style.padding = "0.3rem 0.45rem";
    hVal.style.borderBottom = "1px solid rgba(148,163,184,0.4)";
    hr.appendChild(hVal);

    const hCount = document.createElement("th");
    hCount.textContent = "Count";
    hCount.style.textAlign = "right";
    hCount.style.padding = "0.3rem 0.45rem";
    hCount.style.borderBottom = "1px solid rgba(148,163,184,0.4)";
    hr.appendChild(hCount);

    thead.appendChild(hr);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    lastSummary.rows.forEach((row) => {
      const tr = document.createElement("tr");

      const tdVal = document.createElement("td");
      tdVal.textContent = row.value;
      tdVal.style.padding = "0.25rem 0.45rem";
      tdVal.style.borderBottom = "1px solid rgba(31,41,55,0.6)";
      tdVal.style.whiteSpace = "nowrap";
      tdVal.style.textOverflow = "ellipsis";
      tdVal.style.overflow = "hidden";
      tr.appendChild(tdVal);

      const tdCount = document.createElement("td");
      tdCount.textContent = row.count.toLocaleString();
      tdCount.style.padding = "0.25rem 0.45rem";
      tdCount.style.borderBottom = "1px solid rgba(31,41,55,0.6)";
      tdCount.style.textAlign = "right";
      tr.appendChild(tdCount);

      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    wrap.appendChild(table);
    container.appendChild(wrap);

  }

  function exportSummaryCsv() {
    if (!lastSummary || !lastSummary.rows.length) return;
    const displayName =
      viewState.displayNames[lastSummary.field] || lastSummary.field;

    const data = lastSummary.rows.map((r) => ({
      [displayName]: r.value,
      Count: r.count,
    }));

    const csv = Papa.unparse(data);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "secops-workbench-summary.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    URL.revokeObjectURL(url);
  }

  function exportSummaryXlsx() {
    if (!lastSummary || !lastSummary.rows.length) return;

    const displayName =
      viewState.displayNames[lastSummary.field] || lastSummary.field;

    const data = lastSummary.rows.map((r) => ({
      [displayName]: r.value,
      Count: r.count,
    }));

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Summary");

    const wbout = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
    const blob = new Blob(
      [wbout],
      {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }
    );
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "secops-workbench-summary.xlsx";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    URL.revokeObjectURL(url);
  }

  // ---- Download main CSV ----

  function downloadCurrentCsv() {
    if (!parsedData) return;

    const fields = getEffectiveFields();
    const rows = parsedData.rows;

    const exportRows = rows.map((row) => {
      const obj = {};
      fields.forEach((field) => {
        obj[viewState.displayNames[field] || field] = row[field];
      });
      return obj;
    });

    const csv = Papa.unparse(exportRows);

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "secops-workbench.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    URL.revokeObjectURL(url);
  }

  // ---- Download main XLSX ----

  function downloadCurrentXlsx() {
    if (!parsedData) return;

    const fields = getEffectiveFields();
    const rows = parsedData.rows;

    const exportRows = rows.map((row) => {
      const obj = {};
      fields.forEach((field) => {
        obj[viewState.displayNames[field] || field] = row[field];
      });
      return obj;
    });

    // Build worksheet and workbook
    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Data");

    // Generate XLSX and download
    const wbout = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
    const blob = new Blob(
      [wbout],
      {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }
    );
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "secops-workbench.xlsx";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    URL.revokeObjectURL(url);
  }

  function show() {
    render();
  }

  function hide() {}

  window.SecOpsWorkbench.registerModule("csvWorkbench", {
    meta,
    init,
    show,
    hide,
    api: {
      exportMainCsv: downloadCurrentCsv,
      exportMainXlsx: downloadCurrentXlsx,
      exportSummaryCsv,
      exportSummaryXlsx,
      applyValueMappings,
      hasSummary: () =>
        !!(lastSummary && lastSummary.rows && lastSummary.rows.length),
    },
  });
})();

