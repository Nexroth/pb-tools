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
    container.innerHTML = "";

    const card = document.createElement("div");
    card.className = "module-card";
    card.innerHTML = `
      <div class="module-card-body" style="padding-top:0;">
        <section style="margin-bottom:1rem;">
          <h3 style="font-size:0.9rem;margin:0 0 0.4rem;">Theme</h3>
          <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
            <button class="btn btn-secondary" data-theme="dark">Dark (default)</button>
            <button class="btn btn-secondary" data-theme="light">Light</button>
            <button class="btn btn-secondary" data-theme="pb-dashboard">PB Dashboard</button>
          </div>
        </section>

        <section>
          <h3 style="font-size:0.9rem;margin:0 0 0.4rem;">About</h3>
          <p style="font-size:0.8rem;color:#9ca3af;">
            PB Tools â€“ internal helper app for CSV / spreadsheet workflows.
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
    const buttons = rootEl.querySelectorAll("[data-theme]");
    const appRoot = document.getElementById("app");
    if (!appRoot) return;

    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const theme = btn.getAttribute("data-theme");
        setTheme(appRoot, theme);
      });
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