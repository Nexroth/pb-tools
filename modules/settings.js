// modules/settings.js
(function () {
  const meta = {
    title:    "Settings",
    subtitle: "Theme, preferences, and about PB Tools.",
  };

  let rootEl = null;

  function init() {}

  function render() {
    const container = document.getElementById("moduleContainer");
    if (!container) return;

    container.className = "module-container module-container--settings";
    container.innerHTML = "";

    const card = document.createElement("div");
    card.className = "module-card";
    card.innerHTML = `
      <div class="module-card-header">
        <div>
          <div class="module-card-title">Settings</div>
          <div class="module-card-subtitle">Configure themes, defaults, and view information about this tool.</div>
        </div>
        <span class="tag">System</span>
      </div>

      <div class="module-card-body">
        <section style="margin-bottom:1.1rem;">
          <h3 style="font-size:0.85rem;margin:0 0 0.45rem;color:#9ca3af;font-weight:600;letter-spacing:0.04em;">THEME</h3>
          <div style="display:flex;gap:0.45rem;flex-wrap:wrap;">
            <button class="btn btn-secondary" data-theme="dark">Dark (default)</button>
            <button class="btn btn-secondary" data-theme="light">Light</button>
            <button class="btn btn-secondary" data-theme="pb-dashboard">PB Dashboard</button>
          </div>
        </section>

        <section>
          <h3 style="font-size:0.85rem;margin:0 0 0.45rem;color:#9ca3af;font-weight:600;letter-spacing:0.04em;">ABOUT</h3>
          <p style="font-size:0.8rem;color:#6b7280;line-height:1.6;margin:0;">
            <span style="color:#e5e7eb;font-weight:600;">PB Tools</span> v0.2.0<br>
            All data processing happens locally in your browser. Nothing leaves your machine.<br>
            <span style="color:#4b5563;">Developer:</span> <span style="color:#e5e7eb;">Raf</span>
          </p>
        </section>
      </div>
    `;

    container.appendChild(card);
    rootEl = card;
    wireThemeButtons();
  }

  function wireThemeButtons() {
    if (!rootEl) return;
    const appRoot = document.getElementById("app");
    if (!appRoot) return;

    rootEl.querySelectorAll("[data-theme]").forEach(btn => {
      btn.addEventListener("click", () => {
        const theme = btn.getAttribute("data-theme");
        appRoot.classList.remove("theme-dark", "theme-light", "theme-pb-dashboard");
        const cls = theme === "light" ? "theme-light"
                  : theme === "pb-dashboard" ? "theme-pb-dashboard"
                  : "theme-dark";
        appRoot.classList.add(cls);
        localStorage.setItem("pbTools_theme", cls);
      });
    });
  }

  function show() { render(); }
  function hide() {}

  window.SecOpsWorkbench.registerModule("settings", {
    meta,
    init,
    show,
    hide,
  });
})();
