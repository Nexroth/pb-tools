// modules/reportBuilder.js

(function () {

  const meta = {
    title:    "Report Builder",
    subtitle: "Build charts from your CSV data and export a shareable HTML report.",
  };

  // Report state — list of chart configs added to the report
  let reportCharts = []; // [{ id, title, type, field, data: {labels, values} }]
  let reportTitle  = "PB Tools Report";
  let chartInstances = {}; // canvasId -> Chart instance

  const CHART_TYPES = [
    { value: "bar",          label: "Bar" },
    { value: "horizontalBar", label: "Horizontal Bar" },
    { value: "line",         label: "Line" },
    { value: "pie",          label: "Pie" },
    { value: "doughnut",     label: "Doughnut" },
    { value: "radar",        label: "Radar" },
    { value: "polarArea",    label: "Polar Area" },
  ];

  // Colour palette — enough for 20 distinct segments
  const PALETTE = [
    "#22c55e","#22d3ee","#818cf8","#f59e0b","#f87171",
    "#a78bfa","#34d399","#60a5fa","#fbbf24","#e879f9",
    "#2dd4bf","#fb923c","#a3e635","#38bdf8","#c084fc",
    "#4ade80","#facc15","#f472b6","#94a3b8","#fb7185",
  ];

  // ── Helpers ───────────────────────────────────────────────────────────────

  function getCsvApi() {
    return window.SecOpsWorkbench?.modules?.csvWorkbench?.api ?? null;
  }

  function getSessionData() {
    return getCsvApi()?.getData?.() ?? null;
  }

  function computeGroupCount(rows, field) {
    const counts = {};
    rows.forEach(row => {
      const key = (row[field] == null || row[field] === "") ? "(empty)" : String(row[field]);
      counts[key] = (counts[key] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
  }

  function escHtml(s) {
    return String(s)
      .replace(/&/g,"&amp;").replace(/</g,"&lt;")
      .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  function uid() {
    return "chart_" + Math.random().toString(36).slice(2, 9);
  }

  // ── Chart rendering ───────────────────────────────────────────────────────

  function buildChartConfig(chartDef) {
    const { type, data } = chartDef;
    const labels  = data.map(d => d.label);
    const values  = data.map(d => d.value);
    const colors  = labels.map((_, i) => PALETTE[i % PALETTE.length]);

    const isIndexed = ["bar","line","radar","polarArea"].includes(type);
    const realType  = type === "horizontalBar" ? "bar" : type;

    const config = {
      type: realType,
      data: {
        labels,
        datasets: [{
          label: chartDef.title || "Count",
          data: values,
          backgroundColor: isIndexed ? colors.map(c => c + "cc") : colors,
          borderColor:     isIndexed ? colors : colors.map(c => c + "99"),
          borderWidth: 1,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        indexAxis: type === "horizontalBar" ? "y" : "x",
        plugins: {
          legend: {
            display: !isIndexed,
            labels: { color: "#e5e7eb", font: { size: 11 } },
          },
          title: {
            display: !!chartDef.title,
            text:    chartDef.title,
            color:   "#f9fafb",
            font:    { size: 14, weight: "600" },
            padding: { bottom: 10 },
          },
        },
        scales: isIndexed ? {
          x: { ticks: { color: "#9ca3af" }, grid: { color: "rgba(255,255,255,0.06)" } },
          y: { ticks: { color: "#9ca3af" }, grid: { color: "rgba(255,255,255,0.06)" } },
        } : undefined,
      },
    };

    return config;
  }

  function renderChartToCanvas(canvasId, chartDef) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    // Destroy previous instance if exists
    if (chartInstances[canvasId]) {
      chartInstances[canvasId].destroy();
      delete chartInstances[canvasId];
    }

    const config = buildChartConfig(chartDef);
    chartInstances[canvasId] = new Chart(canvas.getContext("2d"), config);
  }

  // ── Export ────────────────────────────────────────────────────────────────

  function exportReportHtml() {
    if (!reportCharts.length) return;

    // We'll embed Chart.js from CDN in the exported HTML — this file has no CSP
    const chartsHtml = reportCharts.map(chartDef => {
      const id     = uid();
      const config = buildChartConfig(chartDef);
      const isPie  = ["pie","doughnut","polarArea","radar"].includes(chartDef.type);
      return `
  <div class="chart-card">
    <h2 class="chart-title">${escHtml(chartDef.title || "Chart")}</h2>
    <p class="chart-meta">Grouped by: <strong>${escHtml(chartDef.fieldLabel || chartDef.field)}</strong> &mdash; ${chartDef.data.length} distinct values</p>
    <div class="chart-wrap ${isPie ? "chart-wrap--pie" : ""}">
      <canvas id="${id}"></canvas>
    </div>
  </div>
  <script>
    (function(){
      const ctx = document.getElementById('${id}').getContext('2d');
      new Chart(ctx, ${JSON.stringify(config)});
    })();
  <\/script>`;
    }).join("\n");

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escHtml(reportTitle)}</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"><\/script>
<style>
  *,*::before,*::after{box-sizing:border-box}
  body{font-family:system-ui,-apple-system,sans-serif;background:#0f172a;color:#f9fafb;margin:0;padding:1.5rem 2rem;min-height:100vh}
  h1{font-size:1.4rem;margin:0 0 0.25rem;font-weight:700}
  .report-meta{font-size:0.78rem;color:#6b7280;margin-bottom:2rem}
  .charts-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(480px,1fr));gap:1.5rem}
  .chart-card{background:#1e293b;border-radius:0.75rem;border:1px solid rgba(148,163,184,0.15);padding:1.25rem 1.5rem}
  .chart-title{font-size:1rem;font-weight:600;margin:0 0 0.2rem;color:#f9fafb}
  .chart-meta{font-size:0.72rem;color:#6b7280;margin:0 0 1rem}
  .chart-wrap{position:relative;height:300px}
  .chart-wrap--pie{height:280px;max-width:380px;margin:0 auto}
  @media print{
    body{background:#fff;color:#111;padding:0.5rem}
    .chart-card{background:#f9fafb;border-color:#e5e7eb;break-inside:avoid}
    .chart-title,.chart-meta{color:#111}
    .report-meta{color:#6b7280}
  }
</style>
</head>
<body>
<h1>${escHtml(reportTitle)}</h1>
<div class="report-meta">Generated ${new Date().toLocaleString()} &mdash; ${reportCharts.length} chart${reportCharts.length !== 1 ? "s" : ""}</div>
<div class="charts-grid">
${chartsHtml}
</div>
</body>
</html>`;

    const blob = new Blob([html], { type: "text/html;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = (reportTitle || "report").replace(/[^a-z0-9_-]/gi, "-").toLowerCase() + ".html";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  function render() {
    const container = document.getElementById("moduleContainer");
    if (!container) return;
    container.className = "module-container module-container--reportBuilder";
    container.innerHTML = "";

    const sessionData = getSessionData();
    const hasData     = !!(sessionData?.rows?.length);

    const root = document.createElement("div");
    root.className = "rb-root";
    root.innerHTML = `
      <div class="rb-header">
        <div class="rb-header-left">
          <input type="text" class="rb-title-input" id="rbTitleInput" value="${escHtml(reportTitle)}" placeholder="Report title…">
        </div>
        <div class="rb-header-right">
          <button class="btn btn-secondary" id="rbClearBtn" style="font-size:0.75rem;padding:0.3rem 0.65rem;" ${!reportCharts.length ? "disabled" : ""}>Clear all</button>
          <button class="btn" id="rbExportBtn" style="font-size:0.75rem;padding:0.3rem 0.65rem;" ${!reportCharts.length ? "disabled" : ""}>⬆ Export HTML</button>
        </div>
      </div>

      <div class="rb-body">
        <!-- Left: Chart builder -->
        <div class="rb-builder">
          <div class="rb-section-title">ADD CHART</div>
          ${!hasData ? `
            <div class="rb-no-data">
              <div class="rb-no-data-icon">📊</div>
              <div class="rb-no-data-msg">No data loaded.</div>
              <div class="rb-no-data-sub">Load a CSV in the <strong>CSV Workbench</strong> first, then come back here to build charts.</div>
            </div>
          ` : `
            <div class="rb-field-row">
              <label class="rb-label">Column to group by</label>
              <select class="rb-select" id="rbFieldSelect">
                <option value="">Select column…</option>
                ${sessionData.visibleFields.filter(f => f !== "StatusNote").map(f =>
                  `<option value="${escHtml(f)}">${escHtml(sessionData.displayNames[f] || f)}</option>`
                ).join("")}
              </select>
            </div>

            <div class="rb-field-row">
              <label class="rb-label">Chart type</label>
              <select class="rb-select" id="rbTypeSelect">
                ${CHART_TYPES.map(t => `<option value="${t.value}">${t.label}</option>`).join("")}
              </select>
            </div>

            <div class="rb-field-row">
              <label class="rb-label">Chart title (optional)</label>
              <input type="text" class="rb-input" id="rbChartTitle" placeholder="e.g. Fails by Department">
            </div>

            <div class="rb-field-row">
              <label class="rb-label">Max groups to show</label>
              <select class="rb-select" id="rbMaxGroups">
                <option value="0">All</option>
                <option value="5">Top 5</option>
                <option value="10" selected>Top 10</option>
                <option value="15">Top 15</option>
                <option value="20">Top 20</option>
              </select>
            </div>

            <div id="rbPreviewArea" class="rb-preview-area">
              <div class="rb-preview-hint">Select a column to preview.</div>
            </div>

            <button class="btn" id="rbAddChartBtn" style="width:100%;margin-top:0.5rem;font-size:0.78rem;" disabled>
              + Add to report
            </button>
          `}
        </div>

        <!-- Right: Report canvas -->
        <div class="rb-canvas" id="rbCanvas">
          ${!reportCharts.length ? `
            <div class="rb-canvas-empty">
              <div style="font-size:2rem;opacity:0.3">📈</div>
              <div style="opacity:0.4;font-size:0.85rem;margin-top:0.5rem;">Charts you add will appear here.</div>
            </div>
          ` : ""}
        </div>
      </div>
    `;
    container.appendChild(root);

    // Wire title input
    const titleInput = root.querySelector("#rbTitleInput");
    titleInput?.addEventListener("input", () => { reportTitle = titleInput.value; });

    // Wire export + clear
    root.querySelector("#rbExportBtn")?.addEventListener("click", exportReportHtml);
    root.querySelector("#rbClearBtn")?.addEventListener("click", () => {
      reportCharts = [];
      chartInstances = {};
      render();
    });

    if (!hasData) return;

    const fieldSelect  = root.querySelector("#rbFieldSelect");
    const typeSelect   = root.querySelector("#rbTypeSelect");
    const chartTitleIn = root.querySelector("#rbChartTitle");
    const maxGroupsSel = root.querySelector("#rbMaxGroups");
    const previewArea  = root.querySelector("#rbPreviewArea");
    const addBtn       = root.querySelector("#rbAddChartBtn");

    let previewData = null;

    function updatePreview() {
      const field = fieldSelect.value;
      const type  = typeSelect.value;
      const max   = parseInt(maxGroupsSel.value) || 0;
      previewArea.innerHTML = "";
      addBtn.disabled = true;
      previewData = null;

      if (!field) {
        previewArea.innerHTML = `<div class="rb-preview-hint">Select a column to preview.</div>`;
        return;
      }

      let data = computeGroupCount(sessionData.rows, field);
      if (max > 0) data = data.slice(0, max);
      previewData = data;

      if (!data.length) {
        previewArea.innerHTML = `<div class="rb-preview-hint">No data in this column.</div>`;
        return;
      }

      // Mini chart preview
      const canvasId  = "rbPreviewCanvas";
      const fieldLabel = sessionData.displayNames[field] || field;
      const chartDef   = {
        id: canvasId, type, field, fieldLabel,
        title: chartTitleIn.value.trim() || fieldLabel,
        data,
      };

      const wrap = document.createElement("div");
      wrap.className = "rb-preview-wrap";
      const canvas = document.createElement("canvas");
      canvas.id     = canvasId;
      canvas.className = "rb-preview-canvas";
      wrap.appendChild(canvas);
      previewArea.appendChild(wrap);

      setTimeout(() => renderChartToCanvas(canvasId, chartDef), 0);
      addBtn.disabled = false;
    }

    fieldSelect.addEventListener("change", updatePreview);
    typeSelect.addEventListener("change",  updatePreview);
    maxGroupsSel.addEventListener("change", updatePreview);
    chartTitleIn.addEventListener("input",  updatePreview);

    addBtn.addEventListener("click", () => {
      const field      = fieldSelect.value;
      const type       = typeSelect.value;
      const max        = parseInt(maxGroupsSel.value) || 0;
      const fieldLabel = sessionData.displayNames[field] || field;
      const title      = chartTitleIn.value.trim() || fieldLabel;

      if (!field || !previewData) return;

      const chartDef = {
        id:         uid(),
        type, field, fieldLabel, title,
        data:       previewData,
      };

      reportCharts.push(chartDef);

      // Add card to canvas without full re-render
      renderChartCard(chartDef);

      // Reset builder
      fieldSelect.value    = "";
      chartTitleIn.value   = "";
      previewArea.innerHTML = `<div class="rb-preview-hint">Select a column to preview.</div>`;
      addBtn.disabled = true;
      previewData = null;

      // Enable export/clear
      root.querySelector("#rbExportBtn").disabled = false;
      root.querySelector("#rbClearBtn").disabled  = false;

      // Clear empty state in canvas
      const emptyEl = root.querySelector(".rb-canvas-empty");
      if (emptyEl) emptyEl.remove();
    });

    // Render existing charts if re-rendering
    if (reportCharts.length) {
      reportCharts.forEach(c => renderChartCard(c));
    }
  }

  function renderChartCard(chartDef) {
    const canvas = document.getElementById("rbCanvas");
    if (!canvas) return;

    const isPie    = ["pie","doughnut","polarArea","radar"].includes(chartDef.type);
    const canvasId = chartDef.id;

    const card = document.createElement("div");
    card.className    = "rb-chart-card";
    card.dataset.chartId = chartDef.id;

    card.innerHTML = `
      <div class="rb-chart-card-header">
        <div class="rb-chart-card-title">${escHtml(chartDef.title || "Chart")}</div>
        <div class="rb-chart-card-meta">Grouped by ${escHtml(chartDef.fieldLabel || chartDef.field)} &mdash; ${chartDef.data.length} values</div>
      </div>
      <div class="rb-chart-wrap ${isPie ? "rb-chart-wrap--pie" : ""}">
        <canvas id="${canvasId}"></canvas>
      </div>
      <div class="rb-chart-card-footer">
        <button class="btn btn-ghost rb-remove-btn" data-id="${chartDef.id}">✕ Remove</button>
      </div>
    `;

    card.querySelector(".rb-remove-btn").addEventListener("click", () => {
      reportCharts = reportCharts.filter(c => c.id !== chartDef.id);
      if (chartInstances[canvasId]) {
        chartInstances[canvasId].destroy();
        delete chartInstances[canvasId];
      }
      card.remove();
      const rbCanvas = document.getElementById("rbCanvas");
      if (rbCanvas && !rbCanvas.querySelector(".rb-chart-card")) {
        rbCanvas.innerHTML = `
          <div class="rb-canvas-empty">
            <div style="font-size:2rem;opacity:0.3">📈</div>
            <div style="opacity:0.4;font-size:0.85rem;margin-top:0.5rem;">Charts you add will appear here.</div>
          </div>`;
        document.getElementById("rbExportBtn").disabled = true;
        document.getElementById("rbClearBtn").disabled  = true;
      }
    });

    canvas.appendChild(card);
    setTimeout(() => renderChartToCanvas(canvasId, chartDef), 0);
  }

  function init() {}
  function show() { render(); }
  function hide() {}

  window.SecOpsWorkbench.registerModule("reportBuilder", {
    meta,
    init,
    show,
    hide,
  });

})();
