// screens/importPaper.js — paste raw paper text, parse it, let the user fix
// anything flagged using OMR-style answer bubbles (matching the rest of the
// app's exam-paper visual language), then save as a reusable paper.

import { parsePaperText } from "../parser.js";
import { PapersDB } from "../db.js";

let state = null; // holds the in-progress parsed paper between internal re-renders

export async function renderImportPaper(container, { navigate, params }) {
  const mode = params.mode || "main";
  const paperNum = params.paperNum || (mode === "advanced" ? 1 : undefined);

  if (!state || state.mode !== mode || state.paperNum !== paperNum) {
    state = { mode, paperNum, phase: "paste", rawText: "", parsed: null };
  }

  function rerender() {
    renderImportPaper(container, { navigate, params });
  }

  if (state.phase === "paste") {
    renderPastePhase(container, { navigate, rerender, mode, paperNum });
  } else {
    renderReviewPhase(container, { navigate, rerender, mode, paperNum });
  }
}

function paperLabel(mode, paperNum) {
  return mode === "advanced" ? `JEE Advanced · Paper ${paperNum}` : "JEE Main";
}

function renderPastePhase(container, { navigate, rerender, mode, paperNum }) {
  container.innerHTML = `
    <div class="screen">
      <button class="btn-ghost" id="back" style="align-self:flex-start; padding:0;">← Back to Setup</button>
      <p class="eyebrow">IMPORT PAPER</p>
      <h1 class="page-title">${paperLabel(mode, paperNum)}</h1>

      <div class="card">
        <p class="subtext" style="margin-bottom:10px;">
          Start each subject section on its own line (Physics / Chemistry / Mathematics).
          Number questions like "Q1." or "1)". List options as "(A) ...". Mark the answer
          with "Answer: B" or "Ans: 6" — anything unclear gets flagged for quick review next.
        </p>
        <textarea id="paper-text" rows="13" class="mono-input" placeholder="Paste paper text here..."
          style="width:100%; resize:vertical;">${state.rawText}</textarea>
      </div>

      <button class="btn-primary" id="parse-btn" style="width:100%;">Parse Questions →</button>
    </div>
  `;

  container.querySelector("#back").onclick = () => navigate("setup");
  container.querySelector("#parse-btn").onclick = () => {
    const text = container.querySelector("#paper-text").value;
    state.rawText = text;
    state.parsed = parsePaperText(text, { paperId: `${mode}_${paperNum || 1}_${Date.now()}`, mode, paperNum });
    state.phase = "review";
    rerender();
  };
}

function renderReviewPhase(container, { navigate, rerender, mode, paperNum }) {
  const { parsed } = state;
  const questions = parsed.questions;
  const flaggedCount = questions.filter((q) => q.needsReview).length;

  const warningsHtml = parsed.warnings.length
    ? `<div class="warning-banner">${parsed.warnings.map((w) => `⚠️ ${w}`).join("<br/>")}</div>`
    : "";

  const statusHtml = questions.length
    ? `<div class="stat-row">
         <div class="stat"><div class="stat-value mono">${questions.length}</div><div class="stat-label">Questions</div></div>
         <div class="stat"><div class="stat-value mono ${flaggedCount ? "amber" : "good"}">${flaggedCount}</div><div class="stat-label">Need Review</div></div>
       </div>`
    : "";

  const questionsHtml = questions.map((q, i) => renderQuestionCard(q, i)).join("");

  container.innerHTML = `
    <div class="screen">
      <button class="btn-ghost" id="back-to-paste" style="align-self:flex-start; padding:0;">← Edit Text</button>
      <p class="eyebrow">REVIEW</p>
      <h1 class="page-title">${paperLabel(mode, paperNum)}</h1>

      ${statusHtml}
      ${warningsHtml}

      <div style="display:flex; flex-direction:column; gap:12px;">
        ${questionsHtml || '<p class="subtext">No questions detected. Go back and check the format.</p>'}
      </div>

      ${questions.length ? '<button class="btn-primary" id="save-btn" style="width:100%; margin-top:4px;">💾 Save Paper</button>' : ""}
      <div id="save-error-slot"></div>
    </div>
  `;

  container.querySelector("#back-to-paste").onclick = () => {
    state.phase = "paste";
    rerender();
  };

  questions.forEach((q, i) => wireQuestionCard(container, q, i, rerender));

  const saveBtn = container.querySelector("#save-btn");
  if (saveBtn) {
    saveBtn.onclick = async () => {
      saveBtn.disabled = true;
      saveBtn.textContent = "Saving…";
      const errSlot = container.querySelector("#save-error-slot");
      errSlot.innerHTML = "";
      try {
        const paper = {
          id: parsed.id,
          mode,
          paperNum: paperNum || null,
          createdAt: Date.now(),
          questions,
        };
        const result = await PapersDB.save(paper);
        if (!result) throw new Error("Save did not return a confirmed result.");
        navigate("setup");
      } catch (err) {
        saveBtn.disabled = false;
        saveBtn.textContent = "💾 Save Paper";
        errSlot.innerHTML = `<div class="error-banner" style="margin-top:10px;">Couldn't save: ${err.message}. Nothing was lost — try again.</div>`;
      }
    };
  }
}

function renderQuestionCard(q, i) {
  const cardStyle = q.needsReview ? "border-color: rgba(252,163,17,0.5);" : "";

  const subjectChips = ["Physics", "Chemistry", "Mathematics"]
    .map((s) => `<button type="button" class="subject-chip" data-row="${i}" data-subject="${s}"
        style="font-size:11px; padding:5px 10px; border-radius:8px; border:1px solid var(--line); background:${q.subject === s ? "var(--focus)" : "transparent"}; color:${q.subject === s ? "#fff" : "var(--muted)"};">${s}</button>`)
    .join("");

  const typeChips = ["single", "multi", "numerical"]
    .map((t) => `<button type="button" class="type-chip" data-row="${i}" data-type="${t}"
        style="font-size:11px; padding:5px 10px; border-radius:8px; border:1px solid var(--line); background:${q.type === t ? "var(--ink)" : "transparent"}; color:${q.type === t ? "var(--amber)" : "var(--muted)"}; text-transform:capitalize;">${t}</button>`)
    .join("");

  // OMR bubbles for marking the correct option (single/multi only).
  let answerUi;
  if (q.type === "numerical") {
    const val = q.correctAnswer || "";
    answerUi = `<input type="text" data-row="${i}" data-field="numerical-answer" placeholder="correct numeric value" value="${escapeAttr(val)}" style="width:100%;" />`;
  } else {
    const correctSet = new Set(Array.isArray(q.correctAnswer) ? q.correctAnswer : (q.correctAnswer ? [q.correctAnswer] : []));
    const labels = q.options.length ? q.options.map((o) => o.label) : ["A", "B", "C", "D"];
    answerUi = `<div style="display:flex; gap:10px;">` +
      labels.map((label) => `
        <button type="button" class="omr-bubble answer-bubble" data-row="${i}" data-label="${label}"
          style="${correctSet.has(label) ? "background:var(--good); border-color:var(--good); color:#06281C;" : ""}">${label}</button>
      `).join("") +
      `</div>`;
  }

  const optionsListHtml = q.options.length
    ? `<div style="margin:8px 0; display:flex; flex-direction:column; gap:3px;">
        ${q.options.map((o) => `<div style="font-size:12px; color:var(--muted);"><strong style="color:var(--paper);">${o.label})</strong> ${escapeHtml(o.text)}</div>`).join("")}
      </div>`
    : "";

  return `
    <div class="card" data-row="${i}" style="${cardStyle}">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <span class="q-number">Q${q.number}</span>
        ${q.needsReview ? '<span style="font-size:11px; color:var(--amber); font-weight:700;">⚠ REVIEW</span>' : ""}
      </div>
      <p style="font-size:13.5px; margin:0 0 8px; white-space:pre-wrap; line-height:1.5;">${escapeHtml(q.questionText) || "(no question text detected — check the pasted text)"}</p>
      ${optionsListHtml}

      <div style="margin:10px 0 4px;">
        <div style="font-size:10.5px; color:var(--muted); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:5px;">Subject</div>
        <div style="display:flex; gap:6px; flex-wrap:wrap;">${subjectChips}</div>
      </div>

      <div style="margin:10px 0 4px;">
        <div style="font-size:10.5px; color:var(--muted); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:5px;">Type</div>
        <div style="display:flex; gap:6px; flex-wrap:wrap;">${typeChips}</div>
      </div>

      <div style="margin-top:10px;">
        <div style="font-size:10.5px; color:var(--muted); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:6px;">Correct Answer ${q.type === "multi" ? "(tap all that apply)" : ""}</div>
        <div data-answer-slot="${i}">${answerUi}</div>
      </div>
    </div>
  `;
}

function wireQuestionCard(container, q, i, rerender) {
  // Subject chips
  container.querySelectorAll(`.subject-chip[data-row="${i}"]`).forEach((chip) => {
    chip.onclick = () => {
      q.subject = chip.dataset.subject;
      recomputeNeedsReview(q);
      rerender();
    };
  });

  // Type chips
  container.querySelectorAll(`.type-chip[data-row="${i}"]`).forEach((chip) => {
    chip.onclick = () => {
      q.type = chip.dataset.type;
      // Switching type invalidates the previous answer shape (e.g. single -> multi).
      q.correctAnswer = q.type === "multi" ? [] : null;
      recomputeNeedsReview(q);
      rerender();
    };
  });

  // OMR answer bubbles (single/multi)
  container.querySelectorAll(`.answer-bubble[data-row="${i}"]`).forEach((bubble) => {
    bubble.onclick = () => {
      const label = bubble.dataset.label;
      if (q.type === "multi") {
        const set = new Set(Array.isArray(q.correctAnswer) ? q.correctAnswer : []);
        if (set.has(label)) set.delete(label); else set.add(label);
        q.correctAnswer = Array.from(set);
      } else {
        q.correctAnswer = label;
      }
      recomputeNeedsReview(q);
      rerender();
    };
  });

  // Numerical answer input
  const numInput = container.querySelector(`input[data-row="${i}"][data-field="numerical-answer"]`);
  if (numInput) {
    numInput.onchange = (e) => {
      q.correctAnswer = e.target.value.trim() || null;
      recomputeNeedsReview(q);
      // No rerender needed here — typing shouldn't lose focus on every
      // keystroke. needsReview badge will simply update on the next render.
    };
  }
}

function recomputeNeedsReview(q) {
  const hasAnswer = q.type === "multi"
    ? Array.isArray(q.correctAnswer) && q.correctAnswer.length > 0
    : !!q.correctAnswer;
  q.needsReview = !q.subject || !hasAnswer || !q.questionText;
}

function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function escapeAttr(str) {
  return escapeHtml(str);
      }
    
