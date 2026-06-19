// parser.js — turns pasted raw paper text into structured questions.
//
// Design philosophy: be forgiving, never silently drop a question. Anything
// the parser isn't confident about gets flagged with needsReview=true rather
// than guessed at silently — the review screen (built on top of this) is
// where the user fixes those by hand. This file has NO UI code, just text in,
// structured data out, so it can be tested and improved independently.

const SUBJECT_HEADER_RE = /^\s*(physics|chemistry|mathematics|maths)\s*$/i;

// Matches question starts like: "Q1.", "Q1)", "1.", "1)", "Question 1:"
const QUESTION_START_RE = /^\s*(?:q(?:uestion)?\.?\s*)?(\d{1,3})\s*[.)\]:-]\s*/i;

// Matches option lines like: "(A) text", "A) text", "A. text", "A: text"
const OPTION_RE = /^\s*\(?([A-D])\)?\s*[.):-]\s*(.+)$/i;

// Matches an inline answer marker like: "Answer: B", "Ans - C", "Correct Answer: A, C" (multi)
const ANSWER_RE = /^\s*(?:ans(?:wer)?|correct\s*answer)\s*[:.-]\s*(.+)$/i;

function normalizeSubject(raw) {
  const s = raw.trim().toLowerCase();
  if (s === "maths") return "Mathematics";
  return raw.trim().replace(/^./, (c) => c.toUpperCase());
}

/**
 * Splits raw pasted text into question blocks, attaching a detected subject
 * to each based on the most recent subject header line seen above it.
 * Returns an array of { number, subject, lines: string[] }.
 */
function splitIntoBlocks(rawText) {
  const lines = rawText.replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let currentSubject = "Unknown";
  let current = null;

  for (const line of lines) {
    const subjMatch = line.match(SUBJECT_HEADER_RE);
    if (subjMatch) {
      currentSubject = normalizeSubject(subjMatch[1]);
      continue;
    }

    const qMatch = line.match(QUESTION_START_RE);
    if (qMatch) {
      if (current) blocks.push(current);
      current = { number: parseInt(qMatch[1], 10), subject: currentSubject, lines: [line.slice(qMatch[0].length)] };
      continue;
    }

    if (current) current.lines.push(line);
  }
  if (current) blocks.push(current);

  return blocks;
}

/**
 * Parses one question block into a structured question object.
 * Detects single-correct vs multi-correct (multiple options marked correct
 * in the answer line) vs numerical (no option lines found at all).
 */
function parseBlock(block, idSeed) {
  const optionLines = [];
  const bodyLines = [];
  let detectedAnswer = null;

  for (const line of block.lines) {
    const optMatch = line.match(OPTION_RE);
    if (optMatch) {
      optionLines.push({ label: optMatch[1].toUpperCase(), text: optMatch[2].trim() });
      continue;
    }
    const ansMatch = line.match(ANSWER_RE);
    if (ansMatch) {
      detectedAnswer = ansMatch[1].trim();
      continue;
    }
    bodyLines.push(line);
  }

  const questionText = bodyLines.join("\n").trim();
  const hasOptions = optionLines.length >= 2;

  let type, correctAnswer, needsReview = false;
  if (hasOptions) {
    // Decide single vs multi based on the detected answer line, if present.
    if (detectedAnswer && /[A-D]\s*[,&/]\s*[A-D]/i.test(detectedAnswer)) {
      type = "multi";
      correctAnswer = detectedAnswer.toUpperCase().match(/[A-D]/g) || [];
      if (correctAnswer.length < 2) needsReview = true;
    } else {
      type = "single";
      correctAnswer = detectedAnswer ? detectedAnswer.toUpperCase().match(/[A-D]/)?.[0] || null : null;
      if (!correctAnswer) needsReview = true;
    }
  } else {
    type = "numerical";
    correctAnswer = detectedAnswer || null;
    if (!correctAnswer) needsReview = true;
  }

  if (!questionText) needsReview = true;

  return {
    id: idSeed,
    number: block.number,
    subject: block.subject === "Unknown" ? null : block.subject,
    type,
    questionText,
    options: hasOptions ? optionLines : [],
    correctAnswer,
    needsReview: needsReview || block.subject === "Unknown",
  };
}

/**
 * Main entry point: raw text in, structured paper out.
 * `paperId` and `mode`/`paperNum` are just metadata attached to the result,
 * not used for parsing logic itself.
 */
export function parsePaperText(rawText, { paperId, mode, paperNum } = {}) {
  if (!rawText || !rawText.trim()) {
    return { id: paperId, mode, paperNum, questions: [], warnings: ["No text provided."] };
  }

  const blocks = splitIntoBlocks(rawText);
  const warnings = [];

  if (blocks.length === 0) {
    warnings.push("Couldn't detect any question numbers (expected formats like 'Q1.', '1)', 'Question 1:'). Nothing was imported.");
    return { id: paperId, mode, paperNum, questions: [], warnings };
  }

  const questions = blocks.map((block, i) => parseBlock(block, `${paperId || "paper"}_q${i + 1}`));

  const reviewCount = questions.filter((q) => q.needsReview).length;
  if (reviewCount > 0) {
    warnings.push(`${reviewCount} of ${questions.length} questions need review (missing subject, answer, or question text couldn't be confidently detected).`);
  }

  const subjectless = questions.filter((q) => !q.subject).length;
  if (subjectless === questions.length && questions.length > 0) {
    warnings.push("No subject headers (Physics/Chemistry/Mathematics) were detected anywhere — all questions are unassigned. Add subject headers as their own line before each section, or assign subjects manually in review.");
  }

  return { id: paperId, mode, paperNum, questions, warnings };
}

/** Groups a flat question list by subject, for the auto-split-by-subject view. */
export function groupBySubject(questions) {
  const groups = {};
  for (const q of questions) {
    const key = q.subject || "Unassigned";
    groups[key] = groups[key] || [];
    groups[key].push(q);
  }
  return groups;
}
