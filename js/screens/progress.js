// screens/progress.js — was entirely missing before (setup.js linked here but
// no route or file existed). Pulls everything from HistoryDB; no chart
// library used (dependency-free, static-file-friendly) — small hand-rolled
// SVG line chart helper at the bottom instead.

import { HistoryDB } from "../db.js";
import { aiChat } from "../ai.js";

const MODE_COLORS = { main: "#A78BFA", advanced: "#2DD4BF" };
const MODE_LABELS = { main: "JEE Main", advanced: "JEE Advanced" };
const SUBJECT_COLORS = { Physics: "#818CF8", Chemistry: "#FBBF24", Mathematics: "#FB7185" };

export async function renderProgress(container, { navigate }) {
  let history = [];
  let loadError = null;
  try {
    history = await HistoryDB.getAll();
  } catch (err) {
    loadError = err;
  }

  if (loadError) {
    container.innerHTML = `
      <div class="screen">
        <button class="btn-ghost" id="back-setup" style="align-self:flex-start; padding:0;">← Back to Setup</button>
        <div class="error-banner">Couldn't load your progress (${loadError.message}). Your data is still on this device — try reopening the app.</div>
      </div>`;
    container.querySelector("#back-setup").onclick = () => navigate("setup");
    return;
  }

  if (history.length === 0) {
    container.innerHTML = `
      <div class="screen">
        <button class="btn-ghost" id="back-setup" style="align-self:flex-start; padding:0;">← Back to Setup</button>
        <div class="empty-state">
          <div class="empty-state-icon">📊</div>
          <h2>No attempts yet</h2>
          <p class="subtext" style="max-width:280px;">Take and submit a mock exam to start seeing your score trend and subject-wise progress here.</p>
          <button class="btn-primary" id="cta-setup" style="margin-top:8px;">Go to Setup</button>
        </div>
      </div>`;
    container.querySelector("#back-setup").onclick = () => navigate("setup");
    container.querySelector("#cta-setup").onclick = () => navigate("setup");
    return;
  }

  const sortedAsc = [...history].sort((a, b) => new Date(a.date) - new Date(b.date));
  const sortedDesc = [...sortedAsc].reverse();

  const totals = sortedAsc.map((e) => e.total);
  const totalAttempts = sortedAsc.length;
  const avgScore = totals.reduce((a, b) => a + b, 0) / totalAttempts;
  const bestScore = Math.max(...totals);

  // ── Score trend, split by mode ──────────────────────────────────────────
  const scoreSeries = ["main", "advanced"]
    .map((mode) => ({
      name: MODE_LABELS[mode],
      color: MODE_COLORS[mode],
      points: sortedAsc
        .filter((e) => e.mode === mode)
        .map((e) => ({ x: new Date(e.date).getTime(), y: e.total })),
    }))
    .filter((s) => s.points.length > 0);

  // ── Subject accuracy trend (correct / (correct+wrong)) per attempt ─────
  const subjectSeries = ["Physics", "Chemistry", "Mathematics"]
    .map((subj) => {
      const points = [];
      for (const e of sortedAsc) {
        const s = e.bySubject && e.bySubject[subj];
        if (!s) continue;
        const attempted = (s.correct || 0) + (s.wrong || 0);
        if (attempted === 0) continue;
        points.push({ x: new Date(e.date).getTime(), y: (s.correct / attempted) * 100 });
      }
      return { name: subj, color: SUBJECT_COLORS[subj], points };
    })
    .filter((s) => s.points.length > 0);

  container.innerHTML = `
    <div class="screen">
      <button class="btn-ghost" id="back-setup" style="align-self:flex-start; padding:0;">← Back to Setup</button>
      <p class="eyebrow">YOUR PROGRESS</p>
      <h1 class="page-title">Progress</h1>

      <div class="stat-row">
        <div class="stat"><div class="stat-value mono">${totalAttempts}</div><div class="stat-label">Attempts</div></div>
        <div class="stat"><div class="stat-value mono ${avgScore >= 0 ? "good" : "bad"}">${avgScore.toFixed(1)}</div><div class="stat-label">Avg Score</div></div>
        <div class="stat"><div class="stat-value mono good">${bestScore}</div><div class="stat-label">Best Score</div></div>
      </div>

      <div class="card chart-card">
        <h2 style="margin:0 0 4px; font-size:14px; font-weight:800;">Score Trend</h2>
        <p class="subtext" style="margin:0 0 10px;">Total marks per attempt, over time.</p>
        ${scoreSeries.length ? buildMultiLineChart(scoreSeries) : `<p class="subtext">Not enough data yet.</p>`}
        ${buildLegend(scoreSeries)}
      </div>

      <div class="card chart-card">
        <h2 style="margin:0 0 4px; font-size:14px; font-weight:800;">Subject Accuracy</h2>
        <p class="subtext" style="margin:0 0 10px;">% correct among attempted questions, per subject, over time.</p>
        ${subjectSeries.length ? buildMultiLineChart(subjectSeries, { yMin: 0, yMax: 100 }) : `<p class="subtext">No subject-tagged attempts yet.</p>`}
        ${buildLegend(subjectSeries)}
      </div>

      <div class="card">
        <h2 style="margin:0 0 4px; font-size:14px; font-weight:800;">AI Study Plan</h2>
        <p class="subtext" style="margin:0 0 10px;">A short, personalized focus plan based on your trends above.</p>
        <div id="study-plan-output"></div>
        ${totalAttempts >= 2
          ? `<button class="btn-primary" id="study-plan-btn" style="width:100%; margin-top:8px;">✨ Get AI Study Plan</button>`
          : `<p class="subtext">Take one more attempt to unlock a trend-based study plan.</p>`}
      </div>

      <div class="card">
        <h2 style="margin:0 0 4px; font-size:14px; font-weight:800;">Recent Attempts</h2>
        <div style="margin-top:6px;">
          ${sortedDesc.slice(0, 12).map((e) => attemptRow(e)).join("")}
        </div>
        ${sortedDesc.length > 12 ? `<p class="subtext" style="margin:10px 0 0;">+ ${sortedDesc.length - 12} earlier attempt${sortedDesc.length - 12 === 1 ? "" : "s"} not shown.</p>` : ""}
      </div>
    </div>
  `;

  container.querySelector("#back-setup").onclick = () => navigate("setup");

  const studyPlanBtn = container.querySelector("#study-plan-btn");
  if (studyPlanBtn) {
    studyPlanBtn.onclick = async () => {
      const outputEl = container.querySelector("#study-plan-output");
      studyPlanBtn.disabled = true;
      studyPlanBtn.textContent = "Thinking…";
      try {
        const summary = buildProgressSummary(sortedAsc);
        const plan = await getStudyPlan(summary);
        outputEl.innerHTML = `<p class="review-explanation">${escapeHtml(plan).replace(/\n/g, "<br/>")}</p>`;
        studyPlanBtn.textContent = "↻ Regenerate";
      } catch (err) {
        outputEl.innerHTML = `<p class="review-explanation error">Couldn't generate a study plan: ${escapeHtml(err.message)}</p>`;
        studyPlanBtn.textContent = "✨ Get AI Study Plan";
      }
      studyPlanBtn.disabled = false;
    };
  }
}

/**
 * Builds a compact NUMERIC summary (not a raw history dump) to send to the
 * AI for the study plan — first-half vs second-half average, per subject,
 * so the model can comment on trend direction without us shipping every
 * question and answer off-device.
 */
function buildProgressSummary(sortedAsc) {
  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  const n = sortedAsc.length;
  const half = Math.max(1, Math.floor(n / 2));
  const firstHalf = sortedAsc.slice(0, half);
  const secondHalf = sortedAsc.slice(half);

  const overall = {
    totalAttempts: n,
    earlyAvgScore: round1(avg(firstHalf.map((e) => e.total))),
    recentAvgScore: round1(avg(secondHalf.map((e) => e.total))),
  };

  const subjects = {};
  for (const subj of ["Physics", "Chemistry", "Mathematics"]) {
    const accuracies = [];
    for (const e of sortedAsc) {
      const s = e.bySubject && e.bySubject[subj];
      if (!s) continue;
      const attempted = (s.correct || 0) + (s.wrong || 0);
      if (attempted === 0) continue;
      accuracies.push((s.correct / attempted) * 100);
    }
    if (accuracies.length === 0) continue;
    const splitAt = Math.max(1, Math.floor(accuracies.length / 2));
    subjects[subj] = {
      attemptsWithData: accuracies.length,
      earlyAccuracyPct: round1(avg(accuracies.slice(0, splitAt))),
      recentAccuracyPct: round1(avg(accuracies.slice(splitAt))),
      mostRecentAccuracyPct: round1(accuracies[accuracies.length - 1]),
    };
  }

  return { overall, subjects };
}

function round1(n) {
  return n === null || n === undefined ? null : Math.round(n * 10) / 10;
}

/** Sends the numeric summary (never raw question/answer data) to the AI. */
async function getStudyPlan(summary) {
  const messages = [
    {
      role: "system",
      content:
        "You are a supportive, no-nonsense JEE prep coach. Given a compact numeric summary of a " +
        "student's mock exam history (average scores and per-subject accuracy, early vs recent), write " +
        "a short, prioritized, plain-language study focus plan in under 180 words. Name specific subjects " +
        "by their accuracy trend (improving / declining / flat) using the actual numbers given, and end " +
        "with 2-3 concrete next actions. Plain prose, short paragraphs, no markdown headers or bullets.",
    },
    { role: "user", content: JSON.stringify(summary) },
  ];
  return await aiChat(messages, { maxTokens: 400, timeoutMs: 45000 });
}

function attemptRow(e) {
  const label = e.mode === "advanced" ? `Advanced${e.paperNum ? ` · Paper ${e.paperNum}` : ""}` : "Main";
  const date = new Date(e.date).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  return `
    <div class="attempt-row">
      <div>
        <div class="attempt-mode">${label}</div>
        <div class="attempt-date">${date}${e.autoSubmitted ? " · auto-submitted" : ""}</div>
      </div>
      <div class="attempt-score mono ${e.total >= 0 ? "" : "bad"}" style="color:${e.total >= 0 ? "var(--good)" : "var(--bad)"};">${e.total}</div>
    </div>
  `;
}

function buildLegend(series) {
  if (!series.length) return "";
  return `
    <div class="chart-legend">
      ${series.map((s) => `<div class="chart-legend-item"><span class="chart-legend-dot" style="background:${s.color};"></span>${escapeHtml(s.name)}</div>`).join("")}
    </div>
  `;
}

/**
 * Small dependency-free multi-line SVG chart. x values are timestamps
 * (ms), y values are numeric scores or percentages. Auto-scales both axes
 * unless yMin/yMax are passed in (used to lock subject accuracy to 0–100).
 */
function buildMultiLineChart(seriesArr, opts = {}) {
  const width = 320, height = 160, pad = 14;
  const allPoints = seriesArr.flatMap((s) => s.points);
  if (allPoints.length === 0) return `<svg viewBox="0 0 ${width} ${height}"></svg>`;

  const xs = allPoints.map((p) => p.x);
  let xMin = Math.min(...xs), xMax = Math.max(...xs);
  if (xMin === xMax) { xMin -= 1; xMax += 1; }

  let yMin, yMax;
  if (opts.yMin !== undefined && opts.yMax !== undefined) {
    yMin = opts.yMin; yMax = opts.yMax;
  } else {
    const ys = allPoints.map((p) => p.y);
    yMin = Math.min(...ys); yMax = Math.max(...ys);
    if (yMin === yMax) { yMin -= 1; yMax += 1; }
    const padY = (yMax - yMin) * 0.18;
    yMin -= padY; yMax += padY;
  }

  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const sx = (x) => pad + ((x - xMin) / (xMax - xMin)) * innerW;
  const sy = (y) => pad + innerH - ((y - yMin) / (yMax - yMin)) * innerH;

  let zeroLine = "";
  if (yMin < 0 && yMax > 0) {
    const zy = sy(0);
    zeroLine = `<line class="chart-empty-axis" x1="${pad}" y1="${zy.toFixed(1)}" x2="${width - pad}" y2="${zy.toFixed(1)}" stroke-dasharray="3,3" />`;
  }

  const linesHtml = seriesArr.map((s) => {
    if (s.points.length === 0) return "";
    const sorted = [...s.points].sort((a, b) => a.x - b.x);
    const d = sorted.map((p, i) => `${i === 0 ? "M" : "L"} ${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`).join(" ");
    const dots = sorted.map((p) => `<circle class="chart-point" cx="${sx(p.x).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="3.5" stroke="${s.color}" fill="${s.color}" />`).join("");
    const pathLen = sorted.length > 1 ? 2000 : 0;
    return `<path class="chart-line" d="${d}" stroke="${s.color}" style="stroke-dasharray:${pathLen}; stroke-dashoffset:${pathLen}; animation: chartDraw 1s ease forwards;" />${dots}`;
  }).join("");

  return `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">
      <style>@keyframes chartDraw { to { stroke-dashoffset: 0; } }</style>
      ${zeroLine}
      ${linesHtml}
    </svg>
  `;
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
