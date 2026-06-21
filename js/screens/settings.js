// screens/settings.js — one place to configure the AI provider. Every
// field here is optional: Setup → Exam → Result works fully without any of
// it. This screen is the only place an API key ever gets typed in, and it's
// written only to IndexedDB on this device — never into any source file.

import { getAIConfig, saveAIConfig, testAIConnection, PROVIDER_PRESETS } from "../ai.js";

let formState = null; // lazily loaded from IndexedDB on first render
let testStatus = { state: "idle", message: "" }; // idle | pending | ok | error

export async function renderSettings(container, { navigate }) {
  if (!formState) {
    formState = await getAIConfig();
    testStatus = { state: "idle", message: "" };
  }
  paint(container, navigate);
}

function paint(container, navigate) {
  const presetEntries = Object.entries(PROVIDER_PRESETS);
  const currentHint = PROVIDER_PRESETS[formState.preset]?.keyHint || "paste your key here";

  container.innerHTML = `
    <div class="screen">
      <button class="btn-ghost" id="back-setup" style="align-self:flex-start; padding:0;">← Back to Setup</button>
      <p class="eyebrow">AI SETTINGS</p>
      <h1 class="page-title">AI Provider</h1>
      <p class="subtext">Powers explanations, practice question generation, smarter paper parsing, and study insights. Everything else in the app works without this set up.</p>

      <div class="card">
        <h2 style="margin:0 0 10px; font-size:14px; font-weight:800;">Provider</h2>
        ${presetEntries.map(([key, preset]) => `
          <button type="button" class="preset-card ${formState.preset === key ? "active" : ""}" data-preset="${key}">
            <div class="name">${escapeHtml(preset.label)}</div>
            <div class="desc">${preset.baseUrl ? escapeHtml(preset.baseUrl) : "Enter your own endpoint below"}</div>
          </button>
        `).join("")}
      </div>

      <div class="card">
        <div class="field-block">
          <label class="field-label" for="base-url">Base URL</label>
          <input type="text" id="base-url" class="mono-input" value="${escapeAttr(formState.baseUrl)}" placeholder="https://api.example.com/v1" />
        </div>
        <div class="field-block">
          <label class="field-label" for="model">Model</label>
          <input type="text" id="model" class="mono-input" value="${escapeAttr(formState.model)}" placeholder="provider/model-name" />
        </div>
        <div class="field-block">
          <label class="field-label" for="api-key">API Key</label>
          <input type="password" id="api-key" class="mono-input" value="${escapeAttr(formState.apiKey)}" placeholder="${escapeAttr(currentHint)}" autocomplete="off" />
        </div>
      </div>

      <div class="card" style="gap:12px; display:flex; flex-direction:column;">
        <div id="status-pill-wrap">${statusPillHtml()}</div>
        <div style="display:flex; gap:10px;">
          <button class="btn-secondary" id="test-btn" style="flex:1;">Test Connection</button>
          <button class="btn-primary" id="save-btn" style="flex:1;">Save</button>
        </div>
      </div>

      <div class="warning-banner">
        Your key lives only in this browser's local storage on this device — it's never written into any app source file. Free-tier keys carry rate limits: a 429 error just means wait a moment and retry.
      </div>
    </div>
  `;

  container.querySelector("#back-setup").onclick = () => navigate("setup");

  container.querySelectorAll(".preset-card").forEach((btn) => {
    btn.onclick = () => {
      const key = btn.dataset.preset;
      const preset = PROVIDER_PRESETS[key];
      formState = {
        ...formState,
        preset: key,
        baseUrl: preset.baseUrl,
        model: preset.model,
        apiKey: "", // a key for one provider won't work against another
      };
      testStatus = { state: "idle", message: "" };
      paint(container, navigate);
    };
  });

  container.querySelector("#base-url").oninput = (e) => { formState.baseUrl = e.target.value; };
  container.querySelector("#model").oninput = (e) => { formState.model = e.target.value; };
  container.querySelector("#api-key").oninput = (e) => { formState.apiKey = e.target.value; };

  container.querySelector("#save-btn").onclick = async () => {
    const btn = container.querySelector("#save-btn");
    btn.disabled = true;
    btn.textContent = "Saving…";
    try {
      await saveAIConfig(formState);
      btn.textContent = "Saved ✓";
    } catch (err) {
      testStatus = { state: "error", message: `Couldn't save: ${err.message}` };
      setStatusPill(container);
      btn.textContent = "Save";
    }
    setTimeout(() => { btn.disabled = false; btn.textContent = "Save"; }, 1200);
  };

  container.querySelector("#test-btn").onclick = async () => {
    const testBtn = container.querySelector("#test-btn");
    testBtn.disabled = true;
    try {
      await saveAIConfig(formState); // test exactly what's currently on screen
    } catch (err) {
      testStatus = { state: "error", message: `Couldn't save before testing: ${err.message}` };
      setStatusPill(container);
      testBtn.disabled = false;
      return;
    }
    testStatus = { state: "pending", message: "Testing…" };
    setStatusPill(container);
    try {
      const reply = await testAIConnection();
      testStatus = { state: "ok", message: `Connected — model replied "${reply.slice(0, 30)}"` };
    } catch (err) {
      testStatus = { state: "error", message: err.message };
    }
    setStatusPill(container);
    testBtn.disabled = false;
  };
}

function statusPillHtml() {
  const { state, message } = testStatus;
  const cls = state === "ok" ? "ok" : state === "error" ? "error" : state === "pending" ? "pending" : "off";
  const label = state === "idle" ? "Not tested yet" : message;
  return `<span class="status-pill ${cls}"><span class="status-dot"></span>${escapeHtml(label)}</span>`;
}

function setStatusPill(container) {
  const wrap = container.querySelector("#status-pill-wrap");
  if (wrap) wrap.innerHTML = statusPillHtml();
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function escapeAttr(str) {
  return escapeHtml(str);
}
