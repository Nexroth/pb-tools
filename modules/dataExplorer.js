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
  let charts      = [];   // [{ id, type, xField, yField, datasetIds, title }]
  let activeFilters = {}; // { fieldName: value | "all" }
  let presentationMode = false;

  // Plotly dark theme — matches PB Tools palette
  const PLOTLY_LAYOUT_BASE = {
    paper_bgcolor: "rgba(15,23,42,0)",
    plot_bgcolor:  "rgba(30,41,59,0.6)",
    font: { color: "#f9fafb", family: "system-ui, -apple-system, sans-serif", size: 12 },
    xaxis: {
      gridcolor:  "rgba(148,163,184,0.1)",
      linecolor:  "rgba(148,163,184,0.15)",
      tickfont:   { color: "#d1d5db" },
      titlefont:  { color: "#9ca3af" },
      zerolinecolor: "rgba(148,163,184,0.15)",
    },
    yaxis: {
      gridcolor:  "rgba(148,163,184,0.1)",
      linecolor:  "rgba(148,163,184,0.15)",
      tickfont:   { color: "#d1d5db" },
      titlefont:  { color: "#9ca3af" },
      zerolinecolor: "rgba(148,163,184,0.15)",
    },
    legend: {
      bgcolor:     "rgba(15,23,42,0.5)",
      bordercolor: "rgba(148,163,184,0.15)",
      borderwidth: 1,
      font: { color: "#d1d5db" },
    },
    margin: { t: 36, r: 16, b: 48, l: 52 },
    hoverlabel: {
      bgcolor:     "rgba(15,23,42,0.95)",
      bordercolor: "rgba(148,163,184,0.3)",
      font: { color: "#f9fafb" },
    },
  };

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
  }

  // ── CSV parsing ──────────────────────────────────────────────────────────────
  function parseCSV(text) {
    const result = Papa.parse(text, { header: true, skipEmptyLines: true, dynamicTyping: false });
    return { fields: result.meta.fields || [], rows: result.data };
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  function render() {
    const container = document.getElementById(CONTAINER_ID);
    if (!container) return;
    container.className = "module-container module-container--dataExplorer";

    container.innerHTML = `
      <div class="de-root" id="deRoot">

        <!-- Toolbar -->
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

        <!-- Body: sidebar + canvas -->
        <div class="de-body">

          <!-- Left sidebar: datasets, KPIs, filters, charts config -->
          <div class="de-sidebar" id="deSidebar">

            <!-- Datasets -->
            <div class="de-section">
              <div class="de-section-title">DATASETS</div>
              <div id="deDatasetList"></div>
              ${datasets.length < MAX_DATASETS ? `
                <label class="btn btn-secondary btn-sm de-add-btn" style="cursor:pointer;margin-top:0.4rem;">
                  + Add Dataset
                  <input type="file" accept=".csv" id="deAddDatasetInput" style="display:none;">
                </label>
              ` : `<div class="de-hint">Max ${MAX_DATASETS} datasets loaded.</div>`}
            </div>

            <div class="de-divider"></div>

            <!-- KPI Cards -->
            <div class="de-section">
              <div class="de-section-title">KPI CARDS</div>
              <div id="deKpiConfigList"></div>
              ${datasets.length > 0 ? `<button class="btn btn-secondary btn-sm de-add-btn" id="deAddKpiBtn">+ Add KPI Card</button>` : `<div class="de-hint">Load a dataset first.</div>`}
            </div>

            <div class="de-divider"></div>

            <!-- Filters -->
            <div class="de-section">
              <div class="de-section-title">FILTERS</div>
              <div id="deFiltersList">
                ${datasets.length === 0 ? `<div class="de-hint">Load a dataset to add filters.</div>` : ""}
              </div>
              ${datasets.length > 0 ? `<button class="btn btn-secondary btn-sm de-add-btn" id="deAddFilterBtn">+ Add Filter</button>` : ""}
            </div>

            <div class="de-divider"></div>

            <!-- Charts config -->
            <div class="de-section">
              <div class="de-section-title">CHARTS</div>
              <div id="deChartConfigList"></div>
              ${datasets.length > 0 ? `<button class="btn btn-secondary btn-sm de-add-btn" id="deAddChartBtn">+ Add Chart</button>` : `<div class="de-hint">Load a dataset first.</div>`}
            </div>

          </div>

          <!-- Right canvas: KPI row + chart grid -->
          <div class="de-canvas" id="deCanvas">
            <div id="deKpiRow" class="de-kpi-row"></div>
            <div id="deChartGrid" class="de-chart-grid"></div>
            ${datasets.length === 0 ? `
              <div class="de-empty">
                <div class="de-empty-icon">📊</div>
                <div class="de-empty-title">No datasets loaded</div>
                <div class="de-empty-hint">Add a CSV file using the sidebar to get started.</div>
              </div>
            ` : ""}
          </div>

        </div>
      </div>
    `;

    wireEvents();
    renderDatasetList();
    renderKpiConfig();
    renderFilters();
    renderChartConfig();
    renderKpiCards();
    renderCharts();
  }

  // ── Wire Events ──────────────────────────────────────────────────────────────
  function wireEvents() {
    // Add dataset
    const addInput = document.getElementById("deAddDatasetInput");
    addInput?.addEventListener("change", e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        const { fields, rows } = parseCSV(ev.target.result);
        if (!fields.length) return;
        const label = file.name.replace(/\.csv$/i, "");
        datasets.push({ id: uid(), label, fields, rows });
        activeFilters = {}; // reset filters on new dataset
        render();
      };
      reader.readAsText(file);
      e.target.value = "";
    });

    // KPI
    document.getElementById("deAddKpiBtn")?.addEventListener("click", () => {
      const ds = datasets[0];
      if (!ds) return;
      kpiCards.push({ id: uid(), label: "New KPI", column: ds.fields[0], agg: "count", format: "number" });
      renderKpiConfig();
      renderKpiCards();
    });

    // Filter
    document.getElementById("deAddFilterBtn")?.addEventListener("click", () => {
      const allFields = getAllFields();
      if (!allFields.length) return;
      showAddFilterDialog(allFields);
    });

    // Chart
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
        datasetIds: datasets.map(d => d.id),  // all datasets by default
        agg:        "count",
        size:       "medium",  // small | medium | large | full
      });
      renderChartConfig();
      renderCharts();
    });

    // Save / Load dashboard
    document.getElementById("deSaveDashboardBtn")?.addEventListener("click", () => showSaveDashboardDialog());
    document.getElementById("deLoadDashboardBtn")?.addEventListener("click", () => showLoadDashboardDialog());

    // Presentation mode
    document.getElementById("dePresentBtn")?.addEventListener("click", () => enterPresentationMode());
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
        renderKpiCards();
        renderCharts();
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
      labelInput.addEventListener("change", () => { kpi.label = labelInput.value.trim() || kpi.label; renderKpiCards(); });

      const delBtn = document.createElement("button");
      delBtn.className = "btn btn-ghost btn-xs btn-text-danger";
      delBtn.textContent = "✕";
      delBtn.addEventListener("click", () => { kpiCards = kpiCards.filter(k => k.id !== kpi.id); renderKpiConfig(); renderKpiCards(); });

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
      colSel.addEventListener("change", () => { kpi.column = colSel.value; renderKpiCards(); });

      const aggSel = document.createElement("select");
      aggSel.className = "panel-input";
      aggSel.style.cssText = "flex:1;font-size:0.75rem;";
      ["count","sum","avg","max","min"].forEach(a => {
        const o = document.createElement("option");
        o.value = a; o.textContent = a.toUpperCase();
        if (a === kpi.agg) o.selected = true;
        aggSel.appendChild(o);
      });
      aggSel.addEventListener("change", () => { kpi.agg = aggSel.value; renderKpiCards(); });

      const fmtSel = document.createElement("select");
      fmtSel.className = "panel-input";
      fmtSel.style.cssText = "flex:1;font-size:0.75rem;";
      [{v:"number",l:"#"},{v:"percentage",l:"%"},{v:"decimal",l:".0"}].forEach(f => {
        const o = document.createElement("option");
        o.value = f.v; o.textContent = f.l;
        if (f.v === kpi.format) o.selected = true;
        fmtSel.appendChild(o);
      });
      fmtSel.addEventListener("change", () => { kpi.format = fmtSel.value; renderKpiCards(); });

      cfgRow.appendChild(colSel);
      cfgRow.appendChild(aggSel);
      cfgRow.appendChild(fmtSel);
      item.appendChild(cfgRow);
      el.appendChild(item);
    });
  }

  // ── KPI Cards (canvas) ───────────────────────────────────────────────────────
  function renderKpiCards() {
    const el = document.getElementById("deKpiRow");
    if (!el) return;
    el.innerHTML = "";
    if (!kpiCards.length || !datasets.length) return;

    // Combine all filtered rows from all datasets
    const allRows = datasets.flatMap(ds => applyFilters(ds.rows));

    kpiCards.forEach(kpi => {
      const val   = computeAgg(allRows, kpi.column, kpi.agg);
      const card  = document.createElement("div");
      card.className = "de-kpi-card";

      const valEl = document.createElement("div");
      valEl.className = "de-kpi-value";
      valEl.textContent = formatValue(val, kpi.format);

      const lblEl = document.createElement("div");
      lblEl.className = "de-kpi-label";
      lblEl.textContent = kpi.label;

      const subEl = document.createElement("div");
      subEl.className = "de-kpi-sub";
      subEl.textContent = `${kpi.agg.toUpperCase()}${kpi.agg !== "count" ? ` · ${kpi.column}` : ""} · ${allRows.length} rows`;

      card.appendChild(valEl);
      card.appendChild(lblEl);
      card.appendChild(subEl);
      el.appendChild(card);
    });
  }

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
        renderKpiCards();
        renderCharts();
      });

      const rmBtn = document.createElement("button");
      rmBtn.className = "btn btn-ghost btn-xs btn-text-danger";
      rmBtn.textContent = "✕";
      rmBtn.addEventListener("click", () => {
        delete activeFilters[field];
        renderFilters();
        renderKpiCards();
        renderCharts();
      });

      row.appendChild(lbl);
      row.appendChild(sel);
      row.appendChild(rmBtn);
      el.appendChild(row);
    });
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
      const item = document.createElement("div");
      item.style.cssText = "background:var(--bg-tertiary);border-radius:0.3rem;padding:0.45rem 0.5rem;margin-bottom:0.35rem;";

      // Header
      const hdr = document.createElement("div");
      hdr.style.cssText = "display:flex;align-items:center;gap:0.3rem;margin-bottom:0.3rem;";

      const titleInput = document.createElement("input");
      titleInput.type = "text";
      titleInput.className = "panel-input";
      titleInput.value = chart.title;
      titleInput.style.cssText = "flex:1;font-size:0.8rem;padding:0.2rem 0.4rem;";
      titleInput.addEventListener("change", () => { chart.title = titleInput.value.trim() || chart.title; renderCharts(); });

      const delBtn = document.createElement("button");
      delBtn.className = "btn btn-ghost btn-xs btn-text-danger";
      delBtn.textContent = "✕";
      delBtn.addEventListener("click", () => {
        charts = charts.filter(c => c.id !== chart.id);
        renderChartConfig();
        renderCharts();
      });

      hdr.appendChild(titleInput);
      hdr.appendChild(delBtn);
      item.appendChild(hdr);

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
        renderCharts();
      });
      typeRow.appendChild(typeLbl);
      typeRow.appendChild(typeSel);
      item.appendChild(typeRow);

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
        fieldRow.appendChild(makeFieldSel("Labels", chart.xField, v => { chart.xField = v; renderCharts(); }));
        fieldRow.appendChild(makeFieldSel("Values", chart.yField, v => { chart.yField = v; renderCharts(); }));
      } else if (chart.type === "heatmap") {
        fieldRow.appendChild(makeFieldSel("X (category)", chart.xField, v => { chart.xField = v; renderCharts(); }));
        fieldRow.appendChild(makeFieldSel("Y (category)", chart.yField, v => { chart.yField = v; renderCharts(); }));
      } else if (noY) {
        fieldRow.appendChild(makeFieldSel("Value column", chart.yField, v => { chart.yField = v; renderCharts(); }));
        fieldRow.appendChild(makeFieldSel("Group by", chart.xField, v => { chart.xField = v; renderCharts(); }));
      } else {
        fieldRow.appendChild(makeFieldSel("X axis", chart.xField, v => { chart.xField = v; renderCharts(); }));
        const yLabel = chart.type === "bubble" ? "Y axis" : "Y / Value";
        fieldRow.appendChild(makeFieldSel(yLabel, chart.yField, v => { chart.yField = v; renderCharts(); }));
      }
      item.appendChild(fieldRow);

      // Bubble size field
      if (chart.type === "bubble") {
        const allFields2 = getAllFields();
        const bubbleRow = document.createElement("div");
        bubbleRow.style.cssText = "display:flex;gap:0.25rem;margin-top:0.3rem;";
        bubbleRow.appendChild(makeFieldSel("Bubble size", chart.sizeField || allFields2[0], v => { chart.sizeField = v; renderCharts(); }));
        item.appendChild(bubbleRow);
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
        aggSel.addEventListener("change", () => { chart.agg = aggSel.value; renderCharts(); });
        aggRow.appendChild(aggLbl);
        aggRow.appendChild(aggSel);
        item.appendChild(aggRow);
      }

      // Dataset checkboxes (only show if >1 dataset loaded)
      if (datasets.length > 1) {
        const dsLbl = document.createElement("div");
        dsLbl.style.cssText = "font-size:0.68rem;color:var(--text-muted);margin-top:0.35rem;margin-bottom:0.15rem;";
        dsLbl.textContent = "Datasets:";
        item.appendChild(dsLbl);

        datasets.forEach((ds, i) => {
          const cbRow = document.createElement("label");
          cbRow.style.cssText = "display:flex;align-items:center;gap:0.35rem;font-size:0.75rem;color:var(--text-secondary);cursor:pointer;margin-bottom:0.1rem;";
          const cb = document.createElement("input");
          cb.type = "checkbox";
          cb.checked = (chart.datasetIds || []).includes(ds.id);
          cb.addEventListener("change", () => {
            if (cb.checked) {
              if (!chart.datasetIds.includes(ds.id)) chart.datasetIds.push(ds.id);
            } else {
              chart.datasetIds = chart.datasetIds.filter(id => id !== ds.id);
            }
            renderCharts();
          });
          const dot = document.createElement("span");
          dot.style.cssText = `width:7px;height:7px;border-radius:50%;background:${DATASET_COLORS[i % DATASET_COLORS.length]};flex-shrink:0;`;
          cbRow.appendChild(cb);
          cbRow.appendChild(dot);
          cbRow.appendChild(document.createTextNode(ds.label));
          item.appendChild(cbRow);
        });
      }

      // Size control
      const sizeRow = document.createElement("div");
      sizeRow.style.cssText = "display:flex;gap:0.25rem;margin-top:0.35rem;";
      const sizeLbl = document.createElement("span");
      sizeLbl.style.cssText = "font-size:0.68rem;color:var(--text-muted);line-height:1.8;flex-shrink:0;";
      sizeLbl.textContent = "Size:";
      sizeRow.appendChild(sizeLbl);
      ["small","medium","large","full"].forEach(sz => {
        const btn = document.createElement("button");
        btn.className = (chart.size || "medium") === sz ? "btn btn-xs btn-sm" : "btn btn-secondary btn-xs btn-sm";
        btn.style.flex = "1";
        btn.style.fontSize = "0.68rem";
        btn.textContent = sz.charAt(0).toUpperCase() + sz.slice(1);
        btn.addEventListener("click", () => {
          chart.size = sz;
          sizeRow.querySelectorAll("button").forEach(b => b.className = "btn btn-secondary btn-xs btn-sm");
          btn.className = "btn btn-xs btn-sm";
          renderCharts();
        });
        sizeRow.appendChild(btn);
      });
      item.appendChild(sizeRow);

      el.appendChild(item);
    });
  }

  // ── Charts ───────────────────────────────────────────────────────────────────
  function buildChartData(chart) {
    const usedDatasets = datasets.filter(ds =>
      !chart.datasetIds?.length || chart.datasetIds.includes(ds.id)
    );
    if (!usedDatasets.length) return null;

    const traces = [];

    usedDatasets.forEach((ds, dsIdx) => {
      const filteredRows = applyFilters(ds.rows);
      const color = DATASET_COLORS[dsIdx % DATASET_COLORS.length];

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
        Object.entries(grpMap).forEach(([grp, vals], gi) => {
          traces.push({
            type:    "box",
            name:    grp,
            y:       vals,
            marker:  { color: DATASET_COLORS[gi % DATASET_COLORS.length] },
            boxmean: true,
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
        Object.entries(grpMap).forEach(([grp, vals], gi) => {
          traces.push({
            type:     "violin",
            name:     grp,
            y:        vals,
            marker:   { color: DATASET_COLORS[gi % DATASET_COLORS.length] },
            box:      { visible: true },
            meanline: { visible: true },
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
        traces.push({
          type:   "pie",
          name:   ds.label,
          labels: xVals,
          values: yVals,
          marker: { colors: xVals.map((_, i) => `hsl(${(i * 47) % 360}, 70%, 55%)`) },
          textfont: { color: "#f9fafb" },
          hovertemplate: "%{label}: %{value} (%{percent})<extra></extra>",
        });
      } else if (chart.type === "bar") {
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

  function renderCharts() {
    const grid = document.getElementById("deChartGrid");
    if (!grid) return;
    grid.innerHTML = "";
    if (!charts.length || !datasets.length) return;

    charts.forEach(chart => {
      const traces = buildChartData(chart);
      if (!traces?.length) return;

      const wrap = document.createElement("div");
      const sizeClass = { small: "de-chart-wrap--sm", medium: "", large: "de-chart-wrap--lg", full: "de-chart-wrap--full" }[chart.size || "medium"] || "";
      wrap.className = `de-chart-wrap${sizeClass ? " " + sizeClass : ""}`;

      const titleEl = document.createElement("div");
      titleEl.className = "de-chart-title";
      titleEl.textContent = chart.title;
      wrap.appendChild(titleEl);

      const chartHeight = { small: 200, medium: 280, large: 380, full: 400 }[chart.size || "medium"] || 280;
      const plotDiv = document.createElement("div");
      plotDiv.style.cssText = `width:100%;height:${chartHeight}px;`;
      wrap.appendChild(plotDiv);
      grid.appendChild(wrap);

      // Clean axis labels
      const isPie  = chart.type === "pie";
      const isHist = chart.type === "histogram";
      const isNoAgg = ["scatter","bubble","histogram","box","violin"].includes(chart.type);
      const yAxisLabel = isPie ? "" : isHist ? "Count" : isNoAgg ? (chart.yField || "") :
        (chart.agg && chart.agg !== "count" ? `${chart.agg.toUpperCase()}(${chart.yField || ""})` : "COUNT");
      const xAxisLabel = isPie ? "" : isHist ? (chart.yField || "") : (chart.xField || "");

      const layout = {
        ...PLOTLY_LAYOUT_BASE,
        title: { text: "", font: { color: "#9ca3af", size: 11 } },
        showlegend: (chart.datasetIds?.length || 1) > 1 || datasets.length > 1,
        xaxis: { ...PLOTLY_LAYOUT_BASE.xaxis, title: { text: xAxisLabel, font: { color: "#6b7280", size: 11 } } },
        yaxis: { ...PLOTLY_LAYOUT_BASE.yaxis, title: { text: yAxisLabel, font: { color: "#6b7280", size: 11 } } },
      };

      // Plotly.newPlot is async-ish — use setTimeout to ensure DOM is ready
      setTimeout(() => {
        if (typeof Plotly !== "undefined") {
          Plotly.newPlot(plotDiv, traces, layout, PLOTLY_CONFIG);
        } else {
          plotDiv.innerHTML = `<div style="color:#ef4444;padding:1rem;font-size:0.85rem;">Plotly not loaded. Check lib/plotly-basic.min.js.</div>`;
        }
      }, 0);
    });
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
    exitBtn.style.cssText = "position:fixed;top:1rem;right:1rem;z-index:9999;";
    exitBtn.textContent = "✕ Exit Presentation";
    exitBtn.addEventListener("click", exitPresentationMode);
    document.body.appendChild(exitBtn);

    document.addEventListener("keydown", handlePresentationKey);

    // Re-render charts at full size
    setTimeout(() => { renderCharts(); renderKpiCards(); }, 100);
  }

  function exitPresentationMode() {
    const root = document.getElementById("deRoot");
    root?.classList.remove("de-presentation");
    document.getElementById("dePresentationExit")?.remove();
    document.removeEventListener("keydown", handlePresentationKey);
    presentationMode = false;
    setTimeout(() => { renderCharts(); renderKpiCards(); }, 100);
  }

  function handlePresentationKey(e) {
    if (e.key === "Escape") exitPresentationMode();
  }

  // ── Module lifecycle ─────────────────────────────────────────────────────────
  function init() {
    // nothing to preload
  }

  function show() {
    render();
  }

  function hide() {
    if (presentationMode) exitPresentationMode();
    // Purge Plotly instances to free memory
    const grid = document.getElementById("deChartGrid");
    if (grid && typeof Plotly !== "undefined") {
      grid.querySelectorAll("div[class='js-plotly-plot']").forEach(el => {
        try { Plotly.purge(el); } catch {}
      });
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