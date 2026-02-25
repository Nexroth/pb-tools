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
              <option value="pb-dashboard">PB Dashboard</option>
            </select>
          </div>
        </div>

        <div class="section-card">
          <div class="section-card-header">About</div>
          <p class="info-text">
            PB Tools - internal helper app for CSV / spreadsheet workflows.
          </p>
        </div>
      </div>
    `;

    container.appendChild(wrapper);
    rootEl = wrapper;

    wireThemeButtons();
  }

  function wireThemeButtons() {
    if (!rootEl) return;
    const themeSelect = rootEl.querySelector("#themeSelect");
    const appRoot = document.getElementById("app");
    if (!appRoot || !themeSelect) return;

    // Set current theme in dropdown
    const currentTheme = localStorage.getItem("pbTools_theme") || "theme-dark";
    const themeValue = currentTheme.replace("theme-", "");
    themeSelect.value = themeValue;

    // Listen for changes
    themeSelect.addEventListener("change", (e) => {
      const theme = e.target.value;
      setTheme(appRoot, theme);
    });
  }

  function setTheme(appRoot, theme) {
    appRoot.classList.remove("theme-dark", "theme-light", "theme-pb-dashboard");
    const className =
      theme === "light"
        ? "theme-light"
        : theme === "pb-dashboard"
        ? "theme-pb-dashboard"
        : "theme-dark";
    appRoot.classList.add(className);
    localStorage.setItem("pbTools_theme", className);
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