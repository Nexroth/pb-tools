// modules/hashGenerator.js

(function () {
  const containerId = "moduleContainer";
  let rootEl = null;

  const meta = {
    title: "Hash Generator",
    subtitle:
      "Generate cryptographic hashes (MD5, SHA-1, SHA-256, SHA-512) from files or text. All processing happens locally.",
  };

  let currentHashes = null; // { md5, sha1, sha256, sha512 }
  let currentInput = null; // { type: 'file'|'text', name, size }

  function init() {}

  function render() {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = "";

    const wrapper = document.createElement("div");
    wrapper.className = "module-card";

    wrapper.innerHTML = `
      <div style="padding:0.5rem 0;">
        <!-- Input mode toggle -->
        <div style="display:flex;gap:0.5rem;margin-bottom:1rem;">
          <button class="btn btn-secondary" id="hashModeFile" data-mode="file">
            📄 File
          </button>
          <button class="btn btn-secondary" id="hashModeText" data-mode="text">
            📝 Text
          </button>
        </div>

        <!-- File input panel -->
        <div id="hashFilePanel" style="display:block;">
          <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.75rem;">
            <button class="btn" id="hashChooseFileBtn">
              Choose file
            </button>
            <input
              type="file"
              id="hashFileInput"
              style="display:none"
            >
            <span id="hashFileInfo" style="font-size:0.8rem;color:#9ca3af;"></span>
          </div>

          <div
            id="hashDropzone"
            class="dropzone"
            style="
              padding:2rem 1.5rem;
              min-height:140px;
              display:flex;
              flex-direction:column;
              align-items:center;
              justify-content:center;
              gap:0.5rem;
              cursor:pointer;
              transition:all 0.2s ease;
            "
          >
            <div style="font-size:2.5rem;opacity:0.6;">📄</div>
            <div style="font-size:0.95rem;font-weight:500;color:#e5e7eb;">
              Drop file here to generate hashes
            </div>
            <div style="font-size:0.75rem;color:#6b7280;">
              or click "Choose file" above • Any file type accepted
            </div>
          </div>
        </div>

        <!-- Text input panel -->
        <div id="hashTextPanel" style="display:none;">
          <textarea
            id="hashTextInput"
            placeholder="Paste or type text to hash..."
            style="
              width:100%;
              min-height:150px;
              padding:0.75rem;
              border-radius:0.6rem;
              border:1px solid rgba(148,163,184,0.4);
              background:#020617;
              color:#e5e7eb;
              font-family:ui-monospace,monospace;
              font-size:0.85rem;
              resize:vertical;
            "
          ></textarea>
          <div style="margin-top:0.5rem;display:flex;gap:0.5rem;">
            <button class="btn" id="hashTextBtn">
              Generate hashes
            </button>
            <button class="btn btn-secondary" id="hashClearTextBtn">
              Clear
            </button>
          </div>
        </div>

        <!-- Results panel -->
        <div id="hashResultsPanel" style="margin-top:1.5rem;display:none;">
          <div style="
            background:#020617;
            border-radius:0.6rem;
            border:1px solid rgba(148,163,184,0.35);
            padding:0.75rem 0.9rem;
          ">
            <div style="
              display:flex;
              align-items:center;
              justify-content:space-between;
              margin-bottom:0.5rem;
            ">
              <div style="font-weight:600;font-size:0.9rem;">Hash Results</div>
              <button class="btn btn-secondary" id="hashClearResultsBtn" style="padding:0.25rem 0.6rem;font-size:0.75rem;">
                Clear
              </button>
            </div>

            <div id="hashInputInfo" style="font-size:0.75rem;color:#9ca3af;margin-bottom:0.75rem;"></div>

            <div style="display:flex;flex-direction:column;gap:0.5rem;">
              <!-- MD5 -->
              <div class="hash-result-row">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.25rem;">
                  <span style="font-weight:600;font-size:0.8rem;color:#22c55e;">MD5</span>
                  <button class="btn btn-secondary hash-copy-btn" data-hash-type="md5" style="padding:0.2rem 0.5rem;font-size:0.7rem;">
                    Copy
                  </button>
                </div>
                <div class="hash-value" id="hashMd5" style="
                  font-family:ui-monospace,monospace;
                  font-size:0.75rem;
                  color:#e5e7eb;
                  background:rgba(15,23,42,0.9);
                  padding:0.4rem 0.5rem;
                  border-radius:0.4rem;
                  word-break:break-all;
                "></div>
              </div>

              <!-- SHA-1 -->
              <div class="hash-result-row">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.25rem;">
                  <span style="font-weight:600;font-size:0.8rem;color:#3b82f6;">SHA-1</span>
                  <button class="btn btn-secondary hash-copy-btn" data-hash-type="sha1" style="padding:0.2rem 0.5rem;font-size:0.7rem;">
                    Copy
                  </button>
                </div>
                <div class="hash-value" id="hashSha1" style="
                  font-family:ui-monospace,monospace;
                  font-size:0.75rem;
                  color:#e5e7eb;
                  background:rgba(15,23,42,0.9);
                  padding:0.4rem 0.5rem;
                  border-radius:0.4rem;
                  word-break:break-all;
                "></div>
              </div>

              <!-- SHA-256 -->
              <div class="hash-result-row">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.25rem;">
                  <span style="font-weight:600;font-size:0.8rem;color:#f59e0b;">SHA-256</span>
                  <button class="btn btn-secondary hash-copy-btn" data-hash-type="sha256" style="padding:0.2rem 0.5rem;font-size:0.7rem;">
                    Copy
                  </button>
                </div>
                <div class="hash-value" id="hashSha256" style="
                  font-family:ui-monospace,monospace;
                  font-size:0.75rem;
                  color:#e5e7eb;
                  background:rgba(15,23,42,0.9);
                  padding:0.4rem 0.5rem;
                  border-radius:0.4rem;
                  word-break:break-all;
                "></div>
              </div>

              <!-- SHA-512 -->
              <div class="hash-result-row">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.25rem;">
                  <span style="font-weight:600;font-size:0.8rem;color:#8b5cf6;">SHA-512</span>
                  <button class="btn btn-secondary hash-copy-btn" data-hash-type="sha512" style="padding:0.2rem 0.5rem;font-size:0.7rem;">
                    Copy
                  </button>
                </div>
                <div class="hash-value" id="hashSha512" style="
                  font-family:ui-monospace,monospace;
                  font-size:0.75rem;
                  color:#e5e7eb;
                  background:rgba(15,23,42,0.9);
                  padding:0.4rem 0.5rem;
                  border-radius:0.4rem;
                  word-break:break-all;
                "></div>
              </div>
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

    // Mode toggle buttons
    const fileModeBtn = rootEl.querySelector("#hashModeFile");
    const textModeBtn = rootEl.querySelector("#hashModeText");
    const filePanel = rootEl.querySelector("#hashFilePanel");
    const textPanel = rootEl.querySelector("#hashTextPanel");

    fileModeBtn.addEventListener("click", () => {
      filePanel.style.display = "block";
      textPanel.style.display = "none";
      fileModeBtn.style.background = "#1d4ed8";
      textModeBtn.style.background = "#111827";
    });

    textModeBtn.addEventListener("click", () => {
      filePanel.style.display = "none";
      textPanel.style.display = "block";
      textModeBtn.style.background = "#1d4ed8";
      fileModeBtn.style.background = "#111827";
    });

    // Set initial mode
    fileModeBtn.style.background = "#1d4ed8";

    // File input
    const fileBtn = rootEl.querySelector("#hashChooseFileBtn");
    const fileInput = rootEl.querySelector("#hashFileInput");
    const dropzone = rootEl.querySelector("#hashDropzone");

    if (fileBtn && fileInput) {
      fileBtn.addEventListener("click", () => {
        fileInput.value = "";
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
      // Add hover effect
      dropzone.addEventListener("mouseenter", () => {
        if (!dropzone.classList.contains("dragover")) {
          dropzone.style.borderColor = "rgba(148, 163, 184, 0.7)";
          dropzone.style.background = "rgba(15, 23, 42, 0.8)";
        }
      });

      dropzone.addEventListener("mouseleave", () => {
        if (!dropzone.classList.contains("dragover")) {
          dropzone.style.borderColor = "";
          dropzone.style.background = "";
        }
      });

      dropzone.addEventListener("dragover", (e) => {
        e.preventDefault();
        dropzone.classList.add("dragover");
        dropzone.style.borderColor = "#22c55e";
        dropzone.style.background = "rgba(22, 163, 74, 0.12)";
        dropzone.style.transform = "scale(1.01)";
      });

      dropzone.addEventListener("dragleave", (e) => {
        e.preventDefault();
        dropzone.classList.remove("dragover");
        dropzone.style.borderColor = "";
        dropzone.style.background = "";
        dropzone.style.transform = "";
      });

      dropzone.addEventListener("drop", (e) => {
        e.preventDefault();
        dropzone.classList.remove("dragover");
        dropzone.style.borderColor = "";
        dropzone.style.background = "";
        dropzone.style.transform = "";
        const file = e.dataTransfer.files && e.dataTransfer.files[0];
        if (file) {
          handleFile(file);
        }
      });

      // Make dropzone clickable to trigger file input
      dropzone.addEventListener("click", () => {
        const fileInput = rootEl.querySelector("#hashFileInput");
        if (fileInput) {
          fileInput.value = "";
          fileInput.click();
        }
      });
    }

    // Text input
    const textBtn = rootEl.querySelector("#hashTextBtn");
    const textInput = rootEl.querySelector("#hashTextInput");
    const clearTextBtn = rootEl.querySelector("#hashClearTextBtn");

    if (textBtn && textInput) {
      textBtn.addEventListener("click", () => {
        const text = textInput.value;
        if (text) {
          handleText(text);
        }
      });
    }

    if (clearTextBtn && textInput) {
      clearTextBtn.addEventListener("click", () => {
        textInput.value = "";
      });
    }

    // Clear results
    const clearResultsBtn = rootEl.querySelector("#hashClearResultsBtn");
    if (clearResultsBtn) {
      clearResultsBtn.addEventListener("click", () => {
        clearResults();
      });
    }

    // Copy buttons (delegated event)
    rootEl.addEventListener("click", (e) => {
      if (e.target.classList.contains("hash-copy-btn")) {
        const hashType = e.target.getAttribute("data-hash-type");
        if (hashType && currentHashes && currentHashes[hashType]) {
          copyToClipboard(currentHashes[hashType], e.target);
        }
      }
    });
  }

  async function handleFile(file) {
    const fileInfo = rootEl.querySelector("#hashFileInfo");
    if (fileInfo) {
      fileInfo.textContent = `Processing ${file.name} (${formatBytes(file.size)})...`;
    }

    currentInput = {
      type: "file",
      name: file.name,
      size: file.size,
    };

    try {
      const arrayBuffer = await readFileAsArrayBuffer(file);
      const hashes = await computeHashes(arrayBuffer);
      
      currentHashes = hashes;
      displayResults();

      if (fileInfo) {
        fileInfo.textContent = `${file.name} (${formatBytes(file.size)})`;
      }
    } catch (err) {
      console.error("[Hash Generator] Error processing file:", err);
      if (fileInfo) {
        fileInfo.textContent = `Error: ${err.message}`;
      }
    }
  }

  async function handleText(text) {
    currentInput = {
      type: "text",
      name: "Text input",
      size: new TextEncoder().encode(text).length,
    };

    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(text);
      const hashes = await computeHashes(data.buffer);
      
      currentHashes = hashes;
      displayResults();
    } catch (err) {
      console.error("[Hash Generator] Error processing text:", err);
    }
  }

  function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsArrayBuffer(file);
    });
  }

  async function computeHashes(arrayBuffer) {
    const md5 = await computeMD5(arrayBuffer);
    const sha1 = await computeSHA(arrayBuffer, "SHA-1");
    const sha256 = await computeSHA(arrayBuffer, "SHA-256");
    const sha512 = await computeSHA(arrayBuffer, "SHA-512");

    return { md5, sha1, sha256, sha512 };
  }

  // MD5 implementation (since Web Crypto API doesn't support MD5)
  // Simplified MD5 based on the RSA Data Security, Inc. MD5 Message-Digest Algorithm
  async function computeMD5(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    return md5(bytes);
  }

  // MD5 hash function
  function md5(bytes) {
    // MD5 implementation
    const K = new Int32Array([
      0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee,
      0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
      0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be,
      0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
      0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa,
      0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
      0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed,
      0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
      0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c,
      0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
      0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05,
      0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
      0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039,
      0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
      0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1,
      0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391
    ]);

    const S = [
      7, 12, 17, 22,  7, 12, 17, 22,  7, 12, 17, 22,  7, 12, 17, 22,
      5,  9, 14, 20,  5,  9, 14, 20,  5,  9, 14, 20,  5,  9, 14, 20,
      4, 11, 16, 23,  4, 11, 16, 23,  4, 11, 16, 23,  4, 11, 16, 23,
      6, 10, 15, 21,  6, 10, 15, 21,  6, 10, 15, 21,  6, 10, 15, 21
    ];

    function rotateLeft(value, shift) {
      return (value << shift) | (value >>> (32 - shift));
    }

    function addUnsigned(x, y) {
      const lsw = (x & 0xFFFF) + (y & 0xFFFF);
      const msw = (x >> 16) + (y >> 16) + (lsw >> 16);
      return (msw << 16) | (lsw & 0xFFFF);
    }

    // Padding
    const msgLen = bytes.length;
    const bitLen = msgLen * 8;
    const paddedLen = ((msgLen + 8) >>> 6 << 4) + 14;
    const padded = new Uint8Array((paddedLen + 2) * 4);
    padded.set(bytes);
    padded[msgLen] = 0x80;
    
    const view = new DataView(padded.buffer);
    view.setUint32(paddedLen * 4, bitLen & 0xFFFFFFFF, true);
    view.setUint32(paddedLen * 4 + 4, Math.floor(bitLen / 0x100000000), true);

    // Initialize hash values
    let h0 = 0x67452301;
    let h1 = 0xEFCDAB89;
    let h2 = 0x98BADCFE;
    let h3 = 0x10325476;

    // Process blocks
    for (let i = 0; i < padded.length; i += 64) {
      const M = new Uint32Array(16);
      for (let j = 0; j < 16; j++) {
        M[j] = view.getUint32(i + j * 4, true);
      }

      let A = h0, B = h1, C = h2, D = h3;

      for (let j = 0; j < 64; j++) {
        let F, g;
        if (j < 16) {
          F = (B & C) | (~B & D);
          g = j;
        } else if (j < 32) {
          F = (D & B) | (~D & C);
          g = (5 * j + 1) % 16;
        } else if (j < 48) {
          F = B ^ C ^ D;
          g = (3 * j + 5) % 16;
        } else {
          F = C ^ (B | ~D);
          g = (7 * j) % 16;
        }

        F = addUnsigned(F, A);
        F = addUnsigned(F, K[j]);
        F = addUnsigned(F, M[g]);
        A = D;
        D = C;
        C = B;
        B = addUnsigned(B, rotateLeft(F, S[j]));
      }

      h0 = addUnsigned(h0, A);
      h1 = addUnsigned(h1, B);
      h2 = addUnsigned(h2, C);
      h3 = addUnsigned(h3, D);
    }

    // Convert to hex
    const hex = (n) => {
      const h = (n >>> 0).toString(16);
      return ('00000000' + h).slice(-8);
    };

    return [h0, h1, h2, h3].map(h => {
      const bytes = [
        (h >>> 0) & 0xFF,
        (h >>> 8) & 0xFF,
        (h >>> 16) & 0xFF,
        (h >>> 24) & 0xFF
      ];
      return bytes.map(b => b.toString(16).padStart(2, '0')).join('');
    }).join('');
  }

  // SHA family using Web Crypto API
  async function computeSHA(arrayBuffer, algorithm) {
    const hashBuffer = await crypto.subtle.digest(algorithm, arrayBuffer);
    return bufferToHex(hashBuffer);
  }

  function bufferToHex(buffer) {
    const bytes = new Uint8Array(buffer);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  function displayResults() {
    const resultsPanel = rootEl.querySelector("#hashResultsPanel");
    const inputInfo = rootEl.querySelector("#hashInputInfo");

    if (!resultsPanel || !currentHashes || !currentInput) return;

    resultsPanel.style.display = "block";

    if (inputInfo) {
      inputInfo.textContent = `Source: ${currentInput.name} (${formatBytes(currentInput.size)})`;
    }

    const md5El = rootEl.querySelector("#hashMd5");
    const sha1El = rootEl.querySelector("#hashSha1");
    const sha256El = rootEl.querySelector("#hashSha256");
    const sha512El = rootEl.querySelector("#hashSha512");

    if (md5El) md5El.textContent = currentHashes.md5 || "N/A";
    if (sha1El) sha1El.textContent = currentHashes.sha1 || "N/A";
    if (sha256El) sha256El.textContent = currentHashes.sha256 || "N/A";
    if (sha512El) sha512El.textContent = currentHashes.sha512 || "N/A";
  }

  function clearResults() {
    const resultsPanel = rootEl.querySelector("#hashResultsPanel");
    const fileInfo = rootEl.querySelector("#hashFileInfo");
    const textInput = rootEl.querySelector("#hashTextInput");

    if (resultsPanel) resultsPanel.style.display = "none";
    if (fileInfo) fileInfo.textContent = "";
    if (textInput) textInput.value = "";

    currentHashes = null;
    currentInput = null;
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
        button.textContent = "✗ Failed";
        setTimeout(() => {
          button.textContent = "Copy";
        }, 1500);
      }
    );
  }

  function formatBytes(bytes) {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + " " + sizes[i];
  }

  function show() {
    render();
  }

  function hide() {
    currentHashes = null;
    currentInput = null;
  }

  window.SecOpsWorkbench.registerModule("hashGenerator", {
    meta,
    init,
    show,
    hide,
  });
})();