
// screens/setup.js — entry screen: choose JEE Main or Advanced, see saved
// papers, and either import a new one or start an existing one.

import { PapersDB } from "../db.js";

function formatDate(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function paperRow(paper, navigate) {
  const label = paper.mode === "advanced" ? `Advanced · Paper ${paper.paperNum}` : "Main";
  return `
    <div class="omr-row" style="border-bottom:1px solid var(--line); padding:12px 4px;" data-paper-id="${paper.id}">
      <span class="q-number">${paper.questions.length}Q</span>
      <div style="flex:1;">
        <div style="font-size:13px; font-weight:600;">${label}</div>
        <div style="font-size:11px; color:var(--muted);">Imported ${formatDate(paper.createdAt)}</div>
      </div>
      <button class="btn-secondary start-paper-btn" data-paper-id="${paper.id}" style="padding:8px 14px; min-height:38px; font-size:12px;">Start →</button>
    </div>
  `;
}

export async function renderSetup(container, { navigate }) {
  let papers = [];
  let loadError = null;
  try {
    papers = await PapersDB.getAll();
  } catch (err) {
    loadError = err;
  }

  const mainPapers = papers.filter((p) => p.mode === "main");
  const advPapers = papers.filter((p) => p.mode === "advanced");

  const errorHtml = loadError
    ? `<div class="error-banner">Couldn't load your saved papers (${loadError.message}). Your data is still on this device — try reopening the app.</div>`
    : "";

  container.innerHTML = `
    <div class="screen">
      <p class="eyebrow">JEE EXAM SIMULATOR</p>
      <h1 class="page-title">Setup</h1>
      <p class="subtext">Everything stays on this device — no account, no sync, no upload.</p>

      ${errorHtml}

      <div class="card">
        <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:4px;">
          <h2 style="margin:0; font-size:15px; font-weight:700;">JEE Main</h2>
          <span style="font-size:11px; color:var(--muted);">${mainPapers.length} paper${mainPapers.length === 1 ? "" : "s"}</span>
        </div>
        ${mainPapers.length ? mainPapers.map((p) => paperRow(p, navigate)).join("") : '<p class="subtext" style="margin:8px 0;">No papers yet.</p>'}
        <button class="btn-secondary" id="import-main" style="width:100%; margin-top:10px;">＋ Import a Paper</button>
      </div>

      <div class="card">
        <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:4px;">
          <h2 style="margin:0; font-size:15px; font-weight:700;">JEE Advanced</h2>
          <span style="font-size:11px; color:var(--muted);">${advPapers.length} paper${advPapers.length === 1 ? "" : "s"}</span>
        </div>
        ${advPapers.length ? advPapers.map((p) => paperRow(p, navigate)).join("") : '<p class="subtext" style="margin:8px 0;">No papers yet. Import Paper 1, then Paper 2.</p>'}
        <div style="display:flex; gap:8px; margin-top:10px;">
          <button class="btn-secondary" id="import-adv-1" style="flex:1;">＋ Paper 1</button>
          <button class="btn-secondary" id="import-adv-2" style="flex:1;">＋ Paper 2</button>
        </div>
      </div>

      <button class="btn-primary" id="view-progress" style="width:100%; margin-top:auto;">📊 View Progress</button>
    </div>
  `;

  container.querySelector("#import-main").onclick = () => navigate("import", { mode: "main" });
  container.querySelector("#import-adv-1").onclick = () => navigate("import", { mode: "advanced", paperNum: 1 });
  container.querySelector("#import-adv-2").onclick = () => navigate("import", { mode: "advanced", paperNum: 2 });
  container.querySelector("#view-progress").onclick = () => navigate("progress");

  container.querySelectorAll(".start-paper-btn").forEach((btn) => {
    btn.onclick = () => navigate("exam", { paperId: btn.dataset.paperId });
  });
}
