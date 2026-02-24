// modules/emailTemplater.js

(function () {
  const containerId = "moduleContainer";
  let rootEl = null;

  const meta = {
    title: "Email Templater",
    subtitle:
      "Create email templates with variables, load recipient data from CSV, and preview merged messages. Perfect for bulk notifications and phishing awareness campaigns.",
  };

  // State
  let csvData = null; // { fields: [...], rows: [...] }
  let currentTemplate = {
    subject: "",
    body: "",
  };
  let quickFillValues = {}; // For single recipient mode
  let savedTemplates = []; // Load from localStorage
  let previewIndex = 0; // Which row to preview

  const TEMPLATES_STORAGE_KEY = "pbToolsEmailTemplates";

  function init() {
    loadSavedTemplates();
  }

  function loadSavedTemplates() {
    try {
      const raw = localStorage.getItem(TEMPLATES_STORAGE_KEY);
      savedTemplates = raw ? JSON.parse(raw) : [];
    } catch (e) {
      savedTemplates = [];
    }
  }

  function saveTemplatesToStorage() {
    try {
      localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify(savedTemplates));
    } catch (e) {
      console.error("[Email Templater] Failed to save templates:", e);
    }
  }

  function render() {
    const container = document.getElementById(containerId);
    if (!container) return;

    // Force scrolling by setting explicit height constraint
    // Adjusted to prevent bottom cutoff bar
    container.style.cssText = `
      overflow-y: auto !important;
      overflow-x: hidden !important;
      max-height: calc(100vh - 140px) !important;
      position: relative;
    `;

    container.innerHTML = "";

    const wrapper = document.createElement("div");
    // Use custom class instead of module-card to avoid height: 100% constraint
    wrapper.className = "email-templater-wrapper";
    wrapper.style.cssText = `
      width: 100%;
      height: auto;
      min-height: 100%;
      display: block;
      overflow: visible;
    `;

    wrapper.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:1rem;padding-right:1rem;padding-bottom:0.5rem;">
        <!-- CSV Upload Section -->
        <div style="
          background:#020617;
          border-radius:0.6rem;
          border:1px solid rgba(148,163,184,0.35);
          padding:0.75rem 0.9rem;
          margin-bottom:1rem;
        ">
          <div style="font-weight:600;font-size:0.9rem;margin-bottom:0.5rem;">
            1. Load Recipient Data
          </div>
          
          <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.5rem;">
            <button class="btn" id="emailCsvButton">
              Choose CSV file
            </button>
            <input
              type="file"
              id="emailCsvInput"
              accept=".csv,.txt"
              style="display:none"
            >
            <span id="emailCsvInfo" style="font-size:0.8rem;color:#9ca3af;"></span>
          </div>

          <div id="emailAvailableFields" style="display:none;margin-top:0.5rem;">
            <div style="font-size:0.75rem;color:#9ca3af;margin-bottom:0.25rem;">
              Available variables (click to copy):
            </div>
            <div id="emailFieldsList" style="display:flex;flex-wrap:wrap;gap:0.35rem;"></div>
          </div>
        </div>

        <!-- Template Editor Section -->
        <div style="
          background:#020617;
          border-radius:0.6rem;
          border:1px solid rgba(148,163,184,0.35);
          padding:0.75rem 0.9rem;
          margin-bottom:1rem;
        ">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.5rem;">
            <div style="font-weight:600;font-size:0.9rem;">
              2. Create Template
            </div>
            <div style="display:flex;gap:0.35rem;">
              <button class="btn btn-secondary" id="emailSaveTemplateBtn" style="padding:0.25rem 0.6rem;font-size:0.75rem;">
                Save Template
              </button>
              <button class="btn btn-secondary" id="emailLoadTemplateBtn" style="padding:0.25rem 0.6rem;font-size:0.75rem;">
                Load Template
              </button>
            </div>
          </div>

          <div style="margin-bottom:0.75rem;">
            <label style="font-size:0.75rem;color:#9ca3af;display:block;margin-bottom:0.25rem;">
              Subject Line:
            </label>
            <input
              type="text"
              id="emailSubjectInput"
              placeholder="e.g., Security Alert for {{FirstName}} {{LastName}}"
              style="
                width:100%;
                padding:0.5rem;
                border-radius:0.4rem;
                border:1px solid rgba(148,163,184,0.4);
                background:#020617;
                color:#e5e7eb;
                font-size:0.85rem;
              "
            >
          </div>

          <div>
            <label style="font-size:0.75rem;color:#9ca3af;display:block;margin-bottom:0.25rem;">
              Message Body:
            </label>
            <textarea
              id="emailBodyInput"
              placeholder="Hi {{FirstName}},

You recently failed the phishing simulation on {{Date}}. Please review the training materials...

Use {{VariableName}} to insert data from your CSV.

Best regards,
Security Team"
              style="
                width:100%;
                min-height:200px;
                padding:0.75rem;
                border-radius:0.4rem;
                border:1px solid rgba(148,163,184,0.4);
                background:#020617;
                color:#e5e7eb;
                font-family:system-ui,sans-serif;
                font-size:0.85rem;
                resize:vertical;
              "
            ></textarea>
          </div>

          <div style="margin-top:0.5rem;font-size:0.7rem;color:#6b7280;">
            💡 Use {{FieldName}} to insert variables. Field names are case-sensitive.
          </div>
        </div>

        <!-- Quick Fill Section (for single recipient) -->
        <div id="emailQuickFillSection" style="
          background:#020617;
          border-radius:0.6rem;
          border:1px solid rgba(148,163,184,0.35);
          padding:0.75rem 0.9rem;
          margin-bottom:1rem;
          display:none;
        ">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.5rem;">
            <div style="font-weight:600;font-size:0.9rem;">
              Quick Fill (Single Recipient)
            </div>
            <button class="btn btn-secondary" id="emailClearQuickFillBtn" style="padding:0.2rem 0.5rem;font-size:0.7rem;">
              Clear All
            </button>
          </div>
          
          <div style="font-size:0.75rem;color:#9ca3af;margin-bottom:0.5rem;">
            Fill in values below to preview without loading CSV:
          </div>
          
          <div id="emailQuickFillInputs" style="display:flex;flex-direction:column;gap:0.5rem;">
            <!-- Dynamic inputs will be added here -->
          </div>
        </div>

        <!-- Preview Section -->
        <div style="
          background:#020617;
          border-radius:0.6rem;
          border:1px solid rgba(148,163,184,0.35);
          padding:0.75rem 0.9rem;
          margin-bottom:1rem;
        ">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.5rem;">
            <div style="font-weight:600;font-size:0.9rem;">
              3. Preview
            </div>
            <div id="emailPreviewNav" style="display:none;align-items:center;gap:0.35rem;font-size:0.75rem;">
              <button class="btn btn-secondary" id="emailPreviewPrev" style="padding:0.2rem 0.5rem;font-size:0.7rem;">
                ◀
              </button>
              <span id="emailPreviewCounter" style="color:#9ca3af;"></span>
              <button class="btn btn-secondary" id="emailPreviewNext" style="padding:0.2rem 0.5rem;font-size:0.7rem;">
                ▶
              </button>
            </div>
          </div>

          <div id="emailPreviewContent">
            <div style="font-size:0.8rem;color:#9ca3af;text-align:center;padding:2rem;">
              Load CSV data and create a template to see preview
            </div>
          </div>
        </div>

        <!-- Export Section -->
        <div style="
          background:#020617;
          border-radius:0.6rem;
          border:1px solid rgba(148,163,184,0.35);
          padding:0.75rem 0.9rem;
        ">
          <div style="font-weight:600;font-size:0.9rem;margin-bottom:0.5rem;">
            4. Export
          </div>
          
          <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
            <button class="btn" id="emailOpenClientBtn" disabled>
              Open in Email Client
            </button>
            <button class="btn btn-secondary" id="emailExportAllBtn" disabled>
              Export All as Text Files
            </button>
            <button class="btn btn-secondary" id="emailCopyAllBtn" disabled>
              Copy All to Clipboard
            </button>
            <button class="btn btn-secondary" id="emailExportCsvBtn" disabled>
              Export as CSV
            </button>
          </div>
          
          <div style="margin-top:0.5rem;font-size:0.7rem;color:#6b7280;">
            Export options available after loading CSV and creating template
          </div>
        </div>
      </div>
    `;

    container.appendChild(wrapper);
    rootEl = wrapper;

    wireEvents();
    updateQuickFillInputs();
    updatePreview();
  }

  function wireEvents() {
    if (!rootEl) return;

    // CSV file input
    const csvButton = rootEl.querySelector("#emailCsvButton");
    const csvInput = rootEl.querySelector("#emailCsvInput");

    if (csvButton && csvInput) {
      csvButton.addEventListener("click", () => {
        csvInput.value = "";
        csvInput.click();
      });

      csvInput.addEventListener("change", (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) {
          handleCsvFile(file);
        }
      });
    }

    // Template inputs
    const subjectInput = rootEl.querySelector("#emailSubjectInput");
    const bodyInput = rootEl.querySelector("#emailBodyInput");

    if (subjectInput) {
      subjectInput.addEventListener("input", (e) => {
        currentTemplate.subject = e.target.value;
        updateQuickFillInputs();
        updatePreview();
        updateExportButtons();
      });
    }

    if (bodyInput) {
      bodyInput.addEventListener("input", (e) => {
        currentTemplate.body = e.target.value;
        updateQuickFillInputs();
        updatePreview();
        updateExportButtons();
      });
    }

    // Preview navigation
    const prevBtn = rootEl.querySelector("#emailPreviewPrev");
    const nextBtn = rootEl.querySelector("#emailPreviewNext");

    if (prevBtn) {
      prevBtn.addEventListener("click", () => {
        if (csvData && previewIndex > 0) {
          previewIndex--;
          updatePreview();
        }
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener("click", () => {
        if (csvData && previewIndex < csvData.rows.length - 1) {
          previewIndex++;
          updatePreview();
        }
      });
    }

    // Template management
    const saveTemplateBtn = rootEl.querySelector("#emailSaveTemplateBtn");
    const loadTemplateBtn = rootEl.querySelector("#emailLoadTemplateBtn");

    if (saveTemplateBtn) {
      saveTemplateBtn.addEventListener("click", () => {
        saveTemplate();
      });
    }

    if (loadTemplateBtn) {
      loadTemplateBtn.addEventListener("click", () => {
        showLoadTemplateDialog();
      });
    }

    // Export buttons
    const openClientBtn = rootEl.querySelector("#emailOpenClientBtn");
    const exportAllBtn = rootEl.querySelector("#emailExportAllBtn");
    const copyAllBtn = rootEl.querySelector("#emailCopyAllBtn");
    const exportCsvBtn = rootEl.querySelector("#emailExportCsvBtn");

    if (openClientBtn) {
      openClientBtn.addEventListener("click", () => {
        openInEmailClient();
      });
    }

    if (exportAllBtn) {
      exportAllBtn.addEventListener("click", () => {
        exportAllAsTextFiles();
      });
    }

    if (copyAllBtn) {
      copyAllBtn.addEventListener("click", () => {
        copyAllToClipboard();
      });
    }

    if (exportCsvBtn) {
      exportCsvBtn.addEventListener("click", () => {
        exportAsCsv();
      });
    }

    // Quick Fill clear button
    const clearQuickFillBtn = rootEl.querySelector("#emailClearQuickFillBtn");
    if (clearQuickFillBtn) {
      clearQuickFillBtn.addEventListener("click", () => {
        quickFillValues = {};
        updateQuickFillInputs();
        updatePreview();
      });
    }
  }

  function updateQuickFillInputs() {
    const quickFillSection = rootEl.querySelector("#emailQuickFillSection");
    const quickFillInputs = rootEl.querySelector("#emailQuickFillInputs");

    if (!quickFillSection || !quickFillInputs) return;

    // Extract variables from template
    const variables = extractVariables(currentTemplate.subject, currentTemplate.body);

    // Hide section if no variables or if CSV is loaded
    if (variables.length === 0 || csvData) {
      quickFillSection.style.display = "none";
      return;
    }

    // Show section and create inputs
    quickFillSection.style.display = "block";
    quickFillInputs.innerHTML = "";

    variables.forEach((varName) => {
      const inputGroup = document.createElement("div");
      inputGroup.style.display = "flex";
      inputGroup.style.flexDirection = "column";
      inputGroup.style.gap = "0.25rem";

      const label = document.createElement("label");
      label.textContent = varName;
      label.style.fontSize = "0.75rem";
      label.style.color = "#9ca3af";
      label.style.fontWeight = "500";

      const input = document.createElement("input");
      input.type = "text";
      input.value = quickFillValues[varName] || "";
      input.placeholder = `Enter ${varName}...`;
      input.style.cssText = `
        padding: 0.4rem 0.5rem;
        border-radius: 0.4rem;
        border: 1px solid rgba(148,163,184,0.4);
        background: #020617;
        color: #e5e7eb;
        font-size: 0.85rem;
      `;

      input.addEventListener("input", (e) => {
        quickFillValues[varName] = e.target.value;
        updatePreview();
        updateExportButtons();
      });

      inputGroup.appendChild(label);
      inputGroup.appendChild(input);
      quickFillInputs.appendChild(inputGroup);
    });
  }

  function extractVariables(subject, body) {
    const text = (subject || "") + " " + (body || "");
    const variableRegex = /\{\{([^}]+)\}\}/g;
    const variables = new Set();

    let match;
    while ((match = variableRegex.exec(text)) !== null) {
      const varName = match[1].trim();
      if (varName) {
        variables.add(varName);
      }
    }

    return Array.from(variables).sort();
  }

  function handleCsvFile(file) {
    const csvInfo = rootEl.querySelector("#emailCsvInfo");
    if (csvInfo) {
      csvInfo.textContent = `Parsing ${file.name}...`;
    }

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      complete: (results) => {
        const fields = results.meta.fields || [];
        const rows = results.data || [];

        csvData = { fields, rows };
        previewIndex = 0;

        if (csvInfo) {
          csvInfo.textContent = `Loaded ${rows.length} recipients with ${fields.length} fields`;
        }

        renderAvailableFields();
        updateQuickFillInputs(); // Hide Quick Fill when CSV is loaded
        updatePreview();
        updateExportButtons();
      },
      error: (err) => {
        console.error("[Email Templater] Parse error:", err);
        if (csvInfo) {
          csvInfo.textContent = `Error: ${err.message || err}`;
        }
      },
    });
  }

  function renderAvailableFields() {
    if (!csvData) return;

    const fieldsContainer = rootEl.querySelector("#emailAvailableFields");
    const fieldsList = rootEl.querySelector("#emailFieldsList");

    if (!fieldsContainer || !fieldsList) return;

    fieldsContainer.style.display = "block";
    fieldsList.innerHTML = "";

    csvData.fields.forEach((field) => {
      const badge = document.createElement("button");
      badge.textContent = `{{${field}}}`;
      badge.style.cssText = `
        padding: 0.25rem 0.5rem;
        border-radius: 999px;
        border: 1px solid rgba(148,163,184,0.4);
        background: rgba(15,23,42,0.9);
        color: #e5e7eb;
        font-size: 0.7rem;
        font-family: ui-monospace, monospace;
        cursor: pointer;
        transition: all 0.15s ease;
      `;

      badge.addEventListener("mouseenter", () => {
        badge.style.background = "rgba(29,78,216,0.3)";
        badge.style.borderColor = "#1d4ed8";
      });

      badge.addEventListener("mouseleave", () => {
        badge.style.background = "rgba(15,23,42,0.9)";
        badge.style.borderColor = "rgba(148,163,184,0.4)";
      });

      badge.addEventListener("click", () => {
        copyToClipboard(`{{${field}}}`, badge);
      });

      fieldsList.appendChild(badge);
    });
  }

  function updatePreview() {
    const previewContent = rootEl.querySelector("#emailPreviewContent");
    const previewNav = rootEl.querySelector("#emailPreviewNav");
    const previewCounter = rootEl.querySelector("#emailPreviewCounter");

    if (!previewContent) return;

    // Check if we have Quick Fill data (no CSV) or CSV data
    const hasQuickFill = !csvData && Object.keys(quickFillValues).length > 0 && (currentTemplate.subject || currentTemplate.body);
    const hasCsvData = csvData && csvData.rows.length > 0 && (currentTemplate.subject || currentTemplate.body);

    if (!hasQuickFill && !hasCsvData) {
      previewContent.innerHTML = `
        <div style="font-size:0.8rem;color:#9ca3af;text-align:center;padding:2rem;">
          ${csvData ? 'Create a template to see preview' : 'Create a template with variables (e.g., {{FirstName}}) to see preview'}
        </div>
      `;
      if (previewNav) previewNav.style.display = "none";
      return;
    }

    // Quick Fill mode (single recipient)
    if (hasQuickFill) {
      if (previewNav) previewNav.style.display = "none";

      const mergedSubject = mergeTemplate(currentTemplate.subject, quickFillValues);
      const mergedBody = mergeTemplate(currentTemplate.body, quickFillValues);

      previewContent.innerHTML = `
        <div style="
          background:rgba(15,23,42,0.9);
          border-radius:0.5rem;
          padding:0.75rem;
          border:1px solid rgba(31,41,55,0.8);
        ">
          <div style="margin-bottom:0.75rem;">
            <div style="font-size:0.7rem;color:#9ca3af;margin-bottom:0.25rem;">
              SUBJECT:
            </div>
            <div style="font-size:0.85rem;color:#e5e7eb;font-weight:500;">
              ${escapeHtml(mergedSubject || "(No subject)")}
            </div>
          </div>
          
          <div>
            <div style="font-size:0.7rem;color:#9ca3af;margin-bottom:0.25rem;">
              BODY:
            </div>
            <div style="
              font-size:0.85rem;
              color:#e5e7eb;
              white-space:pre-wrap;
              font-family:system-ui,sans-serif;
              line-height:1.5;
            ">
              ${escapeHtml(mergedBody || "(No body)")}
            </div>
          </div>
        </div>
      `;
      return;
    }

    // CSV mode (multiple recipients)
    if (hasCsvData) {
      // Show navigation
      if (previewNav) previewNav.style.display = "flex";
      if (previewCounter) {
        previewCounter.textContent = `${previewIndex + 1} of ${csvData.rows.length}`;
      }

      // Merge template with current row
      const row = csvData.rows[previewIndex];
      const mergedSubject = mergeTemplate(currentTemplate.subject, row);
      const mergedBody = mergeTemplate(currentTemplate.body, row);

      previewContent.innerHTML = `
        <div style="
          background:rgba(15,23,42,0.9);
          border-radius:0.5rem;
          padding:0.75rem;
          border:1px solid rgba(31,41,55,0.8);
        ">
          <div style="margin-bottom:0.75rem;">
            <div style="font-size:0.7rem;color:#9ca3af;margin-bottom:0.25rem;">
              SUBJECT:
            </div>
            <div style="font-size:0.85rem;color:#e5e7eb;font-weight:500;">
              ${escapeHtml(mergedSubject || "(No subject)")}
            </div>
          </div>
          
          <div>
            <div style="font-size:0.7rem;color:#9ca3af;margin-bottom:0.25rem;">
              BODY:
            </div>
            <div style="
              font-size:0.85rem;
              color:#e5e7eb;
              white-space:pre-wrap;
              font-family:system-ui,sans-serif;
              line-height:1.5;
            ">
              ${escapeHtml(mergedBody || "(No body)")}
            </div>
          </div>
        </div>
      `;
    }
  }

  function mergeTemplate(template, row) {
    if (!template || !row) return template;

    let merged = template;

    // Replace {{FieldName}} with row[FieldName]
    const variableRegex = /\{\{([^}]+)\}\}/g;
    merged = merged.replace(variableRegex, (match, fieldName) => {
      const trimmedField = fieldName.trim();
      return row[trimmedField] !== undefined ? row[trimmedField] : match;
    });

    return merged;
  }

  function updateExportButtons() {
    const openClientBtn = rootEl.querySelector("#emailOpenClientBtn");
    const exportAllBtn = rootEl.querySelector("#emailExportAllBtn");
    const copyAllBtn = rootEl.querySelector("#emailCopyAllBtn");
    const exportCsvBtn = rootEl.querySelector("#emailExportCsvBtn");

    const hasQuickFill = !csvData && Object.keys(quickFillValues).length > 0 && (currentTemplate.subject || currentTemplate.body);
    const hasCsvData = csvData && csvData.rows.length > 0 && (currentTemplate.subject || currentTemplate.body);
    
    const canExport = hasQuickFill || hasCsvData;
    const canOpenClient = hasQuickFill; // Only for Quick Fill (single email)

    if (openClientBtn) openClientBtn.disabled = !canOpenClient;
    if (exportAllBtn) exportAllBtn.disabled = !canExport;
    if (copyAllBtn) copyAllBtn.disabled = !canExport;
    if (exportCsvBtn) exportCsvBtn.disabled = !hasCsvData; // CSV export only works with CSV data
  }

  function saveTemplate() {
    const name = prompt("Enter a name for this template:");
    if (!name || !name.trim()) return;

    const template = {
      id: Date.now().toString(),
      name: name.trim(),
      subject: currentTemplate.subject,
      body: currentTemplate.body,
      created: new Date().toISOString(),
    };

    savedTemplates.push(template);
    saveTemplatesToStorage();

    alert(`Template "${name}" saved successfully!`);
  }

  function showLoadTemplateDialog() {
    if (savedTemplates.length === 0) {
      alert("No saved templates found.");
      return;
    }

    let message = "Select a template to load:\n\n";
    savedTemplates.forEach((tmpl, idx) => {
      message += `${idx + 1}. ${tmpl.name}\n`;
    });

    const choice = prompt(message + "\nEnter number:");
    if (!choice) return;

    const idx = parseInt(choice) - 1;
    if (idx >= 0 && idx < savedTemplates.length) {
      const template = savedTemplates[idx];
      currentTemplate.subject = template.subject;
      currentTemplate.body = template.body;

      const subjectInput = rootEl.querySelector("#emailSubjectInput");
      const bodyInput = rootEl.querySelector("#emailBodyInput");

      if (subjectInput) subjectInput.value = template.subject;
      if (bodyInput) bodyInput.value = template.body;

      updatePreview();
      updateExportButtons();

      alert(`Template "${template.name}" loaded!`);
    }
  }

  function openInEmailClient() {
    // Only works in Quick Fill mode (single recipient)
    if (!quickFillValues || Object.keys(quickFillValues).length === 0) return;

    const mergedSubject = mergeTemplate(currentTemplate.subject, quickFillValues);
    const mergedBody = mergeTemplate(currentTemplate.body, quickFillValues);

    // URL encode the subject and body for mailto: link
    const subject = encodeURIComponent(mergedSubject || "");
    const body = encodeURIComponent(mergedBody || "");

    // Create mailto: link
    const mailtoLink = `mailto:?subject=${subject}&body=${body}`;

    // Open in default email client
    const a = document.createElement("a");
    a.href = mailtoLink;
    a.target = "_blank";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function exportAllAsTextFiles() {
    // Quick Fill mode - single recipient
    if (!csvData && Object.keys(quickFillValues).length > 0) {
      const mergedSubject = mergeTemplate(currentTemplate.subject, quickFillValues);
      const mergedBody = mergeTemplate(currentTemplate.body, quickFillValues);

      const content = `Subject: ${mergedSubject}\n\n${mergedBody}`;
      const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = `email.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      URL.revokeObjectURL(url);
      alert("Email exported!");
      return;
    }

    // CSV mode - multiple recipients
    if (!csvData || !csvData.rows.length) return;

    csvData.rows.forEach((row, idx) => {
      const mergedSubject = mergeTemplate(currentTemplate.subject, row);
      const mergedBody = mergeTemplate(currentTemplate.body, row);

      const content = `Subject: ${mergedSubject}\n\n${mergedBody}`;
      const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = `email_${idx + 1}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      URL.revokeObjectURL(url);
    });

    alert(`Exported ${csvData.rows.length} email files!`);
  }

  function copyAllToClipboard() {
    // Quick Fill mode - single recipient
    if (!csvData && Object.keys(quickFillValues).length > 0) {
      const mergedSubject = mergeTemplate(currentTemplate.subject, quickFillValues);
      const mergedBody = mergeTemplate(currentTemplate.body, quickFillValues);

      const content = `Subject: ${mergedSubject}\n\n${mergedBody}`;

      navigator.clipboard.writeText(content).then(
        () => {
          alert("Email copied to clipboard!");
        },
        (err) => {
          console.error("Failed to copy:", err);
          alert("Failed to copy to clipboard");
        }
      );
      return;
    }

    // CSV mode - multiple recipients
    if (!csvData || !csvData.rows.length) return;

    let allContent = "";

    csvData.rows.forEach((row, idx) => {
      const mergedSubject = mergeTemplate(currentTemplate.subject, row);
      const mergedBody = mergeTemplate(currentTemplate.body, row);

      allContent += `--- Email ${idx + 1} ---\n`;
      allContent += `Subject: ${mergedSubject}\n\n`;
      allContent += `${mergedBody}\n\n`;
      allContent += `${"=".repeat(60)}\n\n`;
    });

    navigator.clipboard.writeText(allContent).then(
      () => {
        alert(`Copied ${csvData.rows.length} merged emails to clipboard!`);
      },
      (err) => {
        console.error("Failed to copy:", err);
        alert("Failed to copy to clipboard");
      }
    );
  }

  function exportAsCsv() {
    if (!csvData || !csvData.rows.length) return;

    const exportRows = csvData.rows.map((row) => {
      const mergedSubject = mergeTemplate(currentTemplate.subject, row);
      const mergedBody = mergeTemplate(currentTemplate.body, row);

      return {
        ...row,
        MergedSubject: mergedSubject,
        MergedBody: mergedBody,
      };
    });

    const csv = Papa.unparse(exportRows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "merged_emails.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    URL.revokeObjectURL(url);
  }

  function copyToClipboard(text, button) {
    navigator.clipboard.writeText(text).then(
      () => {
        const originalText = button.textContent;
        button.textContent = "✓ Copied";
        button.style.background = "#16a34a";
        setTimeout(() => {
          button.textContent = originalText;
          button.style.background = "";
        }, 1500);
      },
      (err) => {
        console.error("Failed to copy:", err);
      }
    );
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  function show() {
    render();
  }

  function hide() {
    // Reset container styles
    const container = document.getElementById(containerId);
    if (container) {
      container.style.cssText = "";
    }
    
    csvData = null;
    currentTemplate = { subject: "", body: "" };
    quickFillValues = {};
    previewIndex = 0;
  }

  window.SecOpsWorkbench.registerModule("emailTemplater", {
    meta,
    init,
    show,
    hide,
  });
})();