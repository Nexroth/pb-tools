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
  let analysisResults = null; // Store complete analysis for export

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
      <div class="module-content-wrapper" style="padding-left:1.2rem;">
        
        <!-- Upload Section -->
        <div class="section-card">
          <div class="section-card-header">
            1. Load EML File
          </div>
          
          <div class="flex gap-3 items-center mb-3">
            <button class="btn" id="emlFileButton">
              📧 Choose EML File
            </button>
            <button class="btn btn-secondary" id="emlExportButton" style="display:none;">
              📄 Export Report
            </button>
            <input type="file" id="emlFileInput" accept=".eml,.txt,.msg" class="hidden">
            <span id="emlFileInfo" class="info-text-sm"></span>
          </div>

          <div id="emlDropzone" class="dropzone">
            <div class="dropzone-icon">📧</div>
            <div class="dropzone-text">
              Drop EML file here or click to browse
            </div>
            <div class="dropzone-hint">
              Supports .eml, .msg, and .txt files
            </div>
          </div>
        </div>

        <!-- Analysis Results Section -->
        <div id="emlAnalysisSection" class="hidden">
          
          <!-- Quick Info Card -->
          <div class="section-card mb-5">
            <div class="section-card-header">
              2. Message Overview
            </div>
            <div id="emlQuickInfo" class="info-text"></div>
          </div>

          <!-- Automated Analysis Card -->
          <div class="section-card mb-5">
            <div class="section-card-header">
              3. Automated Analysis
            </div>
            <div id="emlAnalysis" class="info-text"></div>
          </div>

          <!-- Key Headers Card -->
          <div class="section-card mb-5">
            <div class="section-card-header">
              4. Key Headers
            </div>
            <div id="emlKeyHeaders" class="info-text"></div>
          </div>

          <!-- Authentication Results Card -->
          <div class="section-card mb-5">
            <div class="section-card-header">
              5. Authentication Results
            </div>
            <div id="emlAuthResults" class="info-text"></div>
          </div>

          <!-- Links Section (dynamically shown/hidden) -->
          <div id="emlLinksSection"></div>

          <!-- Attachments Section (dynamically shown/hidden) -->
          <div id="emlAttachmentsSection"></div>

          <!-- X-Headers Section (dynamically shown/hidden) -->
          <div id="emlXHeadersSection"></div>

          <!-- Received Path Card -->
          <div class="section-card mb-5">
            <div class="flex justify-between items-center mb-3">
              <div class="section-card-title">
                6. Routing Path
              </div>
              <button class="btn btn-secondary btn-xs" id="emlToggleReceived">
                Show All Hops
              </button>
            </div>
            <div id="emlReceivedPath" class="info-text"></div>
          </div>

          <!-- Raw Headers Card -->
          <div class="section-card">
            <div class="flex justify-between items-center mb-3">
              <div class="section-card-title">
                7. Raw Headers
              </div>
              <div class="flex gap-3">
                <button class="btn btn-secondary btn-xs" id="emlCopyHeaders">
                  Copy All
                </button>
                <button class="btn btn-secondary btn-xs" id="emlToggleRaw">
                  Show Raw
                </button>
              </div>
            </div>
            <div id="emlRawHeaders" class="hidden">
              <pre class="code-block" style="max-height:400px;overflow-y:auto;" id="emlRawHeadersContent"></pre>
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
    const exportButton = rootEl.querySelector("#emlExportButton");

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
          const isVisible = rawSection.classList.contains("block");
          if (isVisible) {
            rawSection.classList.remove("block");
            rawSection.classList.add("hidden");
            toggleRawBtn.textContent = "Show Raw";
          } else {
            rawSection.classList.remove("hidden");
            rawSection.classList.add("block");
            toggleRawBtn.textContent = "Hide Raw";
          }
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

    if (exportButton) {
      exportButton.addEventListener("click", () => {
        exportAnalysisReport();
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
    const bodyText = headerEnd > 0 ? content.substring(headerEnd + 2) : "";
    
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
    
    // Extract body content (for link extraction)
    parsedHeaders.bodyText = bodyText;
    
    // Extract links from body
    parsedHeaders.links = extractLinks(bodyText);
    
    // Extract attachments
    parsedHeaders.attachments = extractAttachments(content);
    
    // Decode subject if encoded
    if (parsedHeaders.subject) {
      parsedHeaders.decodedSubject = decodeHeader(parsedHeaders.subject);
    }

    // Update file info
    const fileInfo = rootEl.querySelector("#emlFileInfo");
    if (fileInfo) {
      fileInfo.textContent = `Loaded: ${filename}`;
    }

    // Show analysis section
    const analysisSection = rootEl.querySelector("#emlAnalysisSection");
    if (analysisSection) {
      analysisSection.classList.remove("hidden");
      analysisSection.classList.add("block");
    }

    // Render all sections
    renderQuickInfo();
    renderAnalysis();
    renderKeyHeaders();
    renderAuthResults();
    renderLinksSection();
    renderAttachmentsSection();
    renderXHeadersSection();
    renderReceivedPath(false);
    renderRawHeaders();
    
    // Capture analysis results for export
    captureAnalysisResults(filename);
    
    // Show export button
    const exportButton = rootEl.querySelector("#emlExportButton");
    if (exportButton) {
      exportButton.style.display = "inline-flex";
    }
  }

  function renderQuickInfo() {
    const container = rootEl.querySelector("#emlQuickInfo");
    if (!container) return;

    const from = parsedHeaders["from"] || "(not found)";
    const to = parsedHeaders["to"] || "(not found)";
    const subject = parsedHeaders["subject"] || "(no subject)";
    const decodedSubject = parsedHeaders["decodedSubject"];
    const date = parsedHeaders["date"] || "(no date)";
    
    const subjectWasEncoded = decodedSubject && decodedSubject !== subject;

    container.innerHTML = `
      <div class="eml-grid">
        <div class="eml-label">From:</div>
        <div class="eml-value">${escapeHtml(from)}</div>
        
        <div class="eml-label">To:</div>
        <div class="eml-value">${escapeHtml(to)}</div>
        
        <div class="eml-label">Subject:</div>
        <div class="eml-value">
          ${escapeHtml(decodedSubject || subject)}
          ${subjectWasEncoded ? `
            <details style="margin-top:0.25rem;">
              <summary class="eml-summary-label">
                View Encoded Subject
              </summary>
              <div class="eml-encoded-original">
                ${escapeHtml(subject)}
              </div>
            </details>
          ` : ''}
        </div>
        
        <div class="eml-label">Date:</div>
        <div class="eml-value">${escapeHtml(date)}</div>
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
      <div class="eml-verdict-box" style="border-color:${verdictColor};">
        <div class="flex items-center gap-3 mb-3">
          <div class="eml-verdict-title" style="color:${verdictColor};">
            Verdict: ${verdict}
          </div>
          <div class="eml-verdict-subtitle" style="background:rgba(148,163,184,0.2);">
            Confidence: ${confidence}
          </div>
        </div>
        <div class="eml-issues-list">
          ${issues.map(issue => `<div class="eml-issue-item">${escapeHtml(issue)}</div>`).join('')}
        </div>
      </div>

      <div class="eml-note">
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
      <div class="eml-grid">
        <div class="eml-label">Message-ID:</div>
        <div class="eml-value-wrap">${escapeHtml(messageId)}</div>
        
        <div class="eml-label">Reply-To:</div>
        <div class="eml-value">${escapeHtml(replyTo)}</div>
        
        <div class="eml-label">Return-Path:</div>
        <div class="eml-value">${escapeHtml(returnPath)}</div>
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
      <div class="eml-grid">
        <div class="eml-label">SPF:</div>
        <div class="eml-value">${escapeHtml(spf)}</div>
        
        <div class="eml-label">DKIM:</div>
        <div class="eml-value">${escapeHtml(dkim)}</div>
        
        <div class="eml-label">Auth-Results:</div>
        <div class="eml-value-wrap">${escapeHtml(dmarc)}</div>
      </div>
    `;
  }

  let showingAllHops = false;

  // Helper function to extract IP and server info from Received header
  function extractIpAndServer(receivedHeader) {
    const result = {
      ip: null,
      fromServer: null,
      byServer: null,
      timestamp: null
    };
    
    // Extract IP address (looks for [xxx.xxx.xxx.xxx] pattern)
    const ipMatch = receivedHeader.match(/\[(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\]/);
    if (ipMatch) {
      result.ip = ipMatch[1];
    }
    
    // Extract 'from' server
    const fromMatch = receivedHeader.match(/from\s+([\w.-]+)/i);
    if (fromMatch) {
      result.fromServer = fromMatch[1];
    }
    
    // Extract 'by' server
    const byMatch = receivedHeader.match(/by\s+([\w.-]+)/i);
    if (byMatch) {
      result.byServer = byMatch[1];
    }
    
    // Extract timestamp (everything after semicolon)
    const timeMatch = receivedHeader.match(/;\s*(.+)$/);
    if (timeMatch) {
      result.timestamp = timeMatch[1].trim();
    }
    
    return result;
  }

  // Determine hop authentication status and color
  function analyzeHopAuthentication(isOriginal) {
    if (!isOriginal) {
      // Relay hops don't have auth data
      return {
        status: 'relay',
        color: '#9ca3af',
        bgColor: 'rgba(15,23,42,0.9)',
        borderColor: 'rgba(31,41,55,0.8)',
        checks: [],
        verdict: 'RELAY HOP'
      };
    }
    
    // For original sender, analyze authentication
    const checks = [];
    let failCount = 0;
    let passCount = 0;
    
    const spf = (parsedHeaders["received-spf"] || "").toLowerCase();
    const authResults = (parsedHeaders["authentication-results"] || "").toLowerCase();
    
    // SPF check
    if (spf.includes("pass")) {
      checks.push({ icon: '✅', label: 'SPF', status: 'PASS', detail: 'Sender authorized' });
      passCount++;
    } else if (spf.includes("fail")) {
      checks.push({ icon: '❌', label: 'SPF', status: 'FAIL', detail: 'Sender not authorized' });
      failCount++;
    } else if (spf.includes("softfail")) {
      checks.push({ icon: '⚠️', label: 'SPF', status: 'SOFTFAIL', detail: 'Weak authorization' });
    }
    
    // DKIM check
    if (authResults.includes("dkim=pass")) {
      checks.push({ icon: '✅', label: 'DKIM', status: 'PASS', detail: 'Signature valid' });
      passCount++;
    } else if (authResults.includes("dkim=fail")) {
      checks.push({ icon: '❌', label: 'DKIM', status: 'FAIL', detail: 'Signature invalid' });
      failCount++;
    }
    
    // DMARC check
    if (authResults.includes("dmarc=pass")) {
      checks.push({ icon: '✅', label: 'DMARC', status: 'PASS', detail: 'Policy compliant' });
      passCount++;
    } else if (authResults.includes("dmarc=fail")) {
      checks.push({ icon: '❌', label: 'DMARC', status: 'FAIL', detail: 'Policy violation' });
      failCount++;
    }
    
    // Determine overall status
    let status, color, bgColor, borderColor, verdict;
    
    if (failCount > 0) {
      status = 'suspicious';
      color = '#ef4444';
      bgColor = 'rgba(239,68,68,0.1)';
      borderColor = 'rgba(239,68,68,0.5)';
      verdict = 'SUSPICIOUS';
    } else if (passCount >= 2) {
      status = 'legitimate';
      color = '#22c55e';
      bgColor = 'rgba(34,197,94,0.1)';
      borderColor = 'rgba(34,197,94,0.5)';
      verdict = 'LEGITIMATE';
    } else {
      status = 'unknown';
      color = '#f59e0b';
      bgColor = 'rgba(245,158,11,0.1)';
      borderColor = 'rgba(245,158,11,0.5)';
      verdict = 'UNKNOWN';
    }
    
    return { status, color, bgColor, borderColor, checks, verdict };
  }

  // Extract links from email body
  function extractLinks(body) {
    if (!body) return [];
    
    const links = [];
    const urlRegex = /(https?:\/\/[^\s<>"{}|\\^`\[\]]+)/gi;
    const matches = body.match(urlRegex);
    
    if (!matches) return [];
    
    matches.forEach(url => {
      const analysis = {
        url: url,
        protocol: url.startsWith('https://') ? 'https' : 'http',
        warnings: []
      };
      
      // Check for IP-based URLs
      if (/https?:\/\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.test(url)) {
        analysis.warnings.push('IP-based URL');
      }
      
      // Check for shortened URLs
      const shorteners = ['bit.ly', 'tinyurl.com', 'goo.gl', 't.co', 'ow.ly', 'is.gd'];
      if (shorteners.some(s => url.includes(s))) {
        analysis.warnings.push('Shortened URL');
      }
      
      // Check for suspicious TLDs
      const suspiciousTlds = ['.tk', '.ml', '.ga', '.cf', '.gq', '.xyz'];
      if (suspiciousTlds.some(tld => url.toLowerCase().includes(tld))) {
        analysis.warnings.push('Suspicious TLD');
      }
      
      links.push(analysis);
    });
    
    return links;
  }

  // Extract attachment information from headers
  function extractAttachments(content) {
    const attachments = [];
    
    // Look for Content-Disposition: attachment headers
    const dispositionRegex = /Content-Disposition:\s*attachment[;\s]+filename[*]?="?([^"\n]+)"?/gi;
    let match;
    
    while ((match = dispositionRegex.exec(content)) !== null) {
      const filename = match[1].trim();
      
      const info = {
        filename: filename,
        extension: filename.split('.').pop().toLowerCase(),
        warnings: []
      };
      
      // Check for dangerous file types
      const dangerousExts = ['exe', 'scr', 'bat', 'cmd', 'com', 'pif', 'vbs', 'js', 'jar', 'zip'];
      if (dangerousExts.includes(info.extension)) {
        info.warnings.push('Executable file type');
      }
      
      // Check for double extensions
      if (filename.split('.').length > 2) {
        info.warnings.push('Multiple extensions');
      }
      
      attachments.push(info);
    }
    
    // Also check for Content-Type: application headers with name
    const contentTypeRegex = /Content-Type:\s*application\/[^;\n]+[;\s]+name="?([^"\n]+)"?/gi;
    
    while ((match = contentTypeRegex.exec(content)) !== null) {
      const filename = match[1].trim();
      
      // Skip if already found via Content-Disposition
      if (attachments.some(a => a.filename === filename)) continue;
      
      const info = {
        filename: filename,
        extension: filename.split('.').pop().toLowerCase(),
        warnings: []
      };
      
      const dangerousExts = ['exe', 'scr', 'bat', 'cmd', 'com', 'pif', 'vbs', 'js', 'jar', 'zip'];
      if (dangerousExts.includes(info.extension)) {
        info.warnings.push('Executable file type');
      }
      
      attachments.push(info);
    }
    
    return attachments;
  }

  // Decode encoded headers (RFC 2047)
  function decodeHeader(header) {
    if (!header) return '';
    
    // Decode =?charset?encoding?text?= format
    const encodedRegex = /=\?([^?]+)\?([BQ])\?([^?]+)\?=/gi;
    
    let decoded = header;
    let match;
    
    while ((match = encodedRegex.exec(header)) !== null) {
      const charset = match[1];
      const encoding = match[2].toUpperCase();
      const encodedText = match[3];
      
      let decodedText = encodedText;
      
      if (encoding === 'B') {
        // Base64 decode
        try {
          decodedText = atob(encodedText);
        } catch (e) {
          decodedText = encodedText;
        }
      } else if (encoding === 'Q') {
        // Quoted-printable decode
        decodedText = encodedText
          .replace(/_/g, ' ')
          .replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
      }
      
      decoded = decoded.replace(match[0], decodedText);
    }
    
    return decoded;
  }

  // Parse and analyze X-headers
  function parseXHeaders() {
    const xHeaders = {
      spam: null,
      originatingIp: null,
      mailer: null,
      priority: null,
      other: []
    };
    
    // Look for X- headers in parsedHeaders
    Object.keys(parsedHeaders).forEach(key => {
      if (!key.startsWith('x-')) return;
      
      const value = parsedHeaders[key];
      
      // Spam scoring
      if (key === 'x-spam-score' || key === 'x-spam-level') {
        xHeaders.spam = {
          header: key,
          value: value,
          score: parseFloat(value) || 0
        };
      }
      // Originating IP
      else if (key === 'x-originating-ip' || key === 'x-sender-ip') {
        const ipMatch = value.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
        xHeaders.originatingIp = {
          header: key,
          value: value,
          ip: ipMatch ? ipMatch[1] : value
        };
      }
      // Mailer information
      else if (key === 'x-mailer' || key === 'x-originating-email') {
        xHeaders.mailer = {
          header: key,
          value: value
        };
      }
      // Priority
      else if (key === 'x-priority' || key === 'x-msmail-priority') {
        xHeaders.priority = {
          header: key,
          value: value,
          level: parseInt(value) || value
        };
      }
      // Virus scanning
      else if (key.includes('virus') || key.includes('scan')) {
        xHeaders.other.push({
          header: key,
          value: value,
          category: 'security'
        });
      }
      // Other X-headers
      else {
        xHeaders.other.push({
          header: key,
          value: value,
          category: 'other'
        });
      }
    });
    
    return xHeaders;
  }

  function renderLinksSection() {
    const container = rootEl.querySelector("#emlLinksSection");
    if (!container) return;
    
    const links = parsedHeaders.links || [];
    
    if (links.length === 0) {
      container.classList.add("hidden");
      return;
    }
    
    container.classList.remove("hidden");
    
    container.innerHTML = `
      <div class="section-card mb-5">
        <div class="section-card-header">
          🔗 Links Found in Email Body (${links.length})
        </div>
        
        <div class="flex-col gap-3">
          ${links.map(link => `
            <div class="eml-link-item ${link.warnings.length > 0 ? 'eml-link-item-warning' : ''}">
              <div class="eml-link-header">
                <span>${link.protocol === 'https' ? '🔒' : '⚠️'}</span>
                <span class="eml-link-protocol-${link.protocol}">
                  ${link.protocol.toUpperCase()}
                </span>
                ${link.warnings.length > 0 ? link.warnings.map(w => `
                  <span class="eml-warning-badge">⚠️ ${escapeHtml(w)}</span>
                `).join('') : ''}
              </div>
              <div class="eml-link-url">
                ${escapeHtml(link.url)}
              </div>
            </div>
          `).join('')}
        </div>
        
        ${links.some(l => l.warnings.length > 0) ? `
          <div class="eml-warning-note">
            ⚠️ Suspicious links detected. Verify before clicking.
          </div>
        ` : ''}
      </div>
    `;
  }

  function renderAttachmentsSection() {
    const container = rootEl.querySelector("#emlAttachmentsSection");
    if (!container) return;
    
    const attachments = parsedHeaders.attachments || [];
    
    if (attachments.length === 0) {
      container.classList.add("hidden");
      return;
    }
    
    container.classList.remove("hidden");
    
    container.innerHTML = `
      <div class="section-card mb-5">
        <div class="section-card-header">
          📎 Attachments (${attachments.length})
        </div>
        
        <div class="flex-col gap-3">
          ${attachments.map(att => `
            <div class="eml-attachment-item ${att.warnings.length > 0 ? 'eml-attachment-item-danger' : ''}">
              <div class="eml-attachment-header">
                <span>${att.warnings.length > 0 ? '⚠️' : '📄'}</span>
                <span class="eml-attachment-filename">
                  ${escapeHtml(att.filename)}
                </span>
                <span class="eml-extension-badge">
                  .${escapeHtml(att.extension)}
                </span>
              </div>
              ${att.warnings.length > 0 ? `
                <div style="margin-top:0.25rem;">
                  ${att.warnings.map(w => `
                    <span class="eml-danger-badge">⚠️ ${escapeHtml(w)}</span>
                  `).join('')}
                </div>
              ` : ''}
            </div>
          `).join('')}
        </div>
        
        ${attachments.some(a => a.warnings.length > 0) ? `
          <div class="eml-danger-note">
            ⚠️ Dangerous attachment types detected. Do not open without verification.
          </div>
        ` : ''}
      </div>
    `;
  }

  function renderXHeadersSection() {
    const container = rootEl.querySelector("#emlXHeadersSection");
    if (!container) return;
    
    const xHeaders = parseXHeaders();
    
    // Check if there are any X-headers to display
    const hasXHeaders = xHeaders.spam || xHeaders.originatingIp || xHeaders.mailer || 
                        xHeaders.priority || xHeaders.other.length > 0;
    
    if (!hasXHeaders) {
      container.classList.add("hidden");
      return;
    }
    
    container.classList.remove("hidden");
    
    let content = `
      <div class="section-card mb-5">
        <div class="section-card-header">
          🔍 X-Headers Analysis
        </div>
        
        <div class="flex-col gap-3">
    `;
    
    // Spam Score
    if (xHeaders.spam) {
      const score = xHeaders.spam.score;
      const isHigh = score > 5;
      const isMedium = score > 2 && score <= 5;
      
      content += `
        <div style="
          background:rgba(15,23,42,0.9);
          border:1px solid ${isHigh ? 'rgba(239,68,68,0.5)' : isMedium ? 'rgba(245,158,11,0.5)' : 'rgba(31,41,55,0.8)'};
          border-radius:0.4rem;
          padding:0.5rem 0.75rem;
          font-size:0.75rem;
        ">
          <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.25rem;">
            <span>${isHigh ? '❌' : isMedium ? '⚠️' : '✅'}</span>
            <span style="color:${isHigh ? '#ef4444' : isMedium ? '#f59e0b' : '#22c55e'};font-weight:500;">
              Spam Score: ${score}
            </span>
            <span style="
              font-size:0.65rem;
              padding:0.15rem 0.4rem;
              border-radius:999px;
              background:${isHigh ? 'rgba(239,68,68,0.2)' : isMedium ? 'rgba(245,158,11,0.2)' : 'rgba(34,197,94,0.2)'};
              color:${isHigh ? '#ef4444' : isMedium ? '#f59e0b' : '#22c55e'};
            ">
              ${isHigh ? 'HIGH' : isMedium ? 'MEDIUM' : 'LOW'}
            </span>
          </div>
          <div style="color:#9ca3af;font-size:0.7rem;">
            Header: ${escapeHtml(xHeaders.spam.header)}
          </div>
        </div>
      `;
    }
    
    // Originating IP
    if (xHeaders.originatingIp) {
      content += `
        <div style="
          background:rgba(15,23,42,0.9);
          border:1px solid rgba(31,41,55,0.8);
          border-radius:0.4rem;
          padding:0.5rem 0.75rem;
          font-size:0.75rem;
        ">
          <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.25rem;">
            <span>🌐</span>
            <span style="color:#e5e7eb;font-weight:500;">Originating IP</span>
          </div>
          <div style="color:#fb923c;font-family:monospace;font-weight:500;">
            ${escapeHtml(xHeaders.originatingIp.ip)}
          </div>
          <div style="color:#9ca3af;font-size:0.7rem;margin-top:0.25rem;">
            Header: ${escapeHtml(xHeaders.originatingIp.header)}
          </div>
        </div>
      `;
    }
    
    // Mailer
    if (xHeaders.mailer) {
      content += `
        <div style="
          background:rgba(15,23,42,0.9);
          border:1px solid rgba(31,41,55,0.8);
          border-radius:0.4rem;
          padding:0.5rem 0.75rem;
          font-size:0.75rem;
        ">
          <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.25rem;">
            <span>📧</span>
            <span style="color:#e5e7eb;font-weight:500;">Email Client</span>
          </div>
          <div style="color:#60a5fa;">
            ${escapeHtml(xHeaders.mailer.value)}
          </div>
          <div style="color:#9ca3af;font-size:0.7rem;margin-top:0.25rem;">
            Header: ${escapeHtml(xHeaders.mailer.header)}
          </div>
        </div>
      `;
    }
    
    // Priority
    if (xHeaders.priority) {
      const level = xHeaders.priority.level;
      const isHigh = level === 1 || level === 'high' || level === 'urgent';
      
      content += `
        <div style="
          background:rgba(15,23,42,0.9);
          border:1px solid rgba(31,41,55,0.8);
          border-radius:0.4rem;
          padding:0.5rem 0.75rem;
          font-size:0.75rem;
        ">
          <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.25rem;">
            <span>${isHigh ? '⚠️' : 'ℹ️'}</span>
            <span style="color:#e5e7eb;font-weight:500;">Priority</span>
            <span style="
              font-size:0.65rem;
              padding:0.15rem 0.4rem;
              border-radius:999px;
              background:${isHigh ? 'rgba(245,158,11,0.2)' : 'rgba(148,163,184,0.2)'};
              color:${isHigh ? '#f59e0b' : '#9ca3af'};
            ">
              ${escapeHtml(xHeaders.priority.value)}
            </span>
          </div>
          <div style="color:#9ca3af;font-size:0.7rem;">
            Header: ${escapeHtml(xHeaders.priority.header)}
          </div>
        </div>
      `;
    }
    
    // Other X-headers (show in collapsed details)
    if (xHeaders.other.length > 0) {
      const securityHeaders = xHeaders.other.filter(h => h.category === 'security');
      const otherHeaders = xHeaders.other.filter(h => h.category === 'other');
      
      content += `
        <details style="
          background:rgba(15,23,42,0.9);
          border:1px solid rgba(31,41,55,0.8);
          border-radius:0.4rem;
          padding:0.5rem 0.75rem;
          font-size:0.75rem;
        ">
          <summary style="cursor:pointer;color:#9ca3af;font-weight:500;">
            📋 Additional X-Headers (${xHeaders.other.length})
          </summary>
          <div style="margin-top:0.5rem;display:flex;flex-direction:column;gap:0.5rem;">
      `;
      
      [...securityHeaders, ...otherHeaders].forEach(header => {
        content += `
          <div style="
            padding:0.25rem 0.5rem;
            background:rgba(0,0,0,0.3);
            border-radius:0.3rem;
          ">
            <div style="color:#60a5fa;font-size:0.7rem;font-weight:500;margin-bottom:0.15rem;">
              ${escapeHtml(header.header)}
            </div>
            <div style="color:#d1d5db;font-size:0.7rem;word-break:break-all;">
              ${escapeHtml(header.value)}
            </div>
          </div>
        `;
      });
      
      content += `
          </div>
        </details>
      `;
    }
    
    content += `
        </div>
      </div>
    `;
    
    container.innerHTML = content;
  }

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
    const totalHops = receivedHeaders.length;

    container.innerHTML = hopsToShow.map((hop, index) => {
      // When showing all, reverse the display order so original sender is at top
      const displayIndex = showingAllHops ? (receivedHeaders.length - index) : totalHops;
      const isOriginal = displayIndex === receivedHeaders.length;
      
      // Extract IP and server info
      const hopData = extractIpAndServer(hop);
      
      // Analyze authentication status
      const authAnalysis = analyzeHopAuthentication(isOriginal);
      
      return `
      <div style="
        background:${authAnalysis.bgColor};
        border:1px solid ${authAnalysis.borderColor};
        border-radius:0.4rem;
        padding:0.75rem;
        margin-bottom:0.5rem;
        font-size:0.75rem;
      ">
        <!-- Hop Header -->
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;">
          <div style="display:flex;align-items:center;gap:0.5rem;">
            <div style="
              font-weight:600;
              color:${authAnalysis.color};
              font-size:0.85rem;
            ">
              ${authAnalysis.status === 'suspicious' ? '🔴' : authAnalysis.status === 'legitimate' ? '🟢' : '⚪'} Hop ${displayIndex}${isOriginal ? ' (Original Sender)' : ''}
            </div>
            <div style="
              font-size:0.65rem;
              padding:0.15rem 0.4rem;
              border-radius:999px;
              background:rgba(148,163,184,0.2);
              color:#9ca3af;
            ">
              ${displayIndex} of ${totalHops}
            </div>
          </div>
          ${isOriginal && authAnalysis.status !== 'relay' ? `
            <div style="
              font-size:0.65rem;
              padding:0.15rem 0.4rem;
              border-radius:999px;
              background:${authAnalysis.status === 'suspicious' ? 'rgba(239,68,68,0.2)' : 'rgba(34,197,94,0.2)'};
              color:${authAnalysis.color};
              font-weight:500;
            ">
              ${authAnalysis.verdict}
            </div>
          ` : ''}
        </div>
        
        <!-- IP and Server Info -->
        <div style="display:grid;grid-template-columns:auto 1fr;gap:0.5rem 0.75rem;margin-bottom:0.5rem;">
          ${hopData.ip ? `
            <div style="color:#9ca3af;font-weight:500;">🌐 IP:</div>
            <div style="color:#fb923c;font-family:monospace;font-weight:500;">${escapeHtml(hopData.ip)}</div>
          ` : ''}
          
          ${hopData.fromServer ? `
            <div style="color:#9ca3af;font-weight:500;">📧 From:</div>
            <div style="color:#60a5fa;font-weight:500;">${escapeHtml(hopData.fromServer)}</div>
          ` : ''}
          
          ${hopData.byServer ? `
            <div style="color:#9ca3af;font-weight:500;">📨 To:</div>
            <div style="color:#60a5fa;">${escapeHtml(hopData.byServer)}</div>
          ` : ''}
          
          ${hopData.timestamp ? `
            <div style="color:#9ca3af;font-weight:500;">🕐 Time:</div>
            <div style="color:#e5e7eb;">${escapeHtml(hopData.timestamp)}</div>
          ` : ''}
        </div>
        
        <!-- Authentication Results (only for original sender) -->
        ${authAnalysis.checks.length > 0 ? `
          <div style="margin-top:0.75rem;padding-top:0.75rem;border-top:1px solid rgba(148,163,184,0.2);">
            <div style="font-weight:500;font-size:0.75rem;color:#e5e7eb;margin-bottom:0.5rem;">
              Authentication Results:
            </div>
            ${authAnalysis.checks.map(check => `
              <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.25rem;">
                <span>${check.icon}</span>
                <span style="color:${check.status === 'PASS' ? '#22c55e' : check.status === 'FAIL' ? '#ef4444' : '#f59e0b'};font-weight:500;min-width:60px;">${check.label}</span>
                <span style="color:#9ca3af;">- ${check.detail}</span>
              </div>
            `).join('')}
          </div>
        ` : authAnalysis.status === 'relay' ? `
          <div style="font-size:0.7rem;color:#9ca3af;margin-top:0.5rem;">
            ℹ️ This is a relay hop (no authentication checks)
          </div>
        ` : ''}
        
        <!-- Expandable Raw Header -->
        <details style="margin-top:0.75rem;">
          <summary style="cursor:pointer;color:#9ca3af;font-size:0.7rem;">
            View Raw Header
          </summary>
          <div style="
            margin-top:0.5rem;
            padding:0.5rem;
            background:rgba(0,0,0,0.3);
            border-radius:0.3rem;
            font-family:monospace;
            font-size:0.7rem;
            color:#d1d5db;
            white-space:pre-wrap;
            word-break:break-all;
          ">
            ${escapeHtml(hop)}
          </div>
        </details>
      </div>
    `}).reverse().join("");
  }

  function renderRawHeaders() {
    const container = rootEl.querySelector("#emlRawHeadersContent");
    if (!container) return;

    container.textContent = rawHeaders;
  }

  function captureAnalysisResults(filename) {
    // Capture all analysis data for export
    analysisResults = {
      filename: filename,
      timestamp: new Date().toLocaleString(),
      from: parsedHeaders["from"] || "(not found)",
      to: parsedHeaders["to"] || "(not found)",
      subject: parsedHeaders["decodedSubject"] || parsedHeaders["subject"] || "(no subject)",
      date: parsedHeaders["date"] || "(no date)",
      messageId: parsedHeaders["message-id"] || "(not found)",
      returnPath: parsedHeaders["return-path"] || "(not found)",
      
      // Authentication
      spf: parsedHeaders["received-spf"] || "(not found)",
      dkim: parsedHeaders["authentication-results"] || "(not found)",
      dmarc: parsedHeaders["dmarc"] || "(not found)",
      
      // Links and attachments
      links: parsedHeaders.links || [],
      attachments: parsedHeaders.attachments || [],
      
      // Routing
      receivedHeaders: parsedHeaders.receivedHeaders || [],
      
      // X-Headers
      xHeaders: parseXHeaders(),
      
      // Re-run verdict analysis for export
      verdict: analyzeEmailVerdict()
    };
  }

  function analyzeEmailVerdict() {
    // Run the same analysis logic as renderAnalysis()
    const issues = [];
    let verdict = "LEGITIMATE";
    let verdictColor = "#22c55e";
    let borderColor = "rgba(34, 197, 94, 0.5)";
    let bgColor = "rgba(34, 197, 94, 0.05)";
    let confidence = "High";

    // Check 1: From vs Return-Path
    const from = parsedHeaders["from"] || "";
    const returnPath = parsedHeaders["return-path"] || "";
    const fromDomain = extractDomain(from);
    const returnDomain = extractDomain(returnPath);
    
    if (fromDomain && returnDomain && fromDomain !== returnDomain) {
      issues.push("⚠️ From domain doesn't match Return-Path domain");
      verdict = "SUSPICIOUS";
      verdictColor = "#f59e0b";
      borderColor = "rgba(245, 158, 11, 0.5)";
      bgColor = "rgba(245, 158, 11, 0.05)";
    }

    // Check 2: SPF
    const spf = (parsedHeaders["received-spf"] || "").toLowerCase();
    if (spf.includes("fail")) {
      issues.push("❌ SPF authentication failed");
      verdict = "LIKELY SPOOFING";
      verdictColor = "#ef4444";
      borderColor = "rgba(239, 68, 68, 0.5)";
      bgColor = "rgba(239, 68, 68, 0.05)";
      confidence = "High";
    } else if (spf.includes("softfail")) {
      issues.push("⚠️ SPF soft fail (weak authentication)");
      if (verdict === "LEGITIMATE") {
        verdict = "SUSPICIOUS";
        verdictColor = "#f59e0b";
        borderColor = "rgba(245, 158, 11, 0.5)";
        bgColor = "rgba(245, 158, 11, 0.05)";
      }
    } else if (spf.includes("pass")) {
      issues.push("✓ SPF passed");
    }

    // Check 3: DKIM
    const authResults = (parsedHeaders["authentication-results"] || "").toLowerCase();
    if (authResults.includes("dkim=fail")) {
      issues.push("❌ DKIM authentication failed");
      verdict = "LIKELY SPOOFING";
      verdictColor = "#ef4444";
      borderColor = "rgba(239, 68, 68, 0.5)";
      bgColor = "rgba(239, 68, 68, 0.05)";
      confidence = "High";
    } else if (authResults.includes("dkim=pass")) {
      issues.push("✓ DKIM passed");
    }

    // Check 4: Links
    const links = parsedHeaders.links || [];
    const suspiciousLinks = links.filter(link => 
      link.isSuspicious || link.isIpBased || link.isShortened
    );
    if (suspiciousLinks.length > 0) {
      issues.push(`⚠️ ${suspiciousLinks.length} suspicious link(s) detected`);
      if (verdict === "LEGITIMATE") {
        verdict = "SUSPICIOUS";
        verdictColor = "#f59e0b";
        borderColor = "rgba(245, 158, 11, 0.5)";
        bgColor = "rgba(245, 158, 11, 0.05)";
      }
    }

    // Check 5: Dangerous attachments
    const attachments = parsedHeaders.attachments || [];
    const dangerousAttachments = attachments.filter(att => att.isDangerous);
    if (dangerousAttachments.length > 0) {
      issues.push(`❌ ${dangerousAttachments.length} dangerous attachment(s) detected`);
      verdict = "LIKELY MALICIOUS";
      verdictColor = "#ef4444";
      borderColor = "rgba(239, 68, 68, 0.5)";
      bgColor = "rgba(239, 68, 68, 0.05)";
      confidence = "High";
    }

    if (issues.length === 0) {
      issues.push("✓ No obvious security issues detected");
    }

    return {
      verdict,
      verdictColor,
      borderColor,
      bgColor,
      confidence,
      issues
    };
  }

  function exportAnalysisReport() {
    if (!analysisResults) {
      alert("No analysis data available to export");
      return;
    }

    const { verdict, verdictColor, borderColor, bgColor, issues } = analysisResults.verdict;
    const reportDate = new Date().toLocaleString();
    
    // Helper function to format X-header display
    function formatXHeaderValue(xHeaderObj) {
      if (!xHeaderObj) return '';
      
      if (xHeaderObj.score !== undefined) {
        // Spam score
        const score = xHeaderObj.score;
        const level = score > 5 ? 'High' : score > 2 ? 'Medium' : 'Low';
        const color = score > 5 ? '#ef4444' : score > 2 ? '#f59e0b' : '#22c55e';
        return `<span style="color:${color};font-weight:600;">${score} (${level})</span>`;
      } else if (xHeaderObj.ip) {
        // IP address
        return `<span style="font-family:monospace;">${escapeHtml(xHeaderObj.ip)}</span>`;
      } else if (xHeaderObj.level !== undefined) {
        // Priority
        const level = xHeaderObj.level;
        const text = level === 1 || level === '1' ? 'High' : 
                     level === 3 || level === '3' ? 'Normal' : 
                     level === 5 || level === '5' ? 'Low' : level;
        return `<span>${escapeHtml(String(text))}</span>`;
      } else {
        // Generic value
        return escapeHtml(xHeaderObj.value || String(xHeaderObj));
      }
    }
    
    // Get hop authentication for routing section
    const hopAuth = analyzeHopAuthentication(true);

    // Build HTML report
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Email Analysis Report - ${escapeHtml(analysisResults.subject)}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.6;
      color: #1f2937;
      background: #f9fafb;
      padding: 2rem;
    }
    
    .report-container {
      max-width: 900px;
      margin: 0 auto;
      background: white;
      border-radius: 12px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      overflow: hidden;
    }
    
    .report-header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 2rem;
    }
    
    .report-title {
      font-size: 1.75rem;
      font-weight: 700;
      margin-bottom: 0.5rem;
    }
    
    .report-meta {
      font-size: 0.875rem;
      opacity: 0.9;
    }
    
    .report-body {
      padding: 2rem;
    }
    
    .section {
      margin-bottom: 2rem;
      page-break-inside: avoid;
    }
    
    .section-title {
      font-size: 1.25rem;
      font-weight: 600;
      color: #4b5563;
      margin-bottom: 1rem;
      padding-bottom: 0.5rem;
      border-bottom: 2px solid #e5e7eb;
    }
    
    .verdict-box {
      background: ${bgColor};
      border: 2px solid ${borderColor};
      border-radius: 8px;
      padding: 1.5rem;
      margin-bottom: 2rem;
    }
    
    .verdict-title {
      font-size: 1.5rem;
      font-weight: 700;
      color: ${verdictColor};
      margin-bottom: 0.5rem;
    }
    
    .verdict-subtitle {
      font-size: 0.875rem;
      color: #6b7280;
      margin-bottom: 1rem;
    }
    
    .issues-list {
      list-style: none;
      padding: 0;
    }
    
    .issue-item {
      padding: 0.5rem 0;
      font-size: 0.95rem;
      color: #374151;
    }
    
    .info-grid {
      display: grid;
      grid-template-columns: 150px 1fr;
      gap: 0.75rem;
      font-size: 0.95rem;
    }
    
    .info-label {
      font-weight: 600;
      color: #6b7280;
    }
    
    .info-value {
      color: #1f2937;
      word-break: break-word;
    }
    
    .hop-item {
      background: #f9fafb;
      border-left: 3px solid #e5e7eb;
      padding: 1rem;
      margin-bottom: 0.75rem;
      border-radius: 4px;
    }
    
    .hop-item.suspicious {
      border-left-color: #ef4444;
      background: rgba(239, 68, 68, 0.05);
    }
    
    .hop-item.legitimate {
      border-left-color: #22c55e;
      background: rgba(34, 197, 94, 0.05);
    }
    
    .hop-title {
      font-weight: 600;
      color: #374151;
      margin-bottom: 0.5rem;
      font-size: 0.95rem;
    }
    
    .hop-detail {
      font-size: 0.875rem;
      color: #6b7280;
      margin-bottom: 0.25rem;
    }
    
    .hop-auth {
      margin-top: 0.75rem;
      padding-top: 0.75rem;
      border-top: 1px solid #e5e7eb;
    }
    
    .hop-auth-title {
      font-size: 0.8rem;
      font-weight: 600;
      color: #6b7280;
      margin-bottom: 0.5rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    
    .auth-check {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.25rem 0;
      font-size: 0.875rem;
    }
    
    .auth-check-label {
      font-weight: 600;
      min-width: 60px;
    }
    
    .auth-check-status {
      font-size: 0.8rem;
      color: #6b7280;
    }
    
    .link-item, .attachment-item {
      background: #f9fafb;
      border-radius: 6px;
      padding: 1rem;
      margin-bottom: 0.75rem;
    }
    
    .link-item.has-warnings {
      border: 1px solid #fbbf24;
      background: rgba(251, 191, 36, 0.05);
    }
    
    .link-url {
      font-family: 'Courier New', monospace;
      font-size: 0.875rem;
      color: #2563eb;
      word-break: break-all;
      margin-bottom: 0.5rem;
    }
    
    .link-protocol {
      display: inline-block;
      padding: 0.2rem 0.4rem;
      border-radius: 3px;
      font-size: 0.7rem;
      font-weight: 600;
      margin-right: 0.5rem;
    }
    
    .link-protocol.https {
      background: #d1fae5;
      color: #065f46;
    }
    
    .link-protocol.http {
      background: #fed7aa;
      color: #9a3412;
    }
    
    .warning-badge, .danger-badge {
      display: inline-block;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 600;
      margin-right: 0.5rem;
      margin-top: 0.25rem;
    }
    
    .warning-badge {
      background: #fef3c7;
      color: #92400e;
    }
    
    .danger-badge {
      background: #fee2e2;
      color: #991b1b;
    }
    
    .report-footer {
      background: #f9fafb;
      padding: 1.5rem 2rem;
      text-align: center;
      font-size: 0.875rem;
      color: #6b7280;
      border-top: 1px solid #e5e7eb;
    }
    
    @media print {
      body {
        background: white;
        padding: 0;
      }
      .report-container {
        box-shadow: none;
        border-radius: 0;
      }
    }
  </style>
</head>
<body>
  <div class="report-container">
    <div class="report-header">
      <div class="report-title">📧 Email Analysis Report</div>
      <div class="report-meta">
        Generated: ${escapeHtml(reportDate)} | 
        Source: PB Tools EML Analyzer
      </div>
    </div>
    
    <div class="report-body">
      <!-- Automated Analysis -->
      <div class="section">
        <h2 class="section-title">1. Automated Analysis</h2>
        <div class="verdict-box">
          <div class="verdict-title">${escapeHtml(verdict)}</div>
          <div class="verdict-subtitle">Confidence: ${escapeHtml(analysisResults.verdict.confidence)}</div>
          <ul class="issues-list">
            ${issues.map(issue => `<li class="issue-item">${escapeHtml(issue)}</li>`).join('')}
          </ul>
        </div>
      </div>
      
      <!-- Message Overview -->
      <div class="section">
        <h2 class="section-title">2. Message Overview</h2>
        <div class="info-grid">
          <div class="info-label">From:</div>
          <div class="info-value">${escapeHtml(analysisResults.from)}</div>
          
          <div class="info-label">To:</div>
          <div class="info-value">${escapeHtml(analysisResults.to)}</div>
          
          <div class="info-label">Subject:</div>
          <div class="info-value">${escapeHtml(analysisResults.subject)}</div>
          
          <div class="info-label">Date:</div>
          <div class="info-value">${escapeHtml(analysisResults.date)}</div>
          
          <div class="info-label">Message-ID:</div>
          <div class="info-value">${escapeHtml(analysisResults.messageId)}</div>
          
          <div class="info-label">Return-Path:</div>
          <div class="info-value">${escapeHtml(analysisResults.returnPath)}</div>
        </div>
      </div>
      
      <!-- Authentication Results -->
      <div class="section">
        <h2 class="section-title">3. Authentication Results</h2>
        <div class="info-grid">
          <div class="info-label">SPF:</div>
          <div class="info-value">${escapeHtml(analysisResults.spf)}</div>
          
          <div class="info-label">DKIM:</div>
          <div class="info-value">${escapeHtml(analysisResults.dkim)}</div>
          
          <div class="info-label">DMARC:</div>
          <div class="info-value">${escapeHtml(analysisResults.dmarc)}</div>
        </div>
      </div>
      
      ${analysisResults.links.length > 0 ? `
      <!-- Links Found -->
      <div class="section">
        <h2 class="section-title">4. Links Found (${analysisResults.links.length})</h2>
        ${analysisResults.links.map(link => `
          <div class="link-item ${link.warnings && link.warnings.length > 0 ? 'has-warnings' : ''}">
            <div>
              <span class="link-protocol ${link.protocol}">${link.protocol.toUpperCase()}</span>
              <span class="link-url">${escapeHtml(link.url)}</span>
            </div>
            ${link.warnings && link.warnings.length > 0 ? `
              <div style="margin-top:0.5rem;">
                ${link.warnings.map(warning => `<span class="warning-badge">⚠️ ${escapeHtml(warning)}</span>`).join('')}
              </div>
            ` : ''}
          </div>
        `).join('')}
      </div>
      ` : ''}
      
      ${analysisResults.attachments.length > 0 ? `
      <!-- Attachments -->
      <div class="section">
        <h2 class="section-title">5. Attachments (${analysisResults.attachments.length})</h2>
        ${analysisResults.attachments.map(att => `
          <div class="attachment-item">
            <div style="font-weight:600;margin-bottom:0.5rem;">${escapeHtml(att.filename)}</div>
            ${att.contentType ? `<div class="hop-detail">Type: ${escapeHtml(att.contentType)}</div>` : ''}
            ${att.isDangerous ? `
              <div style="margin-top:0.5rem;">
                <span class="danger-badge">⚠️ DANGEROUS FILE TYPE</span>
              </div>
              <div style="margin-top:0.5rem;font-size:0.875rem;color:#991b1b;">
                This file type can contain executable code and should be treated with extreme caution.
              </div>
            ` : ''}
          </div>
        `).join('')}
      </div>
      ` : ''}
      
      <!-- Routing Path -->
      <div class="section">
        <h2 class="section-title">6. Routing Path (${analysisResults.receivedHeaders.length} hops)</h2>
        ${analysisResults.receivedHeaders.slice().reverse().map((hop, index) => {
          const { ip, server } = extractIpAndServer(hop);
          const isFirstHop = index === 0;
          const hopAuthData = isFirstHop ? hopAuth : { status: 'relay', checks: [] };
          
          return `
          <div class="hop-item ${hopAuthData.status}">
            <div class="hop-title">Hop ${index + 1} of ${analysisResults.receivedHeaders.length} ${isFirstHop ? '(Original Sender)' : '(Relay)'}</div>
            ${server ? `<div class="hop-detail">🌐 Server: ${escapeHtml(server)}</div>` : ''}
            ${ip ? `<div class="hop-detail">📍 IP: ${escapeHtml(ip)}</div>` : ''}
            
            ${isFirstHop && hopAuthData.checks.length > 0 ? `
              <div class="hop-auth">
                <div class="hop-auth-title">Authentication Results</div>
                ${hopAuthData.checks.map(check => `
                  <div class="auth-check">
                    <span>${check.icon}</span>
                    <span class="auth-check-label">${check.label}:</span>
                    <span>${check.status}</span>
                    <span class="auth-check-status">- ${check.detail}</span>
                  </div>
                `).join('')}
              </div>
            ` : ''}
          </div>
          `;
        }).join('')}
      </div>
      
      ${Object.keys(analysisResults.xHeaders).some(k => analysisResults.xHeaders[k]) ? `
      <!-- X-Headers Analysis -->
      <div class="section">
        <h2 class="section-title">7. X-Headers Analysis</h2>
        <div class="info-grid">
          ${analysisResults.xHeaders.spam ? `
            <div class="info-label">Spam Score:</div>
            <div class="info-value">${formatXHeaderValue(analysisResults.xHeaders.spam)}</div>
          ` : ''}
          
          ${analysisResults.xHeaders.originatingIp ? `
            <div class="info-label">Originating IP:</div>
            <div class="info-value">${formatXHeaderValue(analysisResults.xHeaders.originatingIp)}</div>
          ` : ''}
          
          ${analysisResults.xHeaders.mailer ? `
            <div class="info-label">Email Client:</div>
            <div class="info-value">${formatXHeaderValue(analysisResults.xHeaders.mailer)}</div>
          ` : ''}
          
          ${analysisResults.xHeaders.priority ? `
            <div class="info-label">Priority:</div>
            <div class="info-value">${formatXHeaderValue(analysisResults.xHeaders.priority)}</div>
          ` : ''}
          
          ${analysisResults.xHeaders.other && analysisResults.xHeaders.other.length > 0 ? `
            <div class="info-label">Additional Headers:</div>
            <div class="info-value">${analysisResults.xHeaders.other.length} other X-header(s)</div>
          ` : ''}
        </div>
      </div>
      ` : ''}
    </div>
    
    <div class="report-footer">
      <div>Report generated by <strong>PB Tools EML Analyzer</strong></div>
      <div style="margin-top:0.25rem;">Original File: ${escapeHtml(analysisResults.filename)}</div>
    </div>
  </div>
</body>
</html>`;

    // Create and download the file
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `email-analysis-report-${Date.now()}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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