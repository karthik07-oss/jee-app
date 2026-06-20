// timer.js — pure countdown logic, no DOM. A screen wires this to setInterval
// and re-renders on tick; this file just tracks state and answers questions
// like "how much time is left" and "should we warn the user."

export const MAIN_DURATION_SEC = 3 * 60 * 60;       // 3 hours
export const ADVANCED_DURATION_SEC = 3 * 60 * 60;    // 3 hours per paper

// Below this many seconds remaining, the exam screen should show a warning.
export const LOW_TIME_WARNING_SEC = 15 * 60; // 15 minutes
export const CRITICAL_TIME_WARNING_SEC = 5 * 60; // 5 minutes

/**
 * Creates a timer object. `remainingSec` lets a resumed exam pick up where
 * it left off, rather than always restarting from the full duration.
 */
export function createTimer(durationSec, remainingSec = durationSec) {
  return {
    durationSec,
    remainingSec: Math.max(0, Math.min(remainingSec, durationSec)),
    isExpired: remainingSec <= 0,
  };
}

/** Advances a timer by `deltaSec` (typically 1, called once per second). */
export function tickTimer(timer, deltaSec = 1) {
  const remainingSec = Math.max(0, timer.remainingSec - deltaSec);
  return { ...timer, remainingSec, isExpired: remainingSec <= 0 };
}

export function formatTime(totalSec) {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.floor(totalSec % 60);
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function getTimeUrgency(remainingSec) {
  if (remainingSec <= CRITICAL_TIME_WARNING_SEC) return "critical";
  if (remainingSec <= LOW_TIME_WARNING_SEC) return "low";
  return "normal";
}
