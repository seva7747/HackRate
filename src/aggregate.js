// Aggregation over a dynamic dimension list. Each judge scores the same dimensions;
// we average per dimension across judges, then weight-average into an overall /10.

function cleanScore(value) {
  if (value === null || value === undefined || value === "") return null;
  let n = typeof value === "string" ? parseFloat(value) : value;
  if (typeof n !== "number" || Number.isNaN(n)) return null;
  n = Math.round(n);
  return Math.min(10, Math.max(1, n));
}

/**
 * Validate one judge's parsed JSON against the run's dimensions.
 * Returns { scores, gaps, shines }; every dimension key present (value or null).
 */
export function normalizeJudge(parsed, dimensions) {
  const raw = parsed?.scores && typeof parsed.scores === "object" ? parsed.scores : {};
  const scores = {};
  let anyValid = false;
  for (const d of dimensions) {
    const v = cleanScore(raw[d.key]);
    scores[d.key] = v;
    if (v !== null) anyValid = true;
  }
  if (!anyValid) throw new Error("judge returned no usable scores");

  const gaps = Array.isArray(parsed.gaps)
    ? parsed.gaps.filter((g) => typeof g === "string" && g.trim()).map((g) => g.trim())
    : [];
  const shines = Array.isArray(parsed.shines)
    ? parsed.shines.filter((s) => typeof s === "string" && s.trim()).map((s) => s.trim())
    : [];
  return { scores, gaps, shines };
}

const round1 = (n) => Math.round(n * 10) / 10;

function normalizeText(t) {
  return t.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2);
}
function similar(a, b) {
  const sa = new Set(normalizeText(a));
  const sb = new Set(normalizeText(b));
  if (!sa.size || !sb.size) return false;
  let inter = 0;
  for (const w of sa) if (sb.has(w)) inter++;
  return inter / (sa.size + sb.size - inter) >= 0.5;
}
// Dedupe near-identical entries but keep provenance (which judges raised it).
function mergeNotes(entries) {
  const kept = [];
  for (const { text, judge } of entries) {
    const hit = kept.find((k) => similar(k.text, text));
    if (hit) { if (!hit.judges.includes(judge)) hit.judges.push(judge); }
    else kept.push({ text, judges: [judge] });
  }
  return kept;
}

/**
 * @param {Array} judgeResults - [{ id, title, status, scores?, gaps?, shines?, model?, error? }]
 * @param {Array} dimensions   - the run's dynamic dimensions
 */
export function aggregate(judgeResults, dimensions) {
  const responded = judgeResults.filter((j) => j.status === "ok");
  const skipped = judgeResults
    .filter((j) => j.status !== "ok")
    .map((j) => ({ id: j.id, title: j.title, reason: j.error || "unavailable" }));

  const dimensionAverages = {};
  for (const d of dimensions) {
    const vals = responded.map((j) => j.scores[d.key]).filter((v) => typeof v === "number");
    dimensionAverages[d.key] = vals.length ? round1(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  }

  // Weighted overall across dimensions that have a value.
  let wSum = 0, acc = 0;
  for (const d of dimensions) {
    const v = dimensionAverages[d.key];
    if (typeof v === "number") { acc += v * d.weight; wSum += d.weight; }
  }
  const overall = wSum ? round1(acc / wSum) : null;

  const gapEntries = responded.flatMap((j) => (j.gaps || []).map((text) => ({ text, judge: j.id })));
  const shineEntries = responded.flatMap((j) => (j.shines || []).map((text) => ({ text, judge: j.id })));
  const gapsMerged = mergeNotes(gapEntries);
  const shinesMerged = mergeNotes(shineEntries);

  return {
    overall,
    dimensions: dimensions.map((d) => ({ ...d, average: dimensionAverages[d.key] })),
    dimensionAverages,
    // Flat text arrays (used by meta prompt); rich arrays (used by UI, carry judges[]).
    gaps: gapsMerged.map((g) => g.text),
    shines: shinesMerged.map((s) => s.text),
    gapsRich: gapsMerged,
    shinesRich: shinesMerged,
    judges: {
      responded: responded.map((j) => j.id),
      skipped,
      detail: judgeResults.map((j) => ({
        id: j.id, title: j.title, status: j.status, model: j.model || null, error: j.error || null,
      })),
    },
  };
}
