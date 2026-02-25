// modules/qrAnalyzer.js

(function () {
  const containerId = "moduleContainer";
  let rootEl = null;

  const meta = {
    title: "QR Code Analyzer",
    subtitle: "Decode and analyze QR codes for security threats. Paste, upload, or drag & drop QR code images.",
  };

  let currentImage = null;
  let decodedData = null;

  function init() {}

  function render() {
    const container = document.getElementById(containerId);
    if (!container) return;

    // Setup scrolling container
    container.style.cssText = `
      overflow-y: auto !important;
      overflow-x: hidden !important;
      max-height: calc(100vh - 140px) !important;
      position: relative;
    `;

    container.innerHTML = "";

    const wrapper = document.createElement("div");
    wrapper.className = "qr-analyzer-wrapper";
    wrapper.style.cssText = `
      width: 100%;
      height: auto;
      display: block;
      overflow: visible;
    `;

    wrapper.innerHTML = `
      <div class="module-content-wrapper">
        <!-- Upload/Paste Section -->
        <div class="section-card mb-5">
          <div class="section-card-header">1. Load QR Code Image</div>
          
          <div class="flex gap-3 items-center mb-3">
            <button class="btn" id="qrFileButton">
              📷 Choose Image
            </button>
            <input type="file" id="qrFileInput" accept="image/*" class="hidden">
            <span id="qrFileInfo" class="info-text-sm"></span>
          </div>

          <div id="qrPasteZone" class="qr-paste-zone" tabindex="0">
            <div class="dropzone-icon" style="font-size:2rem;">📋</div>
            <div class="dropzone-text" style="font-size:1rem;font-weight:600;margin-bottom:0.5rem;">
              Paste image here (Ctrl+V / Cmd+V)
            </div>
            <div class="dropzone-hint">
              Screenshot a QR code and paste it directly!
            </div>
            <div class="dropzone-hint" style="margin-top:0.5rem;">
              Or drop QR code image here
            </div>
          </div>

          <div class="hint-text mt-3">
            💡 <strong>Quick workflow:</strong> Take a screenshot of a QR code, click in the paste zone above, and press Ctrl+V (Cmd+V on Mac)
          </div>
        </div>

        <!-- Image Preview Section -->
        <div id="qrPreviewSection" class="section-card mb-5 hidden">
          <div class="section-card-header">2. QR Code Image</div>
          <div style="text-align:center;padding:1rem;">
            <canvas id="qrCanvas" style="max-width:100%;height:auto;border:1px solid #e5e7eb;border-radius:8px;"></canvas>
          </div>
          <div class="flex gap-3 mt-3">
            <button class="btn btn-secondary btn-sm" id="qrClearBtn">
              Clear
            </button>
          </div>
        </div>

        <!-- Analysis Results Section -->
        <div id="qrResultsSection" class="hidden">
          
          <!-- Decoded Content -->
          <div class="section-card mb-5">
            <div class="section-card-header">3. Decoded Content</div>
            <div id="qrDecodedContent" class="result-box" style="min-height:60px;word-break:break-all;"></div>
            <button class="btn btn-secondary btn-sm mt-3" id="qrCopyBtn">
              Copy
            </button>
          </div>

          <!-- Security Analysis -->
          <div class="section-card mb-5">
            <div class="section-card-header">4. Security Analysis</div>
            <div id="qrSecurityAnalysis"></div>
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

    const fileButton = rootEl.querySelector("#qrFileButton");
    const fileInput = rootEl.querySelector("#qrFileInput");
    const pasteZone = rootEl.querySelector("#qrPasteZone");
    const clearBtn = rootEl.querySelector("#qrClearBtn");
    const copyBtn = rootEl.querySelector("#qrCopyBtn");

    // File button
    if (fileButton && fileInput) {
      fileButton.addEventListener("click", () => {
        fileInput.click();
      });

      fileInput.addEventListener("change", (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) {
          handleImageFile(file);
        }
      });
    }

    // Paste zone - click to focus
    if (pasteZone) {
      pasteZone.addEventListener("click", () => {
        pasteZone.focus();
      });

      // Paste event
      pasteZone.addEventListener("paste", (e) => {
        e.preventDefault();
        const items = e.clipboardData.items;
        
        for (let item of items) {
          if (item.type.indexOf("image") !== -1) {
            const blob = item.getAsFile();
            handleImageFile(blob);
            break;
          }
        }
      });

      // Drag and drop
      pasteZone.addEventListener("dragover", (e) => {
        e.preventDefault();
        pasteZone.style.borderColor = "#22c55e";
        pasteZone.style.background = "rgba(34,197,94,0.08)";
      });

      pasteZone.addEventListener("dragleave", (e) => {
        e.preventDefault();
        pasteZone.style.borderColor = "rgba(148,163,184,0.3)";
        pasteZone.style.background = "rgba(15,23,42,0.4)";
      });

      pasteZone.addEventListener("drop", (e) => {
        e.preventDefault();
        pasteZone.style.borderColor = "rgba(148,163,184,0.3)";
        pasteZone.style.background = "rgba(15,23,42,0.4)";
        
        const file = e.dataTransfer.files && e.dataTransfer.files[0];
        if (file && file.type.indexOf("image") !== -1) {
          handleImageFile(file);
        }
      });

      // Visual feedback on focus
      pasteZone.addEventListener("focus", () => {
        pasteZone.style.borderColor = "#22c55e";
      });

      pasteZone.addEventListener("blur", () => {
        pasteZone.style.borderColor = "rgba(148,163,184,0.3)";
      });
    }

    // Clear button
    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        clearAnalysis();
      });
    }

    // Copy button
    if (copyBtn) {
      copyBtn.addEventListener("click", () => {
        if (decodedData) {
          navigator.clipboard.writeText(decodedData).then(
            () => {
              copyBtn.textContent = "✓ Copied";
              setTimeout(() => {
                copyBtn.textContent = "Copy";
              }, 2000);
            },
            () => alert("Failed to copy to clipboard")
          );
        }
      });
    }
  }

  function handleImageFile(file) {
    const fileInfo = rootEl.querySelector("#qrFileInfo");
    if (fileInfo) {
      fileInfo.textContent = `Loading ${file.name || "image"}...`;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        displayImage(img, file.name || "pasted-image.png");
        decodeQRCode(img);
      };
      img.onerror = () => {
        if (fileInfo) {
          fileInfo.textContent = "Error loading image";
        }
        alert("Failed to load image. Please try another file.");
      };
      img.src = e.target.result;
    };
    reader.onerror = () => {
      if (fileInfo) {
        fileInfo.textContent = "Error reading file";
      }
      alert("Failed to read file");
    };
    reader.readAsDataURL(file);
  }

  function displayImage(img, filename) {
    const canvas = rootEl.querySelector("#qrCanvas");
    const previewSection = rootEl.querySelector("#qrPreviewSection");
    const fileInfo = rootEl.querySelector("#qrFileInfo");

    if (!canvas || !previewSection) return;

    // Set canvas size
    const maxWidth = 400;
    const scale = Math.min(1, maxWidth / img.width);
    canvas.width = img.width * scale;
    canvas.height = img.height * scale;

    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    currentImage = img;

    // Show preview section
    previewSection.classList.remove("hidden");
    previewSection.classList.add("block");

    if (fileInfo) {
      fileInfo.textContent = `Loaded: ${filename}`;
    }
  }

  function decodeQRCode(img) {
    // Check if jsQR is loaded
    if (typeof jsQR === "undefined") {
      alert("QR decoder library not loaded. Please refresh the page.");
      return;
    }

    // Create a temporary canvas to get image data
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    
    // Decode QR code
    const code = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: "dontInvert",
    });

    if (code) {
      decodedData = code.data;
      displayResults(code.data);
    } else {
      decodedData = null;
      showNoQRCodeFound();
    }
  }

  function displayResults(data) {
    const resultsSection = rootEl.querySelector("#qrResultsSection");
    const contentDiv = rootEl.querySelector("#qrDecodedContent");

    if (!resultsSection || !contentDiv) return;

    // Show results section
    resultsSection.classList.remove("hidden");
    resultsSection.classList.add("block");

    // Display decoded content
    contentDiv.textContent = data;

    // Analyze content
    analyzeContent(data);
  }

  function analyzeContent(data) {
    const analysisDiv = rootEl.querySelector("#qrSecurityAnalysis");
    if (!analysisDiv) return;

    // Determine content type
    const isURL = /^https?:\/\//i.test(data);
    const isEmail = /^mailto:/i.test(data);
    const isPhone = /^tel:/i.test(data);
    const isWiFi = /^WIFI:/i.test(data);

    let contentType = "Text";
    if (isURL) contentType = "URL";
    else if (isEmail) contentType = "Email";
    else if (isPhone) contentType = "Phone Number";
    else if (isWiFi) contentType = "WiFi Credentials";

    let verdict = "UNKNOWN";
    let verdictColor = "#6b7280";
    let borderColor = "rgba(107, 116, 128, 0.5)";
    let bgColor = "rgba(107, 116, 128, 0.05)";
    const warnings = [];
    const infoItems = [];

    // URL Security Analysis
    if (isURL) {
      // Default verdict for URLs - we can't verify legitimacy
      verdict = "VERIFY MANUALLY";
      verdictColor = "#6b7280";
      borderColor = "rgba(107, 116, 128, 0.5)";
      bgColor = "rgba(107, 116, 128, 0.05)";

      // Track HTTPS as info, not safety indicator
      if (data.startsWith("https://")) {
        infoItems.push("ℹ️ HTTPS encrypted connection");
      }

      // Check for IP-based URLs
      if (/https?:\/\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.test(data)) {
        warnings.push("⚠️ IP-based URL (commonly used in phishing)");
        verdict = "SUSPICIOUS";
        verdictColor = "#f59e0b";
        borderColor = "rgba(245, 158, 11, 0.5)";
        bgColor = "rgba(245, 158, 11, 0.05)";
      }

      // Check for shortened URLs
      const shorteners = ["bit.ly", "tinyurl.com", "goo.gl", "t.co", "ow.ly", "is.gd", "tiny.cc"];
      if (shorteners.some(s => data.includes(s))) {
        warnings.push("⚠️ Shortened URL (destination unknown)");
        if (verdict === "VERIFY MANUALLY") {
          verdict = "SUSPICIOUS";
          verdictColor = "#f59e0b";
          borderColor = "rgba(245, 158, 11, 0.5)";
          bgColor = "rgba(245, 158, 11, 0.05)";
        }
      }

      // Check for suspicious TLDs
      const suspiciousTlds = [".tk", ".ml", ".ga", ".cf", ".gq", ".xyz", ".top"];
      if (suspiciousTlds.some(tld => data.toLowerCase().includes(tld))) {
        warnings.push("⚠️ Suspicious TLD (commonly abused for phishing)");
        if (verdict === "VERIFY MANUALLY") {
          verdict = "SUSPICIOUS";
          verdictColor = "#f59e0b";
          borderColor = "rgba(245, 158, 11, 0.5)";
          bgColor = "rgba(245, 158, 11, 0.05)";
        }
      }

      // Check for HTTP (not HTTPS)
      if (data.startsWith("http://")) {
        warnings.push("⚠️ HTTP - connection not encrypted");
        if (verdict === "VERIFY MANUALLY") {
          verdict = "CAUTION";
          verdictColor = "#f59e0b";
          borderColor = "rgba(245, 158, 11, 0.5)";
          bgColor = "rgba(245, 158, 11, 0.05)";
        }
      }

      // Check for common phishing patterns
      const phishingKeywords = ["login", "verify", "account", "suspend", "update", "confirm", "secure", "wallet", "password"];
      const urlLower = data.toLowerCase();
      const foundKeywords = phishingKeywords.filter(kw => urlLower.includes(kw));
      
      if (foundKeywords.length >= 2) {
        warnings.push(`🚨 Multiple phishing keywords: ${foundKeywords.join(", ")}`);
        verdict = "HIGH RISK";
        verdictColor = "#ef4444";
        borderColor = "rgba(239, 68, 68, 0.5)";
        bgColor = "rgba(239, 68, 68, 0.05)";
      } else if (foundKeywords.length === 1) {
        warnings.push(`⚠️ Phishing keyword detected: ${foundKeywords[0]}`);
        if (verdict === "VERIFY MANUALLY") {
          verdict = "CAUTION";
          verdictColor = "#f59e0b";
          borderColor = "rgba(245, 158, 11, 0.5)";
          bgColor = "rgba(245, 158, 11, 0.05)";
        }
      }

      // If no red flags, note that we still can't verify
      if (warnings.length === 0) {
        infoItems.push("ℹ️ No obvious red flags detected");
        infoItems.push("⚠️ Cannot verify destination legitimacy - manual check required");
      }
    }

    // WiFi password warning
    if (isWiFi) {
      warnings.push("⚠️ WiFi credentials - only connect if you trust the source");
      verdict = "CAUTION";
      verdictColor = "#f59e0b";
      borderColor = "rgba(245, 158, 11, 0.5)";
      bgColor = "rgba(245, 158, 11, 0.05)";
    }

    // Payment QR warning
    if (data.toLowerCase().includes("payment") || data.toLowerCase().includes("pay")) {
      warnings.push("⚠️ Payment-related - verify authenticity before proceeding");
      if (verdict !== "HIGH RISK" && verdict !== "SUSPICIOUS") {
        verdict = "CAUTION";
        verdictColor = "#f59e0b";
        borderColor = "rgba(245, 158, 11, 0.5)";
        bgColor = "rgba(245, 158, 11, 0.05)";
      }
    }

    // For non-URL content with no warnings
    if (!isURL && warnings.length === 0 && !isWiFi) {
      verdict = "NO WARNINGS";
      verdictColor = "#6b7280";
      borderColor = "rgba(107, 116, 128, 0.5)";
      bgColor = "rgba(107, 116, 128, 0.05)";
      infoItems.push("ℹ️ Plain text content - verify context before use");
    }

    // Build analysis HTML
    const allItems = [...warnings, ...infoItems];
    
    analysisDiv.innerHTML = `
      <div class="eml-verdict-box" style="border-color:${borderColor};background:${bgColor};">
        <div class="eml-verdict-title" style="color:${verdictColor};">${verdict}</div>
        <div class="eml-verdict-subtitle">Content Type: ${contentType}</div>
        ${allItems.length > 0 ? `
          <div class="eml-issues-list">
            ${allItems.map(item => `<div class="eml-issue-item">${escapeHtml(item)}</div>`).join("")}
          </div>
        ` : ''}
      </div>

      ${isURL ? `
        <div class="info-text mt-3" style="background:rgba(245,158,11,0.1);border-left:3px solid #f59e0b;padding:1rem;border-radius:0.25rem;">
          <strong>⚠️ Security Reminder:</strong>
          <ul style="margin-left:1.5rem;margin-top:0.5rem;">
            <li><strong>Never assume a URL is safe</strong> - phishing sites use HTTPS too</li>
            <li>Verify the domain matches what you expect (watch for typos)</li>
            <li>Ensure you trust the source of this QR code</li>
            <li>When in doubt, type the URL manually instead of scanning</li>
            <li>Look for legitimate domain names (e.g., bank.com, not bank-secure.xyz)</li>
          </ul>
        </div>
      ` : ""}
      
      ${isWiFi ? `
        <div class="info-text mt-3" style="background:rgba(245,158,11,0.1);border-left:3px solid #f59e0b;padding:1rem;border-radius:0.25rem;">
          <strong>⚠️ WiFi Security:</strong>
          <ul style="margin-left:1.5rem;margin-top:0.5rem;">
            <li>Only connect to networks you trust</li>
            <li>Public WiFi can be spoofed by attackers</li>
            <li>Verify with staff if in a business location</li>
          </ul>
        </div>
      ` : ""}
    `;
  }

  function showNoQRCodeFound() {
    const resultsSection = rootEl.querySelector("#qrResultsSection");
    const contentDiv = rootEl.querySelector("#qrDecodedContent");
    const analysisDiv = rootEl.querySelector("#qrSecurityAnalysis");

    if (!resultsSection || !contentDiv || !analysisDiv) return;

    resultsSection.classList.remove("hidden");
    resultsSection.classList.add("block");

    contentDiv.innerHTML = `
      <div style="text-align:center;padding:2rem;color:#6b7280;">
        <div style="font-size:3rem;margin-bottom:1rem;">❌</div>
        <div style="font-size:1.1rem;font-weight:600;">No QR Code Detected</div>
        <div style="margin-top:0.5rem;font-size:0.9rem;">
          The image doesn't contain a readable QR code.
        </div>
      </div>
    `;

    analysisDiv.innerHTML = `
      <div class="hint-text">
        <strong>Troubleshooting:</strong>
        <ul style="margin-left:1.5rem;margin-top:0.5rem;">
          <li>Ensure the QR code is clearly visible and in focus</li>
          <li>Try a higher resolution image</li>
          <li>Make sure the entire QR code is in the image</li>
          <li>Check that the image isn't rotated or heavily distorted</li>
        </ul>
      </div>
    `;
  }

  function clearAnalysis() {
    const previewSection = rootEl.querySelector("#qrPreviewSection");
    const resultsSection = rootEl.querySelector("#qrResultsSection");
    const fileInfo = rootEl.querySelector("#qrFileInfo");
    const fileInput = rootEl.querySelector("#qrFileInput");

    if (previewSection) {
      previewSection.classList.remove("block");
      previewSection.classList.add("hidden");
    }

    if (resultsSection) {
      resultsSection.classList.remove("block");
      resultsSection.classList.add("hidden");
    }

    if (fileInfo) {
      fileInfo.textContent = "";
    }

    if (fileInput) {
      fileInput.value = "";
    }

    currentImage = null;
    decodedData = null;
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
    rootEl = null;
    currentImage = null;
    decodedData = null;
  }

  window.SecOpsWorkbench = window.SecOpsWorkbench || { modules: {} };
  window.SecOpsWorkbench.registerModule = window.SecOpsWorkbench.registerModule || function(name, mod) {
    window.SecOpsWorkbench.modules[name] = mod;
  };

  window.SecOpsWorkbench.registerModule("qrAnalyzer", {
    meta,
    init,
    show,
    hide,
  });
})();