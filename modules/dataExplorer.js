// modules/dataExplorer.js

(function () {

  // ── Meta ─────────────────────────────────────────────────────────────────────
  const meta = {
    title:    "Data Explorer",
    subtitle: "Interactive dashboards for live presentations. Load datasets, configure KPIs, and build Plotly charts.",
  };

  const CONTAINER_ID       = "moduleContainer";
  const DASHBOARD_STORAGE  = "pbTools_dataExplorer_dashboards";
  const MAX_DATASETS       = 6;

  // ── State ────────────────────────────────────────────────────────────────────
  let datasets    = [];   // [{ id, label, fields, rows }]
  let kpiCards    = [];   // [{ id, label, column, agg, format }]
  let charts      = [];   // [{ id, type, xField, yField, datasetIds, title, x, y, w, h }]
  let activeFilters = {}; // { fieldName: value | "all" }
  let presentationMode = false;
  let gridStack = null;   // GridStack instance for drag/resize layout
  let globalDatasetFilter = null; // null = inactive, [id1, id2] = active with selected datasets

  // Function to get computed CSS variable values
  function getThemeColors() {
    const style = getComputedStyle(document.getElementById('app'));
    return {
      textPrimary: style.getPropertyValue('--text-primary').trim(),
      textSecondary: style.getPropertyValue('--text-secondary').trim(),
      textMuted: style.getPropertyValue('--text-muted').trim(),
      bgPrimary: style.getPropertyValue('--bg-primary').trim(),
      bgSecondary: style.getPropertyValue('--bg-secondary').trim(),
      border: style.getPropertyValue('--border').trim(),
    };
  }

  // Plotly layout - dynamically built from theme colors
  function getPlotlyLayoutBase() {
    const colors = getThemeColors();
    return {
      paper_bgcolor: "transparent",
      plot_bgcolor:  colors.bgSecondary + "99", // Add alpha for slight transparency
      font: { color: colors.textPrimary, family: "system-ui, -apple-system, sans-serif", size: 12 },
      xaxis: {
        gridcolor:  colors.border,
        linecolor:  colors.border,
        tickfont:   { color: colors.textSecondary },
        titlefont:  { color: colors.textMuted },
        zerolinecolor: colors.border,
      },
      yaxis: {
        gridcolor:  colors.border,
        linecolor:  colors.border,
        tickfont:   { color: colors.textSecondary },
        titlefont:  { color: colors.textMuted },
        zerolinecolor: colors.border,
      },
      legend: {
        bgcolor:     colors.bgPrimary + "80", // Semi-transparent
        bordercolor: colors.border,
        borderwidth: 1,
        font: { color: colors.textSecondary },
      },
      margin: { t: 36, r: 16, b: 72, l: 52 },
      hoverlabel: {
        bgcolor:     colors.bgPrimary + "F0", // Almost opaque
        bordercolor: colors.border,
        font: { color: colors.textPrimary },
      },
    };
  }

  const PLOTLY_CONFIG = {
    displayModeBar:  true,
    displaylogo:     false,
    modeBarButtonsToRemove: ["select2d", "lasso2d", "autoScale2d", "toImage"],
    responsive: true,
  };

  // Dataset color palette
  const DATASET_COLORS = [
    "#3b82f6", "#f59e0b", "#10b981", "#ec4899",
    "#8b5cf6", "#f97316",
  ];

  // ── Utility ──────────────────────────────────────────────────────────────────
  function uid() {
    return `de_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  }

  function getNumericFields(fields, rows) {
    if (!rows.length) return [];
    return fields.filter(f => {
      const val = rows[0][f];
      return val !== undefined && val !== "" && !isNaN(Number(String(val).replace(/,/g, "")));
    });
  }

  function getCategoricalFields(fields, rows) {
    const numeric = new Set(getNumericFields(fields, rows));
    return fields.filter(f => !numeric.has(f));
  }

  function toNumber(val) {
    if (val === null || val === undefined || val === "") return NaN;
    return Number(String(val).replace(/,/g, ""));
  }

  function formatValue(val, format) {
    if (val === null || val === undefined || isNaN(val)) return "—";
    if (format === "percentage") return val.toFixed(1) + "%";
    if (format === "decimal")    return val.toFixed(2);
    return Number.isInteger(val) ? val.toLocaleString() : val.toFixed(2);
  }

  // Apply activeFilters to a dataset's rows
  function applyFilters(rows) {
    return rows.filter(row => {
      return Object.entries(activeFilters).every(([field, value]) => {
        if (value === "all" || value === "") return true;
        return String(row[field]) === String(value);
      });
    });
  }

  // Compute aggregation for KPI
  function computeAgg(rows, column, agg) {
    const filtered = applyFilters(rows);
    if (agg === "count") return filtered.length;
    const nums = filtered.map(r => toNumber(r[column])).filter(n => !isNaN(n));
    if (!nums.length) return null;
    if (agg === "sum")  return nums.reduce((a, b) => a + b, 0);
    if (agg === "avg")  return nums.reduce((a, b) => a + b, 0) / nums.length;
    if (agg === "max")  return Math.max(...nums);
    if (agg === "min")  return Math.min(...nums);
    return null;
  }

  // ── Storage ──────────────────────────────────────────────────────────────────
  function loadDashboards() {
    try {
      return JSON.parse(localStorage.getItem(DASHBOARD_STORAGE) || "[]");
    } catch { return []; }
  }

  function saveDashboard(name) {
    const dashboards = loadDashboards();
    const existing = dashboards.findIndex(d => d.name === name);
    const entry = {
      id:      uid(),
      name,
      kpiCards,
      charts,
      savedAt: Date.now(),
    };
    if (existing !== -1) dashboards[existing] = entry;
    else dashboards.push(entry);
    localStorage.setItem(DASHBOARD_STORAGE, JSON.stringify(dashboards));
  }

  function deleteDashboard(id) {
    const updated = loadDashboards().filter(d => d.id !== id);
    localStorage.setItem(DASHBOARD_STORAGE, JSON.stringify(updated));
  }

  function applyDashboard(dashboard) {
    kpiCards = (dashboard.kpiCards || []).map(k => ({ ...k }));
    charts   = (dashboard.charts   || []).map(c => ({ ...c }));
    migrateKpiDataFormat(); // Convert old KPI format if loading old dashboard
  }

  // ── CSV parsing ──────────────────────────────────────────────────────────────
  function parseCSV(text) {
    const result = Papa.parse(text, { header: true, skipEmptyLines: true, dynamicTyping: false });
    return { fields: result.meta.fields || [], rows: result.data };
  }

  function loadCSVFile(file) {
    if (datasets.length >= MAX_DATASETS) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const { fields, rows } = parseCSV(ev.target.result);
      if (!fields.length) return;
      const label = file.name.replace(/\.csv$/i, "");
      datasets.push({ id: uid(), label, fields, rows });
      render();
    };
    reader.readAsText(file);
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  // ── Render ───────────────────────────────────────────────────────────────────
  function render() {
    const container = document.getElementById(CONTAINER_ID);
    if (!container) return;
    container.className = "module-container module-container--dataExplorer";

    // Destroy old GridStack instance before rebuilding DOM
    // Otherwise it will point to a detached element after innerHTML replacement
    if (gridStack) {
      gridStack.destroy(false);
      gridStack = null;
    }

    container.innerHTML = `
      <div class="de-root" id="deRoot">
        <div class="de-toolbar" id="deToolbar">
          <div class="de-toolbar-left">
            <span class="de-toolbar-title">📊 Data Explorer</span>
          </div>
          <div class="de-toolbar-right">
            <button class="btn btn-secondary btn-sm" id="deSaveDashboardBtn">💾 Save Dashboard</button>
            <button class="btn btn-secondary btn-sm" id="deLoadDashboardBtn">📂 Load Dashboard</button>
            <button class="btn btn-secondary btn-sm" id="dePresentBtn">⛶ Present</button>
          </div>
        </div>
        <div class="de-body">
          <div class="de-sidebar" id="deSidebar">
            <div class="de-section">
              <div class="de-section-title">DATASETS</div>
              <div id="deDatasetList"></div>
              ${datasets.length < MAX_DATASETS ? `
                <div id="deDropzone" class="de-dropzone">
                  <div class="de-dropzone-text">Drop CSV here or</div>
                  <label class="btn btn-secondary btn-sm" style="cursor:pointer;margin-top:0.3rem;">
                    Browse File
                    <input type="file" accept=".csv" id="deAddDatasetInput" style="display:none;" multiple>
                  </label>
                </div>
                <button class="btn btn-secondary btn-sm de-add-btn" id="deLoadFromWorkbenchBtn" style="margin-top:0.35rem;">
                  ↓ Load from CSV Workbench
                </button>
              ` : `<div class="de-hint">Max ${MAX_DATASETS} datasets loaded.</div>`}
            </div>
            <div class="de-divider"></div>
            <div class="de-section">
              <div class="de-section-title">KPI CARDS</div>
              <div id="deKpiConfigList"></div>
              ${datasets.length > 0 ? `<button class="btn btn-secondary btn-sm de-add-btn" id="deAddKpiBtn">+ Add KPI Card</button>` : `<div class="de-hint">Load a dataset first.</div>`}
            </div>
            <div class="de-divider"></div>
            <div class="de-section">
              <div class="de-section-title">FILTERS</div>
              <div id="deFiltersList">
                ${datasets.length === 0 ? `<div class="de-hint">Load a dataset to add filters.</div>` : ""}
              </div>
              ${datasets.length > 0 ? `<button class="btn btn-secondary btn-sm de-add-btn" id="deAddFilterBtn">+ Add Filter</button>` : ""}
            </div>
            <div class="de-divider"></div>
            <div class="de-section">
              <div class="de-section-title">CHARTS</div>
              <div id="deChartConfigList"></div>
              ${datasets.length > 0 ? `<button class="btn btn-secondary btn-sm de-add-btn" id="deAddChartBtn">+ Add Chart</button>` : `<div class="de-hint">Load a dataset first.</div>`}
            </div>
          </div>
          <div class="de-canvas" id="deCanvas">
            ${datasets.length > 1 ? `<div id="deGlobalFilterBar" class="de-global-filter-bar"></div>` : ''}
            <div id="deChartGrid" class="grid-stack"></div>
            ${datasets.length === 0 ? `
              <div class="de-empty">
                <div class="de-empty-icon">📊</div>
                <div class="de-empty-title">No datasets loaded</div>
                <div class="de-empty-hint">Add a CSV file using the sidebar to get started.</div>
              </div>` : ""}
          </div>
        </div>
      </div>
    `;

    wireEvents();
    renderGlobalFilterBar();
    renderDatasetList();
    renderKpiConfig();
    renderFilters();
    renderChartConfig();
    renderGrid();
    renderGrid();
  }

  // ── Wire Events — attached fresh each render() since DOM is rebuilt ───────────
  function wireEvents() {
    // File input browse
    document.getElementById("deAddDatasetInput")?.addEventListener("change", e => {
      Array.from(e.target.files || []).forEach(f => loadCSVFile(f));
      e.target.value = "";
    });

    // Drag and drop
    const dropzone = document.getElementById("deDropzone");
    if (dropzone) {
      dropzone.addEventListener("dragover", e => { e.preventDefault(); dropzone.classList.add("de-dropzone--active"); });
      dropzone.addEventListener("dragleave", e => { if (!dropzone.contains(e.relatedTarget)) dropzone.classList.remove("de-dropzone--active"); });
      dropzone.addEventListener("drop", e => {
        e.preventDefault();
        dropzone.classList.remove("de-dropzone--active");
        const files = Array.from(e.dataTransfer.files).filter(f => f.name.match(/\.csv$/i));
        files.slice(0, MAX_DATASETS - datasets.length).forEach(f => loadCSVFile(f));
      });
    }

    // Load from CSV Workbench
    document.getElementById("deLoadFromWorkbenchBtn")?.addEventListener("click", () => {
      const api = window.SecOpsWorkbench?.modules?.csvWorkbench?.api;
      if (!api) { alert("CSV Workbench module not found."); return; }
      const data = api.getData();
      if (!data || !data.fields?.length) { alert("No data loaded in CSV Workbench."); return; }
      if (datasets.length >= MAX_DATASETS) { alert(`Max ${MAX_DATASETS} datasets already loaded.`); return; }
      const fields = data.visibleFields?.length ? data.visibleFields : data.fields;
      const displayNames = data.displayNames || {};
      const labeledFields = fields.map(f => displayNames[f] || f);
      const rows = data.rows.map(row => {
        const mapped = {};
        fields.forEach((f, i) => { mapped[labeledFields[i]] = row[f]; });
        return mapped;
      });
      const existing = datasets.filter(d => d.label.startsWith("Workbench data"));
      const finalLabel = existing.length ? `Workbench data (${existing.length + 1})` : "Workbench data";
      datasets.push({ id: uid(), label: finalLabel, fields: labeledFields, rows, fromWorkbench: true });
      render();
    });

    // Add KPI
    document.getElementById("deAddKpiBtn")?.addEventListener("click", () => {
      const ds = datasets[0];
      if (!ds) return;
      
      // Find next available position at top of grid
      const kpiIndex = kpiCards.length;
      const x = (kpiIndex % 4) * 3;  // 4 KPIs per row (each 3 columns wide)
      const y = 0;  // Always at top
      
      kpiCards.push({ 
        id: uid(), 
        label: "New KPI", 
        column: ds.fields[0], 
        agg: "count", 
        format: "number",
        datasetIds: null, // null = all datasets
        x: x,
        y: y,
        w: 3,  // 3 columns wide (compact)
        h: 2   // 2 rows tall
      });
      renderKpiConfig();
      renderGrid(); // Render entire grid including KPIs
    });

    // Add filter
    document.getElementById("deAddFilterBtn")?.addEventListener("click", () => {
      const allFields = getAllFields();
      if (!allFields.length) return;
      showAddFilterDialog(allFields);
    });

    // Add chart
    document.getElementById("deAddChartBtn")?.addEventListener("click", () => {
      const ds = datasets[0];
      if (!ds) return;
      const catFields = getCategoricalFields(ds.fields, ds.rows);
      const numFields = getNumericFields(ds.fields, ds.rows);
      charts.push({
        id:         uid(),
        type:       "bar",
        title:      "New Chart",
        xField:     catFields[0] || ds.fields[0],
        yField:     numFields[0] || ds.fields[0],
        datasetIds: null,  // null means "all datasets"
        agg:        "count",
        size:       "medium",
      });
      renderChartConfig();
      renderGrid();
    });

    // Toolbar
    document.getElementById("deSaveDashboardBtn")?.addEventListener("click", () => showSaveDashboardDialog());
    document.getElementById("deLoadDashboardBtn")?.addEventListener("click", () => showLoadDashboardDialog());
    document.getElementById("dePresentBtn")?.addEventListener("click", () => enterPresentationMode());
    
    // Dataset selector clicks (event delegation for dynamically created selectors)
    document.addEventListener("click", e => {
      const selector = e.target.closest(".de-dataset-selector");
      if (selector) {
        e.stopPropagation();
        
        // Check if it's a chart selector
        const chartId = selector.getAttribute("data-chart-id");
        if (chartId) {
          const chart = charts.find(c => c.id === chartId);
          if (chart) {
            showDatasetSelectorDropdown(selector, chart);
          }
        }
        
        // Check if it's a KPI selector
        const kpiId = selector.getAttribute("data-kpi-id");
        if (kpiId) {
          const kpi = kpiCards.find(k => k.id === kpiId);
          if (kpi) {
            showKpiDatasetSelectorDropdown(selector, kpi);
          }
        }
      }
      // Close dropdown when clicking outside
      else if (!e.target.closest(".de-dataset-dropdown")) {
        document.querySelectorAll(".de-dataset-dropdown").forEach(dd => dd.remove());
      }
    });
  }

  // ── Data Migration Helper ────────────────────────────────────────────────────
  // Convert old KPI format (datasetId: string) to new format (datasetIds: array)
  function migrateKpiDataFormat() {
    kpiCards.forEach(kpi => {
      // If old format exists, convert to new format
      if (kpi.datasetId !== undefined && kpi.datasetIds === undefined) {
        if (kpi.datasetId === null || kpi.datasetId === "all" || !kpi.datasetId) {
          kpi.datasetIds = null; // All datasets
        } else {
          kpi.datasetIds = [kpi.datasetId]; // Single dataset as array
        }
        delete kpi.datasetId; // Remove old property
      }
    });
  }

    // ── Dataset List ─────────────────────────────────────────────────────────────
  function renderDatasetList() {
    const el = document.getElementById("deDatasetList");
    if (!el) return;
    if (!datasets.length) {
      el.innerHTML = `<div class="de-hint">No datasets loaded yet.</div>`;
      return;
    }
    el.innerHTML = "";
    datasets.forEach((ds, i) => {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:center;gap:0.4rem;padding:0.3rem 0;";

      const dot = document.createElement("span");
      dot.style.cssText = `width:8px;height:8px;border-radius:50%;background:${DATASET_COLORS[i % DATASET_COLORS.length]};flex-shrink:0;`;

      const labelInput = document.createElement("input");
      labelInput.type = "text";
      labelInput.className = "panel-input";
      labelInput.value = ds.label;
      labelInput.style.cssText = "flex:1;font-size:0.8rem;padding:0.2rem 0.4rem;";
      labelInput.addEventListener("change", () => {
        ds.label = labelInput.value.trim() || ds.label;
        renderGrid();
        renderGrid();
      });

      const meta = document.createElement("span");
      meta.style.cssText = "font-size:0.7rem;color:var(--text-muted);flex-shrink:0;";
      meta.textContent = `${ds.rows.length}r · ${ds.fields.length}c`;

      const removeBtn = document.createElement("button");
      removeBtn.className = "btn btn-ghost btn-xs btn-text-danger";
      removeBtn.textContent = "✕";
      removeBtn.title = "Remove dataset";
      removeBtn.addEventListener("click", () => {
        datasets = datasets.filter(d => d.id !== ds.id);
        kpiCards = kpiCards.filter(k => k.datasetId !== ds.id);
        charts   = charts.filter(c => !c.datasetIds?.includes(ds.id));
        activeFilters = {};
        render();
      });

      row.appendChild(dot);
      row.appendChild(labelInput);
      row.appendChild(meta);
      row.appendChild(removeBtn);
      el.appendChild(row);
    });
  }

  // ── KPI Config ───────────────────────────────────────────────────────────────
  function renderKpiConfig() {
    const el = document.getElementById("deKpiConfigList");
    if (!el) return;
    el.innerHTML = "";
    if (!kpiCards.length) {
      el.innerHTML = `<div class="de-hint">No KPI cards yet.</div>`;
      return;
    }
    kpiCards.forEach(kpi => {
      const allFields = getAllFields();
      const item = document.createElement("div");
      item.style.cssText = "background:var(--bg-tertiary);border-radius:0.3rem;padding:0.45rem 0.5rem;margin-bottom:0.35rem;";

      // Header row
      const hdr = document.createElement("div");
      hdr.style.cssText = "display:flex;align-items:center;gap:0.3rem;margin-bottom:0.3rem;";

      const labelInput = document.createElement("input");
      labelInput.type = "text";
      labelInput.className = "panel-input";
      labelInput.value = kpi.label;
      labelInput.style.cssText = "flex:1;font-size:0.8rem;padding:0.2rem 0.4rem;";
      labelInput.addEventListener("change", () => { kpi.label = labelInput.value.trim() || kpi.label; renderGrid(); });

      const delBtn = document.createElement("button");
      delBtn.className = "btn btn-ghost btn-xs btn-text-danger";
      delBtn.textContent = "✕";
      delBtn.addEventListener("click", () => { kpiCards = kpiCards.filter(k => k.id !== kpi.id); renderKpiConfig(); renderGrid(); });

      hdr.appendChild(labelInput);
      hdr.appendChild(delBtn);
      item.appendChild(hdr);

      // Config row: column + agg + format
      const cfgRow = document.createElement("div");
      cfgRow.style.cssText = "display:flex;gap:0.25rem;";

      const colSel = document.createElement("select");
      colSel.className = "panel-input";
      colSel.style.cssText = "flex:2;font-size:0.75rem;";
      allFields.forEach(f => {
        const o = document.createElement("option");
        o.value = f; o.textContent = f;
        if (f === kpi.column) o.selected = true;
        colSel.appendChild(o);
      });
      colSel.addEventListener("change", () => { kpi.column = colSel.value; renderGrid(); });

      const aggSel = document.createElement("select");
      aggSel.className = "panel-input";
      aggSel.style.cssText = "flex:1;font-size:0.75rem;";
      ["count","sum","avg","max","min"].forEach(a => {
        const o = document.createElement("option");
        o.value = a; o.textContent = a.toUpperCase();
        if (a === kpi.agg) o.selected = true;
        aggSel.appendChild(o);
      });
      aggSel.addEventListener("change", () => { kpi.agg = aggSel.value; renderGrid(); });

      const fmtSel = document.createElement("select");
      fmtSel.className = "panel-input";
      fmtSel.style.cssText = "flex:1;font-size:0.75rem;";
      [{v:"number",l:"#"},{v:"percentage",l:"%"},{v:"decimal",l:".0"}].forEach(f => {
        const o = document.createElement("option");
        o.value = f.v; o.textContent = f.l;
        if (f.v === kpi.format) o.selected = true;
        fmtSel.appendChild(o);
      });
      fmtSel.addEventListener("change", () => { kpi.format = fmtSel.value; renderGrid(); });

      cfgRow.appendChild(colSel);
      cfgRow.appendChild(aggSel);
      cfgRow.appendChild(fmtSel);
      item.appendChild(cfgRow);

      el.appendChild(item);
    });
  }

  // ── KPI Cards (canvas) ───────────────────────────────────────────────────────

  // ── Filters ──────────────────────────────────────────────────────────────────
  function getAllFields() {
    const seen = new Set();
    datasets.forEach(ds => ds.fields.forEach(f => seen.add(f)));
    return [...seen];
  }

  function getUniqueValues(field) {
    const seen = new Set();
    datasets.forEach(ds => ds.rows.forEach(r => { if (r[field] !== undefined && r[field] !== "") seen.add(String(r[field])); }));
    return [...seen].sort();
  }

  function renderFilters() {
    const el = document.getElementById("deFiltersList");
    if (!el) return;
    el.innerHTML = "";
    if (!datasets.length) return;

    Object.entries(activeFilters).forEach(([field, value]) => {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:center;gap:0.3rem;margin-bottom:0.3rem;";

      const lbl = document.createElement("span");
      lbl.style.cssText = "font-size:0.75rem;color:var(--text-secondary);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
      lbl.textContent = field;

      const sel = document.createElement("select");
      sel.className = "panel-input";
      sel.style.cssText = "flex:2;font-size:0.75rem;";
      const allOpt = document.createElement("option");
      allOpt.value = "all"; allOpt.textContent = "All";
      sel.appendChild(allOpt);
      getUniqueValues(field).forEach(v => {
        const o = document.createElement("option");
        o.value = v; o.textContent = v;
        if (v === value) o.selected = true;
        sel.appendChild(o);
      });
      if (value === "all" || value === "") sel.value = "all";
      sel.addEventListener("change", () => {
        activeFilters[field] = sel.value;
        renderGrid();
        renderGrid();
      });

      const rmBtn = document.createElement("button");
      rmBtn.className = "btn btn-ghost btn-xs btn-text-danger";
      rmBtn.textContent = "✕";
      rmBtn.addEventListener("click", () => {
        delete activeFilters[field];
        renderFilters();
        renderGrid();
        renderGrid();
      });

      row.appendChild(lbl);
      row.appendChild(sel);
      row.appendChild(rmBtn);
      el.appendChild(row);
    });
  }

  function renderGlobalFilterBar() {
    const el = document.getElementById("deGlobalFilterBar");
    if (!el) return;
    
    const isActive = globalDatasetFilter !== null;
    el.className = isActive ? "de-global-filter-bar" : "de-global-filter-bar inactive";
    el.innerHTML = "";
    
    // Label
    const label = document.createElement("div");
    label.className = "de-global-filter-label";
    label.innerHTML = isActive ? "🌐 GLOBAL FILTER:" : "🌐 Global Filter:";
    el.appendChild(label);
    
    // Dataset selector button (shows current selection)
    const selectorBtn = document.createElement("button");
    selectorBtn.className = "btn btn-secondary btn-xs de-global-filter-selector";
    selectorBtn.style.cssText = "flex:1;max-width:400px;text-align:left;justify-content:space-between;";
    
    let selectorText;
    if (!isActive) {
      selectorText = "All datasets";
    } else {
      const selectedCount = globalDatasetFilter.length;
      const selectedDatasets = datasets.filter(ds => globalDatasetFilter.includes(ds.id));
      selectorText = selectedCount === datasets.length
        ? "All datasets"
        : selectedCount === 0
          ? "No datasets"
          : selectedCount === 1
            ? selectedDatasets[0].label
            : `${selectedCount} datasets selected`;
    }
    
    selectorBtn.innerHTML = `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${selectorText}</span><span>▼</span>`;
    
    // Dropdown always enabled - clicking it shows selection menu
    selectorBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      showGlobalFilterDropdown(selectorBtn);
    });
    
    el.appendChild(selectorBtn);
    
    // Action buttons
    const actions = document.createElement("div");
    actions.className = "de-global-filter-actions";
    
    if (isActive) {
      // Clear button (deactivate global filter)
      const clearBtn = document.createElement("button");
      clearBtn.className = "btn btn-secondary btn-xs";
      clearBtn.textContent = "Clear";
      clearBtn.addEventListener("click", () => {
        globalDatasetFilter = null;
        renderGlobalFilterBar();
        renderGrid();
        renderGrid();
      });
      actions.appendChild(clearBtn);
    }
    
    el.appendChild(actions);
  }
  
  function showGlobalFilterDropdown(buttonEl) {
    
    const isActive = globalDatasetFilter !== null;
    
    // Remove any existing dropdowns
    document.querySelectorAll(".de-dataset-dropdown").forEach(dd => dd.remove());
    
    // Create dropdown
    const dropdown = document.createElement("div");
    dropdown.className = "de-dataset-dropdown";
    
    // Position dropdown below the button
    const rect = buttonEl.getBoundingClientRect();
    dropdown.style.top = `${rect.bottom + 4}px`;
    dropdown.style.left = `${rect.left}px`;
    
    // Quick action buttons: All, None, Invert
    const buttonRow = document.createElement("div");
    buttonRow.className = "de-dataset-dropdown-buttons";
    
    const createActionButton = (label, action) => {
      const btn = document.createElement("button");
      btn.textContent = label;
      btn.className = "btn btn-secondary btn-xs";
      btn.style.flex = "1";
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        action();
      });
      return btn;
    };
    
    // All button
    const allBtn = createActionButton("All", () => {
      globalDatasetFilter = datasets.map(d => d.id);
      renderGlobalFilterBar();
      renderGrid();
      renderGrid();
      dropdown.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
    });
    
    // None button
    const noneBtn = createActionButton("None", () => {
      // If inactive, activate with empty selection
      if (!isActive) {
        globalDatasetFilter = [];
      } else {
        globalDatasetFilter = [];
      }
      renderGlobalFilterBar();
      renderGrid();
      renderGrid();
      dropdown.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
    });
    
    // Invert button
    const invertBtn = createActionButton("Invert", () => {
      // If inactive, start with all datasets then invert
      if (!isActive) {
        globalDatasetFilter = datasets.map(d => d.id);
      }
      
      const newSelection = [];
      datasets.forEach(ds => {
        if (!globalDatasetFilter.includes(ds.id)) {
          newSelection.push(ds.id);
        }
      });
      
      globalDatasetFilter = newSelection;
      renderGlobalFilterBar();
      renderGrid();
      renderGrid();
      dropdown.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.checked = !cb.checked;
      });
    });
    
    buttonRow.appendChild(allBtn);
    buttonRow.appendChild(noneBtn);
    buttonRow.appendChild(invertBtn);
    dropdown.appendChild(buttonRow);
    
    // Add checkboxes for each dataset
    datasets.forEach(ds => {
      // When inactive, show all as checked (starting point)
      const isChecked = isActive ? globalDatasetFilter.includes(ds.id) : true;
      
      const row = document.createElement("div");
      row.className = "de-dataset-dropdown-row";
      
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = isChecked;
      checkbox.style.cursor = "pointer";
      checkbox.dataset.datasetId = ds.id;
      
      const label = document.createElement("span");
      label.className = "de-dataset-dropdown-label";
      label.textContent = ds.label;
      
      checkbox.addEventListener("change", e => {
        e.stopPropagation();
        
        // If filter is inactive, activate it now with current selections
        if (!isActive) {
          // Initialize filter based on current checkbox states
          globalDatasetFilter = [];
          dropdown.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            if (cb.checked) {
              globalDatasetFilter.push(cb.dataset.datasetId);
            }
          });
        } else {
          // Filter already active, just update selection
          if (checkbox.checked) {
            if (!globalDatasetFilter.includes(ds.id)) {
              globalDatasetFilter.push(ds.id);
            }
          } else {
            globalDatasetFilter = globalDatasetFilter.filter(id => id !== ds.id);
          }
        }
        
        renderGlobalFilterBar();
        renderGrid();
        renderGrid();
      });
      
      label.addEventListener("click", e => {
        e.stopPropagation();
        checkbox.checked = !checkbox.checked;
        checkbox.dispatchEvent(new Event('change'));
      });
      
      row.appendChild(checkbox);
      row.appendChild(label);
      dropdown.appendChild(row);
    });
    
    document.getElementById("app").appendChild(dropdown);
  }

  function showAddFilterDialog(fields) {
    // Simple: pick a field not already filtered
    const available = fields.filter(f => !(f in activeFilters));
    if (!available.length) { alert("All available fields already have filters."); return; }

    // Create a small inline dialog
    const el = document.getElementById("deFiltersList");
    if (!el) return;

    const row = document.createElement("div");
    row.style.cssText = "display:flex;align-items:center;gap:0.3rem;margin-bottom:0.3rem;";

    const sel = document.createElement("select");
    sel.className = "panel-input";
    sel.style.cssText = "flex:1;font-size:0.75rem;";
    available.forEach(f => {
      const o = document.createElement("option");
      o.value = f; o.textContent = f;
      sel.appendChild(o);
    });

    const addBtn = document.createElement("button");
    addBtn.className = "btn btn-xs btn-sm";
    addBtn.textContent = "Add";
    addBtn.addEventListener("click", () => {
      activeFilters[sel.value] = "all";
      renderFilters();
    });

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "btn btn-secondary btn-xs btn-sm";
    cancelBtn.textContent = "✕";
    cancelBtn.addEventListener("click", () => row.remove());

    row.appendChild(sel);
    row.appendChild(addBtn);
    row.appendChild(cancelBtn);
    el.appendChild(row);
  }

  // ── Chart Config ─────────────────────────────────────────────────────────────
  function renderChartConfig() {
    const el = document.getElementById("deChartConfigList");
    if (!el) return;
    el.innerHTML = "";
    if (!charts.length) {
      el.innerHTML = `<div class="de-hint">No charts yet.</div>`;
      return;
    }
    charts.forEach(chart => {
      const allFields = getAllFields();

      // Track collapsed state per chart (default collapsed=false)
      if (chart._collapsed === undefined) chart._collapsed = false;

      const item = document.createElement("div");
      item.style.cssText = "background:var(--bg-tertiary);border-radius:0.3rem;padding:0.45rem 0.5rem;margin-bottom:0.35rem;";

      // Header — click to collapse/expand
      const hdr = document.createElement("div");
      hdr.style.cssText = "display:flex;align-items:center;gap:0.3rem;cursor:pointer;";

      const chevron = document.createElement("span");
      chevron.style.cssText = "font-size:0.65rem;color:var(--text-muted);flex-shrink:0;transition:transform 0.15s;";
      chevron.textContent = "▶";
      chevron.style.transform = chart._collapsed ? "rotate(0deg)" : "rotate(90deg)";

      const titleInput = document.createElement("input");
      titleInput.type = "text";
      titleInput.className = "panel-input";
      titleInput.value = chart.title;
      titleInput.style.cssText = "flex:1;font-size:0.8rem;padding:0.2rem 0.4rem;";
      titleInput.addEventListener("change", () => { chart.title = titleInput.value.trim() || chart.title; renderGrid(); });
      titleInput.addEventListener("click", e => e.stopPropagation()); // don't collapse when editing title

      const delBtn = document.createElement("button");
      delBtn.className = "btn btn-ghost btn-xs btn-text-danger";
      delBtn.textContent = "✕";
      delBtn.addEventListener("click", e => {
        e.stopPropagation();
        charts = charts.filter(c => c.id !== chart.id);
        renderChartConfig();
        renderGrid();
      });

      hdr.appendChild(chevron);
      hdr.appendChild(titleInput);
      hdr.appendChild(delBtn);
      item.appendChild(hdr);

      // Collapsible body
      const body = document.createElement("div");
      body.style.cssText = `margin-top:0.3rem;${chart._collapsed ? "display:none;" : ""}`;

      hdr.addEventListener("click", () => {
        chart._collapsed = !chart._collapsed;
        body.style.display = chart._collapsed ? "none" : "";
        chevron.style.transform = chart._collapsed ? "rotate(0deg)" : "rotate(90deg)";
      });

      // ── all config content goes into body, not item ──

      // Type selector — dropdown
      const typeRow = document.createElement("div");
      typeRow.style.cssText = "display:flex;align-items:center;gap:0.3rem;margin-bottom:0.3rem;";
      const typeLbl = document.createElement("div");
      typeLbl.style.cssText = "font-size:0.68rem;color:var(--text-muted);flex-shrink:0;";
      typeLbl.textContent = "Type:";
      const typeSel = document.createElement("select");
      typeSel.className = "panel-input";
      typeSel.style.fontSize = "0.8rem";
      [
        { v: "bar",       l: "Bar"         },
        { v: "line",      l: "Line"        },
        { v: "scatter",   l: "Scatter"     },
        { v: "bubble",    l: "Bubble"      },
        { v: "pie",       l: "Pie"         },
        { v: "histogram", l: "Histogram"   },
        { v: "box",       l: "Box Plot"    },
        { v: "violin",    l: "Violin"      },
        { v: "heatmap",   l: "Heatmap"     },
      ].forEach(t => {
        const o = document.createElement("option");
        o.value = t.v; o.textContent = t.l;
        if (t.v === chart.type) o.selected = true;
        typeSel.appendChild(o);
      });
      typeSel.addEventListener("change", () => {
        chart.type = typeSel.value;
        renderChartConfig();
        renderGrid();
      });
      typeRow.appendChild(typeLbl);
      typeRow.appendChild(typeSel);
      body.appendChild(typeRow);

      // Field selectors
      const fieldRow = document.createElement("div");
      fieldRow.style.cssText = "display:flex;gap:0.25rem;";

      function makeFieldSel(labelText, selectedVal, onChange) {
        const wrap = document.createElement("div");
        wrap.style.flex = "1";
        const lbl = document.createElement("div");
        lbl.style.cssText = "font-size:0.68rem;color:var(--text-muted);margin-bottom:0.1rem;";
        lbl.textContent = labelText;
        const sel = document.createElement("select");
        sel.className = "panel-input";
        sel.style.fontSize = "0.75rem";
        allFields.forEach(f => {
          const o = document.createElement("option");
          o.value = f; o.textContent = f;
          if (f === selectedVal) o.selected = true;
          sel.appendChild(o);
        });
        sel.addEventListener("change", () => onChange(sel.value));
        wrap.appendChild(lbl);
        wrap.appendChild(sel);
        return wrap;
      }

      const noY = ["histogram", "box", "violin"].includes(chart.type);
      if (chart.type === "pie") {
        fieldRow.appendChild(makeFieldSel("Labels", chart.xField, v => { chart.xField = v; renderGrid(); }));
        fieldRow.appendChild(makeFieldSel("Values", chart.yField, v => { chart.yField = v; renderGrid(); }));
      } else if (chart.type === "heatmap") {
        fieldRow.appendChild(makeFieldSel("X (category)", chart.xField, v => { chart.xField = v; renderGrid(); }));
        fieldRow.appendChild(makeFieldSel("Y (category)", chart.yField, v => { chart.yField = v; renderGrid(); }));
      } else if (noY) {
        fieldRow.appendChild(makeFieldSel("Value column", chart.yField, v => { chart.yField = v; renderGrid(); }));
        fieldRow.appendChild(makeFieldSel("Group by", chart.xField, v => { chart.xField = v; renderGrid(); }));
      } else {
        fieldRow.appendChild(makeFieldSel("X axis", chart.xField, v => { chart.xField = v; renderGrid(); }));
        const yLabel = chart.type === "bubble" ? "Y axis" : "Y / Value";
        fieldRow.appendChild(makeFieldSel(yLabel, chart.yField, v => { chart.yField = v; renderGrid(); }));
      }
      body.appendChild(fieldRow);

      // Bubble size field
      if (chart.type === "bubble") {
        const allFields2 = getAllFields();
        const bubbleRow = document.createElement("div");
        bubbleRow.style.cssText = "display:flex;gap:0.25rem;margin-top:0.3rem;";
        bubbleRow.appendChild(makeFieldSel("Bubble size", chart.sizeField || allFields2[0], v => { chart.sizeField = v; renderGrid(); }));
        body.appendChild(bubbleRow);
      }

      // Aggregation for Y
      if (!["scatter","bubble","histogram","box","violin"].includes(chart.type)) {
        const aggRow = document.createElement("div");
        aggRow.style.cssText = "display:flex;align-items:center;gap:0.3rem;margin-top:0.3rem;";
        const aggLbl = document.createElement("span");
        aggLbl.style.cssText = "font-size:0.7rem;color:var(--text-muted);flex-shrink:0;";
        aggLbl.textContent = "Agg:";
        const aggSel = document.createElement("select");
        aggSel.className = "panel-input";
        aggSel.style.fontSize = "0.75rem";
        ["count","sum","avg","max","min"].forEach(a => {
          const o = document.createElement("option");
          o.value = a; o.textContent = a.toUpperCase();
          if (a === (chart.agg || "count")) o.selected = true;
          aggSel.appendChild(o);
        });
        aggSel.addEventListener("change", () => { chart.agg = aggSel.value; renderGrid(); });
        aggRow.appendChild(aggLbl);
        aggRow.appendChild(aggSel);
        body.appendChild(aggRow);
      }

      // Dataset checkboxes (only show if >1 dataset loaded)
      if (datasets.length > 1) {
        const dsLbl = document.createElement("div");
        dsLbl.style.cssText = "font-size:0.68rem;color:var(--text-muted);margin-top:0.35rem;margin-bottom:0.15rem;";
        dsLbl.textContent = "Datasets:";
        body.appendChild(dsLbl);

        datasets.forEach((ds, i) => {
          const cbRow = document.createElement("label");
          cbRow.style.cssText = "display:flex;align-items:center;gap:0.35rem;font-size:0.75rem;color:var(--text-secondary);cursor:pointer;margin-bottom:0.1rem;";
          const cb = document.createElement("input");
          cb.type = "checkbox";
          // Handle null (all datasets) vs array
          cb.checked = chart.datasetIds === null || chart.datasetIds === undefined || chart.datasetIds.includes(ds.id);
          cb.addEventListener("change", () => {
            // Use the same function as dropdown for consistency
            updateChartDatasets(chart, cb.checked, ds.id);
            // Update sidebar checkboxes with delay to avoid re-rendering during interaction
            setTimeout(() => renderChartConfig(), 50);
          });
          const dot = document.createElement("span");
          dot.style.cssText = `width:7px;height:7px;border-radius:50%;background:${DATASET_COLORS[i % DATASET_COLORS.length]};flex-shrink:0;`;
          cbRow.appendChild(cb);
          cbRow.appendChild(dot);
          cbRow.appendChild(document.createTextNode(ds.label));
          body.appendChild(cbRow);
        });
      }

      item.appendChild(body);
      el.appendChild(item);
    });
  }

  // ── Charts ───────────────────────────────────────────────────────────────────
  function buildChartData(chart) {
    // Determine which datasets to use
    // Priority: Global filter > Chart-specific selection > All datasets
    
    let usedDatasets;
    
    // Global filter takes precedence
    if (globalDatasetFilter !== null) {
      usedDatasets = datasets.filter(ds => {
        const included = globalDatasetFilter.includes(ds.id);
        return included;
      });
    } else {
      // Use chart-specific selection
      // null/undefined = all datasets (default)
      // [] = no datasets (explicitly cleared)
      // [id1, id2] = specific datasets
      usedDatasets = chart.datasetIds === null || chart.datasetIds === undefined
        ? datasets
        : datasets.filter(ds => {
            const included = chart.datasetIds.includes(ds.id);
            return included;
          });
    }
    
    
    if (!usedDatasets.length) {
      console.warn("[Data Explorer] No datasets to render for chart", chart.id);
      return null;
    }

    const traces = [];
    const colors = getThemeColors(); // Get theme colors for chart text/labels

    usedDatasets.forEach((ds, dsIdx) => {
      const filteredRows = applyFilters(ds.rows);
      // Use original dataset index for consistent colors, not filtered array index
      const originalIdx = datasets.findIndex(d => d.id === ds.id);
      const color = DATASET_COLORS[originalIdx % DATASET_COLORS.length];

      // ── Types that don't need group-by aggregation ────────────────────────

      if (chart.type === "scatter") {
        traces.push({
          type:   "scatter",
          mode:   "markers",
          name:   ds.label,
          x:      filteredRows.map(r => toNumber(r[chart.xField])),
          y:      filteredRows.map(r => toNumber(r[chart.yField])),
          marker: { color, size: 7, opacity: 0.8 },
        });
        return;
      }

      if (chart.type === "histogram") {
        const vals = filteredRows.map(r => toNumber(r[chart.yField])).filter(n => !isNaN(n));
        traces.push({
          type:   "histogram",
          name:   ds.label,
          x:      vals,
          marker: { color, opacity: 0.8 },
        });
        return;
      }

      if (chart.type === "box") {
        const grpMap = {};
        filteredRows.forEach(row => {
          const key = String(row[chart.xField] ?? "(blank)");
          if (!grpMap[key]) grpMap[key] = [];
          const v = toNumber(row[chart.yField]);
          if (!isNaN(v)) grpMap[key].push(v);
        });
        const grpEntries = Object.entries(grpMap);
        grpEntries.forEach(([grp, vals], gi) => {
          traces.push({
            type:        "box",
            name:        ds.label,          // dataset label for legend
            x:           Array(vals.length).fill(grp),  // group on X axis
            y:           vals,
            marker:      { color },
            boxmean:     true,
            legendgroup: ds.id,
            showlegend:  gi === 0,          // show once per dataset only
            hovertemplate: "%{y}<extra>" + grp + "</extra>",
          });
        });
        return;
      }

      if (chart.type === "violin") {
        const grpMap = {};
        filteredRows.forEach(row => {
          const key = String(row[chart.xField] ?? "(blank)");
          if (!grpMap[key]) grpMap[key] = [];
          const v = toNumber(row[chart.yField]);
          if (!isNaN(v)) grpMap[key].push(v);
        });
        const vEntries = Object.entries(grpMap);
        vEntries.forEach(([grp, vals], gi) => {
          traces.push({
            type:        "violin",
            name:        ds.label,          // dataset label for legend
            x:           Array(vals.length).fill(grp),  // group on X axis
            y:           vals,
            marker:      { color },
            box:         { visible: true },
            meanline:    { visible: true },
            legendgroup: ds.id,
            showlegend:  gi === 0,          // show once per dataset only
            hovertemplate: "%{y}<extra>" + grp + "</extra>",
          });
        });
        return;
      }

      if (chart.type === "bubble") {
        const sizeField = chart.sizeField || chart.yField;
        const rawSizes  = filteredRows.map(r => toNumber(r[sizeField])).filter(n => !isNaN(n));
        const maxSize   = Math.max(...rawSizes) || 1;
        traces.push({
          type: "scatter",
          mode: "markers",
          name: ds.label,
          x:    filteredRows.map(r => toNumber(r[chart.xField])),
          y:    filteredRows.map(r => toNumber(r[chart.yField])),
          marker: {
            color,
            size:     filteredRows.map(r => Math.max(6, (toNumber(r[sizeField]) / maxSize) * 50)),
            opacity:  0.7,
            sizemode: "diameter",
          },
          hovertemplate: "x: %{x}<br>y: %{y}<extra>" + ds.label + "</extra>",
        });
        return;
      }

      if (chart.type === "heatmap") {
        const xCats   = [...new Set(filteredRows.map(r => String(r[chart.xField] ?? "")))].sort();
        const yCats   = [...new Set(filteredRows.map(r => String(r[chart.yField] ?? "")))].sort();
        const zMatrix = yCats.map(y => xCats.map(x =>
          filteredRows.filter(r => String(r[chart.xField]) === x && String(r[chart.yField]) === y).length
        ));
        traces.push({
          type:        "heatmap",
          x:           xCats,
          y:           yCats,
          z:           zMatrix,
          colorscale:  [[0,"rgba(15,23,42,1)"],[0.5,"rgba(59,130,246,0.6)"],[1,"rgba(59,130,246,1)"]],
          hovertemplate: "x: %{x}<br>y: %{y}<br>count: %{z}<extra></extra>",
        });
        return;
      }

      // ── Group-by aggregation (bar, line, pie) ─────────────────────────────

      const aggGroups = {};
      filteredRows.forEach(row => {
        const key = String(row[chart.xField] ?? "(blank)");
        if (!aggGroups[key]) aggGroups[key] = [];
        aggGroups[key].push(toNumber(row[chart.yField]));
      });

      const xVals = Object.keys(aggGroups);
      const yVals = xVals.map(k => {
        const nums = aggGroups[k].filter(n => !isNaN(n));
        const agg  = chart.agg || "count";
        if (agg === "count") return aggGroups[k].length;
        if (!nums.length)    return 0;
        if (agg === "sum")   return nums.reduce((a, b) => a + b, 0);
        if (agg === "avg")   return nums.reduce((a, b) => a + b, 0) / nums.length;
        if (agg === "max")   return Math.max(...nums);
        if (agg === "min")   return Math.min(...nums);
        return 0;
      });

      if (chart.type === "pie") {
        // For pie charts, combine all datasets by summing matching labels
        // This prevents overlapping pie traces and creates one unified pie
        const combinedData = {};
        
        usedDatasets.forEach((ds, dsIdx) => {
          const filteredRows = applyFilters(ds.rows);
          const aggGroups = {};
          filteredRows.forEach(row => {
            const key = String(row[chart.xField] ?? "(blank)");
            if (!aggGroups[key]) aggGroups[key] = [];
            aggGroups[key].push(toNumber(row[chart.yField]));
          });
          
          Object.keys(aggGroups).forEach(key => {
            const nums = aggGroups[key].filter(n => !isNaN(n));
            const agg  = chart.agg || "count";
            let value = 0;
            if (agg === "count") value = aggGroups[key].length;
            else if (nums.length) {
              if (agg === "sum")   value = nums.reduce((a, b) => a + b, 0);
              if (agg === "avg")   value = nums.reduce((a, b) => a + b, 0) / nums.length;
              if (agg === "max")   value = Math.max(...nums);
              if (agg === "min")   value = Math.min(...nums);
            }
            
            // Sum values across datasets for matching labels
            if (!combinedData[key]) combinedData[key] = 0;
            combinedData[key] += value;
          });
        });
        
        const xVals = Object.keys(combinedData);
        const yVals = xVals.map(k => combinedData[k]);
        
        traces.push({
          type:   "pie",
          labels: xVals,
          values: yVals,
          marker: { colors: xVals.map((_, i) => `hsl(${(i * 47) % 360}, 70%, 55%)`) },
          textfont: { color: colors.textPrimary },
          textposition: "inside",
          hovertemplate: "%{label}: %{value} (%{percent})<extra></extra>",
        });
        
        // Skip the normal aggregation loop for pie charts
        return traces;
      }
      
      // ── Group-by aggregation (bar, line) ───────────────────────────────────
      
      if (chart.type === "bar") {
        traces.push({
          type:   "bar",
          name:   ds.label,
          x:      xVals,
          y:      yVals,
          marker: { color, opacity: 0.85 },
          hovertemplate: "%{x}: %{y}<extra>" + ds.label + "</extra>",
        });
      } else if (chart.type === "line") {
        traces.push({
          type:   "scatter",
          mode:   "lines+markers",
          name:   ds.label,
          x:      xVals,
          y:      yVals,
          line:   { color, width: 2.5 },
          marker: { color, size: 5 },
          hovertemplate: "%{x}: %{y}<extra>" + ds.label + "</extra>",
        });
      }
    });

    return traces;
  }

  function buildLayout(chart) {
    const isPie   = chart.type === "pie";
    const isHist  = chart.type === "histogram";
    const isNoAgg = ["scatter","bubble","histogram","box","violin"].includes(chart.type);
    const yAxisLabel = isPie ? "" : isHist ? "Count" : isNoAgg ? (chart.yField || "") :
      (chart.agg && chart.agg !== "count" ? `${chart.agg.toUpperCase()}(${chart.yField || ""})` : "COUNT");
    const xAxisLabel = isPie ? "" : isHist ? (chart.yField || "") : (chart.xField || "");
    
    // Dataset indicator moved to dedicated selector element
    const usedDatasets = chart.datasetIds === null || chart.datasetIds === undefined
      ? datasets
      : datasets.filter(ds => chart.datasetIds.includes(ds.id));
    
    const colors = getThemeColors();
    const layoutBase = getPlotlyLayoutBase();
    
    return {
      ...layoutBase,
      title: { text: "", font: { color: colors.textMuted, size: 11 } },  // Empty title
      showlegend: isPie || usedDatasets.length > 1,  // Enable legend for pie charts AND multi-dataset charts
      legend: isPie ? {
        ...layoutBase.legend,
        orientation: 'v',
        x: 1.02,
        xanchor: 'left',
        y: 0.5,
        yanchor: 'middle'
      } : layoutBase.legend,
      xaxis: { ...layoutBase.xaxis, title: { text: xAxisLabel, font: { color: colors.textMuted, size: 11 } } },
      yaxis: { ...layoutBase.yaxis, title: { text: yAxisLabel, font: { color: colors.textMuted, size: 11 } } },
      dragmode: false,  // Disable Plotly drag to allow GridStack drag to work
    };
  }

  function showKpiDatasetSelectorDropdown(buttonEl, kpi) {
    
    // Remove any existing dropdowns
    document.querySelectorAll(".de-dataset-dropdown").forEach(dd => dd.remove());
    
    // Create dropdown
    const dropdown = document.createElement("div");
    dropdown.className = "de-dataset-dropdown";
    
    // Position dropdown below the button
    const rect = buttonEl.getBoundingClientRect();
    dropdown.style.top = `${rect.bottom + 4}px`;
    dropdown.style.left = `${rect.left}px`;
    
    // Quick action buttons: All, None, Invert
    const buttonRow = document.createElement("div");
    buttonRow.className = "de-dataset-dropdown-buttons";
    
    const createActionButton = (label, action) => {
      const btn = document.createElement("button");
      btn.textContent = label;
      btn.className = "btn btn-secondary btn-xs";
      btn.style.flex = "1";
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        action();
      });
      return btn;
    };
    
    // All button
    const allBtn = createActionButton("All", () => {
      kpi.datasetIds = null;
      renderSingleKpi(kpi);
      updateKpiDatasetSelectorText(kpi);
      dropdown.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
    });
    
    // None button
    const noneBtn = createActionButton("None", () => {
      kpi.datasetIds = [];
      renderSingleKpi(kpi);
      updateKpiDatasetSelectorText(kpi);
      dropdown.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
    });
    
    // Invert button
    const invertBtn = createActionButton("Invert", () => {
      if (kpi.datasetIds === null || kpi.datasetIds === undefined) {
        kpi.datasetIds = datasets.map(d => d.id);
      }
      
      const newSelection = [];
      datasets.forEach(ds => {
        if (!kpi.datasetIds.includes(ds.id)) {
          newSelection.push(ds.id);
        }
      });
      
      kpi.datasetIds = newSelection;
      if (kpi.datasetIds.length === datasets.length) {
        kpi.datasetIds = null;
      }
      
      renderSingleKpi(kpi);
      updateKpiDatasetSelectorText(kpi);
      dropdown.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.checked = !cb.checked;
      });
    });
    
    buttonRow.appendChild(allBtn);
    buttonRow.appendChild(noneBtn);
    buttonRow.appendChild(invertBtn);
    dropdown.appendChild(buttonRow);
    
    // Add checkboxes for each dataset
    datasets.forEach(ds => {
      const isChecked = kpi.datasetIds === null || kpi.datasetIds === undefined || kpi.datasetIds.includes(ds.id);
      
      const row = document.createElement("div");
      row.className = "de-dataset-dropdown-row";
      
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = isChecked;
      checkbox.style.cursor = "pointer";
      checkbox.dataset.datasetId = ds.id;
      
      const label = document.createElement("span");
      label.className = "de-dataset-dropdown-label";
      label.textContent = ds.label;
      
      checkbox.addEventListener("change", e => {
        e.stopPropagation();
        updateKpiDatasets(kpi, checkbox.checked, ds.id);
      });
      
      label.addEventListener("click", e => {
        e.stopPropagation();
        checkbox.checked = !checkbox.checked;
        checkbox.dispatchEvent(new Event('change'));
      });
      
      row.appendChild(checkbox);
      row.appendChild(label);
      dropdown.appendChild(row);
    });
    
    document.getElementById("app").appendChild(dropdown);
  }
  
  function updateKpiDatasets(kpi, isChecked, datasetId) {
    
    // Initialize if null/undefined
    if (kpi.datasetIds === null || kpi.datasetIds === undefined) {
      kpi.datasetIds = datasets.map(d => d.id);
    }
    
    if (isChecked) {
      if (!kpi.datasetIds.includes(datasetId)) {
        kpi.datasetIds.push(datasetId);
      }
    } else {
      kpi.datasetIds = kpi.datasetIds.filter(id => id !== datasetId);
    }
    
    // If all selected, set to null
    if (kpi.datasetIds.length === datasets.length) {
      kpi.datasetIds = null;
    }
    
    
    renderSingleKpi(kpi);
    updateKpiDatasetSelectorText(kpi);
  }

  function showDatasetSelectorDropdown(selectorEl, chart) {
    // Remove any existing dropdowns
    document.querySelectorAll(".de-dataset-dropdown").forEach(dd => dd.remove());
    
    // Create dropdown
    const dropdown = document.createElement("div");
    dropdown.className = "de-dataset-dropdown";
    
    // Position dropdown below the selector (only positioning styles inline)
    const rect = selectorEl.getBoundingClientRect();
    dropdown.style.top = `${rect.bottom + 4}px`;
    dropdown.style.left = `${rect.left}px`;
    
    // Quick action buttons: All, None, Invert
    const buttonRow = document.createElement("div");
    buttonRow.className = "de-dataset-dropdown-buttons";
    
    const createActionButton = (label, action) => {
      const btn = document.createElement("button");
      btn.textContent = label;
      btn.className = "btn btn-secondary btn-xs";
      btn.style.flex = "1";
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        action();
      });
      return btn;
    };
    
    // All button - select all datasets
    const allBtn = createActionButton("All", () => {
      chart.datasetIds = null; // null means "all datasets"
      renderSingleChart(chart);
      updateDatasetSelectorText(chart);
      setTimeout(() => renderChartConfig(), 50);
      // Update checkboxes in dropdown
      dropdown.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
    });
    
    // None button - deselect all datasets
    const noneBtn = createActionButton("None", () => {
      chart.datasetIds = []; // empty array means "no datasets"
      renderSingleChart(chart);
      updateDatasetSelectorText(chart);
      setTimeout(() => renderChartConfig(), 50);
      // Update checkboxes in dropdown
      dropdown.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
    });
    
    // Invert button - flip selection
    const invertBtn = createActionButton("Invert", () => {
      // Initialize if null
      if (chart.datasetIds === null || chart.datasetIds === undefined) {
        chart.datasetIds = datasets.map(d => d.id);
      }
      
      // Flip each dataset
      const newSelection = [];
      datasets.forEach(ds => {
        if (!chart.datasetIds.includes(ds.id)) {
          newSelection.push(ds.id);
        }
      });
      
      chart.datasetIds = newSelection;
      
      // If all selected after invert, set to null
      if (chart.datasetIds.length === datasets.length) {
        chart.datasetIds = null;
      }
      
      renderSingleChart(chart);
      updateDatasetSelectorText(chart);
      setTimeout(() => renderChartConfig(), 50);
      
      // Update checkboxes in dropdown
      dropdown.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.checked = !cb.checked;
      });
    });
    
    buttonRow.appendChild(allBtn);
    buttonRow.appendChild(noneBtn);
    buttonRow.appendChild(invertBtn);
    dropdown.appendChild(buttonRow);
    
    // Add checkboxes for each dataset
    datasets.forEach(ds => {
      // Determine if this dataset is selected
      // null/undefined = all selected, [] = none selected, [ids] = specific selected
      const isChecked = chart.datasetIds === null || chart.datasetIds === undefined || chart.datasetIds.includes(ds.id);
      
      const row = document.createElement("div");
      row.className = "de-dataset-dropdown-row";
      
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = isChecked;
      checkbox.style.cursor = "pointer";
      checkbox.dataset.datasetId = ds.id;
      
      const label = document.createElement("span");
      label.className = "de-dataset-dropdown-label";
      label.textContent = ds.label;
      
      // Let checkbox toggle naturally on click
      checkbox.addEventListener("change", e => {
        e.stopPropagation();
        updateChartDatasets(chart, checkbox.checked, ds.id);
      });
      
      // Clicking label toggles checkbox
      label.addEventListener("click", e => {
        e.stopPropagation();
        checkbox.checked = !checkbox.checked;
        checkbox.dispatchEvent(new Event('change'));
      });
      
      row.appendChild(checkbox);
      row.appendChild(label);
      dropdown.appendChild(row);
    });
    
    document.getElementById("app").appendChild(dropdown);
  }
  
  function updateChartDatasets(chart, isChecked, datasetId) {
    
    // Initialize datasetIds if null/undefined (means "all datasets")
    if (chart.datasetIds === null || chart.datasetIds === undefined) {
      chart.datasetIds = datasets.map(d => d.id);
    }
    
    const before = [...chart.datasetIds];
    
    if (isChecked) {
      // Add dataset if not already present
      if (!chart.datasetIds.includes(datasetId)) {
        chart.datasetIds.push(datasetId);
      } else {
      }
    } else {
      // Remove dataset
      chart.datasetIds = chart.datasetIds.filter(id => id !== datasetId);
    }
    
    // If all datasets are selected, set to null (means "all")
    if (chart.datasetIds.length === datasets.length) {
      chart.datasetIds = null;
    }
    
    // Update chart immediately (no delay)
    renderSingleChart(chart);
    updateDatasetSelectorText(chart);
    
    // Update sidebar checkboxes to stay in sync
    setTimeout(() => renderChartConfig(), 50);
  }
  
  function updateDatasetSelectorText(chart) {
    const selector = document.querySelector(`.de-dataset-selector[data-chart-id="${chart.id}"]`);
    if (!selector) {
      console.warn("[Data Explorer] Cannot find dataset selector for chart", chart.id);
      return;
    }
    
    const indicator = selector.querySelector(".de-dataset-indicator");
    if (!indicator) {
      console.warn("[Data Explorer] Cannot find dataset indicator for chart", chart.id);
      return;
    }
    
    // Determine which datasets are used
    const usedDatasets = chart.datasetIds === null || chart.datasetIds === undefined
      ? datasets
      : datasets.filter(ds => chart.datasetIds.includes(ds.id));
    
    const text = usedDatasets.length === datasets.length 
      ? "All datasets" 
      : usedDatasets.length === 0
        ? "No datasets"
        : usedDatasets.map(ds => ds.label).join(", ");
    
    indicator.textContent = text;
  }
  
  function updateKpiDatasetSelectorText(kpi) {
    const selector = document.querySelector(`.de-dataset-selector[data-kpi-id="${kpi.id}"]`);
    if (!selector) {
      console.warn("[Data Explorer] Cannot find dataset selector for KPI", kpi.id);
      return;
    }
    
    const indicator = selector.querySelector(".de-dataset-indicator");
    if (!indicator) {
      console.warn("[Data Explorer] Cannot find dataset indicator for KPI", kpi.id);
      return;
    }
    
    // Determine which datasets are used
    const usedDatasets = kpi.datasetIds === null || kpi.datasetIds === undefined
      ? datasets
      : datasets.filter(ds => kpi.datasetIds.includes(ds.id));
    
    const text = usedDatasets.length === datasets.length 
      ? "All datasets" 
      : usedDatasets.length === 0
        ? "No datasets"
        : usedDatasets.map(ds => ds.label).join(", ");
    
    indicator.textContent = text;
  }
  
  function renderSingleKpi(kpi) {
    
    const kpiCard = document.querySelector(`.de-kpi-card [data-kpi-id="${kpi.id}"]`)?.closest('.de-kpi-card');
    if (!kpiCard) {
      console.warn("[Data Explorer] Cannot find KPI card for", kpi.id);
      return;
    }
    
    // Resolve which datasets to use
    // Priority: Global filter > KPI-specific selection > All datasets
    let usedDatasets;
    
    if (globalDatasetFilter !== null) {
      // Global filter active - use it
      usedDatasets = datasets.filter(ds => globalDatasetFilter.includes(ds.id));
    } else {
      // Use KPI-specific selection
      usedDatasets = kpi.datasetIds === null || kpi.datasetIds === undefined
        ? datasets
        : datasets.filter(ds => kpi.datasetIds.includes(ds.id));
    }
    
    const rows = usedDatasets.flatMap(ds => applyFilters(ds.rows));
    const dsLabel = usedDatasets.length === datasets.length 
      ? "All datasets" 
      : usedDatasets.length === 0
        ? "No datasets"
        : usedDatasets.map(ds => ds.label).join(", ");
    
    const val = computeAgg(rows, kpi.column, kpi.agg);
    
    // Update value
    const valEl = kpiCard.querySelector('.de-kpi-value');
    if (valEl) valEl.textContent = formatValue(val, kpi.format);
    
    // Update sub-label
    const subEl = kpiCard.querySelector('.de-kpi-sub');
    if (subEl) {
      const aggPart = kpi.agg !== "count" ? `${kpi.agg.toUpperCase()}(${kpi.column})` : "COUNT";
      subEl.textContent = `${aggPart} · ${dsLabel} · ${rows.length} rows`;
    }
    
    // Update color accent strip
    if (usedDatasets.length > 0 && usedDatasets.length < datasets.length) {
      const dsIdx = datasets.findIndex(d => d.id === usedDatasets[0].id);
      if (dsIdx !== -1) {
        kpiCard.style.borderTop = `2px solid ${DATASET_COLORS[dsIdx % DATASET_COLORS.length]}`;
      }
    } else {
      kpiCard.style.borderTop = "";
    }
    
  }
  
  function renderSingleChart(chart) {
    
    const plotDiv = document.querySelector(`.de-chart-plot[data-chart-id="${chart.id}"]`);
    if (!plotDiv) {
      console.error("[Data Explorer] Cannot find plot div for chart", chart.id);
      return;
    }
    
    if (typeof Plotly === "undefined") {
      console.error("[Data Explorer] Plotly not loaded");
      return;
    }
    
    const traces = buildChartData(chart);
    
    if (!traces || traces.length === 0) {
      plotDiv.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);font-size:0.8rem;">No data</div>`;
      return;
    }
    
    const layout = buildLayout(chart);
    
    // Clear and rebuild plot for reliability
    try {
      Plotly.purge(plotDiv);
      Plotly.newPlot(plotDiv, traces, layout, PLOTLY_CONFIG);
    } catch (err) {
      console.error("[Data Explorer] Error rendering chart", chart.id, err);
    }
  }

  function renderGrid() {
    
    if (typeof Plotly === "undefined") {
      console.error("[Data Explorer] Plotly not loaded");
      return;
    }
    
    const grid = document.getElementById("deChartGrid");
    if (!grid) {
      console.error("[Data Explorer] Grid container not found");
      return;
    }
    

    // Check if GridStack is available
    const useGridStack = typeof GridStack !== "undefined" && !presentationMode;

    // Initialize GridStack if not already done and available
    if (useGridStack && !gridStack) {
      try {
        gridStack = GridStack.init({
          cellHeight: 80,
          column: 12,
          margin: 20,  // Increased margin to prevent accidental overlap (was 16px)
          resizable: { handles: 'se' },
          draggable: { handle: '.de-chart-title, .de-kpi-label' },  // Allow dragging by chart titles or KPI labels
          float: true,  // Allow free placement with gaps - GridStack handles collision during drag
          disableOneColumnMode: true,
          staticGrid: false,
          acceptWidgets: false  // Don't accept external widgets
        }, '#deChartGrid'); // Use selector string instead of element

        // Save layout when user drags or resizes
        gridStack.on('change', (event, items) => {
          // Update both chart and KPI objects with new positions/sizes
          const gridItems = gridStack.getGridItems();
          gridItems.forEach(el => {
            const itemId = el.getAttribute('gs-id');
            const itemType = el.getAttribute('data-type'); // 'chart' or 'kpi'
            
            if (itemType === 'chart') {
              const chart = charts.find(c => c.id === itemId);
              if (chart) {
                const node = el.gridstackNode;
                chart.x = node.x;
                chart.y = node.y;
                chart.w = node.w;
                chart.h = node.h;
              }
            } else if (itemType === 'kpi') {
              const kpi = kpiCards.find(k => k.id === itemId);
              if (kpi) {
                const node = el.gridstackNode;
                kpi.x = node.x;
                kpi.y = node.y;
                kpi.w = node.w;
                kpi.h = node.h;
              }
            }
          });
        });
        
        // Only resize on resizestop - triple resize for stability
        gridStack.on('resizestop', (event, el) => {
          const plotDiv = el.querySelector('.js-plotly-plot');
          if (plotDiv && typeof Plotly !== 'undefined') {
            // Immediate
            Plotly.Plots.resize(plotDiv);
            // First delay
            setTimeout(() => Plotly.Plots.resize(plotDiv), 100);
            // Final delay to catch any late layout settling
            setTimeout(() => {
              Plotly.Plots.resize(plotDiv);
            }, 300);
          }
        });
      } catch (err) {
        console.error("[Data Explorer] GridStack init failed:", err);
        gridStack = null;
      }
    }

    // Clear existing items
    if (gridStack) {
      gridStack.removeAll();
    } else {
      grid.innerHTML = "";
    }

    if (!charts.length && !kpiCards.length) {
      console.warn("[Data Explorer] No charts or KPIs to render");
      return;
    }
    
    if (!datasets.length) {
      console.warn("[Data Explorer] No datasets loaded");
      return;
    }

    // ── Render KPIs as GridStack items ──
    kpiCards.forEach((kpi, index) => {
      // Default position if not set
      if (kpi.x === undefined) {
        kpi.x = (index % 4) * 3;  // 4 KPIs per row, each 3 columns wide
        kpi.y = 0;  // KPIs at top
        kpi.w = 3;
        kpi.h = 2;
      }

      if (gridStack) {
        // Determine which datasets to use for this KPI
        let usedDatasets;
        if (globalDatasetFilter !== null) {
          usedDatasets = datasets.filter(ds => globalDatasetFilter.includes(ds.id));
        } else {
          usedDatasets = kpi.datasetIds === null || kpi.datasetIds === undefined
            ? datasets
            : datasets.filter(ds => kpi.datasetIds.includes(ds.id));
        }
        
        const rows = usedDatasets.flatMap(ds => applyFilters(ds.rows));
        const val = computeAgg(rows, kpi.column, kpi.agg);
        
        const dsLabel = usedDatasets.length === datasets.length 
          ? "All datasets" 
          : usedDatasets.length === 0
            ? "No datasets"
            : usedDatasets.map(ds => ds.label).join(", ");
        
        // Color strip for specific datasets
        let borderStyle = "";
        if (usedDatasets.length > 0 && usedDatasets.length < datasets.length) {
          const dsIdx = datasets.findIndex(d => d.id === usedDatasets[0].id);
          if (dsIdx !== -1) {
            borderStyle = `border-top: 2px solid ${DATASET_COLORS[dsIdx % DATASET_COLORS.length]};`;
          }
        }
        
        const aggPart = kpi.agg !== "count" ? `${kpi.agg.toUpperCase()}(${kpi.column})` : "COUNT";
        
        const widgetHTML = `
          <div class="grid-stack-item-content de-kpi-card" style="${borderStyle}">
            <div class="de-kpi-value">${formatValue(val, kpi.format)}</div>
            <div class="de-kpi-label">${kpi.label}</div>
            <div class="de-kpi-sub">${aggPart} · ${dsLabel} · ${rows.length} rows</div>
            <div class="de-dataset-selector" data-kpi-id="${kpi.id}" style="margin-top: 0.4rem;">
              <span class="de-dataset-indicator">${dsLabel}</span>
              <span class="de-dataset-toggle">▼</span>
            </div>
          </div>
        `;
        
        const addedEl = gridStack.addWidget({
          x: kpi.x,
          y: kpi.y,
          w: kpi.w,
          h: kpi.h,
          minW: 2,   // Minimum 2 columns wide
          maxW: 6,   // Maximum 6 columns wide (half screen)
          minH: 2,   // Minimum 2 rows tall
          maxH: 4,   // Maximum 4 rows tall
          content: widgetHTML,
          id: kpi.id
        });
        
        if (addedEl) {
          addedEl.setAttribute('data-type', 'kpi');  // Mark as KPI for change tracking
          const heightPx = kpi.h * 80;
          const widthPercent = (kpi.w / 12) * 100;
          addedEl.style.height = `${heightPx}px`;
          addedEl.style.width = `${widthPercent}%`;
          addedEl.style.position = 'absolute';
        }
      }
    });

    charts.forEach((chart, index) => {
      
      // Default position if not set
      if (chart.x === undefined) {
        chart.x = (index % 2) * 6;
        chart.y = Math.floor(index / 2) * 3;
        chart.w = 6;
        chart.h = 3;
      }

      if (gridStack) {
        // Build dataset selector HTML
        const usedDatasets = chart.datasetIds === null || chart.datasetIds === undefined
          ? datasets
          : datasets.filter(ds => chart.datasetIds.includes(ds.id));
        
        const datasetIndicatorText = usedDatasets.length === datasets.length 
          ? "All datasets" 
          : usedDatasets.length === 0
            ? "No datasets"
            : usedDatasets.map(ds => ds.label).join(", ");
        
        // GridStack mode - use HTML string approach (more reliable than createElement)
        const widgetHTML = `
          <div class="grid-stack-item-content de-chart-wrap">
            <div class="de-chart-title">${chart.title}</div>
            <div class="de-dataset-selector" data-chart-id="${chart.id}">
              <span class="de-dataset-indicator">${datasetIndicatorText}</span>
              <span class="de-dataset-toggle">▼</span>
            </div>
            <div class="de-chart-plot" data-chart-id="${chart.id}"></div>
          </div>
        `;
        
        
        // Let addWidget handle everything
        const addedEl = gridStack.addWidget({
          x: chart.x, 
          y: chart.y, 
          w: chart.w, 
          h: chart.h,
          minW: 3,   // Minimum 3 columns wide (quarter screen)
          maxW: 12,  // Maximum full width
          minH: 2,   // Minimum 2 rows tall
          maxH: 8,   // Maximum 8 rows tall
          content: widgetHTML,
          id: chart.id
        });
        
        
        // CRITICAL: Manually set height - GridStack addWidget doesn't always apply inline styles
        if (addedEl) {
          addedEl.setAttribute('data-type', 'chart');  // Mark as chart for change tracking
          const heightPx = chart.h * 80; // cellHeight = 80px
          const widthPercent = (chart.w / 12) * 100; // 12 columns
          
          addedEl.style.height = `${heightPx}px`;
          addedEl.style.width = `${widthPercent}%`;
          addedEl.style.position = 'absolute';
          
        }
        
        // Find the plot div we just created
        const plotDiv = addedEl ? addedEl.querySelector('.de-chart-plot') : null;
        
        if (!plotDiv) {
          console.error(`[Data Explorer] Could not find plotDiv after addWidget`);
          return;
        }
        

        // Render Plotly chart
        const traces = buildChartData(chart);
        
        if (!traces?.length) {
          plotDiv.innerHTML = `<div style="color:var(--text-muted);padding:1rem;font-size:0.8rem;text-align:center;">No data — check field selections.</div>`;
          return;
        }

        const layout = buildLayout(chart);
        setTimeout(() => {
          Plotly.newPlot(plotDiv, traces, layout, { displayModeBar: false, responsive: true })
            .then(() => {
              // Note: responsive:true handles initial sizing automatically
              // Resize is only needed when GridStack changes size (handled in 'change' event)
            })
            .catch(err => console.error(`[Data Explorer] Plotly render failed for chart ${index}:`, err));
        }, 100);

      } else {
        // Fallback mode - simple grid (no GridStack)
        
        const chartHeight = { small: 200, medium: 280, large: 380, full: 400 }[chart.size || "medium"] || 280;
        
        const wrap = document.createElement("div");
        wrap.className = "de-chart-wrap-fallback";
        wrap.style.cssText = "background:rgba(30,41,59,0.6);border:1px solid rgba(148,163,184,0.1);border-radius:0.6rem;padding:0.7rem 0.8rem 0.5rem;margin-bottom:0.8rem;";

        const titleEl = document.createElement("div");
        titleEl.className = "de-chart-title";
        titleEl.textContent = chart.title;
        wrap.appendChild(titleEl);

        const plotDiv = document.createElement("div");
        plotDiv.style.cssText = `width:100%;height:${chartHeight}px;`;
        wrap.appendChild(plotDiv);

        grid.appendChild(wrap);

        // Render Plotly chart
        const traces = buildChartData(chart);
        if (!traces?.length) {
          plotDiv.innerHTML = `<div style="color:var(--text-muted);padding:1rem;font-size:0.8rem;text-align:center;">No data — check field selections.</div>`;
          return;
        }

        const layout = buildLayout(chart);
        Plotly.newPlot(plotDiv, traces, layout, { displayModeBar: false, responsive: true })
          .catch(err => console.error(`[Data Explorer] Fallback Plotly render failed for chart ${index}:`, err));
      }
    });

    // Compact layout after adding all items
    if (gridStack) {
      gridStack.compact();
    }
    
    
    // DEBUG: Check final DOM state
    setTimeout(() => {
      const finalHTML = grid.innerHTML;
      const itemCount = grid.querySelectorAll('.grid-stack-item').length;
      if (itemCount === 0 && charts.length > 0) {
        console.error("[Data Explorer] BUG: Charts were added but not in DOM!");
      }
    }, 500);
  }

  // ── Dashboard Save/Load ───────────────────────────────────────────────────────
  function showSaveDashboardDialog() {
    const name = prompt("Dashboard name:", "My Dashboard");
    if (!name?.trim()) return;
    saveDashboard(name.trim());
    alert(`Dashboard "${name.trim()}" saved.`);
  }

  function showLoadDashboardDialog() {
    const dashboards = loadDashboards();
    if (!dashboards.length) { alert("No saved dashboards."); return; }

    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;";

    const panel = document.createElement("div");
    panel.style.cssText = "background:var(--bg-secondary);border-radius:0.6rem;padding:1.2rem;width:340px;max-height:70vh;overflow-y:auto;";

    const title = document.createElement("div");
    title.style.cssText = "font-weight:700;font-size:0.95rem;color:var(--text-primary);margin-bottom:0.75rem;";
    title.textContent = "Load Dashboard";
    panel.appendChild(title);

    dashboards.forEach(d => {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:center;gap:0.5rem;padding:0.4rem 0;border-bottom:1px solid rgba(148,163,184,0.08);";

      const lbl = document.createElement("span");
      lbl.style.cssText = "flex:1;font-size:0.85rem;color:var(--text-primary);";
      lbl.textContent = d.name;

      const loadBtn = document.createElement("button");
      loadBtn.className = "btn btn-sm";
      loadBtn.textContent = "Load";
      loadBtn.addEventListener("click", () => {
        applyDashboard(d);
        overlay.remove();
        render();
      });

      const delBtn = document.createElement("button");
      delBtn.className = "btn btn-ghost btn-xs btn-text-danger";
      delBtn.textContent = "Delete";
      delBtn.addEventListener("click", () => {
        deleteDashboard(d.id);
        row.remove();
      });

      row.appendChild(lbl);
      row.appendChild(loadBtn);
      row.appendChild(delBtn);
      panel.appendChild(row);
    });

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "btn btn-secondary btn-sm";
    cancelBtn.style.cssText = "width:100%;margin-top:0.75rem;";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => overlay.remove());
    panel.appendChild(cancelBtn);

    overlay.appendChild(panel);
    document.body.appendChild(overlay);
  }

  // ── Presentation Mode ────────────────────────────────────────────────────────
  function enterPresentationMode() {
    const root = document.getElementById("deRoot");
    if (!root) return;
    root.classList.add("de-presentation");
    presentationMode = true;

    const exitBtn = document.createElement("button");
    exitBtn.id = "dePresentationExit";
    exitBtn.className = "btn btn-secondary btn-sm";
    exitBtn.style.cssText = "position:fixed;top:1rem;left:50%;transform:translateX(-50%);z-index:9999;";
    exitBtn.textContent = "✕ Exit Presentation";
    exitBtn.addEventListener("click", exitPresentationMode);
    document.getElementById("app").appendChild(exitBtn);

    document.addEventListener("keydown", handlePresentationKey);

    // Re-render charts at full size
    setTimeout(() => { renderGrid(); renderGrid(); }, 100);
  }

  function exitPresentationMode() {
    const root = document.getElementById("deRoot");
    root?.classList.remove("de-presentation");
    document.getElementById("dePresentationExit")?.remove();
    document.removeEventListener("keydown", handlePresentationKey);
    presentationMode = false;
    setTimeout(() => { renderGrid(); renderGrid(); }, 100);
  }

  function handlePresentationKey(e) {
    if (e.key === "Escape") exitPresentationMode();
  }

  // ── Module lifecycle ─────────────────────────────────────────────────────────
  function init() {
    // nothing to preload
  }

  function show() {
    migrateKpiDataFormat(); // Convert old KPI format to new format
    render();
  }

  function hide() {
    if (presentationMode) exitPresentationMode();
    
    // Clean up GridStack
    if (gridStack) {
      gridStack.destroy(false); // false = don't remove DOM elements (we're clearing container anyway)
      gridStack = null;
    }
    
    const grid = document.getElementById("deChartGrid");
    if (grid && typeof Plotly !== "undefined") {
      grid.querySelectorAll(".js-plotly-plot").forEach(el => { try { Plotly.purge(el); } catch {} });
    }
    const container = document.getElementById(CONTAINER_ID);
    if (container) container.innerHTML = "";
  }

  // ── Register ─────────────────────────────────────────────────────────────────
  window.SecOpsWorkbench.registerModule("dataExplorer", {
    meta,
    init,
    show,
    hide,
  });

})();