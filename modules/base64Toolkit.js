// modules/base64Toolkit.js

(function () {
  const meta = {
    title: "Base64 Toolkit",
    subtitle: "Encode and decode Base64, URL encoding, Hex, and more. All processing happens locally.",
  };

  let rootEl = null;

  function init() {}

  function render() {
    const container = document.getElementById("moduleContainer");
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
    wrapper.className = "base64-toolkit-wrapper";
    wrapper.style.cssText = `
      width: 100%;
      height: auto;
      display: block;
      overflow: visible;
    `;

    wrapper.innerHTML = `
      <div class="module-content-wrapper">
        <!-- Encoding Type Selection -->
        <div class="section-card mb-5">
          <div class="section-card-header">Encoding Type</div>
          <div class="info-text mb-3">Select which encoding format to use:</div>
          <div class="flex gap-3 flex-wrap">
            <button class="btn btn-secondary encoding-type-btn active" data-type="base64">
              Base64
            </button>
            <button class="btn btn-secondary encoding-type-btn" data-type="url">
              URL Encode
            </button>
            <button class="btn btn-secondary encoding-type-btn" data-type="hex">
              Hex
            </button>
            <button class="btn btn-secondary encoding-type-btn" data-type="binary">
              Binary
            </button>
          </div>
          <div class="hint-text mt-2" id="encodingHint">
            Base64: Standard encoding for email attachments, data URIs, and API tokens
          </div>
        </div>

        <!-- Input Section -->
        <div class="section-card mb-5">
          <div class="section-card-header">Input</div>
          <textarea
            id="base64Input"
            placeholder="Enter text to encode or paste encoded text to decode..."
            class="form-textarea"
            style="min-height:150px;"
          ></textarea>
          <div class="flex gap-3 mt-3">
            <button class="btn btn-secondary" id="encodeBtn">
              ⬆️ Encode
            </button>
            <button class="btn btn-secondary" id="decodeBtn">
              ⬇️ Decode
            </button>
            <button class="btn btn-secondary btn-sm" id="clearBtn">
              Clear
            </button>
          </div>
        </div>

        <!-- Output Section -->
        <div class="section-card" id="outputSection" style="display:none;">
          <div class="flex items-center justify-between mb-3">
            <div class="section-card-header" style="margin:0;">Output</div>
            <button class="btn btn-secondary btn-sm" id="copyOutputBtn">
              Copy
            </button>
          </div>
          <div class="result-box" id="base64Output" style="min-height:100px;white-space:pre-wrap;word-break:break-all;"></div>
        </div>
      </div>
    `;

    container.appendChild(wrapper);
    rootEl = wrapper;

    wireEvents();
  }

  function wireEvents() {
    if (!rootEl) return;

    const inputEl = rootEl.querySelector("#base64Input");
    const outputEl = rootEl.querySelector("#base64Output");
    const outputSection = rootEl.querySelector("#outputSection");
    const encodeBtn = rootEl.querySelector("#encodeBtn");
    const decodeBtn = rootEl.querySelector("#decodeBtn");
    const clearBtn = rootEl.querySelector("#clearBtn");
    const copyOutputBtn = rootEl.querySelector("#copyOutputBtn");
    const typeButtons = rootEl.querySelectorAll(".encoding-type-btn");
    const encodingHint = rootEl.querySelector("#encodingHint");

    let currentType = "base64";

    // Hint text for each encoding type
    const hints = {
      base64: "Base64: Standard encoding for email attachments, data URIs, and API tokens",
      url: "URL Encode: Encode special characters for use in URLs and query parameters",
      hex: "Hex: Hexadecimal representation - useful for color codes and binary data",
      binary: "Binary: 8-bit binary representation of each character"
    };

    // Encoding type selection
    typeButtons.forEach(btn => {
      btn.addEventListener("click", () => {
        typeButtons.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        currentType = btn.getAttribute("data-type");
        
        // Update hint text
        if (encodingHint) {
          encodingHint.textContent = hints[currentType];
        }
      });
    });

    // Encode button
    if (encodeBtn && inputEl && outputEl && outputSection) {
      encodeBtn.addEventListener("click", () => {
        const input = inputEl.value;
        if (!input) {
          alert("Please enter text to encode");
          return;
        }

        try {
          let result = "";
          switch (currentType) {
            case "base64":
              result = btoa(input);
              break;
            case "url":
              result = encodeURIComponent(input);
              break;
            case "hex":
              result = Array.from(input)
                .map(c => c.charCodeAt(0).toString(16).padStart(2, '0'))
                .join('');
              break;
            case "binary":
              result = Array.from(input)
                .map(c => c.charCodeAt(0).toString(2).padStart(8, '0'))
                .join(' ');
              break;
          }
          outputEl.textContent = result;
          outputSection.style.display = "block";
        } catch (err) {
          alert("Encoding failed: " + err.message);
        }
      });
    }

    // Decode button
    if (decodeBtn && inputEl && outputEl && outputSection) {
      decodeBtn.addEventListener("click", () => {
        const input = inputEl.value;
        if (!input) {
          alert("Please enter text to decode");
          return;
        }

        try {
          let result = "";
          switch (currentType) {
            case "base64":
              result = atob(input);
              break;
            case "url":
              result = decodeURIComponent(input);
              break;
            case "hex":
              result = input.match(/.{1,2}/g)
                .map(byte => String.fromCharCode(parseInt(byte, 16)))
                .join('');
              break;
            case "binary":
              result = input.split(' ')
                .map(byte => String.fromCharCode(parseInt(byte, 2)))
                .join('');
              break;
          }
          outputEl.textContent = result;
          outputSection.style.display = "block";
        } catch (err) {
          alert("Decoding failed: " + err.message);
        }
      });
    }

    // Clear button
    if (clearBtn && inputEl && outputEl && outputSection) {
      clearBtn.addEventListener("click", () => {
        inputEl.value = "";
        outputEl.textContent = "";
        outputSection.style.display = "none";
      });
    }

    // Copy output button
    if (copyOutputBtn && outputEl) {
      copyOutputBtn.addEventListener("click", () => {
        const text = outputEl.textContent;
        if (!text) {
          alert("No output to copy");
          return;
        }
        navigator.clipboard.writeText(text).then(
          () => {
            copyOutputBtn.textContent = "✓ Copied";
            setTimeout(() => {
              copyOutputBtn.textContent = "Copy";
            }, 2000);
          },
          () => alert("Failed to copy to clipboard")
        );
      });
    }
  }

  function show() {
    render();
  }

  function hide() {
    rootEl = null;
  }

  window.SecOpsWorkbench = window.SecOpsWorkbench || { modules: {} };
  window.SecOpsWorkbench.registerModule = window.SecOpsWorkbench.registerModule || function(name, mod) {
    window.SecOpsWorkbench.modules[name] = mod;
  };

  window.SecOpsWorkbench.registerModule("base64Toolkit", {
    meta,
    init,
    show,
    hide,
  });
})();