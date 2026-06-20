// app.js — bootstraps the PWA: registers the service worker, then hands off
// to a tiny router so each screen stays in its own file. No framework here
// on purpose — for an app this size, a hand-rolled router is easier to debug
// than wiring up a build step, which matters since this all has to work
// served as plain static files from GitHub Pages.

const appEl = document.getElementById("app");

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("service-worker.js");
  } catch (err) {
    // Not fatal — app still works online, just won't be installable/offline.
    console.warn("Service worker registration failed:", err);
  }
}

// ── Tiny hash-based router ───────────────────────────────────────────────────
// Screens are loaded lazily so a bug in one screen's file can't break the
// whole app from loading (unlike the old single giant file).
const routes = {
  setup: () => import("./screens/setup.js").then((m) => m.renderSetup),
  import: () => import("./screens/importPaper.js").then((m) => m.renderImportPaper),
  exam: () => import("./screens/exam.js").then((m) => m.renderExam),
  result: () => import("./screens/result.js").then((m) => m.renderResult),
  progress: () => import("./screens/progress.js").then((m) => m.renderProgress),
};

let currentParams = {};

function navigate(screenName, params = {}) {
  currentParams = params;
  const newHash = "#" + screenName;
  if (window.location.hash === newHash) {
    // Hash unchanged (e.g. re-importing for the same mode) — hashchange won't
    // fire on its own, so render directly to make sure new params take effect.
    renderCurrentScreen();
  } else {
    window.location.hash = newHash;
    // hashchange listener (registered below) will call renderCurrentScreen().
  }
}

async function renderCurrentScreen() {
  const screenName = (window.location.hash || "#setup").slice(1) || "setup";
  const loader = routes[screenName];

  if (!loader) {
    appEl.innerHTML = `
      <div class="screen">
        <div class="card">
          <p style="margin:0;">Screen "${screenName}" isn't built yet.</p>
          <button class="btn-secondary" style="margin-top:12px;" onclick="window.location.hash='setup'">← Back to Setup</button>
        </div>
      </div>`;
    return;
  }

  try {
    const renderFn = await loader();
    await renderFn(appEl, { navigate, params: currentParams });
  } catch (err) {
    console.error(`Failed to render screen "${screenName}":`, err);
    appEl.innerHTML = `
      <div class="screen">
        <div class="error-banner">
          <strong>Something went wrong loading this screen.</strong><br/>
          ${err.message || err}
        </div>
        <button class="btn-secondary" onclick="window.location.hash='setup'">← Back to Setup</button>
      </div>`;
  }
}

window.addEventListener("hashchange", renderCurrentScreen);

(async function boot() {
  await registerServiceWorker();
  await renderCurrentScreen();
})();
