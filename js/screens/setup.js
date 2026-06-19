// screens/setup.js — entry screen: choose JEE Main or Advanced, see saved papers.
// Intentionally minimal for now; will grow as we wire in paper import + exam start.

import { PapersDB } from "../db.js";

export async function renderSetup(container, { navigate }) {
  const papers = await PapersDB.getAll();
  const mainPapers = papers.filter((p) => p.mode === "main");
  const advPapers = papers.filter((p) => p.mode === "advanced");

  container.innerHTML = `
    <div class="screen">
      <h1 style="font-size:22px; font-weight:800; margin:8px 0 0;">JEE Exam Simulator</h1>
      <p style="color:#94A3B8; font-size:13px; margin:0;">All your data stays on this device.</p>

      <div class="card">
        <h2 style="margin:0 0 8px; font-size:16px;">JEE Main</h2>
        <p style="margin:0 0 12px; color:#94A3B8; font-size:13px;">${mainPapers.length} paper(s) imported</p>
        <button class="btn-secondary" id="import-main" style="width:100%; margin-bottom:8px;">＋ Import a Paper</button>
      </div>

      <div class="card">
        <h2 style="margin:0 0 8px; font-size:16px;">JEE Advanced</h2>
        <p style="margin:0 0 12px; color:#94A3B8; font-size:13px;">${advPapers.length} paper(s) imported</p>
        <button class="btn-secondary" id="import-adv" style="width:100%; margin-bottom:8px;">＋ Import a Paper</button>
      </div>

      <button class="btn-primary" id="view-progress" style="width:100%; margin-top:auto;">📊 View Progress</button>
    </div>
  `;

  container.querySelector("#import-main").onclick = () => navigate("import", { mode: "main" });
  container.querySelector("#import-adv").onclick = () => navigate("import", { mode: "advanced" });
  container.querySelector("#view-progress").onclick = () => navigate("progress");
}
