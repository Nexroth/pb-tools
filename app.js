// app.js

// Global module registry
const SecOpsWorkbench = {
  modules: {},
  currentModule: null,
};

function registerModule(name, moduleDefinition) {
  SecOpsWorkbench.modules[name] = moduleDefinition;
}

// Switch active module
function activateModule(name) {
  const module = SecOpsWorkbench.modules[name];
  if (!module) return;

  // Hide previous
  if (SecOpsWorkbench.currentModule?.hide) {
    SecOpsWorkbench.currentModule.hide();
  }

  // Update header title / subtitle
  const titleEl    = document.getElementById("moduleTitle");
  const subtitleEl = document.getElementById("moduleSubtitle");
  if (module.meta) {
    if (titleEl    && module.meta.title)    titleEl.textContent    = module.meta.title;
    if (subtitleEl && module.meta.subtitle) subtitleEl.textContent = module.meta.subtitle;
  }

  // Set module-specific class on the container (drives CSS layout rules)
  const container = document.getElementById("moduleContainer");
  if (container) {
    container.className = `module-container module-container--${name}`;
  }

  // Show new module
  if (module.show) module.show();

  SecOpsWorkbench.currentModule = module;

  // Update nav active state
  document.querySelectorAll(".nav-item[data-module]").forEach(btn => {
    btn.classList.toggle("active", btn.getAttribute("data-module") === name);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  const appRoot            = document.getElementById("app");
  const sidebarToggleBtn   = document.getElementById("sidebarToggleButton");
  const exportModalBackdrop = document.getElementById("exportModalBackdrop");
  const exportModalCloseBtn = document.getElementById("exportModalCloseBtn");
  const exportCancelButton  = document.getElementById("exportCancelButton");
  const exportConfirmButton = document.getElementById("exportConfirmButton");

  // ── Theme ──────────────────────────────────────────────────────────────────
  if (appRoot) {
    const saved = localStorage.getItem("pbTools_theme");
    appRoot.classList.add(saved || "theme-dark");
  }

  // ── Sidebar collapse/expand ────────────────────────────────────────────────
  if (appRoot && sidebarToggleBtn) {
    const collapsed = localStorage.getItem("pbTools_sidebarCollapsed") === "1";
    if (collapsed) appRoot.classList.add("sidebar-collapsed");
    sidebarToggleBtn.textContent = collapsed ? "☰" : "‹";

    sidebarToggleBtn.addEventListener("click", () => {
      appRoot.classList.toggle("sidebar-collapsed");
      const isNowCollapsed = appRoot.classList.contains("sidebar-collapsed");
      localStorage.setItem("pbTools_sidebarCollapsed", isNowCollapsed ? "1" : "0");
      sidebarToggleBtn.textContent = isNowCollapsed ? "☰" : "‹";
    });
  }

  // ── Navigation ─────────────────────────────────────────────────────────────
  document.querySelectorAll(".nav-item[data-module]").forEach(btn => {
    btn.addEventListener("click", () => {
      if (!btn.disabled) activateModule(btn.getAttribute("data-module"));
    });
  });

  // ── Initialize all modules ─────────────────────────────────────────────────
  Object.entries(SecOpsWorkbench.modules).forEach(([, mod]) => {
    if (mod.init) mod.init();
  });

  // ── Export modal helpers ───────────────────────────────────────────────────
  function openExportModal(hasSummary) {
    if (!exportModalBackdrop) return;

    const summaryOption = document.getElementById("exportSummaryOption");
    const summaryRadio  = summaryOption?.querySelector('input[type="radio"]');

    if (summaryOption && summaryRadio) {
      if (hasSummary) {
        summaryOption.classList.remove("disabled");
        summaryRadio.disabled = false;
      } else {
        summaryOption.classList.add("disabled");
        summaryRadio.disabled = true;
        const mainRadio = document.querySelector('input[name="exportDataset"][value="main"]');
        if (mainRadio) mainRadio.checked = true;
      }
    }

    exportModalBackdrop.classList.remove("hidden");
  }

  function closeExportModal() {
    exportModalBackdrop?.classList.add("hidden");
  }

  // ── Export button — event delegation (button is inside dynamic module DOM) ─
  document.addEventListener("click", e => {
    if (e.target.closest("#exportOpenButton")) {
      const csvMod = SecOpsWorkbench.modules["csvWorkbench"];
      openExportModal(csvMod?.api?.hasSummary?.() ?? false);
    }
  });

  // ── Modal close buttons ────────────────────────────────────────────────────
  [exportModalCloseBtn, exportCancelButton].forEach(btn => {
    btn?.addEventListener("click", closeExportModal);
  });

  // ── Export confirm ─────────────────────────────────────────────────────────
  exportConfirmButton?.addEventListener("click", () => {
    const format  = document.querySelector('input[name="exportFormat"]:checked')?.value;
    const dataset = document.querySelector('input[name="exportDataset"]:checked')?.value;
    const api     = SecOpsWorkbench.modules["csvWorkbench"]?.api;

    if (api) {
      if      (format === "csv"  && dataset === "main")    api.exportMainCsv();
      else if (format === "csv"  && dataset === "summary") api.exportSummaryCsv();
      else if (format === "xlsx" && dataset === "main")    api.exportMainXlsx();
      else if (format === "xlsx" && dataset === "summary") api.exportSummaryXlsx();
    }

    closeExportModal();
  });

  // ── Default module ─────────────────────────────────────────────────────────
  activateModule("csvWorkbench");
});

// Expose globally for modules
window.SecOpsWorkbench = {
  registerModule,
  modules: SecOpsWorkbench.modules,
  activateModule,
};
