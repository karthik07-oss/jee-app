// scoring.js — pure scoring functions, no DOM, no storage, no UI.
// Kept separate so these rules can be tested in isolation and never get
// tangled up with rendering code (the old single-file version's core problem).

/**
 * JEE Main: single-correct MCQ (+4 / -1) and numerical-answer questions (+4 / 0).
 * `answers` is { [questionId]: userAnswer }
 * `questions` is an array of { id, type: "mcq" | "numerical", correctAnswer }
 */
export function calcMainScore(answers, questions) {
  let total = 0, correct = 0, wrong = 0, unattempted = 0;
  const bySubject = {};

  for (const q of questions) {
    const subj = q.subject || "Unknown";
    bySubject[subj] = bySubject[subj] || { total: 0, correct: 0, wrong: 0, unattempted: 0 };

    const given = answers[q.id];
    const isBlank = given === undefined || given === null || given === "";

    if (isBlank) {
      unattempted++;
      bySubject[subj].unattempted++;
      continue;
    }

    let isCorrect;
    if (q.type === "numerical") {
      isCorrect = parseFloat(given) === parseFloat(q.correctAnswer);
    } else {
      isCorrect = String(given).trim().toUpperCase() === String(q.correctAnswer).trim().toUpperCase();
    }

    if (isCorrect) {
      total += 4;
      correct++;
      bySubject[subj].total += 4;
      bySubject[subj].correct++;
    } else {
      // Main awards 0 (not -1) for wrong numerical answers, only MCQs are penalized.
      const penalty = q.type === "numerical" ? 0 : -1;
      total += penalty;
      wrong++;
      bySubject[subj].total += penalty;
      bySubject[subj].wrong++;
    }
  }

  return { total, correct, wrong, unattempted, bySubject };
}

/**
 * JEE Advanced: supports single-correct (+3/-1), multi-correct with partial
 * marking (+4 full, +1 to +3 partial depending on how many correct options
 * picked, -2 if any wrong option picked), and numerical (+4/0, no penalty).
 * `questions[i].correctAnswer` is a string for single/numerical, an array
 * of strings for multi-correct.
 */
export function calcAdvScore(answers, questions) {
  let total = 0, correct = 0, partial = 0, wrong = 0, unattempted = 0;
  const bySubject = {};

  for (const q of questions) {
    const subj = q.subject || "Unknown";
    bySubject[subj] = bySubject[subj] || { total: 0, correct: 0, wrong: 0, unattempted: 0 };

    const given = answers[q.id];
    const isBlank = given === undefined || given === null || given === "" ||
      (Array.isArray(given) && given.length === 0);

    if (isBlank) {
      unattempted++;
      bySubject[subj].unattempted++;
      continue;
    }

    if (q.type === "multi") {
      const correctSet = new Set(q.correctAnswer);
      const givenArr = Array.isArray(given) ? given : [given];
      const givenSet = new Set(givenArr);
      const hasWrongPick = givenArr.some((g) => !correctSet.has(g));

      let delta;
      if (hasWrongPick) {
        delta = -2;
        wrong++;
        bySubject[subj].wrong++;
      } else if (givenSet.size === correctSet.size) {
        delta = 4;
        correct++;
        bySubject[subj].correct++;
      } else {
        // Partial credit: +1 per correctly-chosen option, capped at +3 for
        // safety even on papers with unusually large correct-sets.
        delta = Math.min(givenSet.size, 3);
        partial++;
      }
      total += delta;
      bySubject[subj].total += delta;
    } else if (q.type === "numerical") {
      const isCorrect = parseFloat(given) === parseFloat(q.correctAnswer);
      const delta = isCorrect ? 4 : 0;
      total += delta;
      bySubject[subj].total += delta;
      if (isCorrect) { correct++; bySubject[subj].correct++; }
      else { wrong++; bySubject[subj].wrong++; }
    } else {
      // single-correct
      const isCorrect = String(given).trim().toUpperCase() === String(q.correctAnswer).trim().toUpperCase();
      const delta = isCorrect ? 3 : -1;
      total += delta;
      bySubject[subj].total += delta;
      if (isCorrect) { correct++; bySubject[subj].correct++; }
      else { wrong++; bySubject[subj].wrong++; }
    }
  }

  return { total, correct, wrong, partial, unattempted, bySubject };
}

/** Merges per-subject breakdowns from two papers (Advanced P1 + P2) into one. */
export function mergeBySubject(a, b) {
  const merged = {};
  for (const subj of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) {
    const x = (a && a[subj]) || { total: 0, correct: 0, wrong: 0, unattempted: 0 };
    const y = (b && b[subj]) || { total: 0, correct: 0, wrong: 0, unattempted: 0 };
    merged[subj] = {
      total: x.total + y.total,
      correct: x.correct + y.correct,
      wrong: x.wrong + y.wrong,
      unattempted: x.unattempted + y.unattempted,
    };
  }
  return merged;
}
