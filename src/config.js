// Per-provider connection config. All providers expose an OpenAI-compatible
// /v1/chat/completions endpoint, so one generic caller (callModel.js) handles them all.
//
// `models` is an ordered fallback list: callModel tries them top-to-bottom on that
// same provider before giving up. Free model catalogs churn constantly, so never
// rely on a single hardcoded name.
//
// `apiKeyEnv` names differ from the provider name because they follow whatever the
// existing .env already uses (OPEN_ROUTE_API_KEY, CEREBRAL_API_KEY, DEEP_SEEK_API_KEY).

export const PROVIDERS = {
  groq: {
    label: "Groq",
    baseURL: "https://api.groq.com/openai/v1",
    apiKeyEnv: "GROQ_API_KEY",
    supportsJsonMode: true,
    models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "openai/gpt-oss-20b"],
  },
  openrouter: {
    label: "OpenRouter",
    baseURL: "https://openrouter.ai/api/v1",
    apiKeyEnv: "OPEN_ROUTE_API_KEY",
    supportsJsonMode: false, // many :free models reject response_format; rely on prompt + fence stripping
    extraHeaders: { "X-Title": "HackRate", "HTTP-Referer": "http://localhost:3000" },
    models: [
      "qwen/qwen3-next-80b-a3b-instruct:free",
      "nvidia/nemotron-3-super-120b-a12b:free",
      "openai/gpt-oss-20b:free",
      "meta-llama/llama-3.3-70b-instruct:free",
    ],
  },
  cerebras: {
    label: "Cerebras",
    baseURL: "https://api.cerebras.ai/v1",
    apiKeyEnv: "CEREBRAL_API_KEY",
    supportsJsonMode: true,
    models: ["gpt-oss-120b", "zai-glm-4.7", "gemma-4-31b"],
  },
  mistral: {
    label: "Mistral",
    baseURL: "https://api.mistral.ai/v1",
    apiKeyEnv: "MISTRAL_API_KEY",
    supportsJsonMode: true,
    models: ["mistral-small-latest", "open-mistral-nemo", "open-mistral-7b"],
  },
};

// The scoring panel. Each judge scores independently on the SAME (dynamically
// generated) rubric/schema; only `focus` (role framing) changes so the judges
// genuinely disagree. `optional` judges never fail the run if unavailable.
export const JUDGES = [
  {
    id: "groq",
    provider: "groq",
    title: "Speed Judge",
    focus:
      "blunt, fast feasibility and scope reality-checks — is this actually buildable in the time given, and is the core loop coherent",
  },
  {
    id: "openrouter",
    provider: "openrouter",
    title: "Variety Judge",
    focus:
      "novelty and market precedent — you have broad, different training exposure, so aggressively flag when an idea has been done before or is a thin wrapper on an existing product",
  },
  {
    id: "cerebras",
    provider: "cerebras",
    title: "Throughput Judge",
    focus:
      "a second opinion on technical difficulty and scope realism, and how brittle the data/infra dependencies are",
    optional: true, // most volatile free catalog — treated as a bonus signal
  },
  {
    id: "mistral",
    provider: "mistral",
    title: "Depth Judge",
    focus:
      "structured reasoning about how the idea is written — spot ambiguity, underspecification, and hidden assumptions the pitch glosses over",
  },
];

// Ordered provider fallback for the internal reasoning tasks that are NOT part of
// the scoring panel: writing the final verdict and adjudicating disputes. Groq is
// preferred (fast + reliable); the rest are fallbacks so the app keeps working.
export const REASONING_CHAIN = ["groq", "mistral", "cerebras"];

export const PORT = process.env.PORT || 3000;
export const CALL_TIMEOUT_MS = Number(process.env.CALL_TIMEOUT_MS || 45000);