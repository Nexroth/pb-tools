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
  if (SecOpsWorkbench.currentModule && SecOpsWorkbench.currentModule.hide) {
    SecOpsWorkbench.currentModule.hide();
  }

  // Update header
  const titleEl = document.getElementById("moduleTitle");
  const subtitleEl = document.getElementById("moduleSubtitle");

  if (module.meta) {
    if (titleEl && module.meta.title) titleEl.textContent = module.meta.title;
    if (subtitleEl && module.meta.subtitle) {
      subtitleEl.textContent = module.meta.subtitle;
    }
  }

  // Show new
  if (module.show) {
    module.show();
  }

  SecOpsWorkbench.currentModule = module;

  // Update nav active state
  const navButtons = document.querySelectorAll(".nav-item[data-module]");
  navButtons.forEach((btn) => {
    const mod = btn.getAttribute("data-module");
    btn.classList.toggle("active", mod === name);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  // Wire navigation
  document.querySelectorAll(".nav-item[data-module]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const modName = btn.getAttribute("data-module");
      if (!btn.disabled) {
        activateModule(modName);
      }
    });
  });

  // Initialize all registered modules
  Object.entries(SecOpsWorkbench.modules).forEach(([name, module]) => {
    if (module.init) module.init();
  });
  // Export modal wiring
  const exportOpenButton = document.getElementById("exportOpenButton");
  const exportModalBackdrop = document.getElementById("exportModalBackdrop");
  const exportModalCloseBtn = document.getElementById("exportModalCloseBtn");
  const exportCancelButton = document.getElementById("exportCancelButton");
  const exportConfirmButton = document.getElementById("exportConfirmButton");

  function openExportModal(hasSummary) {
    if (!exportModalBackdrop) return;

    // Enable/disable summary option based on availability
    const summaryOption = document.getElementById("exportSummaryOption");
    const summaryRadio = summaryOption
      ? summaryOption.querySelector('input[type="radio"]')
      : null;

    if (summaryOption && summaryRadio) {
      if (hasSummary) {
        summaryOption.classList.remove("disabled");
        summaryRadio.disabled = false;
      } else {
        summaryOption.classList.add("disabled");
        summaryRadio.disabled = true;
        // Ensure main is selected
        const mainRadio = document.querySelector(
          'input[name="exportDataset"][value="main"]'
        );
        if (mainRadio) mainRadio.checked = true;
      }
    }

    exportModalBackdrop.classList.remove("hidden");
  }

  function closeExportModal() {
    if (!exportModalBackdrop) return;
    exportModalBackdrop.classList.add("hidden");
  }

  if (exportOpenButton) {
    exportOpenButton.addEventListener("click", () => {
      const csvModule = SecOpsWorkbench.modules["csvWorkbench"];
      const hasSummary =
        csvModule && csvModule.api && csvModule.api.hasSummary
          ? csvModule.api.hasSummary()
          : false;
      openExportModal(hasSummary);
    });
  }

  [exportModalCloseBtn, exportCancelButton].forEach((btn) => {
    if (btn) {
      btn.addEventListener("click", () => {
        closeExportModal();
      });
    }
  });

  if (exportConfirmButton) {
    exportConfirmButton.addEventListener("click", () => {
      const format = document.querySelector(
        'input[name="exportFormat"]:checked'
      )?.value;
      const dataset = document.querySelector(
        'input[name="exportDataset"]:checked'
      )?.value;

      const csvModule = SecOpsWorkbench.modules["csvWorkbench"];
      if (!csvModule || !csvModule.api) {
        closeExportModal();
        return;
      }

      if (format === "csv" && dataset === "main") {
        csvModule.api.exportMainCsv();
      } else if (format === "csv" && dataset === "summary") {
        csvModule.api.exportSummaryCsv();
      } else if (format === "xlsx" && dataset === "main") {
        csvModule.api.exportMainXlsx();
      } else if (format === "xlsx" && dataset === "summary") {
        csvModule.api.exportSummaryXlsx();
      }
      closeExportModal();
    });
  }

  // Default module
  activateModule("csvWorkbench");
});

// Expose register function globally for modules
window.SecOpsWorkbench = {
  registerModule,
  modules: SecOpsWorkbench.modules,
  activateModule,
};
