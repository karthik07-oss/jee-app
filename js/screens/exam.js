// screens/exam.js — the actual exam-taking screen: one question at a time,
// OMR-style answer bubbles, a question palette to jump around, a countdown
// timer, and Save & Exit that genuinely persists progress (the old app's
// exit flow used window.location.reload() inside a sandboxed iframe, which
// threw — this version never reloads the page at all).

import { PapersDB, SessionsDB, HistoryDB } from "../db.js";
import { calcMainScore, calcAdvScore } from "../scoring.js";
import { createTimer, tickTimer, formatTime, getTimeUrgency, MAIN_DURATION_SEC, ADVANCED_DURATION_SEC } from "../timer.js";

let runtime = null; // { paper, answers, marked, currentIdx, timer, intervalId, sessionId }

export async function renderExam(container, { navigate, params }) {
  // Only do the expensive load-and-init once per exam attempt. Re-renders
  // triggered by answering/navigating reuse the existing `runtime`.
  if (!runtime || runtime.paperId !== params.paperId) {
    await initRuntime(container, params);
    if (!runtime) return; // initRuntime already rendered an error state
  }
  paint(container, navigate);
}

async function initRuntime(container, params) {
  let paper;
  try {
    paper = await PapersDB.get(params.paperId);
  } catch (err) {
    renderFatalError(container, `Couldn't load this paper: ${err.message}`);
    return;
  }
  if (!paper) {
    renderFatalError(container, "This paper no longer exists. It may have been deleted.");
    return;
  }

  const sessionId = `session_${paper.id}`;
  let session = null;
  try {
    session = await SessionsDB.get(sessionId);
  } catch (err) {
    // Resuming is best-effort — if it fails we just start fresh rather than
    // blocking the user from taking the exam at all.
    console.warn("Couldn't load saved session, starting fresh:", err);
  }

  const duration = paper.mode === "advanced" ? ADVANCED_DURATION_SEC : MAIN_DURATION_SEC;
  const timer = createTimer(duration, session?.remainingSec ?? duration);

  runtime = {
    paperId: paper.id,
    paper,
    sessionId,
    answers: session?.answers || {},
    marked: session?.marked || {},
    currentIdx: session?.currentIdx || 0,
    timer,
    intervalId: null,
    saveState: "idle", // "idle" | "saving" | "error"
  };
}

function renderFatalError(container, message) {
  runtime = null;
  container.innerHTML = `
    <div class="screen">
      <div class="error-banner">${message}</div>
      <button class="btn-secondary" onclick="window.location.hash='setup'">← Back to Setup</button>
    </div>
  `;
}

// ── Persistence ──────────────────────────────────────────────────────────────

async function persistSession() {
  if (!runtime) return false;
  try {
    const result = await SessionsDB.save({
      id: runtime.sessionId,
      paperId: runtime.paper.id,
      answers: runtime.answers,
      marked: runtime.marked,
      currentIdx: runtime.currentIdx,
      remainingSec: runtime.timer.remainingSec,
      updatedAt: Date.now(),
    });
    return !!result;
  } catch (err) {
    console.error("Failed to save exam session:", err);
    return false;
  }
}

// ── Main paint function ─────────────────────────────────────────────────────

function paint(container, navigate) {
  const { paper, answers, marked, currentIdx, timer } = runtime;
  const q = paper.questions[currentIdx];
  const urgency = getTimeUrgency(timer.remainingSec);
  const timeColor = urgency === "critical" ? "var(--bad)" : urgency === "low" ? "var(--amber)" : "var(--paper)";

  const answeredCount = Object.keys(answers).filter((id) => isAnswered(answers[id])).length;
  const markedCount = Object.keys(marked).filter((id) => marked[id]).length;

  container.innerHTML = `
    <div class="screen" style="gap:12px;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <button class="btn-ghost" id="exit-btn" style="padding:4px 0;">✕ Exit</button>
        <div class="mono" style="font-size:18px; font-weight:800; color:${timeColor};">${formatTime(timer.remainingSec)}</div>
      </div>

      ${urgency !== "normal" ? `<div class="${urgency === "critical" ? "error-banner" : "warning-banner"}">${urgency === "critical" ? "⏱ Under 5 minutes left!" : "⏱ Under 15 minutes remaining."}</div>` : ""}

      <div class="stat-row">
        <div class="stat"><div class="stat-value mono good">${answeredCount}</div><div class="stat-label">Answered</div></div>
        <div class="stat"><div class="stat-value mono amber">${markedCount}</div><div class="stat-label">Marked</div></div>
        <div class="stat"><div class="stat-value mono">${paper.questions.length - answeredCount}</div><div class="stat-label">Remaining</div></div>
      </div>

      <div class="card" style="flex:1;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
          <span class="q-number">Q${currentIdx + 1} / ${paper.questions.length}</span>
          <span style="font-size:11px; color:var(--muted);">${q.subject || "—"}</span>
        </div>
        <p style="font-size:14.5px; line-height:1.6; margin:0 0 14px; white-space:pre-wrap;">${escapeHtml(q.questionText)}</p>
        <div id="answer-area"></div>
      </div>

      <div style="display:flex; gap:8px;">
        <button class="btn-secondary" id="mark-btn" style="flex:1;">${marked[q.id] ? "🚩 Unmark" : "🏳️ Mark for Review"}</button>
        <button class="btn-secondary" id="clear-btn" style="flex:1;">Clear</button>
      </div>

      <div id="palette-area"></div>

      <div style="display:flex; gap:8px;">
        <button class="btn-secondary" id="prev-btn" style="flex:1;" ${currentIdx === 0 ? "disabled" : ""}>← Prev</button>
        ${currentIdx === paper.questions.length - 1
          ? `<button class="btn-primary" id="submit-btn" style="flex:1;">Submit →</button>`
          : `<button class="btn-primary" id="next-btn" style="flex:1;">Next →</button>`}
      </div>

      <div id="save-status" style="text-align:center; font-size:11px; color:var(--muted); min-height:14px;"></div>
    </div>
  `;

  paintAnswerArea(container, q);
  paintPalette(container, navigate);
  wireControls(container, navigate);
  startTimerIfNeeded(container, navigate);
}

function paintAnswerArea(container, q) {
  const area = container.querySelector("#answer-area");
  const current = runtime.answers[q.id];

  if (q.type === "numerical") {
    area.innerHTML = `<input type="text" id="numerical-input" placeholder="Enter numeric value" value="${current ?? ""}" inputmode="decimal" style="width:100%; font-size:16px; padding:14px;" />`;
    area.querySelector("#numerical-input").oninput = (e) => {
      runtime.answers[q.id] = e.target.value.trim() || undefined;
      if (!e.target.value.trim()) delete runtime.answers[q.id];
      schedulePersist(container);
    };
  } else {
    const labels = q.options.length ? q.options.map((o) => o.label) : ["A", "B", "C", "D"];
    const selectedSet = new Set(q.type === "multi" ? (Array.isArray(current) ? current : []) : (current ? [current] : []));

    area.innerHTML = labels.map((label) => {
      const opt = q.options.find((o) => o.label === label);
      const isSelected = selectedSet.has(label);
      return `
        <div class="omr-row" data-answer-label="${label}" style="cursor:pointer;">
          <div class="omr-bubble ${isSelected ? "selected" : ""}">${label}</div>
          <div class="omr-option-text">${opt ? escapeHtml(opt.text) : ""}</div>
        </div>
      `;
    }).join("");

    area.querySelectorAll("[data-answer-label]").forEach((row) => {
      row.onclick = () => {
        const label = row.dataset.answerLabel;
        if (q.type === "multi") {
          const set = new Set(Array.isArray(runtime.answers[q.id]) ? runtime.answers[q.id] : []);
          if (set.has(label)) set.delete(label); else set.add(label);
          runtime.answers[q.id] = Array.from(set);
          if (runtime.answers[q.id].length === 0) delete runtime.answers[q.id];
        } else {
          runtime.answers[q.id] = label;
        }
        schedulePersist(container);
        paintAnswerArea(container, q); // repaint just the bubbles, not the whole screen
        repaintStatsAndPalette(container);
      };
    });
  }
}

function paintPalette(container, navigate) {
  const { paper, answers, marked, currentIdx } = runtime;
  const area = container.querySelector("#palette-area");

  area.innerHTML = `
    <div class="card" style="padding:12px;">
      <div style="font-size:10.5px; color:var(--muted); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:8px;">Question Palette</div>
      <div style="display:grid; grid-template-columns:repeat(8, 1fr); gap:6px;">
        ${paper.questions.map((q, i) => {
          const answered = isAnswered(answers[q.id]);
          const isMarked = !!marked[q.id];
          const isCurrent = i === currentIdx;
          let bg = "transparent", border = "var(--line)", color = "var(--muted)";
          if (isCurrent) { border = "var(--focus)"; color = "var(--paper)"; }
          if (answered && !isMarked) { bg = "var(--good)"; color = "#06281C"; border = "var(--good)"; }
          if (isMarked) { bg = "var(--amber)"; color = "var(--ink)"; border = "var(--amber)"; }
          return `<button type="button" class="palette-cell" data-idx="${i}"
            style="aspect-ratio:1; border-radius:6px; font-size:11px; font-weight:700; font-family:'JetBrains Mono',monospace; background:${bg}; border:1.5px solid ${border}; color:${color};">${i + 1}</button>`;
        }).join("")}
      </div>
    </div>
  `;

  area.querySelectorAll(".palette-cell").forEach((cell) => {
    cell.onclick = async () => {
      runtime.currentIdx = parseInt(cell.dataset.idx, 10);
      await persistSession();
      paint(container, navigate);
    };
  });
}

function repaintStatsAndPalette(container) {
  // Cheap way to keep the Answered/Marked/Remaining counters and the
  // palette's colored cells in sync without a full screen repaint (which
  // would interrupt the answer-bubble click animation and steal focus).
  const { paper, answers, marked } = runtime;
  const answeredCount = Object.keys(answers).filter((id) => isAnswered(answers[id])).length;
  const markedCount = Object.keys(marked).filter((id) => marked[id]).length;

  const stats = container.querySelectorAll(".stat-value");
  if (stats[0]) stats[0].textContent = answeredCount;
  if (stats[1]) stats[1].textContent = markedCount;
  if (stats[2]) stats[2].textContent = paper.questions.length - answeredCount;

  paintPalette(container, window.__jeeNavigate);
}

function wireControls(container, navigate) {
  // Stash navigate globally for the palette's cheap repaint path above —
  // a small pragmatic compromise rather than threading it through every
  // helper function.
  window.__jeeNavigate = navigate;

  const { paper, currentIdx } = runtime;
  const q = paper.questions[currentIdx];

  container.querySelector("#mark-btn").onclick = async () => {
    runtime.marked[q.id] = !runtime.marked[q.id];
    await persistSession();
    paint(container, navigate);
  };

  container.querySelector("#clear-btn").onclick = async () => {
    delete runtime.answers[q.id];
    await persistSession();
    paint(container, navigate);
  };

  const prevBtn = container.querySelector("#prev-btn");
  if (prevBtn) prevBtn.onclick = async () => {
    runtime.currentIdx = Math.max(0, currentIdx - 1);
    await persistSession();
    paint(container, navigate);
  };

  const nextBtn = container.querySelector("#next-btn");
  if (nextBtn) nextBtn.onclick = async () => {
    runtime.currentIdx = Math.min(paper.questions.length - 1, currentIdx + 1);
    await persistSession();
    paint(container, navigate);
  };

  const submitBtn = container.querySelector("#submit-btn");
  if (submitBtn) submitBtn.onclick = () => confirmSubmit(container, navigate);

  container.querySelector("#exit-btn").onclick = () => confirmExit(container, navigate);
}

function startTimerIfNeeded(container, navigate) {
  if (runtime.intervalId) return; // already running, don't double-start
  runtime.intervalId = setInterval(async () => {
    runtime.timer = tickTimer(runtime.timer);
    const timeEl = container.querySelector(".mono");
    if (timeEl) {
      timeEl.textContent = formatTime(runtime.timer.remainingSec);
      const urgency = getTimeUrgency(runtime.timer.remainingSec);
      timeEl.style.color = urgency === "critical" ? "var(--bad)" : urgency === "low" ? "var(--amber)" : "var(--paper)";
    }
    if (runtime.timer.remainingSec % 30 === 0) {
      await persistSession(); // periodic autosave, not just on every answer
    }
    if (runtime.timer.isExpired) {
      clearInterval(runtime.intervalId);
      await submitExam(navigate, { autoSubmitted: true });
    }
  }, 1000);
}

function schedulePersist(container) {
  clearTimeout(runtime._persistDebounce);
  const statusEl = container.querySelector("#save-status");
  if (statusEl) statusEl.textContent = "Saving…";
  runtime._persistDebounce = setTimeout(async () => {
    const ok = await persistSession();
    if (statusEl) statusEl.textContent = ok ? "✓ Saved" : "⚠ Couldn't save — check storage";
  }, 400);
}

// ── Exit / Submit flows ──────────────────────────────────────────────────────

function confirmExit(container, navigate) {
  showModal(container, {
    title: "Exit Exam?",
    body: "Your progress is saved automatically. You can resume this exact paper later from Setup.",
    confirmLabel: "Save & Exit",
    confirmClass: "btn-primary",
    onConfirm: async () => {
      stopTimer();
      await persistSession();
      const paperId = runtime.paper.id;
      runtime = null;
      navigate("setup", { resumedPaperId: paperId });
    },
  });
}

function confirmSubmit(container, navigate) {
  const { paper, answers } = runtime;
  const unanswered = paper.questions.length - Object.keys(answers).filter((id) => isAnswered(answers[id])).length;
  showModal(container, {
    title: "Submit Exam?",
    body: unanswered > 0
      ? `You have ${unanswered} unanswered question${unanswered === 1 ? "" : "s"}. This cannot be undone.`
      : "All questions answered. This cannot be undone.",
    confirmLabel: "Submit",
    confirmClass: "btn-primary",
    onConfirm: () => submitExam(navigate, { autoSubmitted: false }),
  });
}

async function submitExam(navigate, { autoSubmitted }) {
  if (!runtime) return;
  stopTimer();

  const { paper, answers } = runtime;
  const scoreFn = paper.mode === "advanced" ? calcAdvScore : calcMainScore;
  const score = scoreFn(answers, paper.questions);

  let historyOk = false;
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
    historyOk = !!result;
  } catch (err) {
    console.error("Failed to save history entry:", err);
  }

  try {
    await SessionsDB.delete(runtime.sessionId);
  } catch (err) {
    console.warn("Couldn't clear session after submit (non-fatal):", err);
  }

  const paperId = paper.id;
  const paperMode = paper.mode;
  const paperNum = paper.paperNum || null;
  // Snapshot answers before nulling runtime — the result screen has no other
  // way to get per-question detail since the session row was just deleted,
  // and it can't wait on another DB round-trip for data we already have.
  const answersSnapshot = { ...answers };
  runtime = null;
  navigate("result", {
    paperId,
    mode: paperMode,
    paperNum,
    historyOk,
    autoSubmitted,
    answers: answersSnapshot,
    score,
  });
}

function stopTimer() {
  if (runtime?.intervalId) {
    clearInterval(runtime.intervalId);
    runtime.intervalId = null;
  }
}

// ── Small reusable confirmation modal ───────────────────────────────────────

function showModal(container, { title, body, confirmLabel, confirmClass, onConfirm }) {
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed; inset:0; background:rgba(0,0,0,0.6); display:flex; align-items:flex-end; z-index:50;";
  overlay.innerHTML = `
    <div class="card" style="width:100%; border-radius:18px 18px 0 0; padding:22px 18px calc(22px + env(safe-area-inset-bottom));">
      <h2 style="margin:0 0 8px; font-size:17px; font-weight:800;">${title}</h2>
      <p class="subtext" style="margin-bottom:18px;">${body}</p>
      <div style="display:flex; gap:10px;">
        <button class="btn-secondary" id="modal-cancel" style="flex:1;">Cancel</button>
        <button class="${confirmClass}" id="modal-confirm" style="flex:1;">${confirmLabel}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector("#modal-cancel").onclick = () => overlay.remove();
  overlay.querySelector("#modal-confirm").onclick = async () => {
    overlay.remove();
    await onConfirm();
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function isAnswered(val) {
  return val !== undefined && val !== null && val !== "" && !(Array.isArray(val) && val.length === 0);
}

function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }
    
