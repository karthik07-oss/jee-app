// ai.js — provider-agnostic adapter for any OpenAI-compatible chat-completions
// endpoint (NVIDIA NIM / build.nvidia.com, Groq, OpenRouter, etc.).
//
// Hard rule for every caller in this app: the exam-taking flow (Setup → Exam
// → Result) must work completely with zero AI configured. Nothing in here
// should ever be awaited on a critical path without a try/catch around it.

import { AIConfigDB, AICacheDB } from "./db.js";

export const PROVIDER_PRESETS = {
  nvidia: {
    label: "NVIDIA NIM — Nemotron 3 Ultra",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    model: "nvidia/nemotron-3-ultra-550b-a55b",
    keyHint: "Starts with nvapi- — from build.nvidia.com",
  },
  groq: {
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "",
    keyHint: "From console.groq.com — fill in your chosen model below",
  },
  openrouter: {
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "",
    keyHint: "From openrouter.ai/keys — e.g. nvidia/nemotron-3-ultra-550b-a55b:free",
  },
  custom: {
    label: "Custom (any OpenAI-compatible endpoint)",
    baseUrl: "",
    model: "",
    keyHint: "",
  },
};

const DEFAULT_CONFIG = {
  preset: "nvidia",
  baseUrl: PROVIDER_PRESETS.nvidia.baseUrl,
  model: PROVIDER_PRESETS.nvidia.model,
  apiKey: "",
};

export async function getAIConfig() {
  const stored = await AIConfigDB.get();
  return { ...DEFAULT_CONFIG, ...(stored || {}) };
}

export async function saveAIConfig(partial) {
  const current = await getAIConfig();
  const next = { ...current, ...partial };
  await AIConfigDB.set(next);
  return next;
}

export async function isAIConfigured() {
  const cfg = await getAIConfig();
  return !!(cfg.apiKey && cfg.apiKey.trim() && cfg.baseUrl && cfg.model);
}

/**
 * Calls the configured chat-completions endpoint. Returns the assistant's
 * text content as a string. Throws a descriptive Error on any failure —
 * every caller must catch this and show a real message, never let it hang.
 */
export async function aiChat(messages, opts = {}) {
  const cfg = await getAIConfig();
  if (!cfg.apiKey || !cfg.apiKey.trim()) {
    throw new Error("No AI API key configured yet — add one in Settings.");
  }
  if (!cfg.baseUrl || !cfg.model) {
    throw new Error("AI provider isn't fully set up — check Base URL and Model in Settings.");
  }

  const timeoutMs = opts.timeoutMs || 30000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(`${cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        temperature: opts.temperature ?? 0.3,
        max_tokens: opts.maxTokens ?? 1024,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(`AI request timed out after ${Math.round(timeoutMs / 1000)}s. Try again.`);
    }
    throw new Error(`Couldn't reach the AI provider (${err.message}). Check your connection.`);
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    let bodyText = "";
    try { bodyText = (await res.text()).slice(0, 200); } catch (_) { /* ignore */ }
    if (res.status === 401) throw new Error("AI provider rejected the API key (401). Re-check it in Settings.");
    if (res.status === 429) throw new Error("AI provider rate limit hit (429). Wait a moment and try again.");
    if (res.status === 402) throw new Error("AI provider says the free quota is used up (402).");
    throw new Error(`AI provider error (${res.status}): ${bodyText || "no further detail"}`);
  }

  let data;
  try {
    data = await res.json();
  } catch (err) {
    throw new Error("AI provider returned a response that couldn't be read.");
  }

  const content = data?.choices?.[0]?.message?.content;
  if (!content || !content.trim()) {
    throw new Error("AI provider returned an empty response.");
  }
  return content;
}

/**
 * Like aiChat, but expects strict JSON back and parses it. Strips ```json
 * fences in case the model wraps its answer despite being told not to.
 */
export async function aiChatJSON(messages, opts = {}) {
  const raw = await aiChat(messages, opts);
  const cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/, "")
    .replace(/```\s*$/, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    throw new Error("AI response wasn't valid JSON — try again, or simplify the request.");
  }
}

/** Used by the Settings screen's "Test Connection" button. */
export async function testAIConnection() {
  const reply = await aiChat(
    [{ role: "user", content: "Reply with exactly the single word: OK" }],
    { maxTokens: 10, timeoutMs: 15000 }
  );
  return reply.trim();
}

/** Thin caching helpers so repeat views (e.g. a result you open twice) don't re-spend quota. */
export async function getCached(cacheId) {
  const row = await AICacheDB.get(cacheId);
  return row ? row.value : null;
}
export async function setCached(cacheId, value) {
  await AICacheDB.set(cacheId, value);
}
