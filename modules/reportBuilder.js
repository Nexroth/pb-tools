// modules/reportBuilder.js

(function () {

  const meta = {
    title:    "Report Builder",
    subtitle: "Build charts from your CSV data and export a shareable HTML report.",
  };

  let reportCharts = [];
  let reportTitle  = "PB Tools Report";
  let chartInstances = {};

  // Comparison mode state
  let comparisonMode = {
    enabled: false,
    datasetA: { name: "", rows: [], fields: [], displayNames: {} },
    datasetB: { name: "", rows: [], fields: [], displayNames: {} },
    displayMode: "overlay", // "overlay" or "sideBySide"
  };

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
        note: c.note || "",
        showLegend: c.showLegend !== false,
        valueColumn: c.valueColumn || "",
        aggType: c.aggType || "count"
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
      const valueColumn = chartConfig.valueColumn || "";
      const aggType = chartConfig.aggType || "count";
      
      // Use aggregation if valueColumn specified
      let chartData = computeAggregation(sessionData.rows, field, valueColumn, aggType);
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
        note: chartConfig.note || "",
        showLegend: chartConfig.showLegend !== false,
        valueColumn,
        aggType
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
    
    const importBtn = document.createElement("button");
    importBtn.className = "btn btn-secondary btn-sm";
    importBtn.id = "tmImportBtn";
    importBtn.textContent = "📥 Import Template JSON";
    
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
        loadBtn.className = "btn btn-xs btn-ghost btn-text-info tm-load-btn";
        loadBtn.dataset.id = t.id;
        loadBtn.textContent = "Load";
        
        const exportBtn = document.createElement("button");
        exportBtn.className = "btn btn-xs btn-ghost btn-text-accent tm-export-btn";
        exportBtn.dataset.id = t.id;
        exportBtn.textContent = "Export";
        
        const deleteBtn = document.createElement("button");
        deleteBtn.className = "btn btn-xs btn-ghost btn-text-danger tm-delete-btn";
        deleteBtn.dataset.id = t.id;
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
    
    document.getElementById("app").appendChild(modal);

    modal.querySelector("#tmCloseBtn").addEventListener("click", function() {
      modal.parentNode.removeChild(modal);
    });

    modal.addEventListener("click", function(e) {
      if (e.target === modal) modal.parentNode.removeChild(modal);
    });

    modal.querySelector("#tmSaveNewBtn").addEventListener("click", function() {
      const name = prompt("Template name:");
      if (!name) return;
      const description = prompt("Description (optional):") || "";
      const saved = saveAsTemplate(name, description);
      if (saved) {
        modal.parentNode.removeChild(modal);
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
          modal.parentNode.removeChild(modal);
          openTemplateManager();
        } else {
          alert("Failed to import template. Check console for details.");
        }
      };
      reader.readAsText(file);
    });

    modal.querySelectorAll(".tm-load-btn").forEach(function(btn) {
      btn.addEventListener("click", function() {
        if (loadTemplate(btn.dataset.id)) modal.parentNode.removeChild(modal);
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
          modal.parentNode.removeChild(modal);
          openTemplateManager();
        }
      });
    });
  }

  function openChartEditor(chartId) {
    const chartDef = reportCharts.find(c => c.id === chartId);
    if (!chartDef) return;

    const modal = document.createElement("div");
    modal.className = "modal-overlay";
    
    const modalContent = document.createElement("div");
    modalContent.className = "modal-content";
    modalContent.style.maxWidth = "500px";
    
    const header = document.createElement("div");
    header.className = "modal-header";
    const headerTitle = document.createElement("h3");
    headerTitle.textContent = "Edit Chart";
    headerTitle.style.cssText = "margin: 0; font-size: 1.1rem; color: #f9fafb;";
    const closeBtn = document.createElement("button");
    closeBtn.className = "modal-close";
    closeBtn.id = "editCloseBtn";
    closeBtn.innerHTML = "×";
    header.appendChild(headerTitle);
    header.appendChild(closeBtn);
    
    const body = document.createElement("div");
    body.className = "modal-body";
    
    const titleGroup = document.createElement("div");
    titleGroup.style.marginBottom = "1rem";
    const titleLabel = document.createElement("label");
    titleLabel.style.cssText = "display: block; color: #f9fafb; font-size: 0.85rem; margin-bottom: 0.5rem; font-weight: 500;";
    titleLabel.textContent = "Chart Title";
    const titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.id = "editChartTitle";
    titleInput.setAttribute("autocomplete", "off");
    titleInput.value = chartDef.title || '';
    titleInput.placeholder = "e.g., Failures by Department";
    titleInput.style.cssText = "width: 100%; background: #1e293b; border: 1px solid #334155; color: #f9fafb; padding: 0.5rem 0.75rem; border-radius: 0.375rem; font-size: 0.9rem; outline: none; font-family: inherit; -webkit-text-fill-color: #f9fafb;";
    titleGroup.appendChild(titleLabel);
    titleGroup.appendChild(titleInput);
    
    const noteGroup = document.createElement("div");
    noteGroup.style.marginBottom = "1rem";
    const noteLabel = document.createElement("label");
    noteLabel.style.cssText = "display: block; color: #f9fafb; font-size: 0.85rem; margin-bottom: 0.5rem; font-weight: 500;";
    noteLabel.textContent = "Custom Note (optional)";
    const noteTextarea = document.createElement("textarea");
    noteTextarea.id = "editChartNote";
    noteTextarea.setAttribute("autocomplete", "off");
    noteTextarea.value = chartDef.note || '';
    noteTextarea.placeholder = "Add context or insights about this chart...";
    noteTextarea.style.cssText = "width: 100%; background: #1e293b; border: 1px solid #334155; color: #f9fafb; padding: 0.5rem 0.75rem; border-radius: 0.375rem; min-height: 80px; resize: vertical; font-size: 0.9rem; font-family: inherit; outline: none; -webkit-text-fill-color: #f9fafb;";
    noteGroup.appendChild(noteLabel);
    noteGroup.appendChild(noteTextarea);
    
    const legendGroup = document.createElement("div");
    legendGroup.style.marginBottom = "1.5rem";
    const legendLabel = document.createElement("label");
    legendLabel.style.cssText = "display: flex; align-items: center; color: #f9fafb; font-size: 0.85rem; cursor: pointer;";
    const legendCheck = document.createElement("input");
    legendCheck.type = "checkbox";
    legendCheck.id = "editShowLegend";
    legendCheck.checked = chartDef.showLegend !== false;
    legendCheck.style.cssText = "margin-right: 0.5rem; cursor: pointer;";
    legendLabel.appendChild(legendCheck);
    legendLabel.appendChild(document.createTextNode("Show legend"));
    legendGroup.appendChild(legendLabel);
    
    const actions = document.createElement("div");
    actions.style.cssText = "display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 1.5rem;";
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "btn btn-secondary btn-sm";
    cancelBtn.textContent = "Cancel";
    const saveBtn = document.createElement("button");
    saveBtn.className = "btn btn-sm";
    saveBtn.textContent = "Save Changes";
    actions.appendChild(cancelBtn);
    actions.appendChild(saveBtn);
    
    body.appendChild(titleGroup);
    body.appendChild(noteGroup);
    body.appendChild(legendGroup);
    body.appendChild(actions);
    
    modalContent.appendChild(header);
    modalContent.appendChild(body);
    modal.appendChild(modalContent);
    
    document.getElementById("app").appendChild(modal);

    const closeModal = function() { modal.parentNode.removeChild(modal); };
    
    closeBtn.addEventListener("click", closeModal);
    cancelBtn.addEventListener("click", closeModal);
    modal.addEventListener("click", function(e) {
      if (e.target === modal) closeModal();
    });

    saveBtn.addEventListener("click", function() {
      const newTitle = titleInput.value.trim();
      const newNote = noteTextarea.value.trim();
      const showLegend = legendCheck.checked;
      
      chartDef.title = newTitle || chartDef.fieldLabel || chartDef.field;
      chartDef.note = newNote;
      chartDef.showLegend = showLegend;
      
      const oldCard = document.querySelector('[data-chart-id="' + chartId + '"]');
      if (oldCard) {
        oldCard.remove();
        renderChartCard(chartDef);
      }
      
      closeModal();
    });
  }

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

  // Enhanced aggregation using CSV Workbench engine
  function computeAggregation(rows, groupBy, valueColumn, aggType) {
    const csvApi = getCsvApi();
    
    // If no value column specified, use simple count
    if (!valueColumn || aggType === "count") {
      return computeGroupCount(rows, groupBy);
    }
    
    // Use CSV Workbench aggregation engine if available
    if (csvApi?.computeAggregation) {
      const result = csvApi.computeAggregation({
        groupBy,
        aggregations: [{ field: valueColumn, type: aggType }],
        includePercentage: false
      });
      
      if (result?.rows) {
        // Transform to chart format: { label, value }
        const aggLabel = Object.keys(result.rows[0]?.metrics || {})[0];
        return result.rows.map(r => ({
          label: r.value,
          value: r.metrics[aggLabel] || 0
        }));
      }
    }
    
    // Fallback to simple count if API not available
    return computeGroupCount(rows, groupBy);
  }

  function escHtml(s) {
    return String(s)
      .replace(/&/g,"&amp;").replace(/</g,"&lt;")
      .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  function uid() {
    return "chart_" + Math.random().toString(36).slice(2, 9);
  }

  function buildStandardUI(sessionData, hasData) {
    if (!hasData) {
      return `
        <div class="rb-body">
          <div class="rb-builder">
            <div class="rb-section-title">ADD CHART</div>
            <div class="rb-no-data">
              <div class="rb-no-data-icon">📊</div>
              <div class="rb-no-data-msg">No data loaded.</div>
              <div class="rb-no-data-sub">Load a CSV in the <strong>CSV Workbench</strong> first, then come back here to build charts.</div>
            </div>
          </div>
          <div class="rb-canvas" id="rbCanvas">
            <div class="rb-canvas-empty">
              <div class="rb-empty-icon">📈</div>
              <div class="rb-empty-text">Charts you add will appear here.</div>
            </div>
          </div>
        </div>
      `;
    }

    // Build field options
    const fieldOptions = sessionData.visibleFields
      .filter(f => f !== "StatusNote")
      .map(f => `<option value="${escHtml(f)}">${escHtml(sessionData.displayNames[f] || f)}</option>`)
      .join("");

    // Build chart type options
    const chartTypeOptions = CHART_TYPES
      .map(t => `<option value="${t.value}">${t.label}</option>`)
      .join("");

    return `
      <div class="rb-body">
        <div class="rb-builder">
          <div class="rb-section-title">ADD CHART</div>
          
          <div class="rb-field-row">
            <label class="rb-label">Column to group by</label>
            <select class="rb-select" id="rbFieldSelect">
              <option value="">Select column…</option>
              ${fieldOptions}
            </select>
          </div>

          <div class="rb-field-row">
            <label class="rb-label">Value to chart</label>
            <select class="rb-select" id="rbValueSelect">
              <option value="">Count (default)</option>
              ${fieldOptions}
            </select>
          </div>

          <div class="rb-field-row">
            <label class="rb-label">Aggregation</label>
            <select class="rb-select" id="rbAggSelect">
              <option value="count">COUNT</option>
              <option value="sum">SUM</option>
              <option value="avg" selected>AVG</option>
              <option value="min">MIN</option>
              <option value="max">MAX</option>
            </select>
          </div>

          <div class="rb-field-row">
            <label class="rb-label">Chart type</label>
            <select class="rb-select" id="rbTypeSelect">
              ${chartTypeOptions}
            </select>
          </div>

          <div class="rb-field-row">
            <label class="rb-label">Chart title (optional)</label>
            <input type="text" class="rb-input" id="rbChartTitle" placeholder="e.g. Avg Click Rate by Department">
          </div>

          <div class="rb-field-row">
            <label class="rb-label">Max groups to show</label>
            <select class="rb-select" id="rbMaxGroups">
              <option value="0">All</option>
              <option value="5">Top 5</option>
              <option value="10" selected>Top 10</option>
              <option value="15">Top 15</option>
              <option value="20">Top 20</option>
              <option value="25">Top 25</option>
              <option value="30">Top 30</option>
              <option value="50">Top 50</option>
              <option value="100">Top 100</option>
            </select>
          </div>

          <div id="rbPreviewArea" class="rb-preview-area">
            <div class="rb-preview-hint">Select a column to preview.</div>
          </div>

          <button class="btn w-full mt-3" id="rbAddChartBtn" disabled>+ Add to report</button>
        </div>

        <div class="rb-canvas" id="rbCanvas">
          ${!reportCharts.length ? `
            <div class="rb-canvas-empty">
              <div class="rb-empty-icon">📈</div>
              <div class="rb-empty-text">Charts you add will appear here.</div>
            </div>
          ` : ""}
        </div>
      </div>
    `;
  }

  function buildComparisonUI() {
    const hasA = comparisonMode.datasetA.rows.length > 0;
    const hasB = comparisonMode.datasetB.rows.length > 0;
    const bothLoaded = hasA && hasB;
    
    return `
      <div class="rb-body">
        <div class="rb-builder">
          <div class="rb-section-title">COMPARISON DATA</div>
          
          <div class="rb-comparison-datasets">
            <div class="rb-dataset-card" id="rbDatasetCardA">
              <div class="rb-dataset-header" style="background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);">
                <span>Dataset A</span>
              </div>
              <div class="rb-dataset-body rb-dropzone" data-dataset="A">
                ${hasA ? `
                  <div class="rb-dataset-info">
                    <strong>${escHtml(comparisonMode.datasetA.name)}</strong>
                    <div class="info-text">${comparisonMode.datasetA.rows.length} rows</div>
                  </div>
                  <button class="btn btn-xs btn-secondary" id="rbClearA">Clear</button>
                ` : `
                  <div class="rb-dropzone-icon">📁</div>
                  <div class="rb-dropzone-text">Drop CSV here or</div>
                  <input type="file" id="rbFileA" accept=".csv" style="display:none;">
                  <button class="btn btn-sm" id="rbLoadA">Browse</button>
                `}
              </div>
            </div>
            
            <div class="rb-dataset-card" id="rbDatasetCardB">
              <div class="rb-dataset-header" style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);">
                <span>Dataset B</span>
              </div>
              <div class="rb-dataset-body rb-dropzone" data-dataset="B">
                ${hasB ? `
                  <div class="rb-dataset-info">
                    <strong>${escHtml(comparisonMode.datasetB.name)}</strong>
                    <div class="info-text">${comparisonMode.datasetB.rows.length} rows</div>
                  </div>
                  <button class="btn btn-xs btn-secondary" id="rbClearB">Clear</button>
                ` : `
                  <div class="rb-dropzone-icon">📁</div>
                  <div class="rb-dropzone-text">Drop CSV here or</div>
                  <input type="file" id="rbFileB" accept=".csv" style="display:none;">
                  <button class="btn btn-sm" id="rbLoadB">Browse</button>
                `}
              </div>
            </div>
          </div>
          
          ${bothLoaded ? `
            <div class="rb-field-row" style="margin-top: 1.5rem;">
              <label class="rb-label">Display mode</label>
              <select class="rb-select" id="rbDisplayMode">
                <option value="overlay" ${comparisonMode.displayMode === 'overlay' ? 'selected' : ''}>Overlay (both datasets in one chart)</option>
                <option value="sideBySide" ${comparisonMode.displayMode === 'sideBySide' ? 'selected' : ''}>Side-by-side (separate charts)</option>
              </select>
            </div>
            
            <div class="rb-field-row">
              <label class="rb-label">Column to compare</label>
              <select class="rb-select" id="rbCompFieldSelect">
                <option value="">Select column…</option>
                ${getCommonFields().map(f => '<option value="' + escHtml(f) + '">' + escHtml(f) + '</option>').join("")}
              </select>
            </div>
            
            <div class="rb-field-row">
              <label class="rb-label">Chart type</label>
              <select class="rb-select" id="rbCompTypeSelect">
                ${CHART_TYPES.map(t => '<option value="' + t.value + '">' + t.label + '</option>').join("")}
              </select>
            </div>
            
            <div class="rb-field-row">
              <label class="rb-label">Chart title (optional)</label>
              <input type="text" class="rb-input" id="rbCompChartTitle" placeholder="e.g. A vs B Comparison">
            </div>
            
            <div id="rbCompPreviewArea" class="rb-preview-area">
              <div class="rb-preview-hint">Select a column to preview.</div>
            </div>
            
            <button class="btn w-full mt-3" id="rbAddCompChartBtn" disabled>+ Add comparison chart</button>
            
            <div class="rb-comparison-stats" id="rbCompStats" style="margin-top: 1.5rem;">
            </div>
          ` : `
            <div class="info-text" style="margin-top: 1rem; text-align: center;">
              Load both datasets to start comparing
            </div>
          `}
        </div>
        
        <div class="rb-canvas" id="rbCanvas">
          ${!reportCharts.length ? '<div class="rb-canvas-empty"><div class="rb-empty-icon">📈</div><div class="rb-empty-text">Comparison charts will appear here.</div></div>' : ""}
        </div>
      </div>
    `;
  }

  function getCommonFields() {
    if (!comparisonMode.datasetA.fields.length || !comparisonMode.datasetB.fields.length) {
      return [];
    }
    return comparisonMode.datasetA.fields.filter(f => 
      comparisonMode.datasetB.fields.includes(f) && f !== "StatusNote"
    );
  }

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
            display: chartDef.showLegend !== false ? !isIndexed : false,
            labels: { color: "#e5e7eb", font: { size: 11 } },
          },
          title: {
            display: false,
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

  function exportReportHtml() {
    if (!reportCharts.length) return;

    const chartsHtml = reportCharts.map(chartDef => {
      if (chartDef.isComparison) {
        // Handle comparison charts
        const id = uid();
        
        if (chartDef.mode === "overlay") {
          // Single overlay chart
          const allLabels = [...new Set([...chartDef.dataA.map(d => d.label), ...chartDef.dataB.map(d => d.label)])];
          const valuesA = allLabels.map(label => {
            const found = chartDef.dataA.find(d => d.label === label);
            return found ? found.value : 0;
          });
          const valuesB = allLabels.map(label => {
            const found = chartDef.dataB.find(d => d.label === label);
            return found ? found.value : 0;
          });
          
          const config = {
            type: chartDef.type === "horizontalBar" ? "bar" : chartDef.type,
            data: {
              labels: allLabels,
              datasets: [
                {
                  label: comparisonMode.datasetA.name || "Dataset A",
                  data: valuesA,
                  backgroundColor: "#3b82f6",
                  borderColor: "#2563eb",
                  borderWidth: 1,
                },
                {
                  label: comparisonMode.datasetB.name || "Dataset B",
                  data: valuesB,
                  backgroundColor: "#f59e0b",
                  borderColor: "#d97706",
                  borderWidth: 1,
                }
              ]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              indexAxis: chartDef.type === "horizontalBar" ? "y" : "x",
              plugins: {
                title: { display: !!chartDef.title, text: chartDef.title || "", color: "#f9fafb" },
                legend: { display: true, labels: { color: "#f9fafb" } }
              },
              scales: ["bar","line","horizontalBar"].includes(chartDef.type) ? {
                x: { ticks: { color: "#9ca3af" }, grid: { color: "rgba(148,163,184,0.1)" } },
                y: { ticks: { color: "#9ca3af" }, grid: { color: "rgba(148,163,184,0.1)" } }
              } : undefined
            }
          };
          
          return '\n  <div class="chart-card">\n    <h2 class="chart-title">' + escHtml(chartDef.title || "Comparison Chart") + '</h2>\n    <p class="chart-meta">Comparison: <strong>' + escHtml(chartDef.field) + '</strong> (Overlay mode)</p>\n    <div class="chart-wrap">\n      <canvas id="' + id + '"></canvas>\n    </div>\n  </div>\n  <script>\n    (function(){\n      const ctx = document.getElementById(\'' + id + '\').getContext(\'2d\');\n      new Chart(ctx, ' + JSON.stringify(config) + ');\n    })();\n  <\/script>';
        } else {
          // Side-by-side charts
          const idA = uid();
          const idB = uid();
          const configA = buildChartConfig({ type: chartDef.type, data: chartDef.dataA, title: comparisonMode.datasetA.name });
          const configB = buildChartConfig({ type: chartDef.type, data: chartDef.dataB, title: comparisonMode.datasetB.name });
          
          return '\n  <div class="chart-card" style="grid-column: 1 / -1;">\n    <h2 class="chart-title">' + escHtml(chartDef.title || "Comparison Chart") + '</h2>\n    <p class="chart-meta">Comparison: <strong>' + escHtml(chartDef.field) + '</strong> (Side-by-side mode)</p>\n    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">\n      <div class="chart-wrap">\n        <canvas id="' + idA + '"></canvas>\n      </div>\n      <div class="chart-wrap">\n        <canvas id="' + idB + '"></canvas>\n      </div>\n    </div>\n  </div>\n  <script>\n    (function(){\n      const ctxA = document.getElementById(\'' + idA + '\').getContext(\'2d\');\n      const ctxB = document.getElementById(\'' + idB + '\').getContext(\'2d\');\n      new Chart(ctxA, ' + JSON.stringify(configA) + ');\n      new Chart(ctxB, ' + JSON.stringify(configB) + ');\n    })();\n  <\/script>';
        }
      } else {
        // Standard chart
        const id     = uid();
        const config = buildChartConfig(chartDef);
        const isPie  = ["pie","doughnut","polarArea","radar"].includes(chartDef.type);
        const noteHtml = chartDef.note ? '<p class="chart-note">' + escHtml(chartDef.note) + '</p>' : '';
        
        return '\n  <div class="chart-card">\n    <h2 class="chart-title">' + escHtml(chartDef.title || "Chart") + '</h2>\n    <p class="chart-meta">Grouped by: <strong>' + escHtml(chartDef.fieldLabel || chartDef.field) + '</strong> &mdash; ' + chartDef.data.length + ' distinct values</p>\n    <div class="chart-wrap ' + (isPie ? "chart-wrap--pie" : "") + '">\n      <canvas id="' + id + '"></canvas>\n    </div>\n    ' + noteHtml + '\n  </div>\n  <script>\n    (function(){\n      const ctx = document.getElementById(\'' + id + '\').getContext(\'2d\');\n      new Chart(ctx, ' + JSON.stringify(config) + ');\n    })();\n  <\/script>';
      }
    }).join("\n");

    const html = '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>' + escHtml(reportTitle) + '</title>\n<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"><\/script>\n<style>\n  *,*::before,*::after{box-sizing:border-box}\n  body{font-family:system-ui,-apple-system,sans-serif;background:#0f172a;color:#f9fafb;margin:0;padding:1.5rem 2rem;min-height:100vh}\n  h1{font-size:1.4rem;margin:0 0 0.25rem;font-weight:700}\n  .report-meta{font-size:0.78rem;color:#6b7280;margin-bottom:2rem}\n  .charts-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(480px,1fr));gap:1.5rem}\n  .chart-card{background:#1e293b;border-radius:0.75rem;border:1px solid rgba(148,163,184,0.15);padding:1.25rem 1.5rem}\n  .chart-title{font-size:1rem;font-weight:600;margin:0 0 0.2rem;color:#f9fafb}\n  .chart-meta{font-size:0.72rem;color:#6b7280;margin:0 0 1rem}\n  .chart-wrap{position:relative;height:300px}\n  .chart-wrap--pie{height:280px;max-width:380px;margin:0 auto}\n  .chart-note{background:rgba(167,139,250,0.1);border-left:3px solid #a78bfa;padding:0.75rem 1rem;margin:1rem 0 0;border-radius:0.375rem;font-size:0.85rem;line-height:1.5;color:#9ca3af;font-style:italic}\n  @media print{\n    body{background:#fff;color:#111;padding:0.5rem}\n    .chart-card{background:#f9fafb;border-color:#e5e7eb;break-inside:avoid}\n    .chart-title,.chart-meta{color:#111}\n    .report-meta{color:#6b7280}\n  }\n</style>\n</head>\n<body>\n<h1>' + escHtml(reportTitle) + '</h1>\n<div class="report-meta">Generated ' + new Date().toLocaleString() + ' &mdash; ' + reportCharts.length + ' chart' + (reportCharts.length !== 1 ? "s" : "") + '</div>\n<div class="charts-grid">\n' + chartsHtml + '\n</div>\n</body>\n</html>';

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

  function render() {
    const container = document.getElementById("moduleContainer");
    if (!container) return;
    container.className = "module-container module-container--reportBuilder";
    container.innerHTML = "";

    const sessionData = getSessionData();
    const hasData     = !!(sessionData?.rows?.length);

    const root = document.createElement("div");
    root.className = "rb-root";
    root.innerHTML = '<div class="rb-header"><div class="rb-header-left"><input type="text" class="rb-title-input" id="rbTitleInput" value="' + escHtml(reportTitle) + '" placeholder="Report title…"></div><div class="rb-header-right"><button class="btn btn-secondary btn-sm" id="rbComparisonBtn" style="margin-right:0.5rem;">' + (comparisonMode.enabled ? '🔴 Exit Comparison' : '📊 Comparison Mode') + '</button><button class="btn btn-secondary btn-sm" id="rbTemplatesBtn">📋 Templates</button><button class="btn btn-secondary btn-sm" id="rbClearBtn" ' + (!reportCharts.length ? "disabled" : "") + '>Clear all</button><button class="btn btn-sm" id="rbExportBtn" ' + (!reportCharts.length ? "disabled" : "") + '>⬆ Export HTML</button></div></div>' + (comparisonMode.enabled ? buildComparisonUI() : buildStandardUI(sessionData, hasData)) + '';
    container.appendChild(root);

    const titleInput = root.querySelector("#rbTitleInput");
    titleInput.addEventListener("input", function() { reportTitle = titleInput.value; });

    root.querySelector("#rbComparisonBtn").addEventListener("click", function() {
      comparisonMode.enabled = !comparisonMode.enabled;
      if (!comparisonMode.enabled) {
        // Reset comparison data when exiting
        comparisonMode.datasetA = { name: "", rows: [], fields: [], displayNames: {} };
        comparisonMode.datasetB = { name: "", rows: [], fields: [], displayNames: {} };
      }
      reportCharts = [];
      chartInstances = {};
      render();
    });

    root.querySelector("#rbTemplatesBtn").addEventListener("click", openTemplateManager);

    root.querySelector("#rbExportBtn").addEventListener("click", exportReportHtml);
    root.querySelector("#rbClearBtn").addEventListener("click", function() {
      reportCharts = [];
      chartInstances = {};
      render();
    });

    if (comparisonMode.enabled) {
      wireComparisonHandlers(root);
    } else if (hasData) {
      wireStandardHandlers(root, sessionData);
    }

    if (reportCharts.length) {
      reportCharts.forEach(c => {
        if (c.isComparison) {
          renderComparisonChartCard(c);
        } else {
          renderChartCard(c);
        }
      });
    }
  }

  function wireStandardHandlers(root, sessionData) {
    const fieldSelect  = root.querySelector("#rbFieldSelect");
    const valueSelect  = root.querySelector("#rbValueSelect");
    const aggSelect    = root.querySelector("#rbAggSelect");
    const typeSelect   = root.querySelector("#rbTypeSelect");
    const chartTitleIn = root.querySelector("#rbChartTitle");
    const maxGroupsSel = root.querySelector("#rbMaxGroups");
    const previewArea  = root.querySelector("#rbPreviewArea");
    const addBtn       = root.querySelector("#rbAddChartBtn");

    let previewData = null;

    // Enable/disable aggregation selector based on value column
    function syncAggregationState() {
      const hasValue = valueSelect.value !== "";
      aggSelect.disabled = !hasValue;
      if (!hasValue) {
        aggSelect.value = "count";
      }
    }

    function updatePreview() {
      const field = fieldSelect.value;
      const valueColumn = valueSelect.value;
      const aggType = valueSelect.value ? aggSelect.value : "count";
      const type  = typeSelect.value;
      const max   = parseInt(maxGroupsSel.value) || 0;
      previewArea.innerHTML = "";
      addBtn.disabled = true;
      previewData = null;

      if (!field) {
        previewArea.innerHTML = '<div class="rb-preview-hint">Select a column to preview.</div>';
        return;
      }

      let data = computeAggregation(sessionData.rows, field, valueColumn, aggType);
      if (max > 0) data = data.slice(0, max);
      previewData = data;

      if (!data.length) {
        previewArea.innerHTML = '<div class="rb-preview-hint">No data in this column.</div>';
        return;
      }

      const canvasId  = "rbPreviewCanvas";
      const fieldLabel = sessionData.displayNames[field] || field;
      
      // Build chart title based on aggregation
      let autoTitle = fieldLabel;
      if (valueColumn) {
        const valueLabel = sessionData.displayNames[valueColumn] || valueColumn;
        autoTitle = `${aggType.toUpperCase()}(${valueLabel}) by ${fieldLabel}`;
      }
      
      const chartDef   = {
        id: canvasId, type, field, fieldLabel,
        title: chartTitleIn.value.trim() || autoTitle,
        data,
        valueColumn,
        aggType
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

    valueSelect.addEventListener("change", () => {
      syncAggregationState();
      updatePreview();
    });
    aggSelect.addEventListener("change", updatePreview);
    fieldSelect.addEventListener("change", updatePreview);
    typeSelect.addEventListener("change",  updatePreview);
    maxGroupsSel.addEventListener("change", updatePreview);
    chartTitleIn.addEventListener("input",  updatePreview);
    
    syncAggregationState();

    addBtn.addEventListener("click", function() {
      const field      = fieldSelect.value;
      const valueColumn = valueSelect.value;
      const aggType    = valueSelect.value ? aggSelect.value : "count";
      const type       = typeSelect.value;
      const max        = parseInt(maxGroupsSel.value) || 0;
      const fieldLabel = sessionData.displayNames[field] || field;
      
      // Build title
      let autoTitle = fieldLabel;
      if (valueColumn) {
        const valueLabel = sessionData.displayNames[valueColumn] || valueColumn;
        autoTitle = `${aggType.toUpperCase()}(${valueLabel}) by ${fieldLabel}`;
      }
      const title = chartTitleIn.value.trim() || autoTitle;

      if (!field || !previewData) return;

      const chartDef = {
        id:         uid(),
        type, field, fieldLabel, title,
        maxGroups:  max,
        data:       previewData,
        note:       "",
        showLegend: true,
        valueColumn,
        aggType
      };

      reportCharts.push(chartDef);
      renderChartCard(chartDef);

      fieldSelect.value    = "";
      valueSelect.value    = "";
      aggSelect.value      = "count";
      chartTitleIn.value   = "";
      previewArea.innerHTML = '<div class="rb-preview-hint">Select a column to preview.</div>';
      addBtn.disabled = true;
      previewData = null;
      syncAggregationState();

      root.querySelector("#rbExportBtn").disabled = false;
      root.querySelector("#rbClearBtn").disabled  = false;

      const emptyEl = root.querySelector(".rb-canvas-empty");
      if (emptyEl) emptyEl.remove();
    });
  }

  function wireComparisonHandlers(root) {
    // Dataset A load button
    const loadBtnA = root.querySelector("#rbLoadA");
    const fileInputA = root.querySelector("#rbFileA");
    if (loadBtnA && fileInputA) {
      loadBtnA.addEventListener("click", () => fileInputA.click());
      fileInputA.addEventListener("change", (e) => loadDataset(e, "A"));
    }

    // Dataset B load button
    const loadBtnB = root.querySelector("#rbLoadB");
    const fileInputB = root.querySelector("#rbFileB");
    if (loadBtnB && fileInputB) {
      loadBtnB.addEventListener("click", () => fileInputB.click());
      fileInputB.addEventListener("change", (e) => loadDataset(e, "B"));
    }

    // Drag and drop for dataset A
    const dropzoneA = root.querySelector('.rb-dropzone[data-dataset="A"]');
    if (dropzoneA) {
      setupDropzone(dropzoneA, "A");
    }

    // Drag and drop for dataset B
    const dropzoneB = root.querySelector('.rb-dropzone[data-dataset="B"]');
    if (dropzoneB) {
      setupDropzone(dropzoneB, "B");
    }

    // Clear buttons
    const clearA = root.querySelector("#rbClearA");
    const clearB = root.querySelector("#rbClearB");
    if (clearA) clearA.addEventListener("click", () => { comparisonMode.datasetA = { name: "", rows: [], fields: [], displayNames: {} }; render(); });
    if (clearB) clearB.addEventListener("click", () => { comparisonMode.datasetB = { name: "", rows: [], fields: [], displayNames: {} }; render(); });

    // If both datasets loaded, wire comparison chart controls
    if (comparisonMode.datasetA.rows.length && comparisonMode.datasetB.rows.length) {
      const displayMode = root.querySelector("#rbDisplayMode");
      const fieldSelect = root.querySelector("#rbCompFieldSelect");
      const typeSelect = root.querySelector("#rbCompTypeSelect");
      const chartTitleIn = root.querySelector("#rbCompChartTitle");
      const previewArea = root.querySelector("#rbCompPreviewArea");
      const addBtn = root.querySelector("#rbAddCompChartBtn");
      const statsArea = root.querySelector("#rbCompStats");

      let previewData = null;

      function updateCompPreview() {
        const field = fieldSelect?.value;
        const type = typeSelect?.value;
        const mode = displayMode?.value || "overlay";
        comparisonMode.displayMode = mode;
        
        if (previewArea) previewArea.innerHTML = "";
        if (addBtn) addBtn.disabled = true;
        previewData = null;

        if (!field) {
          if (previewArea) previewArea.innerHTML = '<div class="rb-preview-hint">Select a column to preview.</div>';
          return;
        }

        const dataA = computeGroupCount(comparisonMode.datasetA.rows, field);
        const dataB = computeGroupCount(comparisonMode.datasetB.rows, field);
        
        const title = chartTitleIn?.value.trim() || `${field} Comparison`;

        if (mode === "overlay") {
          // Combine both datasets into one chart with multiple datasets
          previewData = { mode, field, type, title, dataA, dataB };
          
          if (previewArea) {
            const wrap = document.createElement("div");
            wrap.className = "rb-preview-wrap";
            const canvas = document.createElement("canvas");
            canvas.id = "rbCompPreviewCanvas";
            canvas.className = "rb-preview-canvas";
            wrap.appendChild(canvas);
            previewArea.appendChild(wrap);
            
            setTimeout(() => renderComparisonChart("rbCompPreviewCanvas", { type, dataA, dataB, title }), 0);
          }
        } else {
          // Side-by-side: two separate charts
          previewData = { mode, field, type, title, dataA, dataB };
          
          if (previewArea) {
            previewArea.style.display = "grid";
            previewArea.style.gridTemplateColumns = "1fr 1fr";
            previewArea.style.gap = "1rem";
            
            const wrapA = document.createElement("div");
            const canvasA = document.createElement("canvas");
            canvasA.id = "rbCompPreviewCanvasA";
            wrapA.appendChild(canvasA);
            
            const wrapB = document.createElement("div");
            const canvasB = document.createElement("canvas");
            canvasB.id = "rbCompPreviewCanvasB";
            wrapB.appendChild(canvasB);
            
            previewArea.appendChild(wrapA);
            previewArea.appendChild(wrapB);
            
            setTimeout(() => {
              renderChartToCanvas("rbCompPreviewCanvasA", { id: "A", type, field, title: comparisonMode.datasetA.name, data: dataA });
              renderChartToCanvas("rbCompPreviewCanvasB", { id: "B", type, field, title: comparisonMode.datasetB.name, data: dataB });
            }, 0);
          }
        }

        if (addBtn) addBtn.disabled = false;
        
        // Update comparison stats
        if (statsArea) {
          updateComparisonStats(field, dataA, dataB, statsArea);
        }
      }

      if (displayMode) displayMode.addEventListener("change", updateCompPreview);
      if (fieldSelect) fieldSelect.addEventListener("change", updateCompPreview);
      if (typeSelect) typeSelect.addEventListener("change", updateCompPreview);
      if (chartTitleIn) chartTitleIn.addEventListener("input", updateCompPreview);

      if (addBtn) {
        addBtn.addEventListener("click", () => {
          if (!previewData) return;

          const chartDef = {
            id: uid(),
            isComparison: true,
            ...previewData
          };

          reportCharts.push(chartDef);
          renderComparisonChartCard(chartDef);

          if (fieldSelect) fieldSelect.value = "";
          if (chartTitleIn) chartTitleIn.value = "";
          if (previewArea) previewArea.innerHTML = '<div class="rb-preview-hint">Select a column to preview.</div>';
          if (addBtn) addBtn.disabled = true;
          previewData = null;

          const exportBtn = root.querySelector("#rbExportBtn");
          const clearBtn = root.querySelector("#rbClearBtn");
          if (exportBtn) exportBtn.disabled = false;
          if (clearBtn) clearBtn.disabled = false;

          const emptyEl = root.querySelector(".rb-canvas-empty");
          if (emptyEl) emptyEl.remove();
        });
      }
    }
  }

  function loadDataset(event, dataset) {
    const file = event.target?.files?.[0] || event.dataTransfer?.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target.result;
        const results = Papa.parse(text, { header: true, skipEmptyLines: true });
        
        const targetDataset = dataset === "A" ? comparisonMode.datasetA : comparisonMode.datasetB;
        targetDataset.name = file.name;
        targetDataset.rows = results.data;
        targetDataset.fields = results.meta.fields || [];
        targetDataset.displayNames = {};
        targetDataset.fields.forEach(f => { targetDataset.displayNames[f] = f; });

        render();
      } catch (err) {
        alert("Failed to load CSV: " + err.message);
      }
    };
    reader.readAsText(file);
  }

  function setupDropzone(dropzone, dataset) {
    dropzone.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.style.borderColor = "#3b82f6";
      dropzone.style.background = "rgba(59, 130, 246, 0.1)";
    });

    dropzone.addEventListener("dragleave", (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.style.borderColor = "";
      dropzone.style.background = "";
    });

    dropzone.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.style.borderColor = "";
      dropzone.style.background = "";
      
      loadDataset(e, dataset);
    });
  }

  function updateComparisonStats(field, dataA, dataB, statsArea) {
    const totalA = dataA.reduce((sum, d) => sum + d.value, 0);
    const totalB = dataB.reduce((sum, d) => sum + d.value, 0);
    const uniqueA = dataA.length;
    const uniqueB = dataB.length;
    
    const labelsA = new Set(dataA.map(d => d.label));
    const labelsB = new Set(dataB.map(d => d.label));
    const commonLabels = [...labelsA].filter(l => labelsB.has(l)).length;
    
    statsArea.innerHTML = `
      <div class="section-card">
        <div class="section-card-header">Comparison Stats</div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; padding: 1rem;">
          <div>
            <div style="font-weight: 600; color: #3b82f6; margin-bottom: 0.5rem;">Dataset A</div>
            <div class="info-text">Total: ${totalA}</div>
            <div class="info-text">Unique values: ${uniqueA}</div>
          </div>
          <div>
            <div style="font-weight: 600; color: #f59e0b; margin-bottom: 0.5rem;">Dataset B</div>
            <div class="info-text">Total: ${totalB}</div>
            <div class="info-text">Unique values: ${uniqueB}</div>
          </div>
        </div>
        <div style="padding: 0 1rem 1rem;">
          <div class="info-text">Common values: ${commonLabels} / ${Math.max(uniqueA, uniqueB)}</div>
          <div class="info-text">Difference: ${Math.abs(totalA - totalB)} (${((Math.abs(totalA - totalB) / Math.max(totalA, totalB)) * 100).toFixed(1)}%)</div>
        </div>
      </div>
    `;
  }

  function renderComparisonChart(canvasId, chartDef) {
    const { type, dataA, dataB, title } = chartDef;
    
    // Combine all unique labels from both datasets
    const allLabels = [...new Set([...dataA.map(d => d.label), ...dataB.map(d => d.label)])];
    
    // Create value arrays aligned to labels
    const valuesA = allLabels.map(label => {
      const found = dataA.find(d => d.label === label);
      return found ? found.value : 0;
    });
    
    const valuesB = allLabels.map(label => {
      const found = dataB.find(d => d.label === label);
      return found ? found.value : 0;
    });

    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const realType = type === "horizontalBar" ? "bar" : type;
    const isHorizontal = type === "horizontalBar";

    const config = {
      type: realType,
      data: {
        labels: allLabels,
        datasets: [
          {
            label: comparisonMode.datasetA.name || "Dataset A",
            data: valuesA,
            backgroundColor: "#3b82f6",
            borderColor: "#2563eb",
            borderWidth: 1,
          },
          {
            label: comparisonMode.datasetB.name || "Dataset B",
            data: valuesB,
            backgroundColor: "#f59e0b",
            borderColor: "#d97706",
            borderWidth: 1,
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: isHorizontal ? "y" : "x",
        plugins: {
          title: { display: !!title, text: title || "", color: "#f9fafb" },
          legend: { display: true, labels: { color: "#f9fafb" } }
        },
        scales: ["bar","line","horizontalBar"].includes(type) ? {
          x: { ticks: { color: "#9ca3af" }, grid: { color: "rgba(148,163,184,0.1)" } },
          y: { ticks: { color: "#9ca3af" }, grid: { color: "rgba(148,163,184,0.1)" } }
        } : undefined
      }
    };

    if (chartInstances[canvasId]) {
      chartInstances[canvasId].destroy();
    }
    chartInstances[canvasId] = new Chart(canvas, config);
  }

  function renderComparisonChartCard(chartDef) {
    const canvas = document.getElementById("rbCanvas");
    if (!canvas) return;

    const card = document.createElement("div");
    card.className = "rb-chart-card";
    card.dataset.chartId = chartDef.id;

    // Header
    const cardHeader = document.createElement("div");
    cardHeader.className = "rb-chart-card-header";
    
    const cardTitle = document.createElement("div");
    cardTitle.className = "rb-chart-card-title";
    cardTitle.textContent = chartDef.title || "Comparison Chart";
    
    const cardMeta = document.createElement("div");
    cardMeta.className = "rb-chart-card-meta";
    cardMeta.textContent = `Comparing ${chartDef.field} — ${chartDef.mode === 'overlay' ? 'Overlay' : 'Side-by-side'}`;
    
    cardHeader.appendChild(cardTitle);
    cardHeader.appendChild(cardMeta);
    
    // Chart wrap
    const chartWrap = document.createElement("div");
    chartWrap.className = "rb-chart-wrap";

    if (chartDef.mode === "overlay") {
      const canvasEl = document.createElement("canvas");
      canvasEl.id = chartDef.id;
      chartWrap.appendChild(canvasEl);
    } else {
      // Side-by-side
      chartWrap.style.display = "grid";
      chartWrap.style.gridTemplateColumns = "1fr 1fr";
      chartWrap.style.gap = "1rem";
      
      const wrapA = document.createElement("div");
      wrapA.style.position = "relative";
      wrapA.style.height = "300px";
      const canvasA = document.createElement("canvas");
      canvasA.id = chartDef.id + "_A";
      wrapA.appendChild(canvasA);
      
      const wrapB = document.createElement("div");
      wrapB.style.position = "relative";
      wrapB.style.height = "300px";
      const canvasB = document.createElement("canvas");
      canvasB.id = chartDef.id + "_B";
      wrapB.appendChild(canvasB);
      
      chartWrap.appendChild(wrapA);
      chartWrap.appendChild(wrapB);
    }
    
    // Footer with action buttons
    const cardFooter = document.createElement("div");
    cardFooter.className = "rb-chart-card-footer";
    
    const removeBtn = document.createElement("button");
    removeBtn.className = "btn btn-ghost btn-xs btn-text-danger";
    removeBtn.dataset.id = chartDef.id;
    removeBtn.innerHTML = "✕ Remove";
    
    cardFooter.appendChild(removeBtn);
    
    card.appendChild(cardHeader);
    card.appendChild(chartWrap);
    card.appendChild(cardFooter);
    canvas.appendChild(card);

    // Event handlers
    removeBtn.addEventListener("click", function() {
      reportCharts = reportCharts.filter(c => c.id !== chartDef.id);
      
      // Clean up chart instances
      if (chartDef.mode === "overlay") {
        if (chartInstances[chartDef.id]) {
          chartInstances[chartDef.id].destroy();
          delete chartInstances[chartDef.id];
        }
      } else {
        const idA = chartDef.id + "_A";
        const idB = chartDef.id + "_B";
        if (chartInstances[idA]) {
          chartInstances[idA].destroy();
          delete chartInstances[idA];
        }
        if (chartInstances[idB]) {
          chartInstances[idB].destroy();
          delete chartInstances[idB];
        }
      }
      
      card.remove();
      
      const rbCanvas = document.getElementById("rbCanvas");
      if (rbCanvas && !rbCanvas.querySelector(".rb-chart-card")) {
        rbCanvas.innerHTML = '<div class="rb-canvas-empty"><div class="rb-empty-icon">📈</div><div class="rb-empty-text">Comparison charts will appear here.</div></div>';
        document.getElementById("rbExportBtn").disabled = true;
        document.getElementById("rbClearBtn").disabled = true;
      }
    });

    // Render charts
    if (chartDef.mode === "overlay") {
      setTimeout(() => renderComparisonChart(chartDef.id, chartDef), 0);
    } else {
      setTimeout(() => {
        renderChartToCanvas(chartDef.id + "_A", { id: "A", type: chartDef.type, field: chartDef.field, title: comparisonMode.datasetA.name, data: chartDef.dataA });
        renderChartToCanvas(chartDef.id + "_B", { id: "B", type: chartDef.type, field: chartDef.field, title: comparisonMode.datasetB.name, data: chartDef.dataB });
      }, 0);
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

    const cardHeader = document.createElement("div");
    cardHeader.className = "rb-chart-card-header";
    
    const cardTitle = document.createElement("div");
    cardTitle.className = "rb-chart-card-title";
    cardTitle.textContent = chartDef.title || "Chart";
    
    const cardMeta = document.createElement("div");
    cardMeta.className = "rb-chart-card-meta";
    cardMeta.textContent = "Grouped by " + (chartDef.fieldLabel || chartDef.field) + " — " + chartDef.data.length + " values";
    
    cardHeader.appendChild(cardTitle);
    cardHeader.appendChild(cardMeta);
    
    const chartWrap = document.createElement("div");
    chartWrap.className = "rb-chart-wrap" + (isPie ? " rb-chart-wrap--pie" : "");
    
    const chartCanvas = document.createElement("canvas");
    chartCanvas.id = canvasId;
    chartWrap.appendChild(chartCanvas);
    
    let noteEl;
    if (chartDef.note) {
      noteEl = document.createElement("div");
      noteEl.className = "rb-chart-note";
      noteEl.textContent = chartDef.note;
    }
    
    const cardFooter = document.createElement("div");
    cardFooter.className = "rb-chart-card-footer";
    
    const editBtn = document.createElement("button");
    editBtn.className = "btn btn-ghost btn-xs btn-text-accent";
    editBtn.dataset.id = chartDef.id;
    editBtn.innerHTML = "✏️ Edit";
    
    const removeBtn = document.createElement("button");
    removeBtn.className = "btn btn-ghost btn-xs btn-text-danger";
    removeBtn.dataset.id = chartDef.id;
    removeBtn.innerHTML = "✕ Remove";
    
    cardFooter.appendChild(editBtn);
    cardFooter.appendChild(removeBtn);
    
    card.appendChild(cardHeader);
    card.appendChild(chartWrap);
    if (noteEl) card.appendChild(noteEl);
    card.appendChild(cardFooter);

    editBtn.addEventListener("click", function() {
      openChartEditor(chartDef.id);
    });

    removeBtn.addEventListener("click", function() {
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