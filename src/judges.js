import { JUDGES } from "./config.js";
import { callModel, callReasoning } from "./callModel.js";
import {
  buildIdeaMessages,
  buildProjectMessages,
  buildPrMessages,
  buildMetaMessages,
  buildDisputeMessages,
  buildFixMessages,
  extractJson,
} from "./prompts.js";
import { normalizeJudge, aggregate } from "./aggregate.js";
import { DIMENSIONS } from "./rubric.js";

async function runOneJudge(judge, messages, dimensions, log) {
  const started = Date.now();
  try {
    const { text, model } = await callModel(judge.provider, messages);
    const parsed = extractJson(text);
    const { scores, gaps, shines } = normalizeJudge(parsed, dimensions);
    log(`  [ok]   ${judge.id} via ${model} (${Date.now() - started}ms)`);
    return { id: judge.id, title: judge.title, status: "ok", model, scores, gaps, shines };
  } catch (err) {
    log(`  [SKIP] ${judge.id}: ${err.message} (${Date.now() - started}ms)`);
    return { id: judge.id, title: judge.title, status: "unavailable", error: err.message };
  }
}

/**
 * Full run: generate the dynamic rubric, then run the judge panel in parallel,
 * then aggregate + write the verdict.
 *
 * @param {"idea"|"project"} mode
 * @param {object} input - idea: { ideaText, criteria }
 *                         project: { url, originalIdea, criteria, pages }
 * @param {object} hooks - { onRubric(r), onStart(j), onDone(r), log(msg) }
 */
export async function runPanel(mode, input, hooks = {}) {
  const onRubric = hooks.onRubric || (() => {});
  const onStart = hooks.onStart || (() => {});
  const onDone = hooks.onDone || (() => {});
  const log = hooks.log || (() => {});

  log(`=== HackRate run: ${mode} | ${JUDGES.length} judges ===`);

  // Fixed idea-level rubric (same every run). Criteria adjusts scoring of the
  // criteria_fit dimension, not the rubric itself.
  const dimensions = DIMENSIONS;
  const criteriaSummary = input.criteria && input.criteria.trim()
    ? `Judged on hackathon fundamentals, weighted toward the stated criteria: ${input.criteria.trim().slice(0, 160)}`
    : "Judged on general hackathon fundamentals (would the idea work, is it novel, useful, buildable, demo-able).";
  onRubric({ dimensions, criteriaSummary, source: "fixed" });

  // Judge panel in parallel.
  const results = await Promise.all(
    JUDGES.map((judge) => {
      onStart({ id: judge.id, title: judge.title });
      const messages =
        mode === "pr"
          ? buildPrMessages(judge, { ...input, dimensions })
          : mode === "project"
          ? buildProjectMessages(judge, { ...input, dimensions })
          : buildIdeaMessages(judge, { ...input, dimensions, criteriaSummary });
      return runOneJudge(judge, messages, dimensions, log).then((r) => {
        onDone(r);
        return r;
      });
    })
  );

  // Aggregate + verdict.
  const agg = aggregate(results, dimensions);
  agg.criteriaSummary = criteriaSummary;

  const verdict = await buildVerdict(mode, agg, results, input, { criteriaSummary }, log);
  agg.verdict = verdict.verdict;
  agg.topPriority = verdict.topPriority;
  agg.verdictSource = verdict.source;

  const ok = results.filter((r) => r.status === "ok").length;
  log(`=== done: overall ${agg.overall ?? "n/a"}/10 from ${ok}/${JUDGES.length} judges ===`);
  return agg;
}

async function buildVerdict(mode, agg, results, input, rubric, log) {
  const judgeSummaries = results
    .filter((r) => r.status === "ok")
    .map((r) => `${r.id}: gaps=[${(r.gaps || []).join(" | ")}] shines=[${(r.shines || []).join(" | ")}]`)
    .join("\n");
  try {
    const { text, provider } = await callReasoning(
      buildMetaMessages({
        mode,
        aggregate: agg,
        judgeSummaries,
        originalIdea: input.originalIdea,
        url: input.url,
        criteriaSummary: rubric.criteriaSummary,
      }),
      { temperature: 0.3 }
    );
    const parsed = extractJson(text);
    if (!parsed?.verdict) throw new Error("no verdict field");
    log(`  [ok]   verdict via ${provider}`);
    return {
      verdict: String(parsed.verdict).trim(),
      topPriority: parsed.top_priority ? String(parsed.top_priority).trim() : null,
      source: provider,
    };
  } catch (err) {
    log(`  [SKIP] verdict models unavailable, using heuristic: ${err.message}`);
    return { ...heuristicVerdict(mode, agg), source: "heuristic" };
  }
}

function heuristicVerdict(mode, agg) {
  const s = agg.overall;
  const topGap = agg.gaps[0] || null;
  if (s === null) return { verdict: "No judges were reachable — check API keys and rate limits.", topPriority: null };
  let band;
  if (s >= 8) band = mode === "project" ? "Strong build" : "Strong idea";
  else if (s >= 6.5) band = mode === "project" ? "Solid, close to demo-ready" : "Promising";
  else if (s >= 5) band = "Workable but rough";
  else band = "Needs significant work";
  const tail = topGap ? ` — biggest issue: ${topGap.replace(/\.$/, "")}.` : ".";
  return { verdict: `${band} (${s}/10)${tail}`, topPriority: topGap };
}

/** Fixer — suggest a concrete fix for one flagged gap, grounded in the code. */
export async function suggestFix({ gap, criteria, files }) {
  const { text, provider } = await callReasoning(buildFixMessages({ gap, criteria, files }), { temperature: 0.3 });
  const parsed = extractJson(text);
  return {
    summary: String(parsed.summary || "").trim() || "No suggestion returned.",
    steps: Array.isArray(parsed.steps) ? parsed.steps.filter((s) => typeof s === "string" && s.trim()).map((s) => s.trim()) : [],
    file: parsed.file ? String(parsed.file).trim() : null,
    codeSketch: parsed.codeSketch ? String(parsed.codeSketch).trim() : null,
    source: provider,
  };
}

/** Adjudicate a user's dispute of a single flagged gap. */
export async function adjudicateDispute({ mode, subject, gapText, userArgument }) {
  const { text, provider } = await callReasoning(
    buildDisputeMessages({ mode, subject, gapText, userArgument }),
    { temperature: 0.2 }
  );
  const parsed = extractJson(text);
  const ruling = ["withdrawn", "revised", "upheld"].includes(parsed.ruling) ? parsed.ruling : "upheld";
  return {
    ruling,
    explanation: String(parsed.explanation || "").trim() || "No explanation returned.",
    revisedText: ruling === "revised" && parsed.revisedText ? String(parsed.revisedText).trim() : null,
    source: provider,
  };
}
