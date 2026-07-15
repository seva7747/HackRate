import { PROVIDERS, CALL_TIMEOUT_MS, REASONING_CHAIN } from "./config.js";

/**
 * Call the reasoning chain: try each provider in REASONING_CHAIN until one works.
 * Used for rubric generation, verdicts, and dispute adjudication — the non-panel
 * tasks that just need one capable model. Returns { text, model, provider }.
 */
export async function callReasoning(messages, opts = {}) {
  const errors = [];
  for (const provider of REASONING_CHAIN) {
    if (!(process.env[PROVIDERS[provider]?.apiKeyEnv] || "").trim()) continue;
    try {
      return await callModel(provider, messages, opts);
    } catch (err) {
      errors.push(`${provider}: ${err.message}`);
    }
  }
  throw new Error(`reasoning chain exhausted — ${errors.join(" | ")}`);
}

/**
 * Generic OpenAI-compatible chat call.
 *
 * callModel(provider, messages, opts) -> { text, model, provider }
 *
 * Tries each model in the provider's fallback list in order. A model is only
 * "used up" if the request itself fails (bad model name, rate limit, network).
 * Throws only when every fallback model for that provider has failed — callers
 * decide whether that judge becomes "unavailable" or aborts the run.
 */
export async function callModel(provider, messages, opts = {}) {
  const cfg = PROVIDERS[provider];
  if (!cfg) throw new Error(`Unknown provider: ${provider}`);

  const apiKey = (process.env[cfg.apiKeyEnv] || "").trim();
  if (!apiKey) {
    const err = new Error(`Missing API key (${cfg.apiKeyEnv}) for ${cfg.label}`);
    err.code = "NO_KEY";
    throw err;
  }

  const wantJson = opts.json !== false; // default: ask for JSON
  const temperature = opts.temperature ?? 0.2;
  const errors = [];

  for (const model of cfg.models) {
    // For providers that support it, try json-mode first, then a plain retry on
    // the same model in case json-mode is what got rejected.
    const attempts = cfg.supportsJsonMode && wantJson ? [true, false] : [false];

    for (const useJsonMode of attempts) {
      try {
        const text = await requestOnce({ cfg, apiKey, model, messages, temperature, useJsonMode });
        return { text, model, provider };
      } catch (err) {
        errors.push(`${model}${useJsonMode ? " (json)" : ""}: ${err.message}`);
        // If json-mode failed, the plain retry on the same model happens next.
        // Otherwise fall through to the next fallback model.
      }
    }
  }

  const err = new Error(`All models failed for ${cfg.label} — ${errors.join(" | ")}`);
  err.code = "ALL_FAILED";
  err.attempts = errors;
  throw err;
}

async function requestOnce({ cfg, apiKey, model, messages, temperature, useJsonMode }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);

  const body = { model, messages, temperature };
  if (useJsonMode) body.response_format = { type: "json_object" };

  try {
    const res = await fetch(`${cfg.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...(cfg.extraHeaders || {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      throw new Error(`HTTP ${res.status} ${detail}`);
    }

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (!text || !text.trim()) throw new Error("empty completion");
    return text;
  } catch (err) {
    if (err.name === "AbortError") throw new Error(`timeout after ${CALL_TIMEOUT_MS}ms`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}