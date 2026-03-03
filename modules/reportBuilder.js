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

  // ── Template Management ───────────────────────────────────────────────────

  const TEMPLATE_STORAGE_KEY = "pbTools_reportTemplates";

  function getTemplates() {
    try {
      const stored = localStorage.getItem(TEMPLATE_STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch (e) {
      console.error("Failed to load templates:", e);
      return [];
    }
  }

  function saveTemplates(templates) {
    try {
      localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(templates));
      return true;
    } catch (e) {
      console.error("Failed to save templates:", e);
      return false;
    }
  }

  function saveAsTemplate(name, description = "") {
    if (!name.trim()) return false;
    
    const template = {
      id: uid(),
      name: name.trim(),
      description: description.trim(),
      reportTitle: reportTitle,
      charts: reportCharts.map(c => ({
        type: c.type,
        field: c.field,
        title: c.title,
        maxGroups: c.maxGroups || 10,
      })),
      createdAt: new Date().toISOString(),
    };

    const templates = getTemplates();
    templates.push(template);
    return saveTemplates(templates) ? template : null;
  }

  function loadTemplate(templateId) {
    const templates = getTemplates();
    const template = templates.find(t => t.id === templateId);
    if (!template) return false;

    reportCharts = [];
    chartInstances = {};
    reportTitle = template.reportTitle;

    const sessionData = getSessionData();
    if (!sessionData?.rows?.length) {
      alert("No CSV data loaded. Load a CSV first, then try loading this template.");
      return false;
    }

    template.charts.forEach(chartConfig => {
      const field = chartConfig.field;
      if (!sessionData.visibleFields.includes(field)) {
        console.warn("Field not found in current CSV, skipping chart:", field);
        return;
      }

      const maxGroups = chartConfig.maxGroups || 10;
      let chartData = computeGroupCount(sessionData.rows, field);
      if (maxGroups > 0 && chartData.length > maxGroups) {
        chartData = chartData.slice(0, maxGroups);
      }

      reportCharts.push({
        id: uid(),
        type: chartConfig.type,
        field: field,
        title: chartConfig.title,
        maxGroups: maxGroups,
        data: chartData,
      });
    });

    render();
    return true;
  }

  function deleteTemplate(templateId) {
    const templates = getTemplates();
    const filtered = templates.filter(t => t.id !== templateId);
    return saveTemplates(filtered);
  }

  function exportTemplateJson(templateId) {
    const templates = getTemplates();
    const template = templates.find(t => t.id === templateId);
    if (!template) return;

    const json = JSON.stringify(template, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = template.name.replace(/[^a-z0-9]/gi, '_') + "_template.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  function importTemplateJson(jsonString) {
    try {
      const template = JSON.parse(jsonString);
      if (!template.name || !template.charts) {
        throw new Error("Invalid template format");
      }
      
      template.id = uid();
      template.createdAt = new Date().toISOString();
      
      const templates = getTemplates();
      templates.push(template);
      saveTemplates(templates);
      return template;
    } catch (e) {
      console.error("Failed to import template:", e);
      return null;
    }
  }

function openTemplateManager() {
    const templates = getTemplates();
    
    const modal = document.createElement("div");
    modal.className = "modal-overlay";
    
    const modalContent = document.createElement("div");
    modalContent.className = "modal-content";
    modalContent.style.maxWidth = "600px";
    
    const header = document.createElement("div");
    header.className = "modal-header";
    header.innerHTML = '<h3 style="margin: 0; font-size: 1.1rem; color: #f9fafb;">Template Manager</h3><button class="modal-close" id="tmCloseBtn">×</button>';
    
    const body = document.createElement("div");
    body.className = "modal-body";
    
    const buttonsRow = document.createElement("div");
    buttonsRow.style.marginBottom = "1rem";
    const saveBtn = document.createElement("button");
    saveBtn.className = "btn btn-sm";
    saveBtn.id = "tmSaveNewBtn";
    saveBtn.disabled = !reportCharts.length;
    saveBtn.innerHTML = "💾 Save Current Report as Template";
    saveBtn.style.color = "#f9fafb";
    
    const importBtn = document.createElement("button");
    importBtn.className = "btn btn-secondary btn-sm";
    importBtn.id = "tmImportBtn";
    importBtn.textContent = "📥 Import Template JSON";
    importBtn.style.color = "#f9fafb";
    
    const importFile = document.createElement("input");
    importFile.type = "file";
    importFile.id = "tmImportFile";
    importFile.accept = ".json";
    importFile.style.display = "none";
    
    buttonsRow.appendChild(saveBtn);
    buttonsRow.appendChild(document.createTextNode(" "));
    buttonsRow.appendChild(importBtn);
    buttonsRow.appendChild(importFile);
    
    const templateCard = document.createElement("div");
    templateCard.className = "section-card";
    
    const cardHeader = document.createElement("div");
    cardHeader.className = "section-card-header";
    cardHeader.innerHTML = '<span style="color: #f9fafb;">Saved Templates (' + templates.length + ')</span>';
    
    const templateList = document.createElement("div");
    templateList.id = "tmTemplateList";
    
    if (templates.length === 0) {
      templateList.innerHTML = '<div class="info-text" style="padding: 1rem; text-align: center; color: #9ca3af;">No templates saved yet. Create charts and save them as a template to reuse later.</div>';
    } else {
      templates.forEach(t => {
        const item = document.createElement("div");
        item.className = "template-item";
        item.dataset.id = t.id;
        
        const itemHeader = document.createElement("div");
        itemHeader.className = "template-item-header";
        
        const itemName = document.createElement("div");
        itemName.className = "template-item-name";
        itemName.style.color = "#f9fafb";
        itemName.textContent = t.name;
        
        const itemActions = document.createElement("div");
        itemActions.className = "template-item-actions";
        
        const loadBtn = document.createElement("button");
        loadBtn.className = "btn btn-xs btn-ghost tm-load-btn";
        loadBtn.dataset.id = t.id;
        loadBtn.textContent = "Load";
        loadBtn.style.color = "#60a5fa";
        
        const exportBtn = document.createElement("button");
        exportBtn.className = "btn btn-xs btn-ghost tm-export-btn";
        exportBtn.dataset.id = t.id;
        exportBtn.textContent = "Export";
        exportBtn.style.color = "#a78bfa";
        
        const deleteBtn = document.createElement("button");
        deleteBtn.className = "btn btn-xs btn-ghost tm-delete-btn";
        deleteBtn.dataset.id = t.id;
        deleteBtn.style.color = "#f87171";
        deleteBtn.textContent = "Delete";
        
        itemActions.appendChild(loadBtn);
        itemActions.appendChild(exportBtn);
        itemActions.appendChild(deleteBtn);
        
        itemHeader.appendChild(itemName);
        itemHeader.appendChild(itemActions);
        item.appendChild(itemHeader);
        
        if (t.description) {
          const itemDesc = document.createElement("div");
          itemDesc.className = "template-item-desc";
          itemDesc.style.color = "#d1d5db";
          itemDesc.textContent = t.description;
          item.appendChild(itemDesc);
        }
        
        const itemMeta = document.createElement("div");
        itemMeta.className = "template-item-meta";
        itemMeta.style.color = "#9ca3af";
        const chartPlural = t.charts.length !== 1 ? 's' : '';
        itemMeta.textContent = t.charts.length + " chart" + chartPlural + " · Created " + new Date(t.createdAt).toLocaleDateString();
        item.appendChild(itemMeta);
        
        templateList.appendChild(item);
      });
    }
    
    templateCard.appendChild(cardHeader);
    templateCard.appendChild(templateList);
    
    body.appendChild(buttonsRow);
    body.appendChild(templateCard);
    
    modalContent.appendChild(header);
    modalContent.appendChild(body);
    modal.appendChild(modalContent);
    
    document.body.appendChild(modal);

    modal.querySelector("#tmCloseBtn").addEventListener("click", function() {
      document.body.removeChild(modal);
    });

    modal.addEventListener("click", function(e) {
      if (e.target === modal) document.body.removeChild(modal);
    });

    modal.querySelector("#tmSaveNewBtn").addEventListener("click", function() {
      const name = prompt("Template name:");
      if (!name) return;
      const description = prompt("Description (optional):") || "";
      const saved = saveAsTemplate(name, description);
      if (saved) {
        document.body.removeChild(modal);
        openTemplateManager();
      } else {
        alert("Failed to save template");
      }
    });

    modal.querySelector("#tmImportBtn").addEventListener("click", function() {
      modal.querySelector("#tmImportFile").click();
    });
    
    modal.querySelector("#tmImportFile").addEventListener("change", function(e) {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function(evt) {
        const imported = importTemplateJson(evt.target.result);
        if (imported) {
          document.body.removeChild(modal);
          openTemplateManager();
        } else {
          alert("Failed to import template. Check console for details.");
        }
      };
      reader.readAsText(file);
    });

    modal.querySelectorAll(".tm-load-btn").forEach(function(btn) {
      btn.addEventListener("click", function() {
        if (loadTemplate(btn.dataset.id)) document.body.removeChild(modal);
      });
    });

    modal.querySelectorAll(".tm-export-btn").forEach(function(btn) {
      btn.addEventListener("click", function() {
        exportTemplateJson(btn.dataset.id);
      });
    });

    modal.querySelectorAll(".tm-delete-btn").forEach(function(btn) {
      btn.addEventListener("click", function() {
        if (confirm("Delete this template? This cannot be undone.")) {
          deleteTemplate(btn.dataset.id);
          document.body.removeChild(modal);
          openTemplateManager();
        }
      });
    });
  }

  // ── Chart Types & Palette ─────────────────────────────────────────────────

  const CHART_TYPES = [
    { value: "bar",          label: "Bar" },
    { value: "horizontalBar", label: "Horizontal Bar" },
    { value: "line",         label: "Line" },
    { value: "pie",          label: "Pie" },
    { value: "doughnut",     label: "Doughnut" },
    { value: "radar",        label: "Radar" },
    { value: "polarArea",    label: "Polar Area" },
    { value: "scatter",      label: "Scatter" },
    { value: "bubble",       label: "Bubble" },
  ];

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

    const isIndexed = ["bar","line","radar","polarArea","scatter","bubble"].includes(type);
    const realType  = type === "horizontalBar" ? "bar" : type;

    const isScatterType = ["scatter", "bubble"].includes(type);
    const chartData = isScatterType 
      ? values.map((y, i) => ({ x: i, y, r: type === "bubble" ? Math.sqrt(y) * 2 : undefined }))
      : values;

    const config = {
      type: realType,
      data: {
        labels: isScatterType ? undefined : labels,
        datasets: [{
          label: chartDef.title || "Count",
          data: chartData,
          backgroundColor: isIndexed ? colors.map(c => c + "cc") : colors,
          borderColor:     isIndexed ? colors : colors.map(c => c + "99"),
          borderWidth: 1,
          pointBackgroundColor: isScatterType ? colors : undefined,
          pointBorderColor: isScatterType ? colors.map(c => c + "99") : undefined,
          pointRadius: type === "scatter" ? 6 : undefined,
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
          tooltip: isScatterType ? {
            callbacks: {
              label: function(context) {
                const index = context.parsed.x;
                const label = labels[index] || 'Unknown';
                const value = context.parsed.y;
                return label + ": " + value;
              }
            }
          } : undefined,
        },
        scales: isIndexed ? {
          x: { 
            ticks: { 
              color: "#9ca3af",
              callback: isScatterType ? (val, index) => labels[index] || val : undefined
            }, 
            grid: { color: "rgba(255,255,255,0.06)" } 
          },
          y: { ticks: { color: "#9ca3af" }, grid: { color: "rgba(255,255,255,0.06)" } },
        } : undefined,
      },
    };

    return config;
  }

  function renderChartToCanvas(canvasId, chartDef) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

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

    const chartsHtml = reportCharts.map(chartDef => {
      const id     = uid();
      const config = buildChartConfig(chartDef);
      const isPie  = ["pie","doughnut","polarArea","radar"].includes(chartDef.type);
      return '\n  <div class="chart-card">\n    <h2 class="chart-title">' + escHtml(chartDef.title || "Chart") + '</h2>\n    <p class="chart-meta">Grouped by: <strong>' + escHtml(chartDef.fieldLabel || chartDef.field) + '</strong> &mdash; ' + chartDef.data.length + ' distinct values</p>\n    <div class="chart-wrap ' + (isPie ? "chart-wrap--pie" : "") + '">\n      <canvas id="' + id + '"></canvas>\n    </div>\n  </div>\n  <script>\n    (function(){\n      const ctx = document.getElementById(\'' + id + '\').getContext(\'2d\');\n      new Chart(ctx, ' + JSON.stringify(config) + ');\n    })();\n  <\/script>';
    }).join("\n");

    const html = '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>' + escHtml(reportTitle) + '</title>\n<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"><\/script>\n<style>\n  *,*::before,*::after{box-sizing:border-box}\n  body{font-family:system-ui,-apple-system,sans-serif;background:#0f172a;color:#f9fafb;margin:0;padding:1.5rem 2rem;min-height:100vh}\n  h1{font-size:1.4rem;margin:0 0 0.25rem;font-weight:700}\n  .report-meta{font-size:0.78rem;color:#6b7280;margin-bottom:2rem}\n  .charts-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(480px,1fr));gap:1.5rem}\n  .chart-card{background:#1e293b;border-radius:0.75rem;border:1px solid rgba(148,163,184,0.15);padding:1.25rem 1.5rem}\n  .chart-title{font-size:1rem;font-weight:600;margin:0 0 0.2rem;color:#f9fafb}\n  .chart-meta{font-size:0.72rem;color:#6b7280;margin:0 0 1rem}\n  .chart-wrap{position:relative;height:300px}\n  .chart-wrap--pie{height:280px;max-width:380px;margin:0 auto}\n  @media print{\n    body{background:#fff;color:#111;padding:0.5rem}\n    .chart-card{background:#f9fafb;border-color:#e5e7eb;break-inside:avoid}\n    .chart-title,.chart-meta{color:#111}\n    .report-meta{color:#6b7280}\n  }\n</style>\n</head>\n<body>\n<h1>' + escHtml(reportTitle) + '</h1>\n<div class="report-meta">Generated ' + new Date().toLocaleString() + ' &mdash; ' + reportCharts.length + ' chart' + (reportCharts.length !== 1 ? "s" : "") + '</div>\n<div class="charts-grid">\n' + chartsHtml + '\n</div>\n</body>\n</html>';

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
    root.innerHTML = '<div class="rb-header"><div class="rb-header-left"><input type="text" class="rb-title-input" id="rbTitleInput" value="' + escHtml(reportTitle) + '" placeholder="Report title…"></div><div class="rb-header-right"><button class="btn btn-secondary btn-sm" id="rbTemplatesBtn">📋 Templates</button><button class="btn btn-secondary btn-sm" id="rbClearBtn" ' + (!reportCharts.length ? "disabled" : "") + '>Clear all</button><button class="btn btn-sm" id="rbExportBtn" ' + (!reportCharts.length ? "disabled" : "") + '>⬆ Export HTML</button></div></div><div class="rb-body"><div class="rb-builder"><div class="rb-section-title">ADD CHART</div>' + (!hasData ? '<div class="rb-no-data"><div class="rb-no-data-icon">📊</div><div class="rb-no-data-msg">No data loaded.</div><div class="rb-no-data-sub">Load a CSV in the <strong>CSV Workbench</strong> first, then come back here to build charts.</div></div>' : '<div class="rb-field-row"><label class="rb-label">Column to group by</label><select class="rb-select" id="rbFieldSelect"><option value="">Select column…</option>' + sessionData.visibleFields.filter(f => f !== "StatusNote").map(f => '<option value="' + escHtml(f) + '">' + escHtml(sessionData.displayNames[f] || f) + '</option>').join("") + '</select></div><div class="rb-field-row"><label class="rb-label">Chart type</label><select class="rb-select" id="rbTypeSelect">' + CHART_TYPES.map(t => '<option value="' + t.value + '">' + t.label + '</option>').join("") + '</select></div><div class="rb-field-row"><label class="rb-label">Chart title (optional)</label><input type="text" class="rb-input" id="rbChartTitle" placeholder="e.g. Fails by Department"></div><div class="rb-field-row"><label class="rb-label">Max groups to show</label><select class="rb-select" id="rbMaxGroups"><option value="0">All</option><option value="5">Top 5</option><option value="10" selected>Top 10</option><option value="15">Top 15</option><option value="20">Top 20</option><option value="25">Top 25</option><option value="30">Top 30</option><option value="50">Top 50</option><option value="100">Top 100</option></select></div><div id="rbPreviewArea" class="rb-preview-area"><div class="rb-preview-hint">Select a column to preview.</div></div><button class="btn w-full mt-3" id="rbAddChartBtn" disabled>+ Add to report</button>') + '</div><div class="rb-canvas" id="rbCanvas">' + (!reportCharts.length ? '<div class="rb-canvas-empty"><div class="rb-empty-icon">📈</div><div class="rb-empty-text">Charts you add will appear here.</div></div>' : "") + '</div></div>';
    container.appendChild(root);

    const titleInput = root.querySelector("#rbTitleInput");
    titleInput.addEventListener("input", function() { reportTitle = titleInput.value; });

    root.querySelector("#rbTemplatesBtn").addEventListener("click", openTemplateManager);

    root.querySelector("#rbExportBtn").addEventListener("click", exportReportHtml);
    root.querySelector("#rbClearBtn").addEventListener("click", function() {
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
        previewArea.innerHTML = '<div class="rb-preview-hint">Select a column to preview.</div>';
        return;
      }

      let data = computeGroupCount(sessionData.rows, field);
      if (max > 0) data = data.slice(0, max);
      previewData = data;

      if (!data.length) {
        previewArea.innerHTML = '<div class="rb-preview-hint">No data in this column.</div>';
        return;
      }

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

      setTimeout(function() { renderChartToCanvas(canvasId, chartDef); }, 0);
      addBtn.disabled = false;
    }

    fieldSelect.addEventListener("change", updatePreview);
    typeSelect.addEventListener("change",  updatePreview);
    maxGroupsSel.addEventListener("change", updatePreview);
    chartTitleIn.addEventListener("input",  updatePreview);

    addBtn.addEventListener("click", function() {
      const field      = fieldSelect.value;
      const type       = typeSelect.value;
      const max        = parseInt(maxGroupsSel.value) || 0;
      const fieldLabel = sessionData.displayNames[field] || field;
      const title      = chartTitleIn.value.trim() || fieldLabel;

      if (!field || !previewData) return;

      const chartDef = {
        id:         uid(),
        type, field, fieldLabel, title,
        maxGroups:  max,
        data:       previewData,
      };

      reportCharts.push(chartDef);
      renderChartCard(chartDef);

      fieldSelect.value    = "";
      chartTitleIn.value   = "";
      previewArea.innerHTML = '<div class="rb-preview-hint">Select a column to preview.</div>';
      addBtn.disabled = true;
      previewData = null;

      root.querySelector("#rbExportBtn").disabled = false;
      root.querySelector("#rbClearBtn").disabled  = false;

      const emptyEl = root.querySelector(".rb-canvas-empty");
      if (emptyEl) emptyEl.remove();
    });

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

    card.innerHTML = '<div class="rb-chart-card-header"><div class="rb-chart-card-title">' + escHtml(chartDef.title || "Chart") + '</div><div class="rb-chart-card-meta">Grouped by ' + escHtml(chartDef.fieldLabel || chartDef.field) + ' &mdash; ' + chartDef.data.length + ' values</div></div><div class="rb-chart-wrap ' + (isPie ? "rb-chart-wrap--pie" : "") + '"><canvas id="' + canvasId + '"></canvas></div><div class="rb-chart-card-footer"><button class="btn btn-ghost rb-remove-btn" data-id="' + chartDef.id + '">✕ Remove</button></div>';

    card.querySelector(".rb-remove-btn").addEventListener("click", function() {
      reportCharts = reportCharts.filter(c => c.id !== chartDef.id);
      if (chartInstances[canvasId]) {
        chartInstances[canvasId].destroy();
        delete chartInstances[canvasId];
      }
      card.remove();
      const rbCanvas = document.getElementById("rbCanvas");
      if (rbCanvas && !rbCanvas.querySelector(".rb-chart-card")) {
        rbCanvas.innerHTML = '<div class="rb-canvas-empty"><div class="rb-empty-icon">📈</div><div class="rb-empty-text">Charts you add will appear here.</div></div>';
        document.getElementById("rbExportBtn").disabled = true;
        document.getElementById("rbClearBtn").disabled  = true;
      }
    });

    canvas.appendChild(card);
    setTimeout(function() { renderChartToCanvas(canvasId, chartDef); }, 0);
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