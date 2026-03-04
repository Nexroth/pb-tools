// modules/settings.js
(function () {
  const meta = {
    title: "Settings",
    subtitle: "Theme, preferences, and about PB Tools.",
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
    wrapper.className = "settings-wrapper";
    wrapper.style.cssText = `
      width: 100%;
      height: auto;
      display: block;
      overflow: visible;
    `;

    wrapper.innerHTML = `
      <div class="module-content-wrapper">
        <div class="section-card mb-5">
          <div class="section-card-header">Theme</div>
          <div class="flex-col gap-2">
            <label class="form-label">Select theme</label>
            <select class="form-select" id="themeSelect" style="max-width:250px;">
              <option value="dark">Dark (default)</option>
              <option value="light">Light</option>
              <option value="pb-dashboard">Peanut Butter</option>
              <option value="nordic">Nordic</option>
              <option value="catppuccin">Catppuccin Mocha</option>
              <option value="dracula">Dracula</option>
              <option value="solarized">Solarized Dark</option>
              <option value="cyberpunk">Cyberpunk</option>
            </select>
          </div>
        </div>

        <div class="section-card mb-5">
          <div class="section-card-header">Data Management</div>
          <div class="flex-col gap-3">
            <div>
              <p class="info-text mb-2">
                Backup and restore all your saved data including templates, 
                note configs, and presets across all modules.
              </p>
            </div>
            <div class="flex-row gap-2">
              <button class="btn btn-primary" id="exportDataBtn">
                Export All Data
              </button>
              <button class="btn btn-secondary" id="importDataBtn">
                Import All Data
              </button>
              <input type="file" id="importFileInput" accept=".json" style="display:none;">
            </div>
            <div class="info-text" style="font-size:0.85rem; color:var(--text-muted);">
              Backs up: theme, templates, note configs, annotations, and user presets
            </div>
          </div>
        </div>

        <div class="section-card mb-5">
          <div class="section-card-header">Links</div>
          <div class="flex-col gap-2">
            <a href="#" id="githubReleasesLink" class="link-primary" 
               style="display:inline-flex; align-items:center; gap:0.5rem;">
              <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.012 8.012 0 0 0 16 8c0-4.42-3.58-8-8-8z"/>
              </svg>
              View Releases on GitHub
            </a>
          </div>
        </div>

        <div class="section-card">
          <div class="section-card-header">About</div>
          <div style="text-align: center; padding: 1.5rem 1rem;">
            <img src="assets/icons/pb-tools-3d.png" 
                 alt="PB Tools" 
                 style="width: 120px; height: auto; margin: 0 auto 1rem; display: block;">
            <h3 style="margin: 0 0 0.5rem; font-size: 1.3rem; color: var(--text-primary);">
              PB Tools
            </h3>
            <p style="color: var(--text-secondary); margin: 0 0 1rem; font-size: 0.9rem;">
              Security Operations Toolset
            </p>
            <p class="info-text" style="margin: 0; line-height: 1.6;">
              Internal helper app for CSV workflows, phishing analysis, 
              email templating, and security operations tasks.
            </p>
            <div style="margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid var(--border); 
                        font-size: 0.85rem; color: var(--text-muted);">
              Version 0.6.0 &bull; Local only
            </div>
          </div>
        </div>
      </div>
    `;

    container.appendChild(wrapper);
    rootEl = wrapper;

    wireEventHandlers();
  }

  function wireEventHandlers() {
    if (!rootEl) return;
    const appRoot = document.getElementById("app");
    if (!appRoot) return;

    // Theme selector
    const themeSelect = rootEl.querySelector("#themeSelect");
    if (themeSelect) {
      const currentTheme = localStorage.getItem("pbTools_theme") || "theme-dark";
      const themeValue = currentTheme.replace("theme-", "");
      themeSelect.value = themeValue;
      
      themeSelect.addEventListener("change", (e) => {
        const theme = e.target.value;
        setTheme(appRoot, theme);
      });
    }

    // Export data button
    const exportBtn = rootEl.querySelector("#exportDataBtn");
    if (exportBtn) {
      exportBtn.addEventListener("click", exportAllData);
    }

    // Import data button
    const importBtn = rootEl.querySelector("#importDataBtn");
    const fileInput = rootEl.querySelector("#importFileInput");
    if (importBtn && fileInput) {
      importBtn.addEventListener("click", () => fileInput.click());
      fileInput.addEventListener("change", handleImportFile);
    }

    // GitHub releases link
    const githubLink = rootEl.querySelector("#githubReleasesLink");
    if (githubLink) {
      githubLink.addEventListener("click", (e) => {
        e.preventDefault();
        window.open("https://github.com/Nexroth/pb-tools", "_blank");
      });
    }
  }

  function setTheme(appRoot, theme) {
    // Remove all theme classes
    appRoot.classList.remove(
      "theme-dark", 
      "theme-light", 
      "theme-pb-dashboard",
      "theme-nordic",
      "theme-catppuccin",
      "theme-dracula",
      "theme-solarized",
      "theme-cyberpunk"
    );
    
    // Map theme value to class name
    const themeMap = {
      "light": "theme-light",
      "pb-dashboard": "theme-pb-dashboard",
      "nordic": "theme-nordic",
      "catppuccin": "theme-catppuccin",
      "dracula": "theme-dracula",
      "solarized": "theme-solarized",
      "cyberpunk": "theme-cyberpunk",
      "dark": "theme-dark"
    };
    
    const className = themeMap[theme] || "theme-dark";
    appRoot.classList.add(className);
    localStorage.setItem("pbTools_theme", className);
  }

  function exportAllData() {
    try {
      // Collect all PB Tools data from localStorage
      const backup = {
        _metadata: {
          version: "0.6.0",
          exportDate: new Date().toISOString(),
          description: "PB Tools data backup"
        },
        theme: localStorage.getItem("pbTools_theme"),
        sidebarCollapsed: localStorage.getItem("pbTools_sidebarCollapsed"),
        csvAnnotations: localStorage.getItem("pbToolsAnnotations"),
        csvNoteConfigs: localStorage.getItem("pbToolsNoteConfigs"),
        csvActiveNoteConfig: localStorage.getItem("pbToolsActiveNoteConfig"),
        csvUserPresets: localStorage.getItem("pbToolsUserPresets"),
        emailTemplates: localStorage.getItem("pbToolsEmailTemplates"),
        reportTemplates: localStorage.getItem("pbTools_reportTemplates")
      };

      // Create download
      const dataStr = JSON.stringify(backup, null, 2);
      const blob = new Blob([dataStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      
      const timestamp = new Date().toISOString().split('T')[0];
      const filename = `pb-tools-backup-${timestamp}.json`;
      
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      
      URL.revokeObjectURL(url);
      
      showNotification("Data exported successfully!", "success");
    } catch (err) {
      console.error("Export failed:", err);
      showNotification("Export failed: " + err.message, "error");
    }
  }

  function handleImportFile(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const backup = JSON.parse(evt.target.result);
        
        // Validate backup structure
        if (!backup._metadata || !backup._metadata.version) {
          throw new Error("Invalid backup file format");
        }

        // Restore all data
        const restoreKey = (key, value) => {
          if (value !== null && value !== undefined) {
            localStorage.setItem(key, value);
          }
        };

        restoreKey("pbTools_theme", backup.theme);
        restoreKey("pbTools_sidebarCollapsed", backup.sidebarCollapsed);
        restoreKey("pbToolsAnnotations", backup.csvAnnotations);
        restoreKey("pbToolsNoteConfigs", backup.csvNoteConfigs);
        restoreKey("pbToolsActiveNoteConfig", backup.csvActiveNoteConfig);
        restoreKey("pbToolsUserPresets", backup.csvUserPresets);
        restoreKey("pbToolsEmailTemplates", backup.emailTemplates);
        restoreKey("pbTools_reportTemplates", backup.reportTemplates);

        // Show success and reload
        showNotification(
          "Data imported successfully! Reloading in 2 seconds...", 
          "success"
        );
        
        setTimeout(() => {
          window.location.reload();
        }, 2000);

      } catch (err) {
        console.error("Import failed:", err);
        showNotification("Import failed: " + err.message, "error");
      }
    };
    
    reader.readAsText(file);
    
    // Reset file input
    e.target.value = "";
  }

  function showNotification(message, type = "info") {
    // Create notification element
    const notification = document.createElement("div");
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 1rem 1.5rem;
      border-radius: 4px;
      background: ${type === "success" ? "var(--success)" : type === "error" ? "var(--danger)" : "var(--info)"};
      color: white;
      font-weight: 500;
      z-index: 10000;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      animation: slideIn 0.3s ease-out;
    `;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    // Auto-remove after 3 seconds
    setTimeout(() => {
      notification.style.animation = "slideOut 0.3s ease-out";
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }

  function show() {
    render();
  }

  function hide() {}

  window.SecOpsWorkbench.registerModule("settings", {
    meta,
    init,
    show,
    hide,
  });
})();