// screens/generate.js — AI-generated practice question sets. Deliberately
// reuses the existing Import screen's review/edit/save flow (same question
// schema, same per-question editing UI) rather than duplicating it — once
// generated, questions land in exactly the same review screen used for
// pasted papers.

import { aiChatJSON, isAIConfigured } from "../ai.js";
import { computeNeedsReview } from "../parser.js";

let formState = null;

export async function renderGenerate(container, { navigate, params }) {
  const mode = params.mode || "main";
  const paperNum = params.paperNum || (mode === "advanced" ? 1 : undefined);

  if (!formState || formState.mode !== mode || formState.paperNum !== paperNum) {
    formState = {
      mode, paperNum,
      subjects: ["Physics", "Chemistry", "Mathematics"],
      topic: "",
      difficulty: "mixed",
      count: 10,
      busy: false,
      error: null,
    };
  }

  let aiReady = false;
  try { aiReady = await isAIConfigured(); } catch (err) { aiReady = false; }

  paint(container, navigate, mode, paperNum, aiReady);
}

function paint(container, navigate, mode, paperNum, aiReady) {
  const label = mode === "advanced" ? `JEE Advanced · Paper ${paperNum}` : "JEE Main";
  const subjectChips = ["Physics", "Chemistry", "Mathematics"].map((s) => `
    <button type="button" class="subject-chip" data-subject="${s}"
      style="font-size:12px; padding:8px 14px; border-radius:10px; border:1px solid var(--line-strong); background:${formState.subjects.includes(s) ? "linear-gradient(160deg,#6B82FF,var(--focus))" : "transparent"}; color:${formState.subjects.includes(s) ? "#fff" : "var(--muted)"}; font-weight:600;">${s}</button>
  `).join("");

  container.innerHTML = `
    <div class="screen">
      <button class="btn-ghost" id="back" style="align-self:flex-start; padding:0;">← Back to Setup</button>
      <p class="eyebrow">AI PRACTICE SET</p>
      <h1 class="page-title">${label}</h1>

      ${aiReady ? "" : `<div class="warning-banner">No AI key set up yet. <span id="open-settings-link" style="text-decoration:underline; cursor:pointer;">Add one in Settings</span> first — you can still fill this in, the Generate button will just fail until then.</div>`}

      <div class="card">
        <div class="field-block">
          <label class="field-label">Subjects</label>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">${subjectChips}</div>
        </div>
        <div class="field-block">
          <label class="field-label" for="topic-input">Topic / Chapter (optional)</label>
          <input type="text" id="topic-input" placeholder="e.g. Thermodynamics — leave blank for mixed topics" value="${escapeAttr(formState.topic)}" />
        </div>
        <div class="field-block">
          <label class="field-label" for="difficulty-select">Difficulty</label>
          <select id="difficulty-select">
            ${["easy", "medium", "hard", "mixed"].map((d) => `<option value="${d}" ${formState.difficulty === d ? "selected" : ""}>${d[0].toUpperCase()}${d.slice(1)}</option>`).join("")}
          </select>
        </div>
        <div class="field-block">
          <label class="field-label" for="count-input">Number of Questions</label>
          <input type="text" id="count-input" class="mono-input" inputmode="numeric" value="${formState.count}" />
          <p class="subtext" style="margin:6px 0 0;">5–30 recommended for one request on a free-tier key.</p>
        </div>
      </div>

      ${formState.error ? `<div class="error-banner">${escapeHtml(formState.error)}</div>` : ""}

      <button class="btn-primary" id="generate-btn" style="width:100%;" ${formState.busy ? "disabled" : ""}>
        ${formState.busy ? "Generating…" : "✨ Generate Questions"}
      </button>
    </div>
  `;

  container.querySelector("#back").onclick = () => navigate("setup");
  const settingsLink = container.querySelector("#open-settings-link");
  if (settingsLink) settingsLink.onclick = () => navigate("settings");

  container.querySelectorAll(".subject-chip").forEach((chip) => {
    chip.onclick = () => {
      const s = chip.dataset.subject;
      const set = new Set(formState.subjects);
      if (set.has(s)) { if (set.size > 1) set.delete(s); } else set.add(s); // always keep ≥1 selected
      formState.subjects = Array.from(set);
      paint(container, navigate, mode, paperNum, aiReady);
    };
  });

  container.querySelector("#topic-input").oninput = (e) => { formState.topic = e.target.value; };
  container.querySelector("#difficulty-select").onchange = (e) => { formState.difficulty = e.target.value; };
  container.querySelector("#count-input").oninput = (e) => {
    const n = parseInt(e.target.value, 10);
    formState.count = Number.isFinite(n) ? n : 0;
  };

  container.querySelector("#generate-btn").onclick = async () => {
    const count = Math.min(30, Math.max(1, formState.count || 10));
    formState.busy = true;
    formState.error = null;
    paint(container, navigate, mode, paperNum, aiReady);

    const paperId = `${mode}_${paperNum || 1}_${Date.now()}`;
    try {
      const questions = await generateQuestions({
        paperId, mode,
        subjects: formState.subjects,
        topic: formState.topic,
        difficulty: formState.difficulty,
        count,
      });
      const parsed = { id: paperId, mode, paperNum, questions, warnings: [] };
      formState = null; // reset for next visit to this screen
      navigate("import", { mode, paperNum, prefilledParsed: parsed });
    } catch (err) {
      formState.busy = false;
      formState.error = `Couldn't generate questions: ${err.message}`;
      paint(container, navigate, mode, paperNum, aiReady);
    }
  };
}

async function generateQuestions({ paperId, mode, subjects, topic, difficulty, count }) {
  const allowedTypes = mode === "advanced" ? ["single", "multi", "numerical"] : ["single", "numerical"];

  const messages = [
    {
      role: "system",
      content:
        "You are a JEE (Joint Entrance Examination, India) question-setter with deep subject expertise. " +
        "Generate original, exam-style practice questions and return ONLY a JSON array — no prose, no " +
        "markdown fences, no explanation. Each element must have exactly: number (integer, 1-based), " +
        `subject (one of ${JSON.stringify(subjects)}), type (one of ${JSON.stringify(allowedTypes)}), ` +
        "questionText (string), options (array of {label, text} objects with label a single capital " +
        'letter — empty array for numerical questions), correctAnswer (a single letter for "single" type, ' +
        'an array of letters for "multi" type, or the numeric value as a string for "numerical" type). ' +
        "Distribute questions roughly evenly across the requested subjects. Every question must be " +
        "self-contained, unambiguous, and have a definite correct answer — never leave correctAnswer null.",
    },
    {
      role: "user",
      content:
        `Generate ${count} ${difficulty}-difficulty JEE ${mode === "advanced" ? "Advanced" : "Main"} practice ` +
        `questions covering: ${subjects.join(", ")}.` +
        (topic && topic.trim() ? ` Focus specifically on: ${topic.trim()}.` : " Mix topics within each subject."),
    },
  ];

  const result = await aiChatJSON(messages, {
    maxTokens: Math.min(16000, count * 350 + 1000),
    timeoutMs: 90000,
  });
  if (!Array.isArray(result) || result.length === 0) {
    throw new Error("AI didn't return any questions");
  }

  return result.map((item, i) => {
    const q = {
      id: `${paperId}_q${i + 1}`,
      number: i + 1,
      subject: subjects.includes(item.subject) ? item.subject : (item.subject || null),
      type: allowedTypes.includes(item.type) ? item.type : allowedTypes[0],
      questionText: typeof item.questionText === "string" ? item.questionText.trim() : "",
      options: Array.isArray(item.options)
        ? item.options
            .filter((o) => o && o.label && o.text)
            .map((o) => ({ label: String(o.label).toUpperCase(), text: String(o.text) }))
        : [],
      correctAnswer: item.correctAnswer ?? null,
    };
    q.needsReview = computeNeedsReview(q);
    return q;
  });
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function escapeAttr(str) { return escapeHtml(str); }
