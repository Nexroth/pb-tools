// modules/emlAnalyzer.js

(function () {
  const containerId = "moduleContainer";
  let rootEl = null;

  const meta = {
    title: "EML / Header Analyzer",
    subtitle: "Analyze email headers and .eml files offline. Extract sender info, routing, and authentication results.",
  };

  // State
  let emlData = null; // Parsed EML data
  let rawHeaders = "";
  let parsedHeaders = {};

  function init() {}

  function render() {
    const container = document.getElementById(containerId);
    if (!container) return;

    // Set scrolling container
    container.style.cssText = `
      overflow-y: auto !important;
      overflow-x: hidden !important;
      max-height: calc(100vh - 140px) !important;
      position: relative;
    `;

    container.innerHTML = "";

    const wrapper = document.createElement("div");
    wrapper.className = "eml-analyzer-wrapper";
    wrapper.style.cssText = `
      width: 100%;
      height: auto;
      display: block;
      overflow: visible;
    `;

    wrapper.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:1rem;padding-right:1rem;padding-bottom:0.5rem;">
        
        <!-- Upload Section -->
        <div style="
          background:#020617;
          border-radius:0.6rem;
          border:1px solid rgba(148,163,184,0.35);
          padding:0.75rem 0.9rem;
        ">
          <div style="font-weight:600;font-size:0.9rem;margin-bottom:0.5rem;">
            1. Load EML File
          </div>
          
          <div style="display:flex;gap:0.5rem;align-items:center;margin-bottom:0.5rem;">
            <button class="btn" id="emlFileButton">
              📧 Choose EML File
            </button>
            <input type="file" id="emlFileInput" accept=".eml,.txt,.msg" style="display:none">
            <span id="emlFileInfo" style="font-size:0.75rem;color:#9ca3af;"></span>
          </div>

          <div id="emlDropzone" style="
            border:2px dashed rgba(148,163,184,0.4);
            border-radius:0.5rem;
            padding:2rem;
            text-align:center;
            background:rgba(15,23,42,0.4);
            cursor:pointer;
            transition:all 0.2s;
          ">
            <div style="font-size:2rem;margin-bottom:0.5rem;">📧</div>
            <div style="font-size:0.85rem;color:#e5e7eb;margin-bottom:0.25rem;">
              Drop EML file here or click to browse
            </div>
            <div style="font-size:0.7rem;color:#9ca3af;">
              Supports .eml, .msg, and .txt files
            </div>
          </div>
        </div>

        <!-- Analysis Results Section -->
        <div id="emlAnalysisSection" style="display:none;">
          
          <!-- Quick Info Card -->
          <div style="
            background:#020617;
            border-radius:0.6rem;
            border:1px solid rgba(148,163,184,0.35);
            padding:0.75rem 0.9rem;
            margin-bottom:1rem;
          ">
            <div style="font-weight:600;font-size:0.9rem;margin-bottom:0.5rem;">
              2. Message Overview
            </div>
            <div id="emlQuickInfo" style="font-size:0.8rem;"></div>
          </div>

          <!-- Automated Analysis Card -->
          <div style="
            background:#020617;
            border-radius:0.6rem;
            border:1px solid rgba(148,163,184,0.35);
            padding:0.75rem 0.9rem;
            margin-bottom:1rem;
          ">
            <div style="font-weight:600;font-size:0.9rem;margin-bottom:0.5rem;">
              3. Automated Analysis
            </div>
            <div id="emlAnalysis" style="font-size:0.8rem;"></div>
          </div>

          <!-- Key Headers Card -->
          <div style="
            background:#020617;
            border-radius:0.6rem;
            border:1px solid rgba(148,163,184,0.35);
            padding:0.75rem 0.9rem;
            margin-bottom:1rem;
          ">
            <div style="font-weight:600;font-size:0.9rem;margin-bottom:0.5rem;">
              4. Key Headers
            </div>
            <div id="emlKeyHeaders" style="font-size:0.8rem;"></div>
          </div>

          <!-- Authentication Results Card -->
          <div style="
            background:#020617;
            border-radius:0.6rem;
            border:1px solid rgba(148,163,184,0.35);
            padding:0.75rem 0.9rem;
            margin-bottom:1rem;
          ">
            <div style="font-weight:600;font-size:0.9rem;margin-bottom:0.5rem;">
              5. Authentication Results
            </div>
            <div id="emlAuthResults" style="font-size:0.8rem;"></div>
          </div>

          <!-- Received Path Card -->
          <div style="
            background:#020617;
            border-radius:0.6rem;
            border:1px solid rgba(148,163,184,0.35);
            padding:0.75rem 0.9rem;
            margin-bottom:1rem;
          ">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;">
              <div style="font-weight:600;font-size:0.9rem;">
                6. Routing Path
              </div>
              <button class="btn btn-secondary" id="emlToggleReceived" style="padding:0.2rem 0.5rem;font-size:0.7rem;">
                Show All Hops
              </button>
            </div>
            <div id="emlReceivedPath" style="font-size:0.8rem;"></div>
          </div>

          <!-- Raw Headers Card -->
          <div style="
            background:#020617;
            border-radius:0.6rem;
            border:1px solid rgba(148,163,184,0.35);
            padding:0.75rem 0.9rem;
          ">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;">
              <div style="font-weight:600;font-size:0.9rem;">
                7. Raw Headers
              </div>
              <div style="display:flex;gap:0.5rem;">
                <button class="btn btn-secondary" id="emlCopyHeaders" style="padding:0.2rem 0.5rem;font-size:0.7rem;">
                  Copy All
                </button>
                <button class="btn btn-secondary" id="emlToggleRaw" style="padding:0.2rem 0.5rem;font-size:0.7rem;">
                  Show Raw
                </button>
              </div>
            </div>
            <div id="emlRawHeaders" style="display:none;">
              <pre style="
                background:rgba(15,23,42,0.9);
                border:1px solid rgba(31,41,55,0.8);
                border-radius:0.4rem;
                padding:0.75rem;
                font-size:0.7rem;
                color:#e5e7eb;
                overflow-x:auto;
                white-space:pre-wrap;
                word-wrap:break-word;
                max-height:400px;
                overflow-y:auto;
              " id="emlRawHeadersContent"></pre>
            </div>
          </div>

        </div>

      </div>
    `;

    container.appendChild(wrapper);
    rootEl = wrapper;

    wireEvents();
  }

  function wireEvents() {
    if (!rootEl) return;

    const fileButton = rootEl.querySelector("#emlFileButton");
    const fileInput = rootEl.querySelector("#emlFileInput");
    const dropzone = rootEl.querySelector("#emlDropzone");
    const toggleRawBtn = rootEl.querySelector("#emlToggleRaw");
    const copyHeadersBtn = rootEl.querySelector("#emlCopyHeaders");
    const toggleReceivedBtn = rootEl.querySelector("#emlToggleReceived");

    if (fileButton && fileInput) {
      fileButton.addEventListener("click", () => {
        fileInput.click();
      });

      fileInput.addEventListener("change", (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) {
          handleFile(file);
        }
      });
    }

    if (dropzone) {
      dropzone.addEventListener("click", () => {
        if (fileInput) fileInput.click();
      });

      dropzone.addEventListener("dragover", (e) => {
        e.preventDefault();
        dropzone.style.borderColor = "#22c55e";
        dropzone.style.background = "rgba(34,197,94,0.08)";
      });

      dropzone.addEventListener("dragleave", (e) => {
        e.preventDefault();
        dropzone.style.borderColor = "rgba(148,163,184,0.4)";
        dropzone.style.background = "rgba(15,23,42,0.4)";
      });

      dropzone.addEventListener("drop", (e) => {
        e.preventDefault();
        dropzone.style.borderColor = "rgba(148,163,184,0.4)";
        dropzone.style.background = "rgba(15,23,42,0.4)";
        const file = e.dataTransfer.files && e.dataTransfer.files[0];
        if (file) {
          handleFile(file);
        }
      });
    }

    if (toggleRawBtn) {
      toggleRawBtn.addEventListener("click", () => {
        const rawSection = rootEl.querySelector("#emlRawHeaders");
        if (rawSection) {
          const isVisible = rawSection.style.display !== "none";
          rawSection.style.display = isVisible ? "none" : "block";
          toggleRawBtn.textContent = isVisible ? "Show Raw" : "Hide Raw";
        }
      });
    }

    if (copyHeadersBtn) {
      copyHeadersBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(rawHeaders).then(
          () => alert("Headers copied to clipboard!"),
          () => alert("Failed to copy headers")
        );
      });
    }

    if (toggleReceivedBtn) {
      toggleReceivedBtn.addEventListener("click", () => {
        // Toggle between showing first hop and all hops
        renderReceivedPath(true);
      });
    }
  }

  function handleFile(file) {
    const fileInfo = rootEl.querySelector("#emlFileInfo");
    if (fileInfo) {
      fileInfo.textContent = `Loading ${file.name}...`;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target.result;
      parseEmlContent(content, file.name);
    };
    reader.onerror = () => {
      if (fileInfo) {
        fileInfo.textContent = "Error reading file";
      }
    };
    reader.readAsText(file);
  }

  function parseEmlContent(content, filename) {
    rawHeaders = content;
    
    // Extract headers (everything before first blank line)
    const headerEnd = content.indexOf("\n\n");
    const headersText = headerEnd > 0 ? content.substring(0, headerEnd) : content;
    
    // Parse headers into key-value pairs
    // Special handling for headers that can appear multiple times (like Received)
    parsedHeaders = {};
    const receivedHeaders = []; // Store all Received headers separately
    
    const lines = headersText.split("\n");
    let currentHeader = "";
    let currentValue = "";

    lines.forEach(line => {
      if (line.match(/^[A-Za-z-]+:/)) {
        // New header - save previous one first
        if (currentHeader) {
          const headerLower = currentHeader.toLowerCase();
          if (headerLower === "received") {
            receivedHeaders.push(currentValue.trim());
          } else {
            parsedHeaders[headerLower] = currentValue.trim();
          }
        }
        const colonIndex = line.indexOf(":");
        currentHeader = line.substring(0, colonIndex).trim();
        currentValue = line.substring(colonIndex + 1).trim();
      } else if (line.startsWith(" ") || line.startsWith("\t")) {
        // Continuation of previous header
        currentValue += " " + line.trim();
      }
    });
    
    // Don't forget the last header
    if (currentHeader) {
      const headerLower = currentHeader.toLowerCase();
      if (headerLower === "received") {
        receivedHeaders.push(currentValue.trim());
      } else {
        parsedHeaders[headerLower] = currentValue.trim();
      }
    }
    
    // Store all Received headers in parsedHeaders
    parsedHeaders.receivedHeaders = receivedHeaders;

    // Update file info
    const fileInfo = rootEl.querySelector("#emlFileInfo");
    if (fileInfo) {
      fileInfo.textContent = `Loaded: ${filename}`;
    }

    // Show analysis section
    const analysisSection = rootEl.querySelector("#emlAnalysisSection");
    if (analysisSection) {
      analysisSection.style.display = "block";
    }

    // Render all sections
    renderQuickInfo();
    renderAnalysis();
    renderKeyHeaders();
    renderAuthResults();
    renderReceivedPath(false);
    renderRawHeaders();
  }

  function renderQuickInfo() {
    const container = rootEl.querySelector("#emlQuickInfo");
    if (!container) return;

    const from = parsedHeaders["from"] || "(not found)";
    const to = parsedHeaders["to"] || "(not found)";
    const subject = parsedHeaders["subject"] || "(no subject)";
    const date = parsedHeaders["date"] || "(no date)";

    container.innerHTML = `
      <div style="display:grid;grid-template-columns:auto 1fr;gap:0.5rem 1rem;">
        <div style="color:#9ca3af;font-weight:500;">From:</div>
        <div style="color:#e5e7eb;">${escapeHtml(from)}</div>
        
        <div style="color:#9ca3af;font-weight:500;">To:</div>
        <div style="color:#e5e7eb;">${escapeHtml(to)}</div>
        
        <div style="color:#9ca3af;font-weight:500;">Subject:</div>
        <div style="color:#e5e7eb;">${escapeHtml(subject)}</div>
        
        <div style="color:#9ca3af;font-weight:500;">Date:</div>
        <div style="color:#e5e7eb;">${escapeHtml(date)}</div>
      </div>
    `;
  }

  function renderAnalysis() {
    const container = rootEl.querySelector("#emlAnalysis");
    if (!container) return;

    // Check if this appears to be a forwarded email
    const receivedCount = (parsedHeaders.receivedHeaders || []).length;
    const isForwarded = receivedCount > 2; // More than 2 hops suggests forwarding

    // Automated analysis logic
    const issues = [];
    let verdict = "LEGITIMATE";
    let verdictColor = "#22c55e"; // green
    let confidence = "High";

    // Check 1: From vs Return-Path match
    const from = parsedHeaders["from"] || "";
    const returnPath = parsedHeaders["return-path"] || "";
    const fromDomain = extractDomain(from);
    const returnDomain = extractDomain(returnPath);
    
    if (fromDomain && returnDomain && fromDomain !== returnDomain) {
      issues.push("⚠️ From domain doesn't match Return-Path domain");
      verdict = "SUSPICIOUS";
      verdictColor = "#f59e0b"; // orange
    }

    // Check 2: SPF results
    const spf = (parsedHeaders["received-spf"] || "").toLowerCase();
    if (spf.includes("fail")) {
      issues.push("❌ SPF authentication failed");
      verdict = "LIKELY SPOOFING";
      verdictColor = "#ef4444"; // red
      confidence = "High";
    } else if (spf.includes("softfail")) {
      issues.push("⚠️ SPF soft fail (weak authentication)");
      if (verdict === "LEGITIMATE") {
        verdict = "SUSPICIOUS";
        verdictColor = "#f59e0b";
      }
    } else if (spf.includes("pass")) {
      issues.push("✅ SPF passed");
    }

    // Check 3: DKIM
    const dkim = parsedHeaders["dkim-signature"] || "";
    const authResults = (parsedHeaders["authentication-results"] || "").toLowerCase();
    
    if (!dkim && !authResults.includes("dkim=pass")) {
      issues.push("⚠️ DKIM signature missing or not verified");
      if (verdict === "LEGITIMATE") {
        verdict = "SUSPICIOUS";
        verdictColor = "#f59e0b";
        confidence = "Medium";
      }
    } else if (authResults.includes("dkim=pass")) {
      issues.push("✅ DKIM signature valid");
    }

    // Check 4: DMARC
    if (authResults.includes("dmarc=fail")) {
      issues.push("❌ DMARC authentication failed");
      verdict = "LIKELY SPOOFING";
      verdictColor = "#ef4444";
    } else if (authResults.includes("dmarc=pass")) {
      issues.push("✅ DMARC passed");
    }

    // Check 5: Message-ID domain matches From domain
    const messageId = parsedHeaders["message-id"] || "";
    const messageIdDomain = extractDomain(messageId);
    
    if (fromDomain && messageIdDomain && fromDomain !== messageIdDomain) {
      issues.push("⚠️ Message-ID domain doesn't match sender domain");
      if (verdict === "LEGITIMATE") {
        verdict = "SUSPICIOUS";
        verdictColor = "#f59e0b";
      }
    }

    // Add forwarding note
    if (isForwarded) {
      issues.push(`ℹ️ Email has ${receivedCount} hops (likely forwarded/reported)`);
    }

    // If no issues found, add a positive note
    if (issues.length === 0 || (issues.length === 1 && isForwarded)) {
      issues.push("✅ No authentication issues detected");
      issues.push("✅ All available checks passed");
    }

    container.innerHTML = `
      <div style="
        background:rgba(15,23,42,0.9);
        border:1px solid rgba(31,41,55,0.8);
        border-radius:0.4rem;
        padding:0.75rem;
        margin-bottom:0.75rem;
      ">
        <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem;">
          <div style="font-weight:600;color:${verdictColor};font-size:0.9rem;">
            Verdict: ${verdict}
          </div>
          <div style="
            font-size:0.7rem;
            padding:0.15rem 0.4rem;
            border-radius:999px;
            background:rgba(148,163,184,0.2);
            color:#9ca3af;
          ">
            Confidence: ${confidence}
          </div>
        </div>
        <div style="font-size:0.75rem;color:#9ca3af;">
          ${issues.map(issue => `<div style="margin-bottom:0.25rem;">${escapeHtml(issue)}</div>`).join('')}
        </div>
      </div>

      <div style="font-size:0.7rem;color:#6b7280;font-style:italic;">
        Note: This is automated analysis based on email headers only. ${isForwarded ? 'For forwarded emails, check the "Original Sender" hop in Routing Path below. ' : ''}Manual review is recommended for important decisions.
      </div>
    `;
  }

  function extractDomain(emailOrHeader) {
    if (!emailOrHeader) return "";
    
    // Try to extract domain from email address
    const emailMatch = emailOrHeader.match(/[\w.-]+@([\w.-]+)/);
    if (emailMatch) {
      return emailMatch[1].toLowerCase();
    }
    
    // Try to extract from Message-ID
    const messageIdMatch = emailOrHeader.match(/@([\w.-]+)>/);
    if (messageIdMatch) {
      return messageIdMatch[1].toLowerCase();
    }
    
    return "";
  }

  function renderKeyHeaders() {
    const container = rootEl.querySelector("#emlKeyHeaders");
    if (!container) return;

    const messageId = parsedHeaders["message-id"] || "(not found)";
    const replyTo = parsedHeaders["reply-to"] || "(same as from)";
    const returnPath = parsedHeaders["return-path"] || "(not found)";

    container.innerHTML = `
      <div style="display:grid;grid-template-columns:auto 1fr;gap:0.5rem 1rem;">
        <div style="color:#9ca3af;font-weight:500;">Message-ID:</div>
        <div style="color:#e5e7eb;word-break:break-all;">${escapeHtml(messageId)}</div>
        
        <div style="color:#9ca3af;font-weight:500;">Reply-To:</div>
        <div style="color:#e5e7eb;">${escapeHtml(replyTo)}</div>
        
        <div style="color:#9ca3af;font-weight:500;">Return-Path:</div>
        <div style="color:#e5e7eb;">${escapeHtml(returnPath)}</div>
      </div>
    `;
  }

  function renderAuthResults() {
    const container = rootEl.querySelector("#emlAuthResults");
    if (!container) return;

    const spf = parsedHeaders["received-spf"] || "(not found)";
    const dkim = parsedHeaders["dkim-signature"] ? "Present" : "(not found)";
    const dmarc = parsedHeaders["authentication-results"] || "(not found)";

    container.innerHTML = `
      <div style="display:grid;grid-template-columns:auto 1fr;gap:0.5rem 1rem;">
        <div style="color:#9ca3af;font-weight:500;">SPF:</div>
        <div style="color:#e5e7eb;">${escapeHtml(spf)}</div>
        
        <div style="color:#9ca3af;font-weight:500;">DKIM:</div>
        <div style="color:#e5e7eb;">${escapeHtml(dkim)}</div>
        
        <div style="color:#9ca3af;font-weight:500;">Auth-Results:</div>
        <div style="color:#e5e7eb;word-break:break-all;">${escapeHtml(dmarc)}</div>
      </div>
    `;
  }

  let showingAllHops = false;

  function renderReceivedPath(toggleMode) {
    const container = rootEl.querySelector("#emlReceivedPath");
    const toggleBtn = rootEl.querySelector("#emlToggleReceived");
    if (!container) return;

    if (toggleMode) {
      showingAllHops = !showingAllHops;
      if (toggleBtn) {
        toggleBtn.textContent = showingAllHops ? "Show First Hop Only" : "Show All Hops";
      }
    }

    // Get all Received headers
    const receivedHeaders = parsedHeaders.receivedHeaders || [];

    if (receivedHeaders.length === 0) {
      container.innerHTML = `<div style="color:#9ca3af;">No routing information found</div>`;
      return;
    }

    // Received headers are in reverse chronological order (newest first)
    // The LAST one is the original sender (most important for phishing analysis)
    const hopsToShow = showingAllHops ? receivedHeaders : [receivedHeaders[receivedHeaders.length - 1]];

    container.innerHTML = hopsToShow.map((hop, index) => {
      // When showing all, reverse the display order so original sender is at top
      const displayIndex = showingAllHops ? (receivedHeaders.length - index) : 1;
      const isOriginal = displayIndex === receivedHeaders.length;
      
      return `
      <div style="
        background:rgba(15,23,42,0.9);
        border:1px solid rgba(31,41,55,0.8);
        border-radius:0.4rem;
        padding:0.5rem 0.75rem;
        margin-bottom:0.5rem;
        font-size:0.75rem;
      ">
        <div style="color:${isOriginal ? '#22c55e' : '#60a5fa'};font-weight:500;margin-bottom:0.25rem;">
          Hop ${displayIndex}${isOriginal ? ' (Original Sender)' : ''}
        </div>
        <div style="color:#e5e7eb;white-space:pre-wrap;word-break:break-all;">
          ${escapeHtml(hop)}
        </div>
      </div>
    `}).reverse().join("");
  }

  function renderRawHeaders() {
    const container = rootEl.querySelector("#emlRawHeadersContent");
    if (!container) return;

    container.textContent = rawHeaders;
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
    
    emlData = null;
    rawHeaders = "";
    parsedHeaders = {};
    showingAllHops = false;
  }

  window.SecOpsWorkbench.registerModule("emlAnalyzer", {
    meta,
    init,
    show,
    hide,
  });
})();