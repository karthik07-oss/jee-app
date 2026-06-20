// screens/result.js — shown right after an exam is submitted. Was entirely
// missing before: exam.js navigated here but no route existed, so scores
// never appeared. Built to be self-sufficient: it recomputes the score from
// the answers snapshot exam.js now passes through navigation params rather
// than trusting a single write to IndexedDB, so a result is always shown
// even if the history save failed (with a visible retry for that case).

import { PapersDB, HistoryDB } from "../db.js";
import { calcMainScore, calcAdvScore } from "../scoring.js";

const REVIEW_PAGE_SIZE = 20;

let reviewVisibleCount = REVIEW_PAGE_SIZE;
let lastPaperId = null;

export async function renderResult(container, { navigate, params }) {
  const { paperId } = params;

  if (lastPaperId !== paperId) {
    reviewVisibleCount = REVIEW_PAGE_SIZE; // fresh paper → reset pagination
    lastPaperId = paperId;
  }

  let paper, loadError = null;
  try {
    paper = await PapersDB.get(paperId);
  } catch (err) {
    loadError = err;
  }

  if (loadError || !paper) {
    container.innerHTML = `
      <div class="screen">
        <div class="error-banner">
          ${loadError ? `Couldn't load this paper: ${loadError.message}` : "This paper no longer exists."}
        </div>
        <button class="btn-secondary" id="back-setup">← Back to Setup</button>
      </div>`;
    container.querySelector("#back-setup").onclick = () => navigate("setup");
    return;
  }

  const answers = params.answers || null;
  const reviewAvailable = !!answers;

  let score = params.score;
  if (!score && answers) {
    const scoreFn = paper.mode === "advanced" ? calcAdvScore : calcMainScore;
    score = scoreFn(answers, paper.questions);
  }

  let historyOk = params.historyOk;
  let usedFallback = false;

  if (!score) {
    // Reached directly (no params) rather than right after submitting —
    // fall back to the most recent saved history entry for this paper.
    try {
      const all = await HistoryDB.getAll();
      const matches = all
        .filter((e) => e.paperId === paperId)
        .sort((a, b) => new Date(b.date) - new Date(a.date));
      if (matches[0]) {
        const m = matches[0];
        score = { total: m.total, correct: m.correct, wrong: m.wrong, unattempted: m.unattempted, partial: m.partial || 0, bySubject: m.bySubject };
        historyOk = true;
        usedFallback = true;
      }
    } catch (err) {
      // fall through to the no-data state below
    }
  }

  if (!score) {
    container.innerHTML = `
      <div class="screen">
        <div class="error-banner">No result data is available for this paper yet. Take the exam first, then submit it to see a result.</div>
        <button class="btn-secondary" id="back-setup">← Back to Setup</button>
      </div>`;
    container.querySelector("#back-setup").onclick = () => navigate("setup");
    return;
  }

  paintResult(container, navigate, { paper, paperId, score, answers, reviewAvailable, historyOk, autoSubmitted: !!params.autoSubmitted, usedFallback });
}

function calcMaxMarks(paper) {
  if (paper.mode === "advanced") {
    return paper.questions.reduce((sum, q) => sum + (q.type === "single" ? 3 : 4), 0);
  }
  return paper.questions.length * 4;
}

function calcSubjectMax(paper) {
  const max = {};
  for (const q of paper.questions) {
    const subj = q.subject || "Unknown";
    const m = paper.mode === "advanced" ? (q.type === "single" ? 3 : 4) : 4;
    max[subj] = (max[subj] || 0) + m;
  }
  return max;
}

function paintResult(container, navigate, ctx) {
  const { paper, paperId, score, answers, reviewAvailable, historyOk, autoSubmitted, usedFallback } = ctx;
  const maxMarks = calcMaxMarks(paper);
  const pct = maxMarks > 0 ? Math.max(0, Math.min(100, (score.total / maxMarks) * 100)) : 0;
  const subjectMax = calcSubjectMax(paper);
  const subjects = Object.keys(score.bySubject || {});
  const label = paper.mode === "advanced" ? `JEE Advanced · Paper ${paper.paperNum || ""}` : "JEE Main";
  const isGoodScore = pct >= 70;

  const RADIUS = 84;
  const CIRC = 2 * Math.PI * RADIUS;

  container.innerHTML = `
    <div class="screen" style="gap:14px;">
      <button class="btn-ghost" id="back-setup" style="align-self:flex-start; padding:0;">← Back to Setup</button>
      <p class="eyebrow">RESULT · ${label}</p>

      ${autoSubmitted ? `<div class="warning-banner">⏱ Time ran out — this paper was submitted automatically.</div>` : ""}
      ${usedFallback ? `<div class="warning-banner">Showing your last saved result for this paper. Per-question review isn't available for past attempts viewed this way.</div>` : ""}
      ${!historyOk && !usedFallback ? `<div class="error-banner" id="save-warning">This result couldn't be saved to your history. It's shown below from this session only — retry saving so it shows up in Progress.<br/><button class="btn-secondary" id="retry-save-btn" style="margin-top:10px; width:100%;">Retry Save</button></div>` : ""}

      <div class="card" style="align-items:center; text-align:center; position:relative;">
        ${isGoodScore ? `<div class="celebrate-glow"></div>` : ""}
        <div class="score-ring-wrap">
          <svg viewBox="0 0 200 200">
            <defs>
              <linearGradient id="ringGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#A78BFA" />
                <stop offset="100%" stop-color="${isGoodScore ? "#2DD4BF" : "#818CF8"}" />
              </linearGradient>
            </defs>
            <circle class="score-ring-track" cx="100" cy="100" r="${RADIUS}" />
            <circle class="score-ring-fill" id="ring-fill" cx="100" cy="100" r="${RADIUS}"
              stroke-dasharray="${CIRC}" stroke-dashoffset="${CIRC}" />
          </svg>
          <div class="score-ring-center">
            <div class="score-ring-total mono" id="score-counter">0</div>
            <div class="score-ring-max">out of ${maxMarks}</div>
          </div>
        </div>
        <div class="subtext" style="margin-top:8px;">${pct.toFixed(1)}% scored</div>
      </div>

      <div class="stat-row">
        <div class="stat"><div class="stat-value mono good">${score.correct}</div><div class="stat-label">Correct</div></div>
        <div class="stat"><div class="stat-value mono bad">${score.wrong}</div><div class="stat-label">Wrong</div></div>
        ${paper.mode === "advanced" ? `<div class="stat"><div class="stat-value mono amber">${score.partial || 0}</div><div class="stat-label">Partial</div></div>` : ""}
        <div class="stat"><div class="stat-value mono">${score.unattempted}</div><div class="stat-label">Skipped</div></div>
      </div>

      <div class="card">
        <h2 style="margin:0 0 14px; font-size:14px; font-weight:800;">By Subject</h2>
        ${subjects.length === 0 ? `<p class="subtext">No subject data on this paper.</p>` : subjects.map((subj) => {
          const s = score.bySubject[subj];
          const mx = subjectMax[subj] || 1;
          const subjPct = Math.max(0, Math.min(100, (s.total / mx) * 100));
          return `
            <div class="subject-bar-block">
              <div class="subject-bar-head">
                <span class="name">${escapeHtml(subj)}</span>
                <span class="marks">${s.total} / ${mx}</span>
              </div>
              <div class="subject-bar-track"><div class="subject-bar-fill ${s.total < 0 ? "bad" : ""}" data-fill="${subjPct}" style="width:0%;"></div></div>
            </div>
          `;
        }).join("")}
      </div>

      ${reviewAvailable ? renderReviewSection(paper, answers) : `
        <div class="card">
          <p class="subtext" style="margin:0;">Full question-by-question review isn't available here — it's only shown right after you submit an exam.</p>
        </div>
      `}

      <div style="display:flex; gap:10px;">
        <button class="btn-secondary" id="retake-btn" style="flex:1;">↻ Retake Paper</button>
        <button class="btn-primary" id="progress-btn" style="flex:1;">📊 View Progress</button>
      </div>
    </div>
  `;

  container.querySelector("#back-setup").onclick = () => navigate("setup");
  container.querySelector("#retake-btn").onclick = () => navigate("exam", { paperId });
  container.querySelector("#progress-btn").onclick = () => navigate("progress");

  const retryBtn = container.querySelector("#retry-save-btn");
  if (retryBtn) {
    retryBtn.onclick = async () => {
      retryBtn.disabled = true;
      retryBtn.textContent = "Saving…";
      try {
        const result = await HistoryDB.add({
          mode: paper.mode,
          paperId: paper.id,
          paperNum: paper.paperNum || null,
          date: new Date().toISOString(),
          total: score.total,
          correct: score.correct,
          wrong: score.wrong,
          unattempted: score.unattempted,
          partial: score.partial || 0,
          bySubject: score.bySubject,
          autoSubmitted,
        });
        if (!result) throw new Error("Save did not return a confirmed result.");
        const warningEl = container.querySelector("#save-warning");
        if (warningEl) {
          warningEl.outerHTML = `<div class="success-banner">✓ Saved — this attempt now shows up in Progress.</div>`;
        }
      } catch (err) {
        retryBtn.disabled = false;
        retryBtn.textContent = "Retry Save";
        retryBtn.insertAdjacentHTML("afterend", `<p style="color:var(--bad); font-size:12px; margin-top:8px;">Still couldn't save: ${err.message}</p>`);
      }
    };
  }

  wireReviewPagination(container, navigate, ctx);
  animateIn(container, score.total, maxMarks);
}

function renderReviewSection(paper, answers) {
  const total = paper.questions.length;
  const visible = Math.min(reviewVisibleCount, total);
  const items = paper.questions.slice(0, visible).map((q) => reviewItemHtml(q, answers[q.id])).join("");
  const hasMore = visible < total;

  return `
    <div class="card">
      <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:12px;">
        <h2 style="margin:0; font-size:14px; font-weight:800;">Question Review</h2>
        <span class="mono" style="font-size:11px; color:var(--muted);">${visible} / ${total}</span>
      </div>
      <div id="review-list">${items}</div>
      ${hasMore ? `<button class="btn-secondary" id="review-more-btn" style="width:100%; margin-top:6px;">Show ${Math.min(REVIEW_PAGE_SIZE, total - visible)} More ↓</button>` : ""}
    </div>
  `;
}

function reviewItemHtml(q, given) {
  const isBlank = given === undefined || given === null || given === "" || (Array.isArray(given) && given.length === 0);
  let status = "unattempted";
  if (!isBlank) {
    if (q.type === "numerical") {
      status = parseFloat(given) === parseFloat(q.correctAnswer) ? "correct" : "wrong";
    } else if (q.type === "multi") {
      const correctSet = new Set(q.correctAnswer);
      const givenArr = Array.isArray(given) ? given : [given];
      const givenSet = new Set(givenArr);
      const hasWrong = givenArr.some((g) => !correctSet.has(g));
      status = hasWrong ? "wrong" : (givenSet.size === correctSet.size ? "correct" : "partial");
    } else {
      status = String(given).trim().toUpperCase() === String(q.correctAnswer).trim().toUpperCase() ? "correct" : "wrong";
    }
  }

  const givenDisplay = isBlank ? "—" : (Array.isArray(given) ? given.join(", ") : given);
  const correctDisplay = Array.isArray(q.correctAnswer) ? q.correctAnswer.join(", ") : (q.correctAnswer ?? "—");
  const snippet = (q.questionText || "").length > 140 ? q.questionText.slice(0, 140).trim() + "…" : q.questionText;

  return `
    <div class="review-item">
      <div class="review-item-head">
        <span class="q-number">Q${q.number}</span>
        <span class="review-badge ${status}">${status}</span>
      </div>
      <p class="review-q-text">${escapeHtml(snippet) || "(no question text)"}</p>
      <div class="review-answer-row">
        <span><span class="label">Your answer:</span><span class="val ${status === "correct" ? "good" : (status === "wrong" ? "bad" : "")}">${escapeHtml(String(givenDisplay))}</span></span>
        <span><span class="label">Correct:</span><span class="val good">${escapeHtml(String(correctDisplay))}</span></span>
      </div>
    </div>
  `;
}

function wireReviewPagination(container, navigate, ctx) {
  const moreBtn = container.querySelector("#review-more-btn");
  if (!moreBtn) return;
  moreBtn.onclick = () => {
    const { paper, answers } = ctx;
    const total = paper.questions.length;
    const prevVisible = reviewVisibleCount;
    reviewVisibleCount = Math.min(total, reviewVisibleCount + REVIEW_PAGE_SIZE);

    const newItems = paper.questions
      .slice(prevVisible, reviewVisibleCount)
      .map((q) => reviewItemHtml(q, answers[q.id]))
      .join("");
    const list = container.querySelector("#review-list");
    if (list) list.insertAdjacentHTML("beforeend", newItems);

    const countEl = moreBtn.closest(".card")?.querySelector(".mono");
    if (countEl) countEl.textContent = `${reviewVisibleCount} / ${total}`;

    if (reviewVisibleCount >= total) {
      moreBtn.remove();
    } else {
      moreBtn.textContent = `Show ${Math.min(REVIEW_PAGE_SIZE, total - reviewVisibleCount)} More ↓`;
    }
  };
}

function animateIn(container, total, maxMarks) {
  const RADIUS = 84;
  const CIRC = 2 * Math.PI * RADIUS;
  const ringFill = container.querySelector("#ring-fill");
  const counter = container.querySelector("#score-counter");
  const bars = container.querySelectorAll(".subject-bar-fill");
  const prefersReduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const pctClamped = maxMarks > 0 ? Math.max(0, Math.min(1, total / maxMarks)) : 0;

  if (prefersReduced) {
    if (ringFill) ringFill.style.strokeDashoffset = CIRC - pctClamped * CIRC;
    if (counter) counter.textContent = total;
    bars.forEach((b) => { b.style.width = `${b.dataset.fill}%`; });
    return;
  }

  requestAnimationFrame(() => {
    if (ringFill) ringFill.style.strokeDashoffset = String(CIRC - pctClamped * CIRC);
    bars.forEach((b) => { b.style.width = `${b.dataset.fill}%`; });
  });

  if (counter) {
    const duration = 900;
    const start = performance.now();
    const from = 0;
    const to = total;
    function tick(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      counter.textContent = Math.round(from + (to - from) * eased);
      if (t < 1) requestAnimationFrame(tick);
      else counter.textContent = to;
    }
    requestAnimationFrame(tick);
  }
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
