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
      <div class="module-content-wrapper" style="padding-left:1.2rem;">
        <!-- CSV Upload Section -->
        <div class="section-card mb-5">
          <div class="section-card-header">
            1. Load Recipient Data
          </div>
          
          <div class="flex items-center gap-3 flex-wrap mb-3">
            <button class="btn" id="emailCsvButton">
              Choose CSV file
            </button>
            <input
              type="file"
              id="emailCsvInput"
              accept=".csv,.txt"
              class="hidden"
            >
            <span id="emailCsvInfo" class="info-text"></span>
          </div>

          <div id="emailAvailableFields" class="hidden mt-3">
            <div class="info-text-sm mb-1">
              Available variables (click to copy):
            </div>
            <div id="emailFieldsList" class="flex flex-wrap gap-2"></div>
          </div>
        </div>

        <!-- Template Editor Section -->
        <div class="section-card mb-5">
          <div class="flex items-center justify-between mb-3">
            <div class="section-card-title">
              2. Create Template
            </div>
            <div class="flex gap-2">
              <button class="btn btn-secondary btn-sm" id="emailSaveTemplateBtn">
                Save Template
              </button>
              <button class="btn btn-secondary btn-sm" id="emailLoadTemplateBtn">
                Load Template
              </button>
            </div>
          </div>

          <div class="mb-4">
            <label class="form-label">
              Subject Line:
            </label>
            <input
              type="text"
              id="emailSubjectInput"
              placeholder="e.g., Security Alert for {{FirstName}} {{LastName}}"
              class="form-input"
            >
          </div>

          <div>
            <label class="form-label">
              Message Body:
            </label>
            <textarea
              id="emailBodyInput"
              placeholder="Hi {{FirstName}},

You recently failed the phishing simulation on {{Date}}. Please review the training materials...

Use {{VariableName}} to insert data from your CSV.

Best regards,
Security Team"
              class="form-textarea"
              style="min-height:200px;"
            ></textarea>
            <div class="mt-3">
              <button class="btn btn-secondary btn-sm" id="emailInsertTableBtn">
                Insert Table Template
              </button>
            </div>
          </div>

          <div class="hint-text mt-3">
            💡 Use {{FieldName}} to insert variables. Field names are case-sensitive. Tables are supported for professional formatting.
          </div>
        </div>

        <!-- Quick Fill Section (for single recipient) -->
        <div id="emailQuickFillSection" class="section-card mb-5 hidden">
          <div class="flex items-center justify-between mb-3">
            <div class="section-card-title">
              Quick Fill (Single Recipient)
            </div>
            <button class="btn btn-secondary btn-xs" id="emailClearQuickFillBtn">
              Clear All
            </button>
          </div>
          
          <div class="info-text-sm mb-3">
            Fill in values below to preview without loading CSV:
          </div>
          
          <div id="emailQuickFillInputs" class="flex-col gap-3">
            <!-- Dynamic inputs will be added here -->
          </div>
        </div>

        <!-- Preview Section -->
        <div class="section-card mb-5">
          <div class="flex items-center justify-between mb-3">
            <div class="section-card-title">
              3. Preview
            </div>
            <div id="emailPreviewNav" class="hidden items-center gap-2">
              <button class="btn btn-secondary btn-xs" id="emailPreviewPrev">
                ◀
              </button>
              <span id="emailPreviewCounter" class="info-text-sm"></span>
              <button class="btn btn-secondary btn-xs" id="emailPreviewNext">
                ▶
              </button>
            </div>
          </div>

          <div id="emailPreviewContent">
            <div class="info-text" style="text-align:center;padding:2rem;">
              Load CSV data and create a template to see preview
            </div>
          </div>
        </div>

        <!-- Export Section -->
        <div class="section-card">
          <div class="section-card-header">
            4. Export
          </div>
          
          <div class="flex gap-3 flex-wrap">
            <button class="btn" id="emailOpenClientBtn" disabled title="Opens mailto: link (text only, no HTML)">
              Open in Email Client
            </button>
            <button class="btn" id="emailCopyHtmlBtn" disabled>
              Copy as HTML
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
          
          <div class="hint-text mt-3">
            💡 "Open in Email Client" sends text only. For HTML tables, use "Copy as HTML" then paste into Outlook/Gmail.
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

    // Insert Table Template button
    const insertTableBtn = rootEl.querySelector("#emailInsertTableBtn");
    if (insertTableBtn) {
      insertTableBtn.addEventListener("click", () => {
        const bodyTextarea = rootEl.querySelector("#emailBodyInput");
        if (!bodyTextarea) return;
        
        const tableTemplate = `
<table border="1" style="border-collapse:collapse;width:100%;margin:1rem 0;border:1px solid #cbd5e0;">
  <thead>
    <tr style="background:#4a5568;color:#ffffff;">
      <th style="padding:10px;text-align:left;border:1px solid #cbd5e0;">Column 1</th>
      <th style="padding:10px;text-align:left;border:1px solid #cbd5e0;">Column 2</th>
    </tr>
  </thead>
  <tbody>
    <tr style="background:#ffffff;color:#000000;">
      <td style="padding:8px;border:1px solid #cbd5e0;">{{Variable1}}</td>
      <td style="padding:8px;border:1px solid #cbd5e0;">{{Variable2}}</td>
    </tr>
    <tr style="background:#f7fafc;color:#000000;">
      <td style="padding:8px;border:1px solid #cbd5e0;">{{Variable3}}</td>
      <td style="padding:8px;border:1px solid #cbd5e0;">{{Variable4}}</td>
    </tr>
  </tbody>
</table>`;
        
        // Insert at cursor position
        const pos = bodyTextarea.selectionStart || 0;
        const before = bodyTextarea.value.substring(0, pos);
        const after = bodyTextarea.value.substring(pos);
        bodyTextarea.value = before + tableTemplate + after;
        
        // Update template and preview
        currentTemplate.body = bodyTextarea.value;
        updateQuickFillInputs();
        updatePreview();
        updateExportButtons();
        
        // Move cursor to end of inserted text
        bodyTextarea.focus();
        bodyTextarea.setSelectionRange(pos + tableTemplate.length, pos + tableTemplate.length);
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
    const copyHtmlBtn = rootEl.querySelector("#emailCopyHtmlBtn");
    const exportAllBtn = rootEl.querySelector("#emailExportAllBtn");
    const copyAllBtn = rootEl.querySelector("#emailCopyAllBtn");
    const exportCsvBtn = rootEl.querySelector("#emailExportCsvBtn");

    if (openClientBtn) {
      openClientBtn.addEventListener("click", () => {
        openInEmailClient();
      });
    }

    if (copyHtmlBtn) {
      copyHtmlBtn.addEventListener("click", () => {
        copyAsHtml();
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
      quickFillSection.classList.remove("block");
      quickFillSection.classList.add("hidden");
      return;
    }

    // Show section and create inputs
    quickFillSection.classList.remove("hidden");
    quickFillSection.classList.add("block");
    quickFillInputs.innerHTML = "";

    variables.forEach((varName) => {
      const inputGroup = document.createElement("div");
      inputGroup.className = "flex-col gap-1";

      const label = document.createElement("label");
      label.textContent = varName;
      label.className = "form-label";

      const input = document.createElement("input");
      input.type = "text";
      input.value = quickFillValues[varName] || "";
      input.placeholder = `Enter ${varName}...`;
      input.className = "form-input";

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

    fieldsContainer.classList.remove("hidden");
    fieldsContainer.classList.add("block");
    fieldsList.innerHTML = "";

    csvData.fields.forEach((field) => {
      const badge = document.createElement("button");
      badge.textContent = `{{${field}}}`;
      badge.className = "field-badge";

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
        <div class="info-text" style="text-align:center;padding:2rem;">
          ${csvData ? 'Create a template to see preview' : 'Create a template with variables (e.g., {{FirstName}}) to see preview'}
        </div>
      `;
      if (previewNav) {
        previewNav.classList.remove("flex");
        previewNav.classList.add("hidden");
      }
      return;
    }

    // Quick Fill mode (single recipient)
    if (hasQuickFill) {
      if (previewNav) {
        previewNav.classList.remove("flex");
        previewNav.classList.add("hidden");
      }

      const mergedSubject = mergeTemplate(currentTemplate.subject, quickFillValues);
      const mergedBody = mergeTemplate(currentTemplate.body, quickFillValues);

      previewContent.innerHTML = `
        <div class="preview-box">
          <div class="mb-4">
            <div class="preview-label">
              SUBJECT:
            </div>
            <div class="preview-value">
              ${escapeHtml(mergedSubject || "(No subject)")}
            </div>
          </div>
          
          <div>
            <div class="preview-label">
              BODY:
            </div>
            <div class="preview-body ${containsHtmlTable(mergedBody) ? '' : 'preview-body-plain'}">
              ${containsHtmlTable(mergedBody) ? sanitizeHtml(mergedBody.replace(/\n/g, '<br>')) : escapeHtml(mergedBody || "(No body)")}
            </div>
          </div>
        </div>
      `;
      return;
    }

    // CSV mode (multiple recipients)
    if (hasCsvData) {
      // Show navigation
      if (previewNav) {
        previewNav.classList.remove("hidden");
        previewNav.classList.add("flex");
      }
      if (previewCounter) {
        previewCounter.textContent = `${previewIndex + 1} of ${csvData.rows.length}`;
      }

      // Merge template with current row
      const row = csvData.rows[previewIndex];
      const mergedSubject = mergeTemplate(currentTemplate.subject, row);
      const mergedBody = mergeTemplate(currentTemplate.body, row);

      previewContent.innerHTML = `
        <div class="preview-box">
          <div class="mb-4">
            <div class="preview-label">
              SUBJECT:
            </div>
            <div class="preview-value">
              ${escapeHtml(mergedSubject || "(No subject)")}
            </div>
          </div>
          
          <div>
            <div class="preview-label">
              BODY:
            </div>
            <div class="preview-body ${containsHtmlTable(mergedBody) ? '' : 'preview-body-plain'}">
              ${containsHtmlTable(mergedBody) ? sanitizeHtml(mergedBody.replace(/\n/g, '<br>')) : escapeHtml(mergedBody || "(No body)")}
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

  function containsHtmlTable(text) {
    if (!text) return false;
    return /<table[\s>]/i.test(text);
  }

  function sanitizeHtml(html) {
    if (!html) return html;
    
    const temp = document.createElement('div');
    temp.innerHTML = html;
    
    // Remove dangerous elements
    const dangerous = temp.querySelectorAll('script, iframe, object, embed');
    dangerous.forEach(el => el.remove());
    
    // Remove event handlers and dangerous attributes
    const allElements = temp.querySelectorAll('*');
    allElements.forEach(el => {
      Array.from(el.attributes).forEach(attr => {
        // Remove event handlers
        if (attr.name.startsWith('on')) {
          el.removeAttribute(attr.name);
        }
      });
      
      // Remove dangerous href/src
      if (el.hasAttribute('href')) {
        const href = el.getAttribute('href').toLowerCase();
        if (href.startsWith('javascript:') || href.startsWith('data:')) {
          el.removeAttribute('href');
        }
      }
      if (el.hasAttribute('src')) {
        const src = el.getAttribute('src').toLowerCase();
        if (src.startsWith('javascript:') || src.startsWith('data:')) {
          el.removeAttribute('src');
        }
      }
    });
    
    return temp.innerHTML;
  }

  function stripHtml(html) {
    if (!html) return html;
    const temp = document.createElement('div');
    temp.innerHTML = html;
    return temp.textContent || temp.innerText || '';
  }

  function updateExportButtons() {
    const openClientBtn = rootEl.querySelector("#emailOpenClientBtn");
    const copyHtmlBtn = rootEl.querySelector("#emailCopyHtmlBtn");
    const exportAllBtn = rootEl.querySelector("#emailExportAllBtn");
    const copyAllBtn = rootEl.querySelector("#emailCopyAllBtn");
    const exportCsvBtn = rootEl.querySelector("#emailExportCsvBtn");

    const hasQuickFill = !csvData && Object.keys(quickFillValues).length > 0 && (currentTemplate.subject || currentTemplate.body);
    const hasCsvData = csvData && csvData.rows.length > 0 && (currentTemplate.subject || currentTemplate.body);
    
    const canExport = hasQuickFill || hasCsvData;
    const canOpenClient = hasQuickFill; // Only for Quick Fill (single email)

    if (openClientBtn) openClientBtn.disabled = !canOpenClient;
    if (copyHtmlBtn) copyHtmlBtn.disabled = !canOpenClient; // Same as Open in Email Client (Quick Fill only)
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
    let mergedBody = mergeTemplate(currentTemplate.body, quickFillValues);

    // Strip HTML tables for mailto: (email clients don't support HTML in mailto: links)
    if (containsHtmlTable(mergedBody)) {
      mergedBody = stripHtml(mergedBody);
    }

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

  function copyAsHtml() {
    // Only works in Quick Fill mode (single recipient)
    if (!quickFillValues || Object.keys(quickFillValues).length === 0) return;

    const mergedSubject = mergeTemplate(currentTemplate.subject, quickFillValues);
    const mergedBody = mergeTemplate(currentTemplate.body, quickFillValues);

    // Build HTML email structure
    // Convert newlines to <br> tags, then sanitize if HTML is present
    let bodyHtml = mergedBody;
    if (containsHtmlTable(bodyHtml)) {
      // Replace newlines with <br>, then sanitize the HTML
      bodyHtml = bodyHtml.replace(/\n/g, '<br>');
      bodyHtml = sanitizeHtml(bodyHtml);
    } else {
      // Plain text: escape and convert newlines
      bodyHtml = escapeHtml(bodyHtml).replace(/\n/g, '<br>');
    }

    const htmlEmail = `
<html>
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(mergedSubject)}</title>
</head>
<body style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#000000;">
  ${bodyHtml}
</body>
</html>`.trim();

    // Copy to clipboard using modern Clipboard API
    if (navigator.clipboard && navigator.clipboard.write) {
      // Create ClipboardItem with HTML
      const blob = new Blob([htmlEmail], { type: 'text/html' });
      const clipboardItem = new ClipboardItem({ 'text/html': blob });
      
      navigator.clipboard.write([clipboardItem])
        .then(() => {
          alert('HTML email copied to clipboard!\n\nNow paste (Ctrl+V) into your email client compose window.');
        })
        .catch(err => {
          console.error('Clipboard write failed:', err);
          // Fallback
          copyHtmlFallback(htmlEmail);
        });
    } else {
      // Fallback for older browsers
      copyHtmlFallback(htmlEmail);
    }
  }

  function copyHtmlFallback(htmlEmail) {
    // Create a temporary contenteditable div
    const tempDiv = document.createElement('div');
    tempDiv.contentEditable = 'true';
    tempDiv.innerHTML = htmlEmail;
    tempDiv.style.position = 'fixed';
    tempDiv.style.left = '-9999px';
    document.body.appendChild(tempDiv);

    // Select the content
    const range = document.createRange();
    range.selectNodeContents(tempDiv);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    // Try to copy
    try {
      document.execCommand('copy');
      alert('HTML email copied to clipboard!\n\nNow paste (Ctrl+V) into your email client compose window.');
    } catch (err) {
      console.error('Copy failed:', err);
      alert('Copy failed. Please try a different browser or use "Export All as Text Files".');
    }

    // Cleanup
    document.body.removeChild(tempDiv);
    selection.removeAllRanges();
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