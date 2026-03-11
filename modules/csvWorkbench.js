// modules/csvWorkbench.js
// Layout: icon rail + slide-out drawer + table/summary content area.
// Business logic is unchanged; only the render layer is redesigned.

(function () {
  const CONTAINER_ID     = "moduleContainer";
  const ANNOTATION_KEY   = "pbToolsAnnotations";
  const NOTE_COL         = "StatusNote";
  const NOTE_CONFIG_KEY  = "pbToolsNoteConfigs";     // Note key configurations
  const ACTIVE_CONFIG_KEY = "pbToolsActiveNoteConfig"; // Currently active config ID
  const CALC_COLUMNS_KEY = "pbToolsCalcColumns";     // Calculations

  // Protected columns are now determined dynamically based on active note key config
  // Plus some always-protected columns
  const ALWAYS_PROTECTED = new Set(); // No hardcoded columns — use manual protection or Note Key auto-protection

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
  let calcColumns   = [];  // [{ id, name, formula }] — calculated column definitions
  let manuallyProtectedColumns = new Set(); // User-toggled via right-click → persisted in presets

  // ── Drawer state ──────────────────────────────────────────────────────────
  let drawerState   = { open: false, panel: null };

  const PANEL_LABELS = {
    columns:   "Columns",
    presets:   "Presets",
    mapping:   "Value mapping",
    tools:     "Tools",
    notekeys:  "Note Keys",
    reference: "References",
    formulas:  "Formulas",
    summary:   "Summary",
  };

  const PANEL_ICONS = {
    columns:   "☰",
    presets:   "⚡",
    mapping:   "⇄",
    tools:     "🔧",
    notekeys:  "🔑",
    reference: "📋",
    formulas:  "🧮",
    summary:   "📊",
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

  // ── Note Key Configuration ────────────────────────────────────────────────
  
  function loadNoteConfigs() {
    try {
      const raw = localStorage.getItem(NOTE_CONFIG_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (_) { return {}; }
  }

  function saveNoteConfigs(configs) {
    try {
      localStorage.setItem(NOTE_CONFIG_KEY, JSON.stringify(configs));
    } catch (_) {}
  }

  function getActiveNoteConfig() {
    try {
      const activeId = localStorage.getItem(ACTIVE_CONFIG_KEY);
      if (!activeId) return null;
      const configs = loadNoteConfigs();
      return configs[activeId] || null;
    } catch (_) { return null; }
  }

  function setActiveNoteConfig(configId) {
    try {
      if (configId) {
        localStorage.setItem(ACTIVE_CONFIG_KEY, configId);
        // Update lastUsed timestamp
        const configs = loadNoteConfigs();
        if (configs[configId]) {
          configs[configId].lastUsed = new Date().toISOString();
          saveNoteConfigs(configs);
        }
      } else {
        localStorage.removeItem(ACTIVE_CONFIG_KEY);
      }
    } catch (_) {}
  }

  function detectKeyColumns(headers) {
    const detected = { primary: null, secondary: null, context: null };
    
    // Detect primary (person/entity identifier)
    const primaryPatterns = ['email', 'username', 'employee_id', 'user_id', 'account'];
    for (const pattern of primaryPatterns) {
      const match = headers.find(h => h.toLowerCase().includes(pattern));
      if (match) { detected.primary = match; break; }
    }
    
    // Detect secondary (fallback identifier)
    const secondaryPatterns = ['employee number', 'employeenumber', 'phone', 'id'];
    for (const pattern of secondaryPatterns) {
      const match = headers.find(h => 
        h.toLowerCase().replace(/\s/g, '').includes(pattern.replace(/\s/g, '')) && 
        h !== detected.primary
      );
      if (match) { detected.secondary = match; break; }
    }
    
    // Detect context (cohort/batch)
    const contextPatterns = ['due date', 'duedate', 'campaign', 'batch', 'quarter', 'enrolled'];
    for (const pattern of contextPatterns) {
      const match = headers.find(h => h.toLowerCase().replace(/\s/g, '').includes(pattern.replace(/\s/g, '')));
      if (match) { detected.context = match; break; }
    }
    
    return detected;
  }

  function makeAnnotationKey(row, rowIndex = null) {
    const activeConfig = getActiveNoteConfig();
    
    // Persistent mode (config with key columns)
    if (activeConfig?.keyColumns) {
      const { primary, secondary, context } = activeConfig.keyColumns;
      const person = row[primary] || (secondary ? row[secondary] : null);
      
      if (!person) return null;
      
      const personKey = String(person).trim().toLowerCase();
      
      // Include context if available
      if (context && row[context]) {
        return `${personKey}::${String(row[context]).trim()}`;
      }
      
      return personKey;
    }
    
    // Temporary mode (no config) - use row index
    if (rowIndex !== null) {
      return `temp_${rowIndex}`;
    }
    
    return null;
  }

  function getProtectedColumns() {
    const protected = new Set([...ALWAYS_PROTECTED, ...manuallyProtectedColumns]);
    const activeConfig = getActiveNoteConfig();
    
    if (activeConfig?.keyColumns) {
      const { primary, secondary, context } = activeConfig.keyColumns;
      if (primary) protected.add(primary);
      if (secondary) protected.add(secondary);
      if (context) protected.add(context);
    }
    
    return protected;
  }

  function getNoteCountForConfig(configId) {
    const notes = loadAnnotations();
    return Object.values(notes).filter(n => n.configId === configId).length;
  }

  function deleteNoteConfig(configId) {
    const configs = loadNoteConfigs();
    const notes = loadAnnotations();
    
    // Delete all notes for this config
    Object.keys(notes).forEach(key => {
      if (notes[key].configId === configId) {
        delete notes[key];
      }
    });
    
    // Delete the config
    delete configs[configId];
    
    // Save
    saveNoteConfigs(configs);
    annotationsCache = notes;
    saveAnnotations();
    
    // Clear active if it was this config
    const activeId = localStorage.getItem(ACTIVE_CONFIG_KEY);
    if (activeId === configId) {
      localStorage.removeItem(ACTIVE_CONFIG_KEY);
    }
  }

  function exportConfigNotesAsCSV(configId, configName) {
    const notes = loadAnnotations();
    const configNotes = Object.entries(notes)
      .filter(([key, note]) => note.configId === configId);
    
    if (configNotes.length === 0) {
      alert('No notes to export for this configuration.');
      return;
    }
    
    const csv = [
      ['Key', 'Note', 'Created', 'Updated'],
      ...configNotes.map(([key, note]) => [
        key,
        note.text || '',
        note.createdAt || '',
        note.updatedAt || ''
      ])
    ].map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${configName.replace(/[^a-z0-9]/gi, '_')}_notes_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Presets ───────────────────────────────────────────────────────────────
  // Built-in presets removed - users can create their own custom presets
  const presets = {};

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

  // applyPhisherLikePreset() function removed - was for hardcoded preset
  // Users can now create custom presets with their own field selections and mappings


  // Enhanced aggregation engine supporting multiple aggregation types
  function computeAggregation(config) {
    if (!parsedData) return null;
    
    // config: { groupBy, aggregations: [{ field, type: 'sum'|'avg'|'min'|'max'|'count' }], includePercentage }
    // Backward compat: if config is a string, treat as simple count
    if (typeof config === 'string') {
      return computeSimpleCount(config);
    }
    
    const { groupBy, aggregations = [], includePercentage = false } = config;
    
    // Use filtered rows (respects row filters from presets)
    const sourceRows = getFilteredSortedRows();
    
    // Group rows
    const groups = {};
    sourceRows.forEach(row => {
      const key = (row[groupBy] == null || row[groupBy] === "") ? "(empty)" : String(row[groupBy]);
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(row);
    });
    
    // Compute aggregations for each group
    const rows = Object.entries(groups).map(([value, groupRows]) => {
      const result = { value, count: groupRows.length, metrics: {} };
      
      aggregations.forEach(agg => {
        const { field, type, label } = agg;
        const aggLabel = label || `${type}(${field})`;
        
        const numericValues = groupRows
          .map(r => parseFloat(r[field]))
          .filter(v => !isNaN(v));
        
        if (numericValues.length === 0) {
          result.metrics[aggLabel] = null;
          return;
        }
        
        switch (type) {
          case 'sum':
            result.metrics[aggLabel] = numericValues.reduce((a, b) => a + b, 0);
            break;
          case 'avg':
            result.metrics[aggLabel] = numericValues.reduce((a, b) => a + b, 0) / numericValues.length;
            break;
          case 'min':
            result.metrics[aggLabel] = Math.min(...numericValues);
            break;
          case 'max':
            result.metrics[aggLabel] = Math.max(...numericValues);
            break;
          case 'count':
            result.metrics[aggLabel] = numericValues.length;
            break;
        }
      });
      
      return result;
    });
    
    // Sort by count descending
    rows.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
    
    // Add percentage if requested
    if (includePercentage) {
      const total = rows.reduce((sum, r) => sum + r.count, 0);
      rows.forEach(r => {
        r.percentOfTotal = total > 0 ? (r.count / total * 100) : 0;
      });
    }
    
    return { groupBy, aggregations, rows, includePercentage };
  }
  
  // Simple count for backward compatibility
  function computeSimpleCount(field) {
    if (!parsedData) return null;
    
    // Use filtered rows (respects row filters from presets)
    const sourceRows = getFilteredSortedRows();
    
    const counts = {};
    sourceRows.forEach(row => {
      const key = (row[field] == null || row[field] === "") ? "(empty)" : String(row[field]);
      counts[key] = (counts[key] || 0) + 1;
    });
    const rows = Object.entries(counts)
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
    return { field, rows };
  }
  
  // Backward compatibility wrapper
  function computeGroupAndCount(field) {
    return computeSimpleCount(field);
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
    rawRows.forEach((row, index) => {
      if (row[NOTE_COL] === undefined) row[NOTE_COL] = "";
      const key = makeAnnotationKey(row, index);
      if (key && annotations[key]) {
        const noteData = annotations[key];
        row[NOTE_COL] = noteData.text || noteData.statusNote || "";  // Handle both old and new format
      }
    });

    parsedData  = { fields, rows: rawRows };
    lastSummary = null;
    undoSnapshot = null;
    sortState   = { field: null, dir: "asc" };
    filterState = { text: "", field: "" };
    rowFilters  = [];
    manuallyProtectedColumns = new Set();
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

    // Apply calculations if any exist
    applyCalcColumns();

    updateFileInfo();

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
    const groupByField = lastSummary.groupBy || lastSummary.field;
    const dn = viewState.displayNames[groupByField] || groupByField;
    const rows = lastSummary.rows;
    
    // Build table headers
    let headers = `<th>${escHtml(dn)}</th><th><strong>COUNT</strong></th>`;
    if (lastSummary.includePercentage) {
      headers += `<th>% of Total</th>`;
    }
    if (lastSummary.aggregations?.length) {
      lastSummary.aggregations.forEach(agg => {
        headers += `<th><strong>${escHtml(agg.label)}</strong></th>`;
      });
    }
    
    // Build table rows
    const tableRows = rows.map(r => {
      let cells = `<td>${escHtml(String(r.value))}</td><td>${r.count.toLocaleString()}</td>`;
      
      if (lastSummary.includePercentage) {
        cells += `<td>${r.percentOfTotal != null ? r.percentOfTotal.toFixed(1) + '%' : '-'}</td>`;
      }
      
      if (lastSummary.aggregations?.length) {
        lastSummary.aggregations.forEach(agg => {
          const val = r.metrics?.[agg.label];
          if (val != null) {
            const formatted = agg.type === 'avg' ? val.toFixed(2) : val.toLocaleString();
            cells += `<td>${formatted}</td>`;
          } else {
            cells += `<td>-</td>`;
          }
        });
      }
      
      return `<tr>${cells}</tr>`;
    }).join("");

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
  td:not(:first-child){text-align:right}
  tr:nth-child(even) td{background:#f9fafb}
  @media print{th{background:#e5e7eb!important;-webkit-print-color-adjust:exact}}
</style>
</head>
<body>
<h1>Summary — ${escHtml(dn)}</h1>
<div class="meta">Exported ${new Date().toLocaleString()} &mdash; ${rows.length.toLocaleString()} distinct values</div>
<table>
<thead><tr>${headers}</tr></thead>
<tbody>${tableRows}</tbody>
</table>
</body>
</html>`;

    triggerDownload(new Blob([html], { type: "text/html;charset=utf-8;" }), "pb-tools-summary.html");
  }

  function exportSummaryCsv() {
    if (!lastSummary?.rows.length) return;
    const groupByField = lastSummary.groupBy || lastSummary.field;
    const dn = viewState.displayNames[groupByField] || groupByField;
    
    const data = lastSummary.rows.map(r => {
      const row = { [dn]: r.value, Count: r.count };
      
      if (lastSummary.includePercentage) {
        row["% of Total"] = r.percentOfTotal != null ? r.percentOfTotal.toFixed(1) + '%' : '-';
      }
      
      if (lastSummary.aggregations?.length) {
        lastSummary.aggregations.forEach(agg => {
          const val = r.metrics?.[agg.label];
          if (val != null) {
            row[agg.label] = agg.type === 'avg' ? val.toFixed(2) : val;
          } else {
            row[agg.label] = '-';
          }
        });
      }
      
      return row;
    });
    
    triggerDownload(new Blob([Papa.unparse(data)], { type: "text/csv;charset=utf-8;" }), "pb-tools-summary.csv");
  }

  function exportSummaryXlsx() {
    if (!lastSummary?.rows.length) return;
    const groupByField = lastSummary.groupBy || lastSummary.field;
    const dn = viewState.displayNames[groupByField] || groupByField;
    
    const data = lastSummary.rows.map(r => {
      const row = { [dn]: r.value, Count: r.count };
      
      if (lastSummary.includePercentage) {
        row["% of Total"] = r.percentOfTotal != null ? r.percentOfTotal.toFixed(1) + '%' : '-';
      }
      
      if (lastSummary.aggregations?.length) {
        lastSummary.aggregations.forEach(agg => {
          const val = r.metrics?.[agg.label];
          if (val != null) {
            row[agg.label] = agg.type === 'avg' ? parseFloat(val.toFixed(2)) : val;
          } else {
            row[agg.label] = '-';
          }
        });
      }
      
      return row;
    });
    
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

        <!-- Row 1: Dropzone only -->
        <div class="section-card" style="margin-bottom: 1rem;">
          <div class="section-card-header">
            Load Data File
          </div>
          
          <input type="file" id="csvFileInput" accept=".csv,.txt,.xlsx" class="hidden">

          <div class="dropzone" id="csvDropzone">
            <div class="dropzone-icon">📊</div>
            <div class="dropzone-text">
              Drop CSV or XLSX file here or click to browse
            </div>
            <div class="dropzone-hint">
              Supports .csv, .txt, and .xlsx files
            </div>
          </div>
        </div>

        <!-- Row 2: File info (left) + actions (right) -->
        <div class="csv-infobar" id="csvInfoBar">
          <div class="csv-file-info" id="csvFileInfo"></div>
          <div class="csv-toolbar-actions">
            <button class="btn btn-secondary btn-sm" id="csvUndoBtn" disabled title="Undo last operation">
              ↩ Undo
            </button>
            <button class="btn btn-sm" id="exportOpenButton">
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
        <div class="csv-workspace" id="csvWorkspace">

          <div class="ops-rail" id="opsRail">
            ${Object.entries(PANEL_ICONS).map(([key, icon]) => `
              <button class="rail-btn" data-panel="${key}" title="${PANEL_LABELS[key]}">
                <span class="rail-icon">${icon}</span>
                <span class="rail-label">${PANEL_LABELS[key]}</span>
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

          <!-- Table (summary moved to drawer) -->
          <div class="csv-content">
            <div class="csv-table-area" id="csvTableContainer"></div>
          </div>

        </div>
      </div>
    `;

    wireEvents();
    updateFileInfo();
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

    // File input (triggered by dropzone click)
    const fileInput = root.querySelector("#csvFileInput");
    if (fileInput) {
      fileInput.addEventListener("change", e => {
        const f = e.target.files?.[0];
        if (f) handleFile(f);
      });
    }

    // Drop zone — drag and drop + click to browse
    const dz = root.querySelector("#csvDropzone");
    if (dz) {
      dz.addEventListener("click", () => {
        if (fileInput) {
          fileInput.value = "";
          fileInput.click();
        }
      });
      dz.addEventListener("dragover",  e => { e.preventDefault(); dz.classList.add("dragover"); });
      dz.addEventListener("dragleave", e => { e.preventDefault(); dz.classList.remove("dragover"); });
      dz.addEventListener("drop", e => {
        e.preventDefault();
        dz.classList.remove("dragover");
        const f = e.dataTransfer.files?.[0];
        if (f) handleFile(f);
      });
    }

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
    
    const hasPreset = !!viewState.activePreset;
    const hasFilters = rowFilters.length > 0;
    
    if (!hasPreset && !hasFilters) {
      bar.style.display = "none";
      return;
    }
    bar.style.display = "flex";

    // Show active preset badge
    if (hasPreset) {
      const allPresets = { ...presets, ...loadUserPresets() };
      const preset = allPresets[viewState.activePreset];
      if (preset) {
        const presetBadge = document.createElement("div");
        presetBadge.className = "row-filter-badge preset-badge";
        presetBadge.style.background = "rgba(168, 139, 250, 0.15)";
        presetBadge.style.borderColor = "rgba(168, 139, 250, 0.3)";
        presetBadge.innerHTML = `<span>⚡ ${preset.label}</span>`;
        bar.appendChild(presetBadge);
      }
    }

    // Show individual filter badges
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

    // Clear/Unapply button
    if (hasPreset || hasFilters) {
      const clearBtn = document.createElement("button");
      clearBtn.className = "btn btn-ghost";
      clearBtn.style.cssText = "font-size:0.68rem;padding:0.1rem 0.4rem;";
      clearBtn.textContent = hasPreset ? "Unapply preset" : "Clear all filters";
      clearBtn.addEventListener("click", () => {
        if (hasPreset) {
          // Unapply preset: clear only the active preset state, keep all transformations
          viewState.activePreset = null;
          updateFileInfo();  // Clear preset badge from top
          renderRowFilterBadges();  // Refresh to update button text and preset badge
          // Refresh Presets panel if it's open to remove highlight
          if (drawerState.open && drawerState.panel === "presets") {
            renderDrawerPanel("presets");
          }
        } else {
          // Clear all filters: remove row filters when no active preset
          rowFilters = [];
          renderRowFilterBadges();
          renderTablePreview();
          renderSummaryPanel();
        }
      });
      bar.appendChild(clearBtn);
    }

    // Wire up individual filter remove buttons
    bar.querySelectorAll(".row-filter-remove").forEach(btn => {
      btn.addEventListener("click", () => {
        rowFilters.splice(parseInt(btn.dataset.idx), 1);
        // If manually removing filters, clear active preset since state no longer matches preset
        if (viewState.activePreset) {
          viewState.activePreset = null;
          updateFileInfo();
          // Refresh Presets panel if open
          if (drawerState.open && drawerState.panel === "presets") {
            renderDrawerPanel("presets");
          }
        }
        renderRowFilterBadges();
        renderTablePreview();
        renderSummaryPanel();
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
    if (drawer) {
      drawer.classList.add("open");
      // Summary panel needs more width for multi-column results
      drawer.classList.toggle("wide", panel === "summary");
    }
    if (titleEl) titleEl.textContent = PANEL_LABELS[panel] || panel;
    updateRailState();
    renderDrawerPanel(panel);
  }

  function closeDrawer() {
    drawerState = { open: false, panel: null };
    const drawer = document.getElementById("opsDrawer");
    if (drawer) {
      drawer.classList.remove("open", "wide");
    }
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
      case "columns":   buildColumnsPanel(body);     break;
      case "presets":   buildPresetsPanel(body);     break;
      case "mapping":   buildMappingPanel(body);     break;
      case "notekeys":  buildNoteKeysPanel(body);    break;
      case "tools":     buildToolsPanel(body);       break;
      case "reference": buildReferencePanel(body);   break;
      case "formulas":  buildCalcColumnsPanel(body); break;
      case "summary":   buildSummaryPanel(body);     break;
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
      protectedColumns: [...manuallyProtectedColumns],
      // Save full formula column definitions so they restore on apply
      calcColumns: calcColumns.map(c => ({ ...c })),
      // Record which reference table IDs are used (for validation on apply)
      referencedTableIds: (() => {
        const ids = new Set();
        calcColumns.forEach(c => {
          const matches = (c.formula || "").matchAll(/LOOKUP\s*\(\s*['"]([^'"]+)['"]/gi);
          for (const m of matches) ids.add(m[1]);
        });
        return [...ids];
      })(),
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

    const section = panelSection("VISIBLE · RENAME · DRAG TO REORDER");
    const list    = document.createElement("div");
    list.className        = "col-field-list";
    list.style.display       = "flex";
    list.style.flexDirection = "column";
    list.style.gap           = "0.2rem";

    // Render in current visible order first, then any hidden fields after
    const ordered = [
      ...viewState.visibleFields,
      ...parsedData.fields.filter(f => !viewState.visibleFields.includes(f)),
    ];

    let dragSrc = null;

    ordered.forEach(field => {
      const row = document.createElement("div");
      row.className        = "col-field-row";
      row.draggable        = true;
      row.dataset.field    = field;

      // Drag handle
      const handle = document.createElement("span");
      handle.className   = "col-drag-handle";
      handle.textContent = "⠿";
      handle.title       = "Drag to reorder";

      const cb = document.createElement("input");
      cb.type          = "checkbox";
      cb.checked       = viewState.visibleFields.includes(field);
      cb.dataset.field = field;

      const nameSpan = document.createElement("span");
      nameSpan.className   = "col-field-name";
      nameSpan.textContent = field;
      nameSpan.title       = field;

      const renameInput = document.createElement("input");
      renameInput.type          = "text";
      renameInput.className     = "panel-rename-input";
      renameInput.value         = viewState.displayNames[field] || field;
      renameInput.dataset.field = field;
      renameInput.placeholder   = "Display name";

      row.appendChild(handle);
      row.appendChild(cb);
      row.appendChild(nameSpan);
      row.appendChild(renameInput);
      list.appendChild(row);

      // Drag events
      row.addEventListener("dragstart", e => {
        dragSrc = row;
        e.dataTransfer.effectAllowed = "move";
        setTimeout(() => row.classList.add("col-row-dragging"), 0);
      });
      row.addEventListener("dragend", () => {
        row.classList.remove("col-row-dragging");
        list.querySelectorAll(".col-field-row").forEach(r => r.classList.remove("col-row-over"));
        dragSrc = null;
      });
      row.addEventListener("dragover", e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (dragSrc && dragSrc !== row) {
          list.querySelectorAll(".col-field-row").forEach(r => r.classList.remove("col-row-over"));
          row.classList.add("col-row-over");
        }
      });
      row.addEventListener("dragleave", () => row.classList.remove("col-row-over"));
      row.addEventListener("drop", e => {
        e.preventDefault();
        row.classList.remove("col-row-over");
        if (!dragSrc || dragSrc === row) return;

        // Insert dragSrc before or after target depending on vertical position
        const rect   = row.getBoundingClientRect();
        const midY   = rect.top + rect.height / 2;
        if (e.clientY < midY) {
          list.insertBefore(dragSrc, row);
        } else {
          list.insertBefore(dragSrc, row.nextSibling);
        }
      });
    });

    section.appendChild(list);
    container.appendChild(section);

    const applyBtn = applyButton("Apply changes");
    applyBtn.addEventListener("click", () => applyColumnChanges(list));
    container.appendChild(applyBtn);
  }

  function applyColumnChanges(listEl) {
    if (!parsedData) return;

    const newNames = { ...viewState.displayNames };

    // Read order and visibility directly from the current DOM order
    const newVisible = [];
    listEl.querySelectorAll(".col-field-row[data-field]").forEach(row => {
      const f  = row.dataset.field;
      const cb = row.querySelector("input[type='checkbox']");
      const inp = row.querySelector("input[type='text']");
      if (inp && f) newNames[f] = inp.value.trim() || f;
      if (cb?.checked) newVisible.push(f);
    });

    viewState.visibleFields = newVisible;
    viewState.displayNames  = newNames;

    renderTablePreview();
    renderSummaryPanel();
  }

  // Presets panel
  function buildPresetsPanel(container) {
    const userPresets = loadUserPresets();
    const allUserPresets = Object.values(userPresets).sort((a,b) => b.savedAt - a.savedAt);

    // ── MY PRESETS ───────────────────────────────────────────────────────────
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
          
          if (viewState.activePreset === p.id) {
            // Preset is active - show Unapply button
            applyBtn.textContent = "Unapply";
            applyBtn.disabled = false;
            applyBtn.addEventListener("click", () => {
              viewState.activePreset = null;
              updateFileInfo();
              renderRowFilterBadges();
              renderDrawerPanel("presets");
            });
          } else {
            // Preset is not active - show Apply button
            applyBtn.textContent = "Apply";
            applyBtn.addEventListener("click", () => {
              applyUserPreset(p);
              renderDrawerPanel("presets");
            });
          }
          
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
        renameBtn.textContent = "✏ Edit";
        renameBtn.addEventListener("click", () => {
          // Toggle inline edit panel
          const existing = row.querySelector(".preset-edit-panel");
          if (existing) { existing.remove(); renameBtn.textContent = "✏ Edit"; return; }
          renameBtn.textContent = "▲ Close";
          buildPresetEditPanel(p, row);
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
            saveStatus.style.color = "var(--security-warning)";
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

    // Restore manually protected columns (only those that exist in the loaded data)
    const currentFields = new Set(parsedData.fields);
    manuallyProtectedColumns = new Set(
      (preset.protectedColumns || []).filter(f => currentFields.has(f))
    );

    // Warn if preset references missing reference tables
    const missingTables = (preset.referencedTableIds || []).filter(id => {
      const tables = loadReferenceTables();
      return !tables[id];
    });
    if (missingTables.length > 0) {
      console.warn(`[PB Tools] Preset references missing reference tables: ${missingTables.join(", ")}. Formula columns using LOOKUP may return errors.`);
      // Non-blocking — user will see ERROR in cells if lookup fails
    }

    // Restore formula columns
    if (preset.calcColumns && preset.calcColumns.length > 0) {
      // Clear any existing calc columns from parsedData first
      calcColumns.forEach(existing => {
        const idx = parsedData.fields.indexOf(existing.name);
        if (idx !== -1) parsedData.fields.splice(idx, 1);
        parsedData.rows.forEach(row => delete row[existing.name]);
        const visIdx = viewState.visibleFields.indexOf(existing.name);
        if (visIdx !== -1) viewState.visibleFields.splice(visIdx, 1);
        delete viewState.displayNames[existing.name];
      });

      // Only restore formulas whose referenced columns exist in the loaded data
      const allFields = new Set(parsedData.fields);
      const skipped = [];
      calcColumns = preset.calcColumns.filter(c => {
        // Check all {ColRef} references exist
        const refs = (c.formula || "").match(/\{([^}]+)\}/g) || [];
        const missing = refs.map(r => r.slice(1,-1)).filter(f => !allFields.has(f));
        if (missing.length > 0) { skipped.push(`${c.name} (missing: ${missing.join(", ")})`); return false; }
        return true;
      });

      if (skipped.length > 0) {
        console.warn(`[PB Tools] Skipped formula columns (columns not in CSV): ${skipped.join("; ")}`);
      }

      saveCalcColumns();
      applyCalcColumns();

      // Make restored formula columns visible
      calcColumns.forEach(c => {
        if (!viewState.visibleFields.includes(c.name)) {
          viewState.visibleFields.push(c.name);
        }
        viewState.displayNames[c.name] = c.name;
      });
    } else {
      // No formula columns in preset — clear any active ones
      calcColumns = [];
      saveCalcColumns();
    }

    viewState.activePreset = preset.id;
    updateFileInfo();
    renderRowFilterBadges();  // Show unapply button and preset badge in filter bar
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

  function buildPresetEditPanel(preset, parentRow) {
    const OP_OPTIONS = [
      { value: "eq",       label: "equals" },
      { value: "neq",      label: "not equals" },
      { value: "contains", label: "contains" },
      { value: "empty",    label: "is empty" },
      { value: "notempty", label: "is not empty" },
    ];

    const panel = document.createElement("div");
    panel.className = "preset-edit-panel";

    // ── Name ────────────────────────────────────────────────────────────────
    const nameLabel = document.createElement("div");
    nameLabel.className   = "panel-label";
    nameLabel.textContent = "NAME";
    panel.appendChild(nameLabel);

    const nameInput = document.createElement("input");
    nameInput.type        = "text";
    nameInput.className   = "panel-input";
    nameInput.value       = preset.label;
    panel.appendChild(nameInput);

    // ── Columns / renames / mappings ─────────────────────────────────────────
    const sessionLabel = document.createElement("div");
    sessionLabel.className   = "panel-label";
    sessionLabel.style.marginTop = "0.5rem";
    sessionLabel.textContent = "COLUMNS · RENAMES · VALUE MAPPINGS";
    panel.appendChild(sessionLabel);

    const sessionInfo = document.createElement("div");
    sessionInfo.className = "panel-hint";
    panel.appendChild(sessionInfo);

    function refreshSessionInfo() {
      const fields = preset.keepFields || [];
      const renames = preset.renameFields || {};
      const renamed = Object.entries(renames).filter(([k, v]) => k !== v).map(([k, v]) => `${k}→${v}`);
      const mappingCols = Object.keys(preset.valueMapping || {});
      let lines = [`${fields.length} column(s): ${fields.join(", ")}`];
      if (renamed.length) lines.push(`Renames: ${renamed.join(", ")}`);
      if (mappingCols.length) lines.push(`Value mappings on: ${mappingCols.join(", ")}`);
      sessionInfo.textContent = lines.join(" · ");
    }
    refreshSessionInfo();

    const updateFromSessionBtn = document.createElement("button");
    updateFromSessionBtn.className   = "btn btn-ghost";
    updateFromSessionBtn.style.cssText = "font-size:0.72rem;padding:0.2rem 0.5rem;margin-top:0.2rem;";
    updateFromSessionBtn.textContent = parsedData ? "↻ Update from current session" : "Load a file to update from session";
    updateFromSessionBtn.disabled    = !parsedData;
    updateFromSessionBtn.title       = "Replaces stored columns, renames, and value mappings with current session state";
    updateFromSessionBtn.addEventListener("click", () => {
      // Stamp current viewState into the preset object (in memory only — saved on confirm)
      const renames = {};
      viewState.visibleFields.forEach(f => { renames[f] = viewState.displayNames[f] || f; });
      const valueMappings = {};
      viewState.appliedMappings.forEach(({ column, from, to }) => {
        if (!valueMappings[column]) valueMappings[column] = {};
        valueMappings[column][from] = to;
      });
      preset = { ...preset, keepFields: [...viewState.visibleFields], renameFields: renames, valueMapping: valueMappings };
      refreshSessionInfo();
      updateFromSessionBtn.textContent = "✓ Updated from session";
      setTimeout(() => { updateFromSessionBtn.textContent = "↻ Update from current session"; }, 2000);
    });
    panel.appendChild(updateFromSessionBtn);

    // ── Row filters ──────────────────────────────────────────────────────────
    const rfLabel = document.createElement("div");
    rfLabel.className   = "panel-label";
    rfLabel.style.marginTop = "0.5rem";
    rfLabel.textContent = "ROW FILTERS";
    panel.appendChild(rfLabel);

    const rfList = document.createElement("div");
    rfList.className = "rf-list";
    panel.appendChild(rfList);

    function addRfRow(initField = "", initOp = "eq", initVal = "") {
      const row = document.createElement("div");
      row.className = "rf-row";

      const fieldSel = document.createElement("select");
      fieldSel.className = "panel-select rf-field-select";
      const phOpt = document.createElement("option");
      phOpt.value = ""; phOpt.textContent = "Column…";
      fieldSel.appendChild(phOpt);

      // Use current data fields if available, otherwise use preset's keepFields
      const availableFields = parsedData
        ? parsedData.fields.filter(f => f !== NOTE_COL)
        : (preset.keepFields || []);
      availableFields.forEach(f => {
        const opt = document.createElement("option");
        opt.value = f;
        opt.textContent = (parsedData ? viewState.displayNames[f] : (preset.renameFields?.[f])) || f;
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
      removeBtn.addEventListener("click", () => row.remove());

      row.appendChild(fieldSel);
      row.appendChild(opSel);
      row.appendChild(valInput);
      row.appendChild(removeBtn);
      rfList.appendChild(row);
    }

    // Pre-populate with existing filters
    if (preset.rowFilters?.length) {
      preset.rowFilters.forEach(rf => addRfRow(rf.field, rf.op, rf.value || ""));
    } else {
      addRfRow();
    }

    const addRfBtn = document.createElement("button");
    addRfBtn.className   = "btn btn-ghost";
    addRfBtn.style.cssText = "font-size:0.72rem;padding:0.15rem 0.45rem;margin-top:0.1rem;";
    addRfBtn.textContent = "+ Add filter rule";
    addRfBtn.addEventListener("click", () => addRfRow());
    panel.appendChild(addRfBtn);

    // ── Save / Cancel ────────────────────────────────────────────────────────
    const footer = document.createElement("div");
    footer.style.cssText = "display:flex;gap:0.3rem;margin-top:0.5rem;";

    const saveBtn = document.createElement("button");
    saveBtn.className   = "btn";
    saveBtn.style.cssText = "font-size:0.75rem;padding:0.3rem 0.65rem;";
    saveBtn.textContent = "Save changes";
    saveBtn.addEventListener("click", () => {
      const newName = nameInput.value.trim() || preset.label;

      const newFilters = [];
      rfList.querySelectorAll(".rf-row").forEach(row => {
        const field = row.querySelector(".rf-field-select").value;
        const op    = row.querySelector(".rf-op-select").value;
        const value = row.querySelector(".rf-val-input").value.trim();
        if (!field || !op) return;
        if (op === "empty" || op === "notempty" || value) {
          newFilters.push({ field, op, value: (op === "empty" || op === "notempty") ? "" : value });
        }
      });

      const map = loadUserPresets();
      if (map[preset.id]) {
        map[preset.id] = {
          ...preset,
          label:      newName,
          rowFilters: newFilters,
          savedAt:    Date.now(),
        };
        saveUserPresets(map);
      }
      renderDrawerPanel("presets");
    });

    const cancelBtn = document.createElement("button");
    cancelBtn.className   = "btn btn-ghost";
    cancelBtn.style.cssText = "font-size:0.75rem;padding:0.3rem 0.65rem;";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => renderDrawerPanel("presets"));

    footer.appendChild(saveBtn);
    footer.appendChild(cancelBtn);
    panel.appendChild(footer);

    parentRow.appendChild(panel);
    nameInput.focus();
    nameInput.select();
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

  // Note Keys panel
  function buildNoteKeysPanel(container) {
    const activeConfig = getActiveNoteConfig();
    const allConfigs = loadNoteConfigs();
    const configCount = Object.keys(allConfigs).length;
    
    // Tab container
    const tabContainer = document.createElement("div");
    tabContainer.className = "note-keys-tabs";
    
    const configureTab = document.createElement("button");
    configureTab.className = "note-keys-tab active";
    configureTab.textContent = "Configure";
    
    const manageTab = document.createElement("button");
    manageTab.className = "note-keys-tab";
    manageTab.textContent = `Manage Configs (${configCount})`;
    
    tabContainer.appendChild(configureTab);
    tabContainer.appendChild(manageTab);
    container.appendChild(tabContainer);
    
    // Tab content container
    const tabContent = document.createElement("div");
    tabContent.className = "note-keys-content";
    container.appendChild(tabContent);
    
    // Build Configure Tab
    function buildConfigureTab() {
      tabContent.innerHTML = "";
      
      // Info section
      const infoSection = panelSection("WHAT ARE STATUSNOTES?");
      const infoText = document.createElement("div");
      infoText.className = "panel-hint";
      infoText.textContent = "StatusNotes let you add notes to rows that persist across CSV loads. Configure key columns to identify the same rows in different files.";
      infoSection.appendChild(infoText);
      tabContent.appendChild(infoSection);
      
      const divider1 = document.createElement("div");
      divider1.className = "panel-divider";
      tabContent.appendChild(divider1);
      
      // Configure section
      const configSection = panelSection("CONFIGURE KEY COLUMNS");
      
      if (!parsedData) {
        const hint = document.createElement("div");
        hint.className = "panel-hint";
        hint.style.padding = "1rem";
        hint.style.textAlign = "center";
        hint.style.color = "var(--security-warning)";
        hint.innerHTML = "<strong>⚠️ No CSV loaded</strong><br><br>Load a CSV file first, then return here to configure note persistence.";
        configSection.appendChild(hint);
        tabContent.appendChild(configSection);
        return;
      }
      
      // Auto-detect and show suggestion
      const detected = detectKeyColumns(parsedData.fields);
      
      const hint = document.createElement("div");
      hint.className = "panel-hint";
      hint.style.marginBottom = "0.75rem";
      hint.innerHTML = "Choose columns that uniquely identify rows. <strong>Without key columns, notes are temporary</strong> (lost on refresh). With key columns, notes persist permanently.";
      configSection.appendChild(hint);
      
      // Config name
      const nameLabel = document.createElement("label");
      nameLabel.className = "panel-label";
      nameLabel.textContent = "Configuration Name:";
      configSection.appendChild(nameLabel);
      
      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.className = "panel-input";
      nameInput.id = "noteKeyConfigName";
      nameInput.placeholder = "e.g., Q1 2026 Training";
      nameInput.value = activeConfig?.name || "";
      configSection.appendChild(nameInput);
      
      // Primary column
      const primaryLabel = document.createElement("label");
      primaryLabel.className = "panel-label";
      primaryLabel.style.marginTop = "0.75rem";
      primaryLabel.textContent = "Primary Identifier (required):";
      configSection.appendChild(primaryLabel);
      
      const primarySelect = document.createElement("select");
      primarySelect.className = "panel-select";
      primarySelect.id = "noteKeyPrimary";
      
      const primaryPlaceholder = document.createElement("option");
      primaryPlaceholder.value = "";
      primaryPlaceholder.textContent = "Select column...";
      primarySelect.appendChild(primaryPlaceholder);
      
      parsedData.fields.filter(f => f !== NOTE_COL).forEach(f => {
        const opt = document.createElement("option");
        opt.value = f;
        opt.textContent = viewState.displayNames[f] || f;
        if (f === detected.primary || f === activeConfig?.keyColumns?.primary) {
          opt.selected = true;
        }
        primarySelect.appendChild(opt);
      });
      configSection.appendChild(primarySelect);
      
      if (detected.primary) {
        const autoHint = document.createElement("div");
        autoHint.className = "panel-hint";
        autoHint.style.color = "var(--security-success)";
        autoHint.style.marginTop = "0.25rem";
        autoHint.textContent = `✓ Auto-detected: ${detected.primary}`;
        configSection.appendChild(autoHint);
      }
      
      // Secondary column
      const secondaryLabel = document.createElement("label");
      secondaryLabel.className = "panel-label";
      secondaryLabel.style.marginTop = "0.75rem";
      secondaryLabel.textContent = "Fallback Identifier (optional):";
      configSection.appendChild(secondaryLabel);
      
      const secondarySelect = document.createElement("select");
      secondarySelect.className = "panel-select";
      secondarySelect.id = "noteKeySecondary";
      
      const secondaryPlaceholder = document.createElement("option");
      secondaryPlaceholder.value = "";
      secondaryPlaceholder.textContent = "(none)";
      secondarySelect.appendChild(secondaryPlaceholder);
      
      parsedData.fields.filter(f => f !== NOTE_COL).forEach(f => {
        const opt = document.createElement("option");
        opt.value = f;
        opt.textContent = viewState.displayNames[f] || f;
        if (f === detected.secondary || f === activeConfig?.keyColumns?.secondary) {
          opt.selected = true;
        }
        secondarySelect.appendChild(opt);
      });
      configSection.appendChild(secondarySelect);
      
      if (detected.secondary) {
        const autoHint = document.createElement("div");
        autoHint.className = "panel-hint";
        autoHint.style.color = "var(--security-success)";
        autoHint.style.marginTop = "0.25rem";
        autoHint.textContent = `✓ Auto-detected: ${detected.secondary}`;
        configSection.appendChild(autoHint);
      }
      
      // Context column
      const contextLabel = document.createElement("label");
      contextLabel.className = "panel-label";
      contextLabel.style.marginTop = "0.75rem";
      contextLabel.textContent = "Campaign/Batch ID (optional):";
      configSection.appendChild(contextLabel);
      
      const contextSelect = document.createElement("select");
      contextSelect.className = "panel-select";
      contextSelect.id = "noteKeyContext";
      
      const contextPlaceholder = document.createElement("option");
      contextPlaceholder.value = "";
      contextPlaceholder.textContent = "(none)";
      contextSelect.appendChild(contextPlaceholder);
      
      parsedData.fields.filter(f => f !== NOTE_COL).forEach(f => {
        const opt = document.createElement("option");
        opt.value = f;
        opt.textContent = viewState.displayNames[f] || f;
        if (f === detected.context || f === activeConfig?.keyColumns?.context) {
          opt.selected = true;
        }
        contextSelect.appendChild(opt);
      });
      configSection.appendChild(contextSelect);
      
      if (detected.context) {
        const autoHint = document.createElement("div");
        autoHint.className = "panel-hint";
        autoHint.style.color = "var(--security-success)";
        autoHint.style.marginTop = "0.25rem";
        autoHint.textContent = `✓ Auto-detected: ${detected.context}`;
        configSection.appendChild(autoHint);
      }
      
      // Preview
      const previewBox = document.createElement("div");
      previewBox.className = "note-key-preview";
      previewBox.innerHTML = `<strong>Preview:</strong> <code id="noteKeyPreview">Select columns to see preview</code>`;
      previewBox.style.marginTop = "0.75rem";
      configSection.appendChild(previewBox);
      
      // Update preview function
      function updatePreview() {
        const primary = primarySelect.value;
        const secondary = secondarySelect.value;
        const context = contextSelect.value;
        const previewEl = document.getElementById("noteKeyPreview");
        
        if (!previewEl) {
          console.warn("Preview element not found");
          return;
        }
        
        if (!primary) {
          previewEl.textContent = "Select primary column";
          return;
        }
        
        // Get first row value
        const firstRow = parsedData.rows[0];
        if (!firstRow) {
          previewEl.textContent = "No data rows";
          return;
        }
        
        const primaryVal = String(firstRow[primary] || "").trim().toLowerCase();
        const contextVal = context ? String(firstRow[context] || "").trim() : "";
        
        if (contextVal) {
          previewEl.textContent = `${primaryVal}::${contextVal}`;
        } else {
          previewEl.textContent = primaryVal;
        }
      }
      
      primarySelect.addEventListener("change", updatePreview);
      secondarySelect.addEventListener("change", updatePreview);
      contextSelect.addEventListener("change", updatePreview);
      
      // Protection notice
      const protectNotice = document.createElement("div");
      protectNotice.className = "panel-hint";
      protectNotice.style.marginTop = "0.75rem";
      protectNotice.style.color = "var(--text-muted)";
      protectNotice.innerHTML = "🔒 Key columns will be <strong>read-only</strong> to prevent breaking note links.";
      configSection.appendChild(protectNotice);
      
      tabContent.appendChild(configSection);
      
      // Call updatePreview AFTER adding to DOM
      updatePreview();
      
      // Save button
      const saveBtn = document.createElement("button");
      saveBtn.className = "btn btn-primary";
      saveBtn.textContent = activeConfig ? "Update Configuration" : "Save Configuration";
      saveBtn.style.marginTop = "1rem";
      saveBtn.addEventListener("click", () => {
        const name = nameInput.value.trim();
        const primary = primarySelect.value;
        
        if (!name) {
          alert("Please enter a configuration name.");
          return;
        }
        
        if (!primary) {
          alert("Please select a primary identifier column.");
          return;
        }
        
        const configs = loadNoteConfigs();
        const id = activeConfig?.id || `config_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        configs[id] = {
          id,
          name,
          keyColumns: {
            primary,
            secondary: secondarySelect.value || null,
            context: contextSelect.value || null
          },
          createdAt: activeConfig?.createdAt || new Date().toISOString(),
          lastUsed: new Date().toISOString()
        };
        
        saveNoteConfigs(configs);
        setActiveNoteConfig(id);
        
        // Refresh UI
        renderDrawerPanel("notekeys");
        updateFileInfo();
        renderTablePreview();
      });
      tabContent.appendChild(saveBtn);
      
      // Current status
      const divider2 = document.createElement("div");
      divider2.className = "panel-divider";
      tabContent.appendChild(divider2);
      
      const statusSection = panelSection("CURRENT STATUS");
      const statusBox = document.createElement("div");
      statusBox.className = "note-key-status";
      
      if (activeConfig) {
        statusBox.innerHTML = `
          <div style="color: var(--security-success); font-weight: 600;">✓ Persistent Mode</div>
          <div style="margin-top: 0.25rem; font-size: 0.875rem; color: var(--text-muted);">
            Active: ${activeConfig.name}<br>
            Notes will persist across CSV loads
          </div>
        `;
      } else {
        statusBox.innerHTML = `
          <div style="color: var(--security-warning); font-weight: 600;">⚠️ Temporary Mode</div>
          <div style="margin-top: 0.25rem; font-size: 0.875rem; color: var(--text-muted);">
            Notes will be lost on refresh<br>
            Save a configuration to enable persistence
          </div>
        `;
      }
      statusSection.appendChild(statusBox);
      tabContent.appendChild(statusSection);
    }
    
    // Build Manage Tab
    function buildManageTab() {
      tabContent.innerHTML = "";
      
      const configs = loadNoteConfigs();
      const configList = Object.values(configs).sort((a, b) => 
        new Date(b.lastUsed) - new Date(a.lastUsed)
      );
      
      if (configList.length === 0) {
        const emptySection = panelSection("NO CONFIGURATIONS");
        const hint = document.createElement("div");
        hint.className = "panel-hint";
        hint.textContent = "No saved configurations yet. Use the Configure tab to create one.";
        emptySection.appendChild(hint);
        tabContent.appendChild(emptySection);
        return;
      }
      
      const section = panelSection("SAVED CONFIGURATIONS");
      
      configList.forEach(config => {
        const configCard = document.createElement("div");
        configCard.className = "note-config-card";
        if (activeConfig?.id === config.id) {
          configCard.classList.add("active");
        }
        
        const header = document.createElement("div");
        header.className = "note-config-header";
        
        const nameEl = document.createElement("div");
        nameEl.className = "note-config-name";
        nameEl.textContent = config.name;
        if (activeConfig?.id === config.id) {
          nameEl.innerHTML += ' <span style="color: var(--security-success); font-size: 0.875rem;">✓ Active</span>';
        }
        header.appendChild(nameEl);
        
        configCard.appendChild(header);
        
        const details = document.createElement("div");
        details.className = "note-config-details";
        
        const keyInfo = document.createElement("div");
        keyInfo.style.fontSize = "0.875rem";
        keyInfo.style.color = "var(--text-muted)";
        const parts = [];
        if (config.keyColumns.primary) parts.push(config.keyColumns.primary);
        if (config.keyColumns.secondary) parts.push(`+ ${config.keyColumns.secondary}`);
        if (config.keyColumns.context) parts.push(`+ ${config.keyColumns.context}`);
        keyInfo.textContent = parts.join(" ");
        details.appendChild(keyInfo);
        
        const metadata = document.createElement("div");
        metadata.style.fontSize = "0.75rem";
        metadata.style.color = "var(--text-secondary)";
        metadata.style.marginTop = "0.25rem";
        
        const created = new Date(config.createdAt);
        const lastUsed = new Date(config.lastUsed);
        const now = new Date();
        const hoursAgo = Math.floor((now - lastUsed) / (1000 * 60 * 60));
        const lastUsedText = hoursAgo < 1 ? "Just now" :
                            hoursAgo < 24 ? `${hoursAgo}h ago` :
                            `${Math.floor(hoursAgo / 24)}d ago`;
        
        const noteCount = getNoteCountForConfig(config.id);
        metadata.innerHTML = `Created: ${created.toLocaleDateString()} • Last used: ${lastUsedText} • ${noteCount} notes`;
        details.appendChild(metadata);
        
        configCard.appendChild(details);
        
        const actions = document.createElement("div");
        actions.className = "note-config-actions";
        
        if (activeConfig?.id !== config.id) {
          const activateBtn = document.createElement("button");
          activateBtn.className = "btn btn-ghost btn-sm";
          activateBtn.textContent = "Make Active";
          activateBtn.addEventListener("click", () => {
            setActiveNoteConfig(config.id);
            renderDrawerPanel("notekeys");
            updateFileInfo();
            renderTablePreview();
          });
          actions.appendChild(activateBtn);
        }
        
        const exportBtn = document.createElement("button");
        exportBtn.className = "btn btn-ghost btn-sm";
        exportBtn.textContent = "Export Notes";
        exportBtn.addEventListener("click", () => {
          exportConfigNotesAsCSV(config.id, config.name);
        });
        actions.appendChild(exportBtn);
        
        const deleteBtn = document.createElement("button");
        deleteBtn.className = "btn btn-ghost btn-sm btn-text-danger";
        deleteBtn.textContent = "Delete";
        let confirmTimeout = null;
        let confirming = false;
        deleteBtn.addEventListener("click", () => {
          if (!confirming) {
            confirming = true;
            deleteBtn.textContent = "Sure? Click again";
            deleteBtn.style.backgroundColor = "var(--security-danger-bg)";
            confirmTimeout = setTimeout(() => {
              confirming = false;
              deleteBtn.textContent = "Delete";
              deleteBtn.style.backgroundColor = "";
            }, 3000);
          } else {
            clearTimeout(confirmTimeout);
            const noteCount = getNoteCountForConfig(config.id);
            if (noteCount > 0) {
              const doExport = confirm(`Delete "${config.name}"?\n\n${noteCount} notes will be deleted.\n\nClick OK to export notes first, or Cancel to delete without exporting.`);
              if (doExport) {
                exportConfigNotesAsCSV(config.id, config.name);
              }
            }
            deleteNoteConfig(config.id);
            renderDrawerPanel("notekeys");
            updateFileInfo();
            renderTablePreview();
          }
        });
        actions.appendChild(deleteBtn);
        
        configCard.appendChild(actions);
        section.appendChild(configCard);
      });
      
      tabContent.appendChild(section);
      
      // Storage info
      const storageSection = panelSection("STORAGE");
      const notes = loadAnnotations();
      const totalNotes = Object.keys(notes).length;
      const storageInfo = document.createElement("div");
      storageInfo.className = "panel-hint";
      storageInfo.textContent = `Total: ${configList.length} configurations, ${totalNotes} notes`;
      storageSection.appendChild(storageInfo);
      tabContent.appendChild(storageSection);
    }
    
    // Tab switching
    configureTab.addEventListener("click", () => {
      configureTab.classList.add("active");
      manageTab.classList.remove("active");
      buildConfigureTab();
    });
    
    manageTab.addEventListener("click", () => {
      manageTab.classList.remove("active");
      configureTab.classList.add("active");
      manageTab.classList.add("active");
      configureTab.classList.remove("active");
      buildManageTab();
    });
    
    // Build initial tab
    buildConfigureTab();
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
      dedupMsg.style.color = removed > 0 ? "var(--security-success)" : "var(--text-muted)";

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

      const protectedCols = getProtectedColumns();
      const targetFields = col === "__all__"
        ? getEffectiveFields().filter(f => f !== NOTE_COL && !protectedCols.has(f))
        : protectedCols.has(col) ? [] : [col];

      if (targetFields.length === 0) {
        cleanMsg.textContent = "No editable columns selected.";
        cleanMsg.style.color = "var(--security-danger)";
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
      cleanMsg.style.color = changed > 0 ? "var(--security-success)" : "var(--text-muted)";

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
          joinMsg.style.color = "var(--security-danger)";
          return;
        }
        if (!importFields.length) {
          joinMsg.textContent = "Select at least one column to bring in.";
          joinMsg.style.color = "var(--security-danger)";
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
        joinMsg.style.color = unmatched > 0 ? "var(--security-warning)" : "var(--security-success)";

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
          joinFileStatus.style.color = "var(--security-success)";
          buildJoinConfig();
        },
        error: err => {
          joinFileStatus.textContent = `Error: ${err.message}`;
          joinFileStatus.style.color = "var(--security-danger)";
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


  // ── Reference Tables Storage ─────────────────────────────────────────────
  const REFERENCE_TABLES_KEY = "pbTools_referenceTables";

  function loadReferenceTables() {
    try {
      const raw = localStorage.getItem(REFERENCE_TABLES_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (_) { return {}; }
  }

  function saveReferenceTables(tables) {
    try {
      localStorage.setItem(REFERENCE_TABLES_KEY, JSON.stringify(tables));
    } catch (_) {}
  }

  // ── Reference Tables Panel ───────────────────────────────────────────────
  function buildReferencePanel(container) {
    const tables = loadReferenceTables();
    const tableIds = Object.keys(tables);

    // ── Header actions ────────────────────────────────────────────────────
    const headerSection = panelSection(null);
    headerSection.style.cssText = "display:flex;gap:0.4rem;flex-wrap:wrap;margin-bottom:0.25rem;";

    const newBtn = document.createElement("button");
    newBtn.className = "btn btn-sm";
    newBtn.textContent = "+ New Table";
    newBtn.addEventListener("click", () => showReferenceTableEditor(null, container));

    const importBtn = document.createElement("button");
    importBtn.className = "btn btn-secondary btn-sm";
    importBtn.textContent = "Import CSV";
    importBtn.title = "Import a reference table from a CSV file";
    importBtn.addEventListener("click", () => {
      const inp = document.createElement("input");
      inp.type = "file";
      inp.accept = ".csv";
      inp.addEventListener("change", () => {
        const file = inp.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = e => {
          try {
            const parsed = Papa.parse(e.target.result.trim(), { header: true, skipEmptyLines: true });
            if (!parsed.data.length || !parsed.meta.fields.length) {
              alert("CSV appears empty or invalid.");
              return;
            }
            // Show editor pre-populated with this data
            showReferenceTableEditor(null, container, {
              name: file.name.replace(/\.csv$/i, ""),
              fields: parsed.meta.fields,
              data: parsed.data,
            });
          } catch (err) {
            alert("Could not parse CSV: " + err.message);
          }
        };
        reader.readAsText(file);
      });
      inp.click();
    });

    const exportAllBtn = document.createElement("button");
    exportAllBtn.className = "btn btn-secondary btn-sm";
    exportAllBtn.textContent = "Export All";
    exportAllBtn.title = "Export all reference tables as JSON";
    exportAllBtn.disabled = tableIds.length === 0;
    exportAllBtn.addEventListener("click", () => {
      const blob = new Blob([JSON.stringify(tables, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "reference_tables.json";
      a.click();
    });

    headerSection.appendChild(newBtn);
    headerSection.appendChild(importBtn);
    headerSection.appendChild(exportAllBtn);
    container.appendChild(headerSection);

    const divider = document.createElement("div");
    divider.className = "panel-divider";
    container.appendChild(divider);

    // ── Table list ────────────────────────────────────────────────────────
    if (tableIds.length === 0) {
      noDataMessage(container, "No reference tables yet. Create one or import from CSV.");
      return;
    }

    tableIds.forEach(id => {
      const tbl = tables[id];
      const card = document.createElement("div");
      card.className = "calc-column-item";
      card.style.cssText = "padding:0.6rem;background:var(--bg-tertiary);border-radius:0.35rem;margin-bottom:0.6rem;";

      // Card header row
      const cardHeader = document.createElement("div");
      cardHeader.style.cssText = "display:flex;justify-content:space-between;align-items:flex-start;gap:0.5rem;";

      const meta = document.createElement("div");
      meta.style.flex = "1";

      const nameEl = document.createElement("div");
      nameEl.style.cssText = "font-weight:600;color:var(--text-primary);font-size:0.9rem;";
      nameEl.textContent = tbl.name;

      const metaEl = document.createElement("div");
      metaEl.style.cssText = "font-size:0.75rem;color:var(--text-muted);margin-top:0.1rem;";
      const rowCount = tbl.data ? tbl.data.length : 0;
      const cols = tbl.fields ? tbl.fields.join(", ") : "";
      metaEl.textContent = `${rowCount} row${rowCount !== 1 ? "s" : ""} · ${cols}`;
      if (tbl.lastUpdated) {
        metaEl.textContent += ` · Updated ${tbl.lastUpdated}`;
      }

      meta.appendChild(nameEl);
      meta.appendChild(metaEl);

      const actions = document.createElement("div");
      actions.style.cssText = "display:flex;gap:0.3rem;flex-shrink:0;";

      const editBtn = document.createElement("button");
      editBtn.className = "btn btn-ghost btn-xs";
      editBtn.textContent = "Edit";
      editBtn.addEventListener("click", () => showReferenceTableEditor(id, container));

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "btn btn-ghost btn-xs btn-text-danger";
      deleteBtn.textContent = "Delete";
      deleteBtn.addEventListener("click", () => {
        if (confirm(`Delete reference table "${tbl.name}"? This cannot be undone.`)) {
          const all = loadReferenceTables();
          delete all[id];
          saveReferenceTables(all);
          renderDrawerPanel("reference");
          if (parsedData && calcColumns.length > 0) {
            applyCalcColumns();
            renderTablePreview();
          }
        }
      });

      actions.appendChild(editBtn);
      actions.appendChild(deleteBtn);

      cardHeader.appendChild(meta);
      cardHeader.appendChild(actions);
      card.appendChild(cardHeader);

      // Inline preview (first 3 rows)
      if (tbl.data && tbl.data.length && tbl.fields && tbl.fields.length) {
        const preview = document.createElement("div");
        preview.style.cssText = "margin-top:0.5rem;overflow-x:auto;";
        const previewTable = document.createElement("table");
        previewTable.style.cssText = "border-collapse:collapse;font-size:0.75rem;width:100%;";

        // Header
        const thead = document.createElement("thead");
        const htr = document.createElement("tr");
        tbl.fields.forEach(f => {
          const th = document.createElement("th");
          th.textContent = f;
          th.style.cssText = "padding:0.2rem 0.4rem;text-align:left;color:var(--text-muted);border-bottom:1px solid var(--border-color);white-space:nowrap;";
          htr.appendChild(th);
        });
        thead.appendChild(htr);
        previewTable.appendChild(thead);

        // Up to 3 rows
        const tbody = document.createElement("tbody");
        tbl.data.slice(0, 3).forEach(row => {
          const tr = document.createElement("tr");
          tbl.fields.forEach(f => {
            const td = document.createElement("td");
            td.textContent = row[f] ?? "";
            td.style.cssText = "padding:0.2rem 0.4rem;color:var(--text-secondary);white-space:nowrap;";
            tr.appendChild(td);
          });
          tbody.appendChild(tr);
        });
        if (tbl.data.length > 3) {
          const tr = document.createElement("tr");
          const td = document.createElement("td");
          td.colSpan = tbl.fields.length;
          td.textContent = `… ${tbl.data.length - 3} more row${tbl.data.length - 3 !== 1 ? "s" : ""}`;
          td.style.cssText = "padding:0.2rem 0.4rem;color:var(--text-muted);font-style:italic;";
          tr.appendChild(td);
          tbody.appendChild(tr);
        }
        previewTable.appendChild(tbody);
        preview.appendChild(previewTable);
        card.appendChild(preview);
      }

      container.appendChild(card);
    });
  }

  // ── Reference Table Editor ────────────────────────────────────────────────
  function showReferenceTableEditor(tableId, panelContainer, prefill) {
    const isNew = !tableId;
    const tables = loadReferenceTables();
    const existing = tableId ? tables[tableId] : null;

    // Init working data
    let editorName = existing ? existing.name : (prefill ? prefill.name : "");
    let editorFields = existing ? [...existing.fields] : (prefill ? [...prefill.fields] : ["Key", "Value"]);
    let editorData = existing ? existing.data.map(r => ({ ...r })) : (prefill ? prefill.data.map(r => ({ ...r })) : []);

    // Overlay
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:absolute;inset:0;background:rgba(0,0,0,0.7);z-index:100;display:flex;align-items:flex-start;justify-content:center;padding:1.5rem 1rem;box-sizing:border-box;overflow-y:auto;";

    const panel = document.createElement("div");
    panel.style.cssText = "background:var(--bg-secondary);border-radius:0.6rem;padding:1.2rem;display:flex;flex-direction:column;gap:0.6rem;width:100%;max-width:460px;box-shadow:0 20px 60px rgba(0,0,0,0.5);";

    // Title
    const title = document.createElement("div");
    title.style.cssText = "font-weight:700;font-size:1rem;color:var(--text-primary);";
    title.textContent = isNew ? "New Reference Table" : `Edit: ${existing.name}`;
    panel.appendChild(title);

    // Name input
    const nameLabel = document.createElement("label");
    nameLabel.className = "panel-label";
    nameLabel.textContent = "Table Name:";
    panel.appendChild(nameLabel);

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "panel-input";
    nameInput.value = editorName;
    nameInput.placeholder = "e.g., Employee Counts by State";
    nameInput.addEventListener("input", () => { editorName = nameInput.value.trim(); });
    panel.appendChild(nameInput);

    // Column headers editor
    const colsLabel = document.createElement("div");
    colsLabel.className = "panel-label";
    colsLabel.style.marginTop = "0.25rem";
    colsLabel.textContent = "COLUMNS";
    panel.appendChild(colsLabel);

    const colsRow = document.createElement("div");
    colsRow.style.cssText = "display:flex;gap:0.3rem;flex-wrap:wrap;align-items:center;";

    function rebuildColsRow() {
      colsRow.innerHTML = "";
      editorFields.forEach((f, idx) => {
        const inp = document.createElement("input");
        inp.type = "text";
        inp.className = "panel-input";
        inp.value = f;
        inp.style.cssText = "width:8rem;padding:0.25rem 0.4rem;font-size:0.8rem;";
        inp.addEventListener("change", () => {
          const oldName = editorFields[idx];
          const newName = inp.value.trim() || oldName;
          editorFields[idx] = newName;
          // Rename in data rows
          editorData.forEach(row => {
            if (oldName !== newName) {
              row[newName] = row[oldName];
              delete row[oldName];
            }
          });
          rebuildDataTable();
        });
        const removeColBtn = document.createElement("button");
        removeColBtn.className = "btn btn-ghost btn-xs btn-text-danger";
        removeColBtn.textContent = "✕";
        removeColBtn.title = "Remove column";
        removeColBtn.style.padding = "0.1rem 0.3rem";
        removeColBtn.addEventListener("click", () => {
          if (editorFields.length <= 1) { alert("A table must have at least one column."); return; }
          const removedName = editorFields[idx];
          editorFields.splice(idx, 1);
          editorData.forEach(row => delete row[removedName]);
          rebuildColsRow();
          rebuildDataTable();
        });
        const group = document.createElement("div");
        group.style.cssText = "display:flex;align-items:center;gap:0.15rem;";
        group.appendChild(inp);
        group.appendChild(removeColBtn);
        colsRow.appendChild(group);
      });

      const addColBtn = document.createElement("button");
      addColBtn.className = "btn btn-ghost btn-xs";
      addColBtn.textContent = "+ Col";
      addColBtn.addEventListener("click", () => {
        editorFields.push(`Column${editorFields.length + 1}`);
        rebuildColsRow();
        rebuildDataTable();
      });
      colsRow.appendChild(addColBtn);
    }

    rebuildColsRow();
    panel.appendChild(colsRow);

    // Data table
    const dataLabel = document.createElement("div");
    dataLabel.className = "panel-label";
    dataLabel.style.marginTop = "0.25rem";
    dataLabel.textContent = "DATA";
    panel.appendChild(dataLabel);

    const tableWrap = document.createElement("div");
    tableWrap.style.cssText = "overflow:auto;flex:1;min-height:8rem;max-height:20rem;border:1px solid var(--border-color);border-radius:0.25rem;";

    const dataTable = document.createElement("table");
    dataTable.style.cssText = "border-collapse:collapse;font-size:0.8rem;width:100%;";

    function rebuildDataTable() {
      dataTable.innerHTML = "";

      // Header
      const thead = document.createElement("thead");
      const htr = document.createElement("tr");
      // Actions col header
      const actTh = document.createElement("th");
      actTh.style.cssText = "width:2rem;padding:0.25rem;";
      htr.appendChild(actTh);
      editorFields.forEach(f => {
        const th = document.createElement("th");
        th.textContent = f;
        th.style.cssText = "padding:0.25rem 0.4rem;text-align:left;background:var(--bg-tertiary);color:var(--text-muted);white-space:nowrap;border-bottom:1px solid var(--border-color);";
        htr.appendChild(th);
      });
      thead.appendChild(htr);
      dataTable.appendChild(thead);

      // Body
      const tbody = document.createElement("tbody");
      editorData.forEach((row, rowIdx) => {
        const tr = document.createElement("tr");
        // Delete row button
        const delTd = document.createElement("td");
        delTd.style.cssText = "padding:0.15rem;text-align:center;";
        const delBtn = document.createElement("button");
        delBtn.className = "btn btn-ghost btn-xs btn-text-danger";
        delBtn.textContent = "✕";
        delBtn.style.cssText = "padding:0.1rem 0.25rem;font-size:0.7rem;";
        delBtn.addEventListener("click", () => {
          editorData.splice(rowIdx, 1);
          rebuildDataTable();
        });
        delTd.appendChild(delBtn);
        tr.appendChild(delTd);

        editorFields.forEach(f => {
          const td = document.createElement("td");
          const inp = document.createElement("input");
          inp.type = "text";
          inp.value = row[f] ?? "";
          inp.style.cssText = "width:100%;padding:0.2rem 0.35rem;background:var(--bg-primary);border:1px solid var(--border-color);border-radius:0.2rem;color:var(--text-primary);font-size:0.8rem;outline:none;box-sizing:border-box;";
          inp.addEventListener("focus", () => { inp.style.borderColor = "var(--accent)"; inp.style.background = "var(--bg-tertiary)"; });
          inp.addEventListener("blur", () => {
            row[f] = inp.value;
            inp.style.borderColor = "var(--border-color)";
            inp.style.background = "var(--bg-primary)";
          });
          td.style.cssText = "padding:0.1rem;border-bottom:1px solid var(--border-color);";
          td.appendChild(inp);
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
      dataTable.appendChild(tbody);
    }

    rebuildDataTable();
    tableWrap.appendChild(dataTable);
    panel.appendChild(tableWrap);

    // Add row button
    const addRowBtn = document.createElement("button");
    addRowBtn.className = "btn btn-secondary btn-sm";
    addRowBtn.textContent = "+ Add Row";
    addRowBtn.style.alignSelf = "flex-start";
    addRowBtn.addEventListener("click", () => {
      const newRow = {};
      editorFields.forEach(f => newRow[f] = "");
      editorData.push(newRow);
      rebuildDataTable();
      // Scroll to bottom
      setTimeout(() => { tableWrap.scrollTop = tableWrap.scrollHeight; }, 50);
    });
    panel.appendChild(addRowBtn);

    // Error msg
    const errorMsg = document.createElement("div");
    errorMsg.style.cssText = "color:var(--security-danger);font-size:0.82rem;display:none;";
    panel.appendChild(errorMsg);

    // Action buttons
    const btnRow = document.createElement("div");
    btnRow.style.cssText = "display:flex;gap:0.5rem;margin-top:0.25rem;";

    const saveBtn = document.createElement("button");
    saveBtn.className = "btn btn-sm";
    saveBtn.textContent = isNew ? "Create Table" : "Save Changes";
    saveBtn.addEventListener("click", () => {
      // Flush any active inputs
      dataTable.querySelectorAll("input").forEach(inp => inp.blur());

      const finalName = nameInput.value.trim();
      if (!finalName) {
        errorMsg.textContent = "Please enter a table name.";
        errorMsg.style.display = "block";
        return;
      }
      if (editorFields.length === 0) {
        errorMsg.textContent = "Table must have at least one column.";
        errorMsg.style.display = "block";
        return;
      }

      // Deduplicate key col values
      const allTables = loadReferenceTables();
      const id = tableId || `ref_${Date.now()}`;
      allTables[id] = {
        name: finalName,
        fields: editorFields,
        keyColumn: editorFields[0],
        data: editorData,
        lastUpdated: new Date().toLocaleDateString("en-CA"), // YYYY-MM-DD
      };
      saveReferenceTables(allTables);
      overlay.remove();
      renderDrawerPanel("reference");
      // Recalculate any formula columns that use this reference table
      if (parsedData && calcColumns.length > 0) {
        applyCalcColumns();
        renderTablePreview();
      }
    });

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "btn btn-secondary btn-sm";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => {
      overlay.remove();
      renderDrawerPanel("reference");
    });

    btnRow.appendChild(saveBtn);
    btnRow.appendChild(cancelBtn);
    panel.appendChild(btnRow);

    overlay.appendChild(panel);

    // Mount on full workspace for a proper centered dialog
    const workspace = document.getElementById("csvWorkspace");
    if (workspace) {
      workspace.appendChild(overlay);
    }
  }

  // ── Formulas Panel ──────────────────────────────────────────────────
  function buildCalcColumnsPanel(container) {
    if (!parsedData) {
      noDataMessage(container, "Load a CSV file to create formula columns.");
      return;
    }

    loadCalcColumns();

    // ── Active formula columns list ──────────────────────────────────
    const listSection = panelSection(`FORMULA COLUMNS (${calcColumns.length})`);

    if (calcColumns.length === 0) {
      const empty = document.createElement("div");
      empty.className = "panel-hint";
      empty.textContent = 'No formula columns yet. Use "Add Formula Column" below.';
      listSection.appendChild(empty);
    } else {
      calcColumns.forEach(calc => {
        const item = document.createElement("div");
        item.className = "calc-column-item";
        item.style.cssText = "padding:0.5rem;background:var(--bg-tertiary);border-radius:0.3rem;margin-bottom:0.4rem;";

        const hdr = document.createElement("div");
        hdr.style.cssText = "display:flex;justify-content:space-between;align-items:center;gap:0.3rem;margin-bottom:0.2rem;";

        const nameEl = document.createElement("strong");
        nameEl.textContent = calc.name;
        nameEl.style.color = "var(--text-primary)";
        nameEl.style.flex = "1";
        nameEl.style.minWidth = "0";
        nameEl.style.overflow = "hidden";
        nameEl.style.textOverflow = "ellipsis";
        nameEl.style.whiteSpace = "nowrap";

        // Type badge
        const typeBadge = document.createElement("span");
        const calcType = calc.type || "simple";
        typeBadge.textContent = calcType === "lookup" ? "LOOKUP" : "SIMPLE";
        typeBadge.style.cssText = `font-size:0.62rem;padding:0.1rem 0.35rem;border-radius:999px;font-weight:600;flex-shrink:0;
          background:${calcType === "lookup" ? "rgba(167,139,250,0.15)" : "rgba(96,165,250,0.12)"};
          color:${calcType === "lookup" ? "var(--accent)" : "var(--security-info)"};
          border:1px solid ${calcType === "lookup" ? "rgba(167,139,250,0.3)" : "rgba(96,165,250,0.2)"};`;

        const btnGroup = document.createElement("div");
        btnGroup.style.cssText = "display:flex;gap:0.25rem;flex-shrink:0;";

        // Edit button — only for wizard-built (has config) or always show for usability
        const editBtn = document.createElement("button");
        editBtn.className = "btn btn-ghost btn-xs";
        editBtn.textContent = calc.config ? "Edit" : "Edit";
        editBtn.title = calc.config ? "Edit in wizard" : "Edit formula";
        editBtn.addEventListener("click", () => showFormulaWizard(container, calc));

        const deleteBtn = document.createElement("button");
        deleteBtn.className = "btn btn-ghost btn-xs btn-text-danger";
        deleteBtn.textContent = "Delete";
        deleteBtn.addEventListener("click", () => {
          if (confirm(`Delete formula column "${calc.name}"?`)) {
            deleteCalcColumn(calc.id);
            renderDrawerPanel("formulas");
            applyCalcColumns();
            renderTablePreview();
            renderSummaryPanel();
          }
        });

        btnGroup.appendChild(editBtn);
        btnGroup.appendChild(deleteBtn);
        hdr.appendChild(nameEl);
        hdr.appendChild(typeBadge);
        hdr.appendChild(btnGroup);

        const formulaEl = document.createElement("div");
        formulaEl.style.cssText = "font-family:monospace;font-size:0.78rem;color:var(--text-secondary);word-break:break-all;";
        formulaEl.textContent = calc.formula;

        item.appendChild(hdr);
        item.appendChild(formulaEl);
        listSection.appendChild(item);
      });
    }

    container.appendChild(listSection);

    if (calcColumns.length > 0) {
      const clearBtn = document.createElement("button");
      clearBtn.className = "btn btn-secondary btn-sm";
      clearBtn.textContent = "Clear All Formula Columns";
      clearBtn.style.width = "100%";
      clearBtn.style.marginTop = "0.4rem";
      clearBtn.addEventListener("click", () => {
        if (confirm("Delete all formula columns? This cannot be undone.")) {
          const columnNames = calcColumns.map(c => c.name);
          calcColumns = [];
          saveCalcColumns();
          if (parsedData) {
            columnNames.forEach(colName => {
              const idx = parsedData.fields.indexOf(colName);
              if (idx !== -1) parsedData.fields.splice(idx, 1);
              parsedData.rows.forEach(row => delete row[colName]);
              const visIdx = viewState.visibleFields.indexOf(colName);
              if (visIdx !== -1) viewState.visibleFields.splice(visIdx, 1);
              delete viewState.displayNames[colName];
            });
          }
          renderDrawerPanel("formulas");
          renderTablePreview();
          renderSummaryPanel();
        }
      });
      container.appendChild(clearBtn);
    }

    const divider = document.createElement("div");
    divider.className = "panel-divider";
    container.appendChild(divider);

    // ── Add formula column ────────────────────────────────────────────
    const addSection = panelSection("ADD FORMULA COLUMN");

    // Mode toggle
    const modeWrap = document.createElement("div");
    modeWrap.style.cssText = "display:flex;gap:0.3rem;margin-bottom:0.5rem;";

    const modeSimpleBtn = document.createElement("button");
    modeSimpleBtn.className = "btn btn-sm";
    modeSimpleBtn.id = "fmodeSimple";
    modeSimpleBtn.textContent = "Simple";
    modeSimpleBtn.style.flex = "1";

    const modeWizardBtn = document.createElement("button");
    modeWizardBtn.className = "btn btn-secondary btn-sm";
    modeWizardBtn.id = "fmodeWizard";
    modeWizardBtn.textContent = "⚙ Wizard";
    modeWizardBtn.style.flex = "1";

    modeWrap.appendChild(modeSimpleBtn);
    modeWrap.appendChild(modeWizardBtn);
    addSection.appendChild(modeWrap);

    // ── Simple mode form ─────────────────────────────────────────────
    const simpleForm = document.createElement("div");
    simpleForm.id = "formulaSimpleForm";

    const nameLabel = document.createElement("label");
    nameLabel.className = "panel-label";
    nameLabel.textContent = "Column Name:";
    simpleForm.appendChild(nameLabel);

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "panel-input";
    nameInput.placeholder = "e.g., Click Rate %";
    simpleForm.appendChild(nameInput);

    const formulaLabel = document.createElement("label");
    formulaLabel.className = "panel-label";
    formulaLabel.style.marginTop = "0.4rem";
    formulaLabel.textContent = "Formula:";
    simpleForm.appendChild(formulaLabel);

    const formulaInput = document.createElement("input");
    formulaInput.type = "text";
    formulaInput.className = "panel-input";
    formulaInput.placeholder = "{Clicked} / {Recipients} * 100";
    formulaInput.style.fontFamily = "monospace";
    simpleForm.appendChild(formulaInput);

    // Reference table hint
    const refTables = loadReferenceTables();
    const refIds = Object.keys(refTables);

    const syntaxHint = document.createElement("div");
    syntaxHint.className = "panel-hint";
    syntaxHint.style.marginTop = "0.4rem";
    syntaxHint.innerHTML = `<strong>Simple:</strong> {Col1} / {Col2} * 100<br>
      <strong>Lookup:</strong> {Clicked} / LOOKUP('id', MatchCol, ValueCol) * 100`;
    simpleForm.appendChild(syntaxHint);

    if (refIds.length > 0) {
      const refHint = document.createElement("div");
      refHint.className = "panel-hint";
      refHint.style.cssText = "margin-top:0.35rem;background:rgba(167,139,250,0.07);border:1px solid rgba(167,139,250,0.2);border-radius:0.3rem;padding:0.35rem 0.45rem;font-size:0.75rem;";
      const lines = refIds.map(id => {
        const t = refTables[id];
        return `<code>${id}</code> ${t.name}`;
      }).join("<br>");
      refHint.innerHTML = `<span style="color:var(--accent);font-weight:600;">Tables:</span><br>${lines}`;
      simpleForm.appendChild(refHint);
    }

    const simpleError = document.createElement("div");
    simpleError.style.cssText = "color:var(--security-danger);font-size:0.82rem;margin-top:0.4rem;display:none;";
    simpleForm.appendChild(simpleError);

    const addSimpleBtn = applyButton("Add Formula Column");
    addSimpleBtn.style.marginTop = "0.4rem";
    addSimpleBtn.addEventListener("click", () => {
      const name = nameInput.value.trim();
      const formula = formulaInput.value.trim();
      simpleError.style.display = "none";
      if (!name || !formula) { simpleError.textContent = "Enter both name and formula."; simpleError.style.display = "block"; return; }
      if (parsedData.fields.includes(name) || calcColumns.some(c => c.name === name)) {
        simpleError.textContent = `Column "${name}" already exists.`; simpleError.style.display = "block"; return;
      }
      const validation = validateFormula(formula);
      if (!validation.valid) { simpleError.textContent = validation.error; simpleError.style.display = "block"; return; }

      const hasLookup = /LOOKUP\s*\(/i.test(formula);
      calcColumns.push({ id: `calc_${Date.now()}`, name, formula, type: hasLookup ? "lookup" : "simple" });
      saveCalcColumns();
      nameInput.value = "";
      formulaInput.value = "";
      renderDrawerPanel("formulas");
      applyCalcColumns();
      renderTablePreview();
      renderSummaryPanel();
    });
    simpleForm.appendChild(addSimpleBtn);
    addSection.appendChild(simpleForm);

    // ── Wizard mode placeholder ──────────────────────────────────────
    const wizardPlaceholder = document.createElement("div");
    wizardPlaceholder.id = "formulaWizardPlaceholder";
    wizardPlaceholder.style.display = "none";

    const wizardLaunchBtn = document.createElement("button");
    wizardLaunchBtn.className = "btn btn-sm";
    wizardLaunchBtn.style.cssText = "width:100%;margin-top:0.25rem;";
    wizardLaunchBtn.textContent = "Open Formula Wizard →";
    wizardLaunchBtn.addEventListener("click", () => showFormulaWizard(container, null));
    wizardPlaceholder.appendChild(wizardLaunchBtn);

    // Templates
    const tplLabel = document.createElement("div");
    tplLabel.className = "panel-label";
    tplLabel.style.marginTop = "0.75rem";
    tplLabel.textContent = "QUICK TEMPLATES";
    wizardPlaceholder.appendChild(tplLabel);

    const templates = getFormulaTemplates();
    templates.forEach(tpl => {
      const tplBtn = document.createElement("button");
      tplBtn.className = "btn btn-secondary btn-sm";
      tplBtn.style.cssText = "width:100%;margin-top:0.3rem;text-align:left;padding:0.35rem 0.5rem;white-space:normal;";
      tplBtn.innerHTML = `<span style="font-weight:600;display:block;">${tpl.label}</span><span style="font-size:0.72rem;opacity:0.7;display:block;white-space:normal;word-break:break-word;">${tpl.description}</span>`;
      tplBtn.addEventListener("click", () => {
        if (tpl.formula) {
          // Direct formula insertion - switch to manual mode and pre-fill
          modeSimpleBtn.className = "btn btn-sm";
          modeWizardBtn.className = "btn btn-secondary btn-sm";
          simpleForm.style.display = "";
          wizardPlaceholder.style.display = "none";
          nameInput.value = tpl.name || "";
          formulaInput.value = tpl.formula;
          formulaInput.focus();
        } else {
          // Launch wizard with pre-filled config
          showFormulaWizard(container, null, tpl.config);
        }
      });
      wizardPlaceholder.appendChild(tplBtn);
    });

    addSection.appendChild(wizardPlaceholder);
    container.appendChild(addSection);

    // Mode toggle logic
    modeSimpleBtn.addEventListener("click", () => {
      modeSimpleBtn.className = "btn btn-sm";
      modeWizardBtn.className = "btn btn-secondary btn-sm";
      simpleForm.style.display = "";
      wizardPlaceholder.style.display = "none";
    });
    modeWizardBtn.addEventListener("click", () => {
      modeWizardBtn.className = "btn btn-sm";
      modeSimpleBtn.className = "btn btn-secondary btn-sm";
      simpleForm.style.display = "none";
      wizardPlaceholder.style.display = "";
    });
  }

  // ── Formula templates (dynamic — adapt to loaded columns + ref tables) ───
  function getFormulaTemplates() {
    const cols = parsedData ? parsedData.fields.filter(f => f !== NOTE_COL) : [];
    const refTables = loadReferenceTables();
    const firstRef = Object.keys(refTables)[0] || null;
    const firstRefTable = firstRef ? refTables[firstRef] : null;

    // Guess likely numeric columns
    const numericCols = cols.filter(f => {
      if (!parsedData?.rows.length) return false;
      const val = parsedData.rows[0][f];
      return val !== undefined && val !== "" && !isNaN(Number(String(val).replace(/,/g, "")));
    });

    const col1 = numericCols[0] || cols[0] || "Column1";
    const col2 = numericCols[1] || cols[1] || "Column2";
    const strCol = cols.find(f => !numericCols.includes(f)) || cols[0] || "Category";

    const templates = [
      {
        label: "Click Rate %",
        description: "Numerator ÷ Denominator × 100",
        config: { type: "lookup_rate", numeratorCol: col1, denominatorType: "column", denominatorCol: col2, multiplier: 100, name: "Click_Rate_Pct" }
      },
      {
        label: "Per Capita Rate",
        description: "Events per 100 people from reference table",
        config: { type: "lookup_rate", numeratorCol: col1, denominatorType: firstRef ? "lookup" : "column", denominatorCol: col2,
          lookupTable: firstRef, lookupMatchCol: strCol, lookupReturnCol: firstRefTable?.fields?.[1] || "Value",
          multiplier: 100, name: "Per_Capita_Rate" }
      },
      {
        label: "Ratio (A ÷ B)",
        description: "Simple ratio between two columns",
        config: { type: "division", numeratorCol: col1, denominatorType: "column", denominatorCol: col2, name: "Ratio" }
      },
      {
        label: "Difference (A − B)",
        description: "Subtract one column from another",
        config: { type: "difference", col1: col1, col2: col2, name: "Difference" }
      },
      {
        label: "Product (A × B)",
        description: "Multiply two columns",
        config: { type: "product", col1: col1, col2: col2, name: "Product" }
      },
      {
        label: "Count-Based Rate",
        description: "Each row = 1 event. Rate per capita. Use SUM in Data Explorer.",
        formula: firstRef 
          ? `1 / LOOKUP('${firstRef}', {${strCol}}, ${firstRefTable?.fields?.[1] || "Headcount"}) * 100`
          : `1 / {${col2}} * 100`,
        name: "Event_Rate_Pct"
      },
      {
        label: "Percentage Change",
        description: "(New − Old) ÷ Old × 100",
        formula: `({${col2}} - {${col1}}) / {${col1}} * 100`,
        name: "Pct_Change"
      },
    ];
    return templates;
  }

  // ── Formula Wizard Overlay ───────────────────────────────────────────────
  function showFormulaWizard(panelContainer, existingCalc, prefillConfig) {
    const isEdit = !!existingCalc;
    const initConfig = existingCalc?.config || prefillConfig || {};
    const cols = parsedData ? parsedData.fields.filter(f => f !== NOTE_COL) : [];
    const refTables = loadReferenceTables();
    const refIds = Object.keys(refTables);

    // ── Overlay shell ────────────────────────────────────────────────
    const overlay = document.createElement("div");
    // Full-workspace centered dialog
    overlay.style.cssText = "position:absolute;inset:0;background:rgba(0,0,0,0.7);z-index:200;display:flex;align-items:flex-start;justify-content:center;padding:1.5rem 1rem;box-sizing:border-box;overflow-y:auto;";

    const panel = document.createElement("div");
    panel.style.cssText = "background:var(--bg-secondary);border-radius:0.6rem;padding:1.2rem;display:flex;flex-direction:column;gap:0.65rem;width:100%;max-width:420px;box-shadow:0 20px 60px rgba(0,0,0,0.5);";

    const title = document.createElement("div");
    title.style.cssText = "font-weight:700;font-size:0.95rem;color:var(--text-primary);";
    title.textContent = isEdit ? `Edit: ${existingCalc.name}` : "Formula Wizard";
    panel.appendChild(title);

    // ── Formula type selector ───────────────────────────────────────
    const typeLabel = document.createElement("div");
    typeLabel.className = "panel-label";
    typeLabel.textContent = "FORMULA TYPE";
    panel.appendChild(typeLabel);

    const typeSelect = document.createElement("select");
    typeSelect.className = "panel-input";
    [
      { value: "lookup_rate", label: "Rate / Percentage  (A ÷ B × multiplier)" },
      { value: "division",    label: "Division  (A ÷ B)" },
      { value: "difference",  label: "Difference  (A − B)" },
      { value: "product",     label: "Product  (A × B)" },
      { value: "sum",         label: "Sum  (A + B)" },
    ].forEach(opt => {
      const o = document.createElement("option");
      o.value = opt.value;
      o.textContent = opt.label;
      typeSelect.appendChild(o);
    });
    typeSelect.value = initConfig.type || "lookup_rate";
    panel.appendChild(typeSelect);

    // ── Dynamic step container ──────────────────────────────────────
    const stepsWrap = document.createElement("div");
    stepsWrap.style.cssText = "display:flex;flex-direction:column;gap:0.5rem;";
    panel.appendChild(stepsWrap);

    // ── Live formula preview ────────────────────────────────────────
    const previewBox = document.createElement("div");
    previewBox.style.cssText = "background:var(--bg-tertiary);border-radius:0.3rem;padding:0.4rem 0.6rem;font-family:monospace;font-size:0.8rem;color:var(--accent);word-break:break-all;min-height:2rem;border:1px solid rgba(167,139,250,0.2);";
    previewBox.textContent = "…";
    panel.appendChild(previewBox);

    // ── Column name ─────────────────────────────────────────────────
    const nameLabel = document.createElement("label");
    nameLabel.className = "panel-label";
    nameLabel.textContent = "COLUMN NAME";
    panel.appendChild(nameLabel);

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "panel-input";
    nameInput.value = existingCalc?.name || initConfig.name || "";
    nameInput.placeholder = "e.g., Normalized_Click_Rate";
    panel.appendChild(nameInput);

    // ── Error msg ───────────────────────────────────────────────────
    const errorMsg = document.createElement("div");
    errorMsg.style.cssText = "color:var(--security-danger);font-size:0.82rem;display:none;";
    panel.appendChild(errorMsg);

    // ── Buttons ─────────────────────────────────────────────────────
    const btnRow = document.createElement("div");
    btnRow.style.cssText = "display:flex;gap:0.5rem;";

    const saveBtn = document.createElement("button");
    saveBtn.className = "btn btn-sm";
    saveBtn.style.flex = "1";
    saveBtn.textContent = isEdit ? "Save Changes" : "Create Column";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "btn btn-secondary btn-sm";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => { overlay.remove(); renderDrawerPanel("formulas"); });

    btnRow.appendChild(saveBtn);
    btnRow.appendChild(cancelBtn);
    panel.appendChild(btnRow);

    overlay.appendChild(panel);

    // ── Helper: make a column dropdown ─────────────────────────────
    function makeColSelect(labelText, selectedVal) {
      const wrap = document.createElement("div");
      const lbl = document.createElement("div");
      lbl.style.cssText = "font-size:0.72rem;color:var(--text-muted);margin-bottom:0.15rem;";
      lbl.textContent = labelText;
      const sel = document.createElement("select");
      sel.className = "panel-input";
      sel.style.fontSize = "0.82rem";
      cols.forEach(c => {
        const o = document.createElement("option");
        o.value = c; o.textContent = c;
        if (c === selectedVal) o.selected = true;
        sel.appendChild(o);
      });
      wrap.appendChild(lbl);
      wrap.appendChild(sel);
      return { wrap, sel };
    }

    function makeRefTableSelect(labelText, selectedTableId) {
      const wrap = document.createElement("div");
      const lbl = document.createElement("div");
      lbl.style.cssText = "font-size:0.72rem;color:var(--text-muted);margin-bottom:0.15rem;";
      lbl.textContent = labelText;
      const sel = document.createElement("select");
      sel.className = "panel-input";
      sel.style.fontSize = "0.82rem";
      if (refIds.length === 0) {
        const o = document.createElement("option");
        o.value = ""; o.textContent = "(No reference tables — create one first)";
        sel.appendChild(o);
      } else {
        refIds.forEach(id => {
          const o = document.createElement("option");
          o.value = id; o.textContent = refTables[id].name;
          if (id === selectedTableId) o.selected = true;
          sel.appendChild(o);
        });
      }
      wrap.appendChild(lbl);
      wrap.appendChild(sel);
      return { wrap, sel };
    }

    function makeRefColSelect(labelText, tableId, selectedCol) {
      const wrap = document.createElement("div");
      const lbl = document.createElement("div");
      lbl.style.cssText = "font-size:0.72rem;color:var(--text-muted);margin-bottom:0.15rem;";
      lbl.textContent = labelText;
      const sel = document.createElement("select");
      sel.className = "panel-input";
      sel.style.fontSize = "0.82rem";
      const tbl = tableId ? refTables[tableId] : null;
      (tbl?.fields || []).forEach(f => {
        const o = document.createElement("option");
        o.value = f; o.textContent = f;
        if (f === selectedCol) o.selected = true;
        sel.appendChild(o);
      });
      wrap.appendChild(lbl);
      wrap.appendChild(sel);
      return { wrap, sel };
    }

    // ── Build formula preview string ────────────────────────────────
    function buildFormula(cfg) {
      const type = cfg.type || "lookup_rate";
      if (type === "difference") {
        return `{${cfg.col1 || "A"}} - {${cfg.col2 || "B"}}`;
      }
      if (type === "product") {
        return `{${cfg.col1 || "A"}} * {${cfg.col2 || "B"}}`;
      }
      if (type === "sum") {
        return `{${cfg.col1 || "A"}} + {${cfg.col2 || "B"}}`;
      }
      if (type === "division") {
        // Division: numerator / denominator (no multiplier)
        const num = `{${cfg.numeratorCol || "Numerator"}}`;
        let denom;
        if (cfg.denominatorType === "lookup" && cfg.lookupTable) {
          denom = `LOOKUP('${cfg.lookupTable}', ${cfg.lookupMatchCol || "MatchCol"}, ${cfg.lookupReturnCol || "ValueCol"})`;
        } else {
          denom = `{${cfg.denominatorCol || "Denominator"}}`;
        }
        return `${num} / ${denom}`;
      }
      // lookup_rate: numerator / denominator * multiplier
      const num = `{${cfg.numeratorCol || "Numerator"}}`;
      let denom;
      if (cfg.denominatorType === "lookup" && cfg.lookupTable) {
        denom = `LOOKUP('${cfg.lookupTable}', ${cfg.lookupMatchCol || "MatchCol"}, ${cfg.lookupReturnCol || "ValueCol"})`;
      } else {
        denom = `{${cfg.denominatorCol || "Denominator"}}`;
      }
      const mult = cfg.multiplier && cfg.multiplier != 1 ? ` * ${cfg.multiplier}` : "";
      return `${num} / ${denom}${mult}`;
    }

    // ── Render steps based on type ──────────────────────────────────
    let currentConfig = { ...initConfig };

    function updatePreview() {
      previewBox.textContent = buildFormula(currentConfig) || "…";
    }

    function renderSteps() {
      stepsWrap.innerHTML = "";
      const type = typeSelect.value;
      currentConfig.type = type;

      if (type === "lookup_rate" || type === "division") {
        // Step 1: Numerator column
        const step1 = document.createElement("div");
        step1.style.cssText = "background:rgba(148,163,184,0.05);border-radius:0.3rem;padding:0.5rem;border-left:2px solid rgba(96,165,250,0.4);";
        const s1title = document.createElement("div");
        s1title.style.cssText = "font-size:0.75rem;font-weight:600;color:var(--security-info);margin-bottom:0.35rem;";
        s1title.textContent = "Step 1 — Numerator";
        step1.appendChild(s1title);
        const { wrap: numWrap, sel: numSel } = makeColSelect("Column", currentConfig.numeratorCol);
        numSel.addEventListener("change", () => { currentConfig.numeratorCol = numSel.value; updatePreview(); });
        if (!currentConfig.numeratorCol && cols.length) { currentConfig.numeratorCol = numSel.value; }
        step1.appendChild(numWrap);
        stepsWrap.appendChild(step1);

        // Step 2: Denominator
        const step2 = document.createElement("div");
        step2.style.cssText = "background:rgba(148,163,184,0.05);border-radius:0.3rem;padding:0.5rem;border-left:2px solid rgba(167,139,250,0.4);";
        const s2title = document.createElement("div");
        s2title.style.cssText = "font-size:0.75rem;font-weight:600;color:var(--accent);margin-bottom:0.35rem;";
        s2title.textContent = "Step 2 — Denominator";
        step2.appendChild(s2title);

        // Denom type toggle
        const denomTypeRow = document.createElement("div");
        denomTypeRow.style.cssText = "display:flex;gap:0.3rem;margin-bottom:0.4rem;";
        const denomColBtn = document.createElement("button");
        denomColBtn.className = currentConfig.denominatorType !== "lookup" ? "btn btn-xs btn-sm" : "btn btn-secondary btn-xs btn-sm";
        denomColBtn.style.flex = "1";
        denomColBtn.textContent = "Column";
        const denomLookupBtn = document.createElement("button");
        denomLookupBtn.className = currentConfig.denominatorType === "lookup" ? "btn btn-xs btn-sm" : "btn btn-secondary btn-xs btn-sm";
        denomLookupBtn.style.flex = "1";
        denomLookupBtn.textContent = "Reference Table";
        denomTypeRow.appendChild(denomColBtn);
        denomTypeRow.appendChild(denomLookupBtn);
        step2.appendChild(denomTypeRow);

        const denomColWrap = document.createElement("div");
        const denomLookupWrap = document.createElement("div");

        // Column denom
        const { wrap: dcWrap, sel: dcSel } = makeColSelect("Column", currentConfig.denominatorCol);
        dcSel.addEventListener("change", () => { currentConfig.denominatorCol = dcSel.value; updatePreview(); });
        if (!currentConfig.denominatorCol && cols.length) currentConfig.denominatorCol = dcSel.value;
        denomColWrap.appendChild(dcWrap);

        // Lookup denom
        const { wrap: rtWrap, sel: rtSel } = makeRefTableSelect("Table", currentConfig.lookupTable);
        denomLookupWrap.appendChild(rtWrap);

        const lookupMatchRow = document.createElement("div");
        lookupMatchRow.style.cssText = "display:flex;gap:0.3rem;margin-top:0.3rem;align-items:flex-end;";

        const { wrap: lmWrap, sel: lmSel } = makeColSelect("CSV column to match", currentConfig.lookupMatchCol);
        const eqLabel = document.createElement("div");
        eqLabel.style.cssText = "padding-bottom:0.4rem;color:var(--text-muted);font-size:0.8rem;";
        eqLabel.textContent = "=";

        let rvSel;
        const rvContainer = document.createElement("div");
        rvContainer.style.flex = "1";

        function rebuildReturnColSelect() {
          rvContainer.innerHTML = "";
          const tableId = rtSel.value;
          const { wrap: rvWrap, sel: _rvSel } = makeRefColSelect("Table column to get", tableId, currentConfig.lookupReturnCol);
          rvSel = _rvSel;
          rvSel.addEventListener("change", () => { currentConfig.lookupReturnCol = rvSel.value; updatePreview(); });
          if (!currentConfig.lookupReturnCol) currentConfig.lookupReturnCol = rvSel.value;
          rvContainer.appendChild(rvWrap);
        }

        rtSel.addEventListener("change", () => {
          currentConfig.lookupTable = rtSel.value;
          rebuildReturnColSelect();
          updatePreview();
        });
        lmSel.addEventListener("change", () => { currentConfig.lookupMatchCol = lmSel.value; updatePreview(); });
        if (!currentConfig.lookupMatchCol && cols.length) currentConfig.lookupMatchCol = lmSel.value;
        if (!currentConfig.lookupTable && refIds.length) currentConfig.lookupTable = rtSel.value;

        rebuildReturnColSelect();

        lookupMatchRow.appendChild(lmWrap);
        lookupMatchRow.appendChild(eqLabel);
        lookupMatchRow.appendChild(rvContainer);
        denomLookupWrap.appendChild(lookupMatchRow);

        // Show/hide denom sections
        if (currentConfig.denominatorType !== "lookup") {
          denomLookupWrap.style.display = "none";
        } else {
          denomColWrap.style.display = "none";
        }

        denomColBtn.addEventListener("click", () => {
          currentConfig.denominatorType = "column";
          denomColBtn.className = "btn btn-xs btn-sm";
          denomLookupBtn.className = "btn btn-secondary btn-xs btn-sm";
          denomColWrap.style.display = "";
          denomLookupWrap.style.display = "none";
          updatePreview();
        });
        denomLookupBtn.addEventListener("click", () => {
          if (refIds.length === 0) { alert("Create a reference table first."); return; }
          currentConfig.denominatorType = "lookup";
          denomLookupBtn.className = "btn btn-xs btn-sm";
          denomColBtn.className = "btn btn-secondary btn-xs btn-sm";
          denomColWrap.style.display = "none";
          denomLookupWrap.style.display = "";
          updatePreview();
        });

        step2.appendChild(denomColWrap);
        step2.appendChild(denomLookupWrap);
        stepsWrap.appendChild(step2);

        // Step 3: Multiplier (only for lookup_rate, not division)
        if (type === "lookup_rate") {
          const step3 = document.createElement("div");
          step3.style.cssText = "background:rgba(148,163,184,0.05);border-radius:0.3rem;padding:0.5rem;border-left:2px solid rgba(52,211,153,0.4);";
          const s3title = document.createElement("div");
          s3title.style.cssText = "font-size:0.75rem;font-weight:600;color:var(--security-success);margin-bottom:0.35rem;";
          s3title.textContent = "Step 3 — Format";
          step3.appendChild(s3title);

          const multRow = document.createElement("div");
          multRow.style.cssText = "display:flex;gap:0.3rem;flex-wrap:wrap;";
          [
            { label: "Raw (÷ only)", value: 1 },
            { label: "Percentage (× 100)", value: 100 },
            { label: "Per 1,000 (× 1000)", value: 1000 },
          ].forEach(opt => {
            const btn = document.createElement("button");
            btn.className = (currentConfig.multiplier ?? 100) == opt.value ? "btn btn-xs btn-sm" : "btn btn-secondary btn-xs btn-sm";
            btn.style.cssText = "flex:1;min-width:5rem;font-size:0.72rem;";
            btn.textContent = opt.label;
            btn.addEventListener("click", () => {
              currentConfig.multiplier = opt.value;
              multRow.querySelectorAll("button").forEach(b => b.className = "btn btn-secondary btn-xs btn-sm");
              btn.className = "btn btn-xs btn-sm";
              updatePreview();
            });
            multRow.appendChild(btn);
          });
          step3.appendChild(multRow);
          stepsWrap.appendChild(step3);
        }

      } else if (type === "division") {
        // Division: numerator / denominator (no multiplier step)
        
        // Step 1: Numerator column
        const step1 = document.createElement("div");
        step1.style.cssText = "background:rgba(148,163,184,0.05);border-radius:0.3rem;padding:0.5rem;border-left:2px solid rgba(96,165,250,0.4);";
        const s1title = document.createElement("div");
        s1title.style.cssText = "font-size:0.75rem;font-weight:600;color:var(--security-info);margin-bottom:0.35rem;";
        s1title.textContent = "Step 1 — Numerator";
        step1.appendChild(s1title);
        const { wrap: numWrap, sel: numSel } = makeColSelect("Column", currentConfig.numeratorCol);
        numSel.addEventListener("change", () => { currentConfig.numeratorCol = numSel.value; updatePreview(); });
        if (!currentConfig.numeratorCol && cols.length) { currentConfig.numeratorCol = numSel.value; }
        step1.appendChild(numWrap);
        stepsWrap.appendChild(step1);

        // Step 2: Denominator
        const step2 = document.createElement("div");
        step2.style.cssText = "background:rgba(148,163,184,0.05);border-radius:0.3rem;padding:0.5rem;border-left:2px solid rgba(167,139,250,0.4);";
        const s2title = document.createElement("div");
        s2title.style.cssText = "font-size:0.75rem;font-weight:600;color:var(--accent);margin-bottom:0.35rem;";
        s2title.textContent = "Step 2 — Denominator";
        step2.appendChild(s2title);

        // Denom type toggle
        const denomTypeRow = document.createElement("div");
        denomTypeRow.style.cssText = "display:flex;gap:0.3rem;margin-bottom:0.4rem;";
        const denomColBtn = document.createElement("button");
        denomColBtn.className = currentConfig.denominatorType !== "lookup" ? "btn btn-xs btn-sm" : "btn btn-secondary btn-xs btn-sm";
        denomColBtn.style.flex = "1";
        denomColBtn.textContent = "Column";
        const denomLookupBtn = document.createElement("button");
        denomLookupBtn.className = currentConfig.denominatorType === "lookup" ? "btn btn-xs btn-sm" : "btn btn-secondary btn-xs btn-sm";
        denomLookupBtn.style.flex = "1";
        denomLookupBtn.textContent = "Reference Table";
        denomTypeRow.appendChild(denomColBtn);
        denomTypeRow.appendChild(denomLookupBtn);
        step2.appendChild(denomTypeRow);

        const denomColWrap = document.createElement("div");
        const denomLookupWrap = document.createElement("div");

        // Column denom
        const { wrap: dcWrap, sel: dcSel } = makeColSelect("Column", currentConfig.denominatorCol);
        dcSel.addEventListener("change", () => { currentConfig.denominatorCol = dcSel.value; updatePreview(); });
        if (!currentConfig.denominatorCol && cols.length) currentConfig.denominatorCol = dcSel.value;
        denomColWrap.appendChild(dcWrap);

        // Lookup denom
        const { wrap: rtWrap, sel: rtSel } = makeRefTableSelect("Table", currentConfig.lookupTable);
        denomLookupWrap.appendChild(rtWrap);

        const lookupMatchRow = document.createElement("div");
        lookupMatchRow.style.cssText = "display:flex;gap:0.3rem;margin-top:0.3rem;align-items:flex-end;";

        const { wrap: lmWrap, sel: lmSel } = makeColSelect("CSV column to match", currentConfig.lookupMatchCol);
        const eqLabel = document.createElement("div");
        eqLabel.style.cssText = "padding-bottom:0.4rem;color:var(--text-muted);font-size:0.8rem;";
        eqLabel.textContent = "=";

        let rvSel;
        const rvContainer = document.createElement("div");
        rvContainer.style.flex = "1";

        function rebuildReturnColSelect() {
          rvContainer.innerHTML = "";
          const tableId = rtSel.value;
          const { wrap: rvWrap, sel: _rvSel } = makeRefColSelect("Table column to get", tableId, currentConfig.lookupReturnCol);
          rvSel = _rvSel;
          rvSel.addEventListener("change", () => { currentConfig.lookupReturnCol = rvSel.value; updatePreview(); });
          if (!currentConfig.lookupReturnCol) currentConfig.lookupReturnCol = rvSel.value;
          rvContainer.appendChild(rvWrap);
        }

        rtSel.addEventListener("change", () => {
          currentConfig.lookupTable = rtSel.value;
          rebuildReturnColSelect();
          updatePreview();
        });
        lmSel.addEventListener("change", () => { currentConfig.lookupMatchCol = lmSel.value; updatePreview(); });
        if (!currentConfig.lookupMatchCol && cols.length) currentConfig.lookupMatchCol = lmSel.value;
        if (!currentConfig.lookupTable && refIds.length) currentConfig.lookupTable = rtSel.value;

        rebuildReturnColSelect();

        lookupMatchRow.appendChild(lmWrap);
        lookupMatchRow.appendChild(eqLabel);
        lookupMatchRow.appendChild(rvContainer);
        denomLookupWrap.appendChild(lookupMatchRow);

        // Show/hide denom sections
        if (currentConfig.denominatorType !== "lookup") {
          denomLookupWrap.style.display = "none";
        } else {
          denomColWrap.style.display = "none";
        }

        denomColBtn.addEventListener("click", () => {
          currentConfig.denominatorType = "column";
          denomColBtn.className = "btn btn-xs btn-sm";
          denomLookupBtn.className = "btn btn-secondary btn-xs btn-sm";
          denomColWrap.style.display = "";
          denomLookupWrap.style.display = "none";
          updatePreview();
        });
        denomLookupBtn.addEventListener("click", () => {
          if (refIds.length === 0) { alert("Create a reference table first."); return; }
          currentConfig.denominatorType = "lookup";
          denomLookupBtn.className = "btn btn-xs btn-sm";
          denomColBtn.className = "btn btn-secondary btn-xs btn-sm";
          denomColWrap.style.display = "none";
          denomLookupWrap.style.display = "";
          updatePreview();
        });

        step2.appendChild(denomColWrap);
        step2.appendChild(denomLookupWrap);
        stepsWrap.appendChild(step2);

      } else {
        // Difference / Product / Sum — just two column pickers
        const stepA = document.createElement("div");
        stepA.style.cssText = "background:rgba(148,163,184,0.05);border-radius:0.3rem;padding:0.5rem;border-left:2px solid rgba(96,165,250,0.4);";
        const sTitleA = document.createElement("div");
        sTitleA.style.cssText = "font-size:0.75rem;font-weight:600;color:var(--security-info);margin-bottom:0.35rem;";
        sTitleA.textContent = type === "difference" ? "Step 1 — Column A (minuend)" : "Step 1 — Column A";
        stepA.appendChild(sTitleA);
        const { wrap: aWrap, sel: aSel } = makeColSelect("Column", currentConfig.col1);
        aSel.addEventListener("change", () => { currentConfig.col1 = aSel.value; updatePreview(); });
        if (!currentConfig.col1) currentConfig.col1 = aSel.value;
        stepA.appendChild(aWrap);
        stepsWrap.appendChild(stepA);

        const stepB = document.createElement("div");
        stepB.style.cssText = "background:rgba(148,163,184,0.05);border-radius:0.3rem;padding:0.5rem;border-left:2px solid rgba(167,139,250,0.4);";
        const sTitleB = document.createElement("div");
        sTitleB.style.cssText = "font-size:0.75rem;font-weight:600;color:var(--accent);margin-bottom:0.35rem;";
        sTitleB.textContent = type === "difference" ? "Step 2 — Column B (subtrahend)" : "Step 2 — Column B";
        stepB.appendChild(sTitleB);
        const { wrap: bWrap, sel: bSel } = makeColSelect("Column", currentConfig.col2);
        bSel.addEventListener("change", () => { currentConfig.col2 = bSel.value; updatePreview(); });
        if (!currentConfig.col2) currentConfig.col2 = bSel.value;
        stepB.appendChild(bWrap);
        stepsWrap.appendChild(stepB);
      }

      if (!currentConfig.multiplier) currentConfig.multiplier = 100;
      updatePreview();
    }

    typeSelect.addEventListener("change", () => { currentConfig = { type: typeSelect.value }; renderSteps(); });
    renderSteps();

    // ── Save handler ────────────────────────────────────────────────
    saveBtn.addEventListener("click", () => {
      const name = nameInput.value.trim();
      errorMsg.style.display = "none";
      if (!name) { errorMsg.textContent = "Enter a column name."; errorMsg.style.display = "block"; return; }
      if (!isEdit && (parsedData.fields.includes(name) || calcColumns.some(c => c.name === name))) {
        errorMsg.textContent = `Column "${name}" already exists.`; errorMsg.style.display = "block"; return;
      }

      const formula = buildFormula(currentConfig);
      const validation = validateFormula(formula);
      if (!validation.valid) { errorMsg.textContent = validation.error; errorMsg.style.display = "block"; return; }

      const isLookup = /LOOKUP\s*\(/i.test(formula);
      const entry = {
        id: existingCalc?.id || `calc_${Date.now()}`,
        name,
        formula,
        type: isLookup ? "lookup" : "simple",
        config: { ...currentConfig },
      };

      if (isEdit) {
        // Remove old column from data if renamed
        if (existingCalc.name !== name) {
          deleteCalcColumn(existingCalc.id);
          calcColumns.push(entry);
        } else {
          const idx = calcColumns.findIndex(c => c.id === existingCalc.id);
          if (idx !== -1) calcColumns[idx] = entry;
        }
      } else {
        calcColumns.push(entry);
      }

      saveCalcColumns();
      overlay.remove();
      renderDrawerPanel("formulas");
      applyCalcColumns();
      renderTablePreview();
      renderSummaryPanel();
    });

    // Mount on full workspace so wizard can be a proper centered dialog
    const workspace = document.getElementById("csvWorkspace");
    if (workspace) {
      workspace.appendChild(overlay);
    }
  }

  // ── Summary Panel (Drawer) ───────────────────────────────────────────
  function buildSummaryPanel(container) {
    if (!parsedData) {
      noDataMessage(container, "Load a CSV file to create summaries.");
      return;
    }

    // Info section
    const infoSection = panelSection();
    const infoText = document.createElement("div");
    infoText.className = "panel-hint";
    infoText.textContent = "Group rows and aggregate numeric columns to create summary reports.";
    infoSection.appendChild(infoText);
    container.appendChild(infoSection);

    const divider1 = document.createElement("div");
    divider1.className = "panel-divider";
    container.appendChild(divider1);

    // ── GROUP BY ──
    const groupBySection = panelSection("GROUP BY");
    
    const groupBySelect = document.createElement("select");
    groupBySelect.className = "panel-select";
    groupBySelect.id = "summaryGroupBy";
    
    const ph = document.createElement("option");
    ph.value = "";
    ph.textContent = "Select column…";
    groupBySelect.appendChild(ph);
    
    getEffectiveFields().filter(f => f !== NOTE_COL).forEach(f => {
      const opt = document.createElement("option");
      opt.value = f;
      opt.textContent = viewState.displayNames[f] || f;
      groupBySelect.appendChild(opt);
    });
    
    if (lastSummary?.groupBy || lastSummary?.field) {
      groupBySelect.value = lastSummary.groupBy || lastSummary.field;
    }
    
    groupBySection.appendChild(groupBySelect);
    container.appendChild(groupBySection);

    // ── AGGREGATIONS ──
    const aggSection = panelSection("AGGREGATE (OPTIONAL)");
    
    const aggHeader = document.createElement("div");
    aggHeader.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:0.35rem;";
    
    const aggHint = document.createElement("div");
    aggHint.className = "panel-hint";
    aggHint.textContent = "Add metrics to aggregate numeric columns.";
    
    const addAggBtn = document.createElement("button");
    addAggBtn.className = "btn btn-ghost";
    addAggBtn.textContent = "+ Add metric";
    addAggBtn.style.cssText = "padding:0.15rem 0.4rem;font-size:0.7rem;";
    
    aggHeader.appendChild(aggHint);
    aggHeader.appendChild(addAggBtn);
    aggSection.appendChild(aggHeader);
    
    const aggList = document.createElement("div");
    aggList.id = "summaryAggList";
    aggList.style.cssText = "display:flex;flex-direction:column;gap:0.25rem;margin-top:0.35rem;";
    aggSection.appendChild(aggList);
    
    container.appendChild(aggSection);

    // ── OPTIONS ──
    const optionsSection = panelSection();
    const optionsRow = document.createElement("div");
    optionsRow.style.cssText = "display:flex;align-items:center;gap:0.5rem;";
    
    const percentCheck = document.createElement("input");
    percentCheck.type = "checkbox";
    percentCheck.id = "summaryIncludePercent";
    
    const percentLabel = document.createElement("label");
    percentLabel.htmlFor = "summaryIncludePercent";
    percentLabel.className = "panel-hint";
    percentLabel.textContent = "Include % of total";
    percentLabel.style.cssText = "cursor:pointer;margin:0;";
    
    optionsRow.appendChild(percentCheck);
    optionsRow.appendChild(percentLabel);
    optionsSection.appendChild(optionsRow);
    container.appendChild(optionsSection);

    // ── RUN BUTTON ──
    const runBtn = applyButton("Run Summary");
    runBtn.style.width = "100%";
    container.appendChild(runBtn);

    // ── RESULTS AREA ──
    const divider2 = document.createElement("div");
    divider2.className = "panel-divider";
    container.appendChild(divider2);

    const resultsSection = panelSection("RESULTS");
    const resultsContainer = document.createElement("div");
    resultsContainer.id = "summaryDrawerResults";
    resultsContainer.style.cssText = "margin-top:0.5rem;";
    resultsSection.appendChild(resultsContainer);
    container.appendChild(resultsSection);

    // ── Helper: Add aggregation row ──
    function addAggRow(initField = "", initType = "sum") {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;gap:0.3rem;align-items:center;";
      
      const fieldSelect = document.createElement("select");
      fieldSelect.className = "panel-select";
      fieldSelect.style.cssText = "flex:2;min-width:0;"; // More space for column names
      
      const fieldPh = document.createElement("option");
      fieldPh.value = "";
      fieldPh.textContent = "Select column…";
      fieldSelect.appendChild(fieldPh);
      
      getEffectiveFields().filter(f => f !== NOTE_COL).forEach(f => {
        const opt = document.createElement("option");
        opt.value = f;
        opt.textContent = viewState.displayNames[f] || f;
        if (f === initField) opt.selected = true;
        fieldSelect.appendChild(opt);
      });
      
      const typeSelect = document.createElement("select");
      typeSelect.className = "panel-select";
      typeSelect.style.cssText = "flex:0 0 4.5rem;"; // Fixed width for short words (SUM, AVG, etc.)
      
      [
        { value: "sum", label: "SUM" },
        { value: "avg", label: "AVG" },
        { value: "min", label: "MIN" },
        { value: "max", label: "MAX" },
        { value: "count", label: "COUNT" },
      ].forEach(({ value, label }) => {
        const opt = document.createElement("option");
        opt.value = value;
        opt.textContent = label;
        if (value === initType) opt.selected = true;
        typeSelect.appendChild(opt);
      });
      
      const removeBtn = document.createElement("button");
      removeBtn.className = "btn btn-ghost";
      removeBtn.textContent = "✕";
      removeBtn.style.cssText = "padding:0.1rem 0.3rem;font-size:0.7rem;flex-shrink:0;";
      removeBtn.addEventListener("click", () => row.remove());
      
      row.appendChild(fieldSelect);
      row.appendChild(typeSelect);
      row.appendChild(removeBtn);
      aggList.appendChild(row);
    }
    
    // Restore previous aggregations if they exist
    if (lastSummary?.aggregations?.length) {
      lastSummary.aggregations.forEach(agg => addAggRow(agg.field, agg.type));
    }
    
    addAggBtn.addEventListener("click", () => addAggRow());

    // ── RUN SUMMARY ──
    runBtn.addEventListener("click", () => {
      const groupBy = groupBySelect.value;
      if (!groupBy) {
        alert("Please select a column to group by.");
        return;
      }
      
      // Collect aggregations
      const aggregations = [];
      aggList.querySelectorAll("div").forEach(row => {
        const selects = row.querySelectorAll("select");
        if (selects.length >= 2) {
          const field = selects[0].value;
          const type = selects[1].value;
          if (field && type) {
            const displayName = viewState.displayNames[field] || field;
            aggregations.push({
              field,
              type,
              label: `${type.toUpperCase()}(${displayName})`,
            });
          }
        }
      });
      
      const includePercentage = percentCheck.checked;
      
      // Use new aggregation engine
      if (aggregations.length > 0 || includePercentage) {
        lastSummary = computeAggregation({ groupBy, aggregations, includePercentage });
      } else {
        // Simple count for backward compat
        lastSummary = computeSimpleCount(groupBy);
      }
      
      renderSummaryDrawerResults(resultsContainer);
    });

    // Render existing results if any
    if (lastSummary?.rows?.length) {
      renderSummaryDrawerResults(resultsContainer);
    }
  }

  function renderSummaryDrawerResults(container) {
    container.innerHTML = "";
    if (!lastSummary?.rows?.length) {
      const hint = document.createElement("div");
      hint.className = "panel-hint";
      hint.textContent = "No results yet. Configure and run a summary above.";
      container.appendChild(hint);
      return;
    }

    const groupByField = lastSummary.groupBy || lastSummary.field;
    const dn = viewState.displayNames[groupByField] || groupByField;

    const info = document.createElement("div");
    info.className = "panel-hint";
    info.style.marginBottom = "0.5rem";
    info.textContent = `Grouped by "${dn}" — ${lastSummary.rows.length.toLocaleString()} distinct values.`;
    container.appendChild(info);

    const table = document.createElement("table");
    table.className = "summary-table";
    table.style.fontSize = "0.75rem";

    // Build header
    const thead = document.createElement("thead");
    const hr = document.createElement("tr");
    
    // Value column
    const thValue = document.createElement("th");
    thValue.textContent = dn;
    thValue.style.fontSize = "0.7rem";
    hr.appendChild(thValue);
    
    // Count column
    const thCount = document.createElement("th");
    const countStrong = document.createElement("strong");
    countStrong.textContent = "COUNT";
    thCount.appendChild(countStrong);
    thCount.style.cssText = "text-align:right;font-size:0.7rem;";
    hr.appendChild(thCount);
    
    // Percentage column
    if (lastSummary.includePercentage) {
      const thPct = document.createElement("th");
      thPct.textContent = "% Total";
      thPct.style.cssText = "text-align:right;font-size:0.7rem;";
      hr.appendChild(thPct);
    }
    
    // Metric columns
    if (lastSummary.aggregations?.length) {
      lastSummary.aggregations.forEach(agg => {
        const th = document.createElement("th");
        const aggStrong = document.createElement("strong");
        aggStrong.textContent = agg.label;
        th.appendChild(aggStrong);
        th.style.cssText = "text-align:right;font-size:0.7rem;";
        hr.appendChild(th);
      });
    }
    
    thead.appendChild(hr);
    table.appendChild(thead);

    // Build body
    const tbody = document.createElement("tbody");
    lastSummary.rows.forEach(row => {
      const tr = document.createElement("tr");
      
      // Value
      const tdV = document.createElement("td");
      tdV.textContent = row.value;
      tdV.style.fontSize = "0.75rem";
      tr.appendChild(tdV);
      
      // Count
      const tdC = document.createElement("td");
      tdC.textContent = row.count.toLocaleString();
      tdC.style.cssText = "text-align:right;font-size:0.75rem;";
      tr.appendChild(tdC);
      
      // Percentage
      if (lastSummary.includePercentage) {
        const tdP = document.createElement("td");
        tdP.textContent = row.percentOfTotal != null ? row.percentOfTotal.toFixed(1) + "%" : "-";
        tdP.style.cssText = "text-align:right;font-size:0.75rem;";
        tr.appendChild(tdP);
      }
      
      // Metrics
      if (lastSummary.aggregations?.length) {
        lastSummary.aggregations.forEach(agg => {
          const tdM = document.createElement("td");
          const val = row.metrics?.[agg.label];
          if (val != null) {
            const formatted = agg.type === 'avg' ? val.toFixed(2) : val.toLocaleString();
            tdM.textContent = formatted;
          } else {
            tdM.textContent = "-";
          }
          tdM.style.cssText = "text-align:right;font-size:0.75rem;";
          tr.appendChild(tdM);
        });
      }
      
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    container.appendChild(table);

    // Export buttons
    const exportRow = document.createElement("div");
    exportRow.style.cssText = "display:flex;gap:0.3rem;margin-top:0.75rem;";
    
    const csvBtn = document.createElement("button");
    csvBtn.className = "btn btn-ghost";
    csvBtn.textContent = "↓ CSV";
    csvBtn.style.cssText = "flex:1;font-size:0.7rem;padding:0.25rem;";
    csvBtn.addEventListener("click", exportSummaryCsv);
    
    const xlsxBtn = document.createElement("button");
    xlsxBtn.className = "btn btn-ghost";
    xlsxBtn.textContent = "↓ XLSX";
    xlsxBtn.style.cssText = "flex:1;font-size:0.7rem;padding:0.25rem;";
    xlsxBtn.addEventListener("click", exportSummaryXlsx);
    
    const htmlBtn = document.createElement("button");
    htmlBtn.className = "btn btn-ghost";
    htmlBtn.textContent = "↓ HTML";
    htmlBtn.style.cssText = "flex:1;font-size:0.7rem;padding:0.25rem;";
    htmlBtn.addEventListener("click", exportSummaryHtml);
    
    exportRow.appendChild(csvBtn);
    exportRow.appendChild(xlsxBtn);
    exportRow.appendChild(htmlBtn);
    container.appendChild(exportRow);
  }

  // ── Calculations Helpers ────────────────────────────────────────────
  function loadCalcColumns() {
    try {
      const raw = localStorage.getItem(CALC_COLUMNS_KEY);
      calcColumns = raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.error("Failed to load calculated columns:", e);
      calcColumns = [];
    }
  }

  function saveCalcColumns() {
    try {
      localStorage.setItem(CALC_COLUMNS_KEY, JSON.stringify(calcColumns));
    } catch (e) {
      console.error("Failed to save calculated columns:", e);
    }
  }

function deleteCalcColumn(id) {
    // Get the column name BEFORE filtering it out
    const calc = calcColumns.find(c => c.id === id);
    const columnName = calc ? calc.name : null;
    
    // Remove from calcColumns array
    calcColumns = calcColumns.filter(c => c.id !== id);
    saveCalcColumns();
    
    // Remove from parsed data fields and rows
    if (parsedData && columnName) {
      const idx = parsedData.fields.indexOf(columnName);
      if (idx !== -1) {
        parsedData.fields.splice(idx, 1);
        parsedData.rows.forEach(row => delete row[columnName]);
      }
      
      // Remove from visible fields
      const visIdx = viewState.visibleFields.indexOf(columnName);
      if (visIdx !== -1) {
        viewState.visibleFields.splice(visIdx, 1);
      }
      
      // Remove from displayNames
      delete viewState.displayNames[columnName];
    }
  }

  function validateFormula(formula) {
    if (!formula || !parsedData) {
      return { valid: false, error: "Formula is empty" };
    }

    // Strip LOOKUP(...) calls before other validation
    const strippedLookups = formula.replace(/LOOKUP\s*\([^)]*\)/gi, "1");

    // Extract column references {ColumnName}
    const colRefs = strippedLookups.match(/\{([^}]+)\}/g);
    if (!colRefs && !/LOOKUP/i.test(formula)) {
      return { valid: false, error: "Formula must reference at least one column using {ColumnName} syntax or a LOOKUP()" };
    }

    // Check if all referenced columns exist
    if (colRefs) {
      const missingCols = [];
      colRefs.forEach(ref => {
        const colName = ref.slice(1, -1);
        if (!parsedData.fields.includes(colName) && !calcColumns.some(c => c.name === colName)) {
          missingCols.push(colName);
        }
      });
      if (missingCols.length > 0) {
        return { valid: false, error: `Column(s) not found: ${missingCols.join(", ")}` };
      }
    }

    // Validate LOOKUP references exist
    const lookupRefs = [...formula.matchAll(/LOOKUP\s*\(\s*['"]([^'"]+)['"]\s*,\s*([^,]+)\s*,\s*([^)]+)\s*\)/gi)];
    for (const m of lookupRefs) {
      const tableId = m[1].trim();
      const tables = loadReferenceTables();
      if (!tables[tableId]) {
        return { valid: false, error: `Reference table not found: "${tableId}". Check the Reference Tables panel.` };
      }
    }

    // Check for valid operators
    const cleanedFormula = strippedLookups.replace(/\{[^}]+\}/g, "1");
    const invalidChars = cleanedFormula.match(/[^0-9+\-*/().\s]/g);
    if (invalidChars && invalidChars.length > 0) {
      return { valid: false, error: `Invalid characters in formula: ${[...new Set(invalidChars)].join(", ")}` };
    }

    return { valid: true };
  }

  function applyCalcColumns() {
    if (!parsedData || calcColumns.length === 0) return;

    calcColumns.forEach(calc => {
      // Add column to fields if not already there
      if (!parsedData.fields.includes(calc.name)) {
        parsedData.fields.push(calc.name);
        viewState.visibleFields.push(calc.name);
      }

      // Calculate value for each row
      parsedData.rows.forEach(row => {
        const result = executeFormula(calc.formula, row);
        row[calc.name] = result;
      });
    });
  }

function executeFormula(formula, row) {
    try {
      let expr = formula;

      // ── Resolve LOOKUP(tableId, matchColumn, returnColumn) ──────────────
      // Syntax: LOOKUP('ref_123', State, Employees)
      //         LOOKUP('ref_123', {State}, Employees)  — {braces} optional for match col
      expr = expr.replace(/LOOKUP\s*\(\s*['"]([^'"]+)['"]\s*,\s*\{?([^,}]+?)\}?\s*,\s*([^)]+?)\s*\)/gi,
        (_, tableId, matchCol, returnCol) => {
          matchCol = matchCol.trim();
          returnCol = returnCol.trim();
          const tables = loadReferenceTables();
          const tbl = tables[tableId];
          if (!tbl || !tbl.data) return "0";
          const keyValue = String(row[matchCol] ?? "").trim();
          const found = tbl.data.find(r => String(r[tbl.keyColumn] ?? "").trim() === keyValue);
          if (!found) return "0";
          const val = Number(String(found[returnCol] ?? "0").replace(/,/g, ""));
          return isNaN(val) ? "0" : String(val);
        }
      );

      // ── Resolve {ColumnName} references ──────────────────────────────────
      const colRefs = expr.match(/\{([^}]+)\}/g) || [];
      colRefs.forEach(ref => {
        const colName = ref.slice(1, -1);
        let value = row[colName];
        if (value === null || value === undefined || value === "") {
          value = 0;
        } else {
          value = Number(String(value).replace(/,/g, ""));
          if (isNaN(value)) value = 0;
        }
        const regex = new RegExp(ref.replace(/[{}]/g, '\\$&'), 'g');
        expr = expr.replace(regex, value);
      });

      const result = evaluateExpression(expr);
      if (!isFinite(result) || isNaN(result)) return "ERROR";
      return Math.round(result * 100) / 100;

    } catch (e) {
      console.error('Formula error:', e, 'Formula:', formula);
      return "ERROR";
    }
  }

  // Safe arithmetic expression evaluator (no eval needed)
  function evaluateExpression(expr) {
    // Remove all whitespace
    expr = expr.replace(/\s+/g, '');
    
    // Parse and evaluate the expression
    return parseExpression(expr);
  }

  function parseExpression(expr) {
    // Handle addition and subtraction (lowest precedence)
    let tokens = expr.split(/([+\-])/).filter(t => t);
    if (tokens.length > 1) {
      let result = parseTerm(tokens[0]);
      for (let i = 1; i < tokens.length; i += 2) {
        const op = tokens[i];
        const nextVal = parseTerm(tokens[i + 1]);
        if (op === '+') result += nextVal;
        else if (op === '-') result -= nextVal;
      }
      return result;
    }
    return parseTerm(expr);
  }

  function parseTerm(expr) {
    // Handle multiplication and division (higher precedence)
    let tokens = expr.split(/([*\/])/).filter(t => t);
    if (tokens.length > 1) {
      let result = parseFactor(tokens[0]);
      for (let i = 1; i < tokens.length; i += 2) {
        const op = tokens[i];
        const nextVal = parseFactor(tokens[i + 1]);
        if (op === '*') result *= nextVal;
        else if (op === '/') result /= nextVal;
      }
      return result;
    }
    return parseFactor(expr);
  }

  function parseFactor(expr) {
    // Handle parentheses and numbers
    expr = expr.trim();
    
    // Handle parentheses
    if (expr.startsWith('(') && expr.endsWith(')')) {
      return parseExpression(expr.slice(1, -1));
    }
    
    // Handle nested parentheses
    if (expr.includes('(')) {
      let depth = 0;
      let start = -1;
      for (let i = 0; i < expr.length; i++) {
        if (expr[i] === '(') {
          if (depth === 0) start = i;
          depth++;
        } else if (expr[i] === ')') {
          depth--;
          if (depth === 0) {
            const inner = parseExpression(expr.slice(start + 1, i));
            const newExpr = expr.slice(0, start) + inner + expr.slice(i + 1);
            return parseFactor(newExpr);
          }
        }
      }
    }
    
    // Parse as number
    const num = Number(expr);
    if (isNaN(num)) {
      throw new Error(`Cannot parse: ${expr}`);
    }
    return num;
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
            const key = makeAnnotationKey(row, dataIdx);
            if (key) {
              const ann = loadAnnotations();
              if (ann[key]) { 
                delete ann[key];  // Delete the entire note entry
                annotationsCache = ann; 
                saveAnnotations(); 
              }
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
          const key = makeAnnotationKey(row, dataIdx);
          if (key) {
            const ann = loadAnnotations();
            if (ann[key]) { 
              delete ann[key];  // Delete the entire note entry
              annotationsCache = ann; 
              saveAnnotations(); 
            }
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
      (() => {
        const isNoteKeyProtected = getProtectedColumns().has(field) && !manuallyProtectedColumns.has(field);
        if (isNoteKeyProtected) {
          return { label: "🔒 Protected (Note Key column)", disabled: true };
        }
        const isProtected = manuallyProtectedColumns.has(field);
        return {
          label: isProtected ? "🔓 Unprotect column" : "🔒 Protect column",
          action: () => {
            if (isProtected) {
              manuallyProtectedColumns.delete(field);
            } else {
              manuallyProtectedColumns.add(field);
            }
            renderTablePreview();
          },
        };
      })(),
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
      info.style.color = shown === 0 ? "var(--security-danger)" : "var(--security-info)";
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

    const headerProtectedCols = getProtectedColumns();

    fields.forEach(field => {
      const th = document.createElement("th");
      const dn = viewState.displayNames[field] || field;
      const isHeaderProtected = headerProtectedCols.has(field);
      th.title = isHeaderProtected ? `${field} (read-only)` : field;

      const label = document.createElement("span");
      label.textContent = dn;
      th.appendChild(label);

      if (isHeaderProtected) {
        const lockIcon = document.createElement("span");
        lockIcon.textContent = " 🔒";
        lockIcon.style.cssText = "font-size:0.7em;opacity:0.65;";
        th.appendChild(lockIcon);
      }

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

      const protectedCols = getProtectedColumns();
      fields.forEach(field => {
        const td  = document.createElement("td");
        const val = row[field];
        const displayVal = val == null ? "" : String(val);
        const isProtected = protectedCols.has(field);

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
              const key = makeAnnotationKey(row, dataIdx);
              if (key) {
                const ann = loadAnnotations();
                const activeConfig = getActiveNoteConfig();
                
                if (newVal.trim()) {
                  // Create or update note
                  if (!ann[key]) {
                    ann[key] = {
                      text: newVal,
                      configId: activeConfig?.id || null,
                      createdAt: new Date().toISOString(),
                      updatedAt: new Date().toISOString()
                    };
                  } else {
                    ann[key].text = newVal;
                    ann[key].updatedAt = new Date().toISOString();
                  }
                } else {
                  // Empty note - delete it
                  delete ann[key];
                }
                
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
    // Summary has moved to drawer - refresh drawer if it's open on summary panel
    if (drawerState.open && drawerState.panel === "summary") {
      renderDrawerPanel("summary");
    }
  }

  function renderSummaryResults(container) {
    // Legacy function - no longer used since summary moved to drawer
    // Kept for backward compatibility with any external calls
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

  function init() {
    loadCalcColumns();
  }

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
      computeAggregation,  // Enhanced aggregation engine
    },
  });

})();