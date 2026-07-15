// Prompt builders. Every judge scores the same FIXED idea-level rubric (rubric.js).

function dimensionBlock(dimensions) {
  return dimensions
    .map((d) => {
      const risk = d.higherIsBetter === false ? "  [risk: 10 = no problem, 1 = serious problem]" : "";
      return `  - ${d.key} (weight ${d.weight}): ${d.label} — ${d.description}${risk}`;
    })
    .join("\n");
}

function schemaExample(judgeId, dimensions) {
  const scores = {};
  for (const d of dimensions) scores[d.key] = "<1-10>";
  return JSON.stringify(
    { judge: judgeId, scores, gaps: ["<concrete problem with the IDEA>", "..."], shines: ["<concrete strength>", "..."] },
    null,
    2
  );
}

// The core framing that keeps judges evaluating the IDEA, not code.
const IDEA_FOCUS_RULES = `
WHAT TO JUDGE — READ CAREFULLY:
- You are judging whether the IDEA itself would work — NOT reviewing code. The user has given a DESCRIPTION, not an implementation.
- Do NOT flag code-level or implementation problems: missing error handling, specific API rate limits, auth flows, database choices, "no tests", edge cases in code, etc. None of that is knowable or relevant from an idea description.
- Your "gaps" must be about the IDEA: Is the problem real and clear? Is it novel or already done? Would people actually use it? Can a team realistically build and DEMO it in a hackathon? Does it fit the criteria?
- ONE exception for tech: if the idea fundamentally depends on something that does NOT exist (e.g. "an AI that flawlessly predicts the future", a model/capability that isn't real) or is prohibitively expensive to run, THEN flag that (and it should lower tech_realism). Otherwise assume normal, affordable tech is available.`;

const SHARED_RULES = `
OUTPUT RULES:
- Output ONLY a single JSON object. No markdown, no code fences, no prose.
- Score EVERY dimension key listed. Every score is an INTEGER 1-10. Never 0, never a string.
- For risk dimensions, 10 = no issue, 1 = serious issue.
- "gaps": 2-5 concrete, specific problems WITH THE IDEA. "shines": 1-3 concrete strengths (empty array ok).
- Be honest and calibrated. Do not inflate scores to be nice.`;

/** Part 1 — idea intake. */
export function buildIdeaMessages(judge, { ideaText, criteria, dimensions, criteriaSummary }) {
  const criteriaLine = criteria && criteria.trim()
    ? `The hackathon's criteria / theme: "${criteria.trim()}"\nScore "criteria_fit" by how well the idea serves THAT.`
    : `No specific criteria were given — score "criteria_fit" on general hackathon-worthiness (would this fit a typical hackathon theme).`;

  const system = `You are the "${judge.title}" on HackRate, a panel of independent AI judges scoring hackathon IDEAS before they're built.

Your judging specialty: ${judge.focus}.

${criteriaLine}

Score the idea on these dimensions (each 1-10, 10 = best):
${dimensionBlock(dimensions)}

Return EXACTLY this JSON shape (keep "judge" as "${judge.id}"):
${schemaExample(judge.id, dimensions)}
${IDEA_FOCUS_RULES}
${SHARED_RULES}`;

  const user = `Here is the hackathon idea to judge:\n\n"""\n${ideaText.trim()}\n"""`;
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/** Part 2 — finished project review across the crawled site. */
export function buildProjectMessages(judge, { originalIdea, criteria, url, pages, dimensions }) {
  const criteriaLine = criteria && criteria.trim()
    ? `The hackathon's criteria / theme: "${criteria.trim()}"\nScore "criteria_fit" by how well the built project serves THAT.`
    : `No specific criteria were given — score "criteria_fit" on general hackathon-worthiness.`;

  const system = `You are the "${judge.title}" on HackRate, reviewing a FINISHED hackathon project against its pitch and the hackathon criteria.

Your judging specialty: ${judge.focus}.

${criteriaLine}

CRITICAL — how to read the site:
- You are given the text of MULTIPLE pages crawled from the site, each marked "=== PAGE: <url> ===".
- A feature is only "missing" or "false advertising" if it is absent from ALL provided pages. Do NOT assume something is missing just because it isn't on the landing page — check the other pages first.
- If a page's content is thin, it may be a client-rendered app whose content didn't load; treat that as "could not verify", NOT "broken" or "missing".
- Judge the PRODUCT experience, not source code you cannot see.

Score what was actually built on these dimensions (each 1-10, 10 = best):
${dimensionBlock(dimensions)}

Return EXACTLY this JSON shape (keep "judge" as "${judge.id}"):
${schemaExample(judge.id, dimensions)}
${SHARED_RULES}
- In "gaps", separate what's MISSING vs the pitch from things visibly unfinished in the build.`;

  const original = originalIdea?.trim()
    ? `ORIGINAL PITCH:\n"""\n${originalIdea.trim()}\n"""`
    : `ORIGINAL PITCH: (not provided — judge the build on its own merits + the criteria)`;

  const user = `${original}

WHAT WAS BUILT — site ${url} (${pages.length} page${pages.length === 1 ? "" : "s"} crawled):
"""
${pages.map((p) => `=== PAGE: ${p.url} ===\n${p.text}`).join("\n\n").slice(0, 14000)}
"""`;

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/** Meta verdict — reads the aggregate + judges' notes, writes one verdict line. */
export function buildMetaMessages({ mode, aggregate, judgeSummaries, originalIdea, url, criteriaSummary }) {
  const context = mode === "project" ? `Review of a FINISHED project at ${url}.` : `Review of a hackathon IDEA (before building).`;
  const system = `You are the summarizing voice of HackRate. Judges already scored independently and the scores are aggregated deterministically. Do NOT re-score.

Read the aggregate and the judges' notes, then write ONE tight, actionable verdict line (max ~25 words) about whether the IDEA would work. Be specific and honest. Focus on the idea, not code.

Output ONLY JSON: {"verdict": "<one line>", "top_priority": "<the single most important thing to fix, one sentence>"}`;

  const user = `${context}
Judged for: ${criteriaSummary}
Overall score: ${aggregate.overall}/10
Dimension averages: ${JSON.stringify(aggregate.dimensionAverages)}
Judges responded: ${aggregate.judges.responded.join(", ") || "none"} | skipped: ${aggregate.judges.skipped.map((s) => s.id).join(", ") || "none"}

Merged gaps:
${aggregate.gaps.map((g) => `- ${g}`).join("\n") || "- (none)"}

Merged shines:
${aggregate.shines.map((s) => `- ${s}`).join("\n") || "- (none)"}

Per-judge notes:
${judgeSummaries}`;

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/** Dispute — user argues a flagged gap is wrong or misread; a model re-judges it. */
export function buildDisputeMessages({ mode, subject, gapText, userArgument }) {
  const system = `You are the HackRate dispute adjudicator. A user is disputing ONE problem an AI judge flagged about their hackathon ${mode === "project" ? "project" : "idea"}.

Remember: HackRate judges the IDEA, not code. If the flag was actually a code/implementation nitpick, or the AI misread the ${mode === "project" ? "site" : "idea"}, lean "withdrawn".

Re-read the ${mode === "project" ? "project" : "idea"} and the user's rebuttal, then decide honestly:
- "withdrawn": the flag was wrong, a code-level nitpick, or the AI misread it. The user is right.
- "revised": there's a real underlying concern but it should be reworded / narrowed.
- "upheld": the flag stands; explain why the rebuttal doesn't resolve it.

Be fair, not stubborn, but don't cave without substance.

Output ONLY JSON: {"ruling": "withdrawn|revised|upheld", "explanation": "<2-3 sentences to the user>", "revisedText": "<the reworded problem if ruling is 'revised', else null>"}`;

  const user = `THE ${mode === "project" ? "PROJECT" : "IDEA"}:
"""
${(subject || "").trim().slice(0, 12000)}
"""

THE FLAGGED PROBLEM:
"${gapText}"

THE USER'S DISPUTE:
"${userArgument}"`;

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/** Robustly pull a JSON object out of a model response (strips ``` fences). */
export function extractJson(raw) {
  if (typeof raw !== "string") throw new Error("no text to parse");
  let s = raw.trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("no JSON object found in response");
  return JSON.parse(s.slice(start, end + 1));
}
