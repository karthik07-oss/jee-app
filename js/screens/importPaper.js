// screens/importPaper.js — paste raw paper text, parse it, then review ONE
// question at a time (Save & Next moves forward) rather than a long
// scrolling list of every question — far less overwhelming on a 75-question
// paper, and matches how the person actually wants to work through fixes.

import { parsePaperText } from "../parser.js";
import { PapersDB } from "../db.js";

let state = null; // { mode, paperNum, phase, rawText, parsed, reviewIdx }

export async function renderImportPaper(container, { navigate, params }) {
  const mode = params.mode || "main";
  const paperNum = params.paperNum || (mode === "advanced" ? 1 : undefined);

  if (!state || state.mode !== mode || state.paperNum !== paperNum) {
    state = { mode, paperNum, phase: "paste", rawText: "", parsed: null, reviewIdx: 0 };
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
    // Jump straight to the first flagged question if there is one — that's
    // almost always more useful than starting at Q1 when Q1 is already fine.
    const firstFlagged = state.parsed.questions.findIndex((q) => q.needsReview);
    state.reviewIdx = firstFlagged >= 0 ? firstFlagged : 0;
    rerender();
  };
}

function renderReviewPhase(container, { navigate, rerender, mode, paperNum }) {
  const { parsed } = state;
  const questions = parsed.questions;

  if (questions.length === 0) {
    container.innerHTML = `
      <div class="screen">
        <button class="btn-ghost" id="back-to-paste" style="align-self:flex-start; padding:0;">← Edit Text</button>
        <div class="warning-banner">No questions detected. Go back and check the format.</div>
      </div>
    `;
    container.querySelector("#back-to-paste").onclick = () => { state.phase = "paste"; rerender(); };
    return;
  }

  const idx = Math.min(state.reviewIdx, questions.length - 1);
  const q = questions[idx];
  const flaggedCount = questions.filter((qq) => qq.needsReview).length;
  const pct = Math.round(((idx + 1) / questions.length) * 100);

  const warningsHtml = parsed.warnings.length
    ? `<div class="warning-banner">${parsed.warnings.map((w) => `⚠️ ${w}`).join("<br/>")}</div>`
    : "";

  container.innerHTML = `
    <div class="screen" style="gap:14px;">
      <button class="btn-ghost" id="back-to-paste" style="align-self:flex-start; padding:0;">← Edit Text</button>

      <div>
        <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:6px;">
          <p class="eyebrow" style="margin:0;">REVIEWING · ${paperLabel(mode, paperNum)}</p>
          <span class="mono" style="font-size:11px; color:var(--muted);">Q${idx + 1} / ${questions.length}</span>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width:${pct}%;"></div></div>
      </div>

      <div class="stat-row">
        <div class="stat"><div class="stat-value mono ${flaggedCount ? "amber" : "good"}">${flaggedCount}</div><div class="stat-label">Need Review</div></div>
        <div class="stat"><div class="stat-value mono good">${questions.length - flaggedCount}</div><div class="stat-label">Ready</div></div>
      </div>

      ${idx === 0 ? warningsHtml : ""}

      <div id="question-card"></div>

      <div style="display:flex; gap:10px;">
        <button class="btn-secondary" id="prev-q" style="flex:1;" ${idx === 0 ? "disabled" : ""}>← Previous</button>
        ${idx === questions.length - 1
          ? `<button class="btn-primary" id="finish-btn" style="flex:1;">💾 Save Paper</button>`
          : `<button class="btn-primary" id="save-next-btn" style="flex:1;">Save & Next →</button>`}
      </div>
      <div id="save-error-slot"></div>
    </div>
  `;

  container.querySelector("#back-to-paste").onclick = () => { state.phase = "paste"; rerender(); };

  renderQuestionCard(container, q, idx);
  wireQuestionCard(container, q, idx);

  const prevBtn = container.querySelector("#prev-q");
  if (prevBtn) prevBtn.onclick = () => { state.reviewIdx = Math.max(0, idx - 1); rerender(); };

  const nextBtn = container.querySelector("#save-next-btn");
  if (nextBtn) nextBtn.onclick = () => { state.reviewIdx = Math.min(questions.length - 1, idx + 1); rerender(); };

  const finishBtn = container.querySelector("#finish-btn");
  if (finishBtn) {
    finishBtn.onclick = async () => {
      const remainingFlagged = questions.filter((qq) => qq.needsReview).length;
      if (remainingFlagged > 0) {
        const jumpTo = questions.findIndex((qq) => qq.needsReview);
        const errSlot = container.querySelector("#save-error-slot");
        errSlot.innerHTML = `<div class="warning-banner" style="margin-top:10px;">${remainingFlagged} question${remainingFlagged === 1 ? "" : "s"} still need${remainingFlagged === 1 ? "s" : ""} review before saving.</div>`;
        state.reviewIdx = jumpTo;
        setTimeout(rerender, 900); // brief pause so the warning is actually seen
        return;
      }

      finishBtn.disabled = true;
      finishBtn.textContent = "Saving…";
      try {
        const paper = { id: parsed.id, mode, paperNum: paperNum || null, createdAt: Date.now(), questions };
        const result = await PapersDB.save(paper);
        if (!result) throw new Error("Save did not return a confirmed result.");
        navigate("setup");
      } catch (err) {
        finishBtn.disabled = false;
        finishBtn.textContent = "💾 Save Paper";
        container.querySelector("#save-error-slot").innerHTML =
          `<div class="error-banner" style="margin-top:10px;">Couldn't save: ${err.message}. Nothing was lost — try again.</div>`;
      }
    };
  }
}

function renderQuestionCard(container, q, idx) {
  const cardBorder = q.needsReview ? "border-color: rgba(252,163,17,0.55);" : "border-color: rgba(52,211,153,0.4);";

  const subjectChips = ["Physics", "Chemistry", "Mathematics"]
    .map((s) => `<button type="button" class="subject-chip" data-subject="${s}"
        style="font-size:12px; padding:7px 13px; border-radius:10px; border:1px solid var(--line-strong); background:${q.subject === s ? "linear-gradient(160deg,#6B82FF,var(--focus))" : "transparent"}; color:${q.subject === s ? "#fff" : "var(--muted)"}; font-weight:600;">${s}</button>`)
    .join("");

  const typeChips = ["single", "multi", "numerical"]
    .map((t) => `<button type="button" class="type-chip" data-type="${t}"
        style="font-size:12px; padding:7px 13px; border-radius:10px; border:1px solid var(--line-strong); background:${q.type === t ? "rgba(252,163,17,0.16)" : "transparent"}; color:${q.type === t ? "var(--amber)" : "var(--muted)"}; text-transform:capitalize; font-weight:600;">${t}</button>`)
    .join("");

  let answerUi;
  if (q.type === "numerical") {
    const val = q.correctAnswer || "";
    answerUi = `<input type="text" id="numerical-answer-input" placeholder="correct numeric value" value="${escapeAttr(val)}" inputmode="decimal" style="width:100%; font-size:15px; padding:13px;" />`;
  } else {
    const correctSet = new Set(Array.isArray(q.correctAnswer) ? q.correctAnswer : (q.correctAnswer ? [q.correctAnswer] : []));
    const labels = q.options.length ? q.options.map((o) => o.label) : ["A", "B", "C", "D"];
    answerUi = `<div style="display:flex; gap:12px;">` +
      labels.map((label) => `
        <button type="button" class="answer-bubble omr-bubble ${correctSet.has(label) ? "correct" : ""}" data-label="${label}">${label}</button>
      `).join("") +
      `</div>`;
  }

  const optionsListHtml = q.options.length
    ? `<div style="margin:10px 0; display:flex; flex-direction:column; gap:5px; padding:12px; background:rgba(0,0,0,0.18); border-radius:10px;">
        ${q.options.map((o) => `<div style="font-size:12.5px; color:var(--muted);"><strong style="color:var(--paper);">${o.label})</strong> ${escapeHtml(o.text)}</div>`).join("")}
      </div>`
    : "";

  container.querySelector("#question-card").innerHTML = `
    <div class="card" style="${cardBorder}">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
        <span class="q-number">Q${q.number}</span>
        ${q.needsReview ? '<span style="font-size:11px; color:var(--amber); font-weight:700;">⚠ NEEDS REVIEW</span>' : '<span style="font-size:11px; color:var(--good); font-weight:700;">✓ READY</span>'}
      </div>
      <p style="font-size:14.5px; margin:0 0 4px; white-space:pre-wrap; line-height:1.6;">${escapeHtml(q.questionText) || "(no question text detected — check the pasted text)"}</p>
      ${optionsListHtml}

      <div style="margin:14px 0 4px;">
        <div style="font-size:10.5px; color:var(--muted); text-transform:uppercase; letter-spacing:0.6px; margin-bottom:7px;">Subject</div>
        <div style="display:flex; gap:7px; flex-wrap:wrap;">${subjectChips}</div>
      </div>

      <div style="margin:14px 0 4px;">
        <div style="font-size:10.5px; color:var(--muted); text-transform:uppercase; letter-spacing:0.6px; margin-bottom:7px;">Type</div>
        <div style="display:flex; gap:7px; flex-wrap:wrap;">${typeChips}</div>
      </div>

      <div style="margin-top:14px;">
        <div style="font-size:10.5px; color:var(--muted); text-transform:uppercase; letter-spacing:0.6px; margin-bottom:8px;">Correct Answer ${q.type === "multi" ? "(tap all that apply)" : ""}</div>
        ${answerUi}
      </div>
    </div>
  `;
}

function wireQuestionCard(container, q, idx) {
  const card = container.querySelector("#question-card");

  card.querySelectorAll(".subject-chip").forEach((chip) => {
    chip.onclick = () => {
      q.subject = chip.dataset.subject;
      recomputeNeedsReview(q);
      renderQuestionCard(container, q, idx);
      wireQuestionCard(container, q, idx);
      refreshHeaderStats(container);
    };
  });

  card.querySelectorAll(".type-chip").forEach((chip) => {
    chip.onclick = () => {
      q.type = chip.dataset.type;
      q.correctAnswer = q.type === "multi" ? [] : null;
      recomputeNeedsReview(q);
      renderQuestionCard(container, q, idx);
      wireQuestionCard(container, q, idx);
      refreshHeaderStats(container);
    };
  });

  card.querySelectorAll(".answer-bubble").forEach((bubble) => {
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
      renderQuestionCard(container, q, idx);
      wireQuestionCard(container, q, idx);
      refreshHeaderStats(container);
    };
  });

  const numInput = card.querySelector("#numerical-answer-input");
  if (numInput) {
    numInput.oninput = (e) => {
      q.correctAnswer = e.target.value.trim() || null;
      recomputeNeedsReview(q);
      refreshHeaderStats(container); // don't full-rerender the card — keep focus in the input
    };
  }
}

function refreshHeaderStats(container) {
  const questions = state.parsed.questions;
  const flaggedCount = questions.filter((q) => q.needsReview).length;
  const stats = container.querySelectorAll(".stat-value");
  if (stats[0]) {
    stats[0].textContent = flaggedCount;
    stats[0].className = `stat-value mono ${flaggedCount ? "amber" : "good"}`;
  }
  if (stats[1]) stats[1].textContent = questions.length - flaggedCount;

  // Keep the READY/NEEDS REVIEW badge on the current card in sync too, since
  // typing in the numerical input intentionally skips the full card re-render.
  const badge = container.querySelector('#question-card span[style*="font-weight:700"]');
  const idx = Math.min(state.reviewIdx, questions.length - 1);
  const q = questions[idx];
  if (badge) {
    if (q.needsReview) {
      badge.textContent = "⚠ NEEDS REVIEW";
      badge.style.color = "var(--amber)";
    } else {
      badge.textContent = "✓ READY";
      badge.style.color = "var(--good)";
    }
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
function escapeAttr(str) { return escapeHtml(str); }
      
