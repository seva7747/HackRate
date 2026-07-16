import "dotenv/config";
import express from "express";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PORT, JUDGES, PROVIDERS, REASONING_CHAIN } from "./src/config.js";
import { runPanel, adjudicateDispute } from "./src/judges.js";
import { scrapeSite } from "./src/scrape.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, "public");

const app = express();
app.use(express.json({ limit: "512kb" }));

// In-memory store per run so Part 2 can compare against the Part 1 pitch and so the
// dispute page can re-judge against the exact subject the judges saw. Fine for
// localhost / a hackathon; swap for a DB to persist across restarts.
const runStore = new Map(); // reviewId -> { mode, idea, subject }

// ---- page routes (each workflow is its own page) ----------------------------
app.get("/", (req, res) => res.sendFile(path.join(PUBLIC, "index.html")));
app.get("/rate", (req, res) => res.sendFile(path.join(PUBLIC, "rate.html")));
app.get("/results", (req, res) => res.sendFile(path.join(PUBLIC, "results.html")));
app.get("/dispute", (req, res) => res.sendFile(path.join(PUBLIC, "dispute.html")));
app.use(express.static(PUBLIC));

// ---- streaming helper -------------------------------------------------------
function ndjsonStream(res) {
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");
  const send = (obj) => res.write(JSON.stringify(obj) + "\n");
  const log = (msg) => { console.log(msg); send({ type: "log", msg }); };
  const hooks = {
    onRubric: (r) => send({ type: "rubric", dimensions: r.dimensions, criteriaSummary: r.criteriaSummary, source: r.source }),
    onStart: (j) => send({ type: "judge_start", judge: j }),
    onDone: (r) => send({ type: "judge_done", judge: { id: r.id, title: r.title }, status: r.status, error: r.error || null }),
    log,
  };
  return { send, hooks };
}

// ---- metadata ---------------------------------------------------------------
app.get("/api/judges", (req, res) => {
  res.json({
    judges: JUDGES.map((j) => ({ id: j.id, title: j.title, label: PROVIDERS[j.provider].label, optional: !!j.optional })),
  });
});

// ---- Part 1: idea intake ----------------------------------------------------
app.post("/api/review-idea", async (req, res) => {
  const ideaText = (req.body?.idea || "").toString().trim();
  const criteria = (req.body?.criteria || "").toString().trim();
  if (ideaText.length < 15) return res.status(400).json({ error: "Describe your idea in a bit more detail (min ~15 chars)." });

  const { send, hooks } = ndjsonStream(res);
  const reviewId = randomUUID();
  send({ type: "start", mode: "idea", reviewId });

  try {
    const agg = await runPanel("idea", { ideaText, criteria }, hooks);
    runStore.set(reviewId, { mode: "idea", idea: ideaText, subject: ideaText });
    send({ type: "result", reviewId, aggregate: agg });
  } catch (err) {
    console.error("review-idea failed:", err);
    send({ type: "error", error: err.message });
  } finally {
    res.end();
  }
});

// ---- Part 2: finished project review ----------------------------------------
app.post("/api/review-project", async (req, res) => {
  const url = (req.body?.url || "").toString().trim();
  const criteria = (req.body?.criteria || "").toString().trim();
  const priorId = (req.body?.reviewId || "").toString().trim();
  const originalIdea =
    (req.body?.originalIdea || "").toString().trim() || runStore.get(priorId)?.idea || "";
  if (!url) return res.status(400).json({ error: "Provide the URL of your built project." });

  const { send, hooks } = ndjsonStream(res);
  const reviewId = randomUUID();
  send({ type: "start", mode: "project", url, reviewId });

  try {
    send({ type: "log", msg: `Crawling ${url} ...` });
    const site = await scrapeSite(url);
    send({ type: "scraped", pages: site.pages.map((p) => ({ url: p.url, title: p.title || null })) });

    const agg = await runPanel("project", { url: site.url, originalIdea, criteria, pages: site.pages }, hooks);
    agg.hadOriginalIdea = !!originalIdea;
    agg.crawledPages = site.pages.map((p) => ({ url: p.url, title: p.title || null }));

    const subject = `PITCH: ${originalIdea || "(none)"}\n\n${site.pages.map((p) => `=== PAGE: ${p.url} ===\n${p.text}`).join("\n\n")}`;
    runStore.set(reviewId, { mode: "project", idea: originalIdea, subject });
    send({ type: "result", reviewId, aggregate: agg });
  } catch (err) {
    console.error("review-project failed:", err);
    send({ type: "error", error: err.message });
  } finally {
    res.end();
  }
});

// ---- PR review: called by an external agent (Kylon) on each pull request ----
// Non-streaming, plain JSON in / plain JSON out, so a webhook workflow can POST
// the changed files + criteria and drop the result straight into a PR comment
// or an email. This judges the DIFF the same way Part 2 judges a built project:
// does the change fit the criteria and is it actually useful — not code nitpicks.
app.post("/api/review-pr", async (req, res) => {
  const files = Array.isArray(req.body?.files) ? req.body.files : [];
  const criteria = (req.body?.criteria || "").toString().trim();
  const originalIdea = (req.body?.originalIdea || "").toString().trim();
  const prTitle = (req.body?.prTitle || "").toString().trim();

  const usable = files
    .filter((f) => f && (f.patch || f.text))
    .map((f) => ({
      url: (f.filename || f.path || "file").toString(),
      title: (f.filename || f.path || "file").toString(),
      text: (f.patch || f.text || "").toString(),
    }));
  if (!usable.length) {
    return res.status(400).json({ error: "Provide `files: [{ filename, patch }]` with at least one changed file." });
  }

  const log = (msg) => console.log(msg);
  try {
    const agg = await runPanel(
      "pr",
      { prTitle, originalIdea, criteria, pages: usable },
      { log }
    );

    // Compact, comment/email-friendly payload. `score` and `criteriaFit` are /10.
    // Cap gaps so one PR can't spawn a wall of near-duplicate issues downstream.
    res.json({
      score: agg.overall,
      criteriaFit: agg.dimensionAverages?.criteria_fit ?? null,
      verdict: agg.verdict || null,
      topPriority: agg.topPriority || null,
      gaps: (agg.gaps || []).slice(0, 6),
      shines: (agg.shines || []).slice(0, 4),
      judges: agg.judges?.responded || [],
    });
  } catch (err) {
    console.error("review-pr failed:", err);
    res.status(500).json({ error: err.message });
  }
});

// ---- Dispute: user contests a single flagged problem ------------------------
app.post("/api/dispute", async (req, res) => {
  const reviewId = (req.body?.reviewId || "").toString().trim();
  const gapText = (req.body?.gapText || "").toString().trim();
  const userArgument = (req.body?.argument || "").toString().trim();
  if (!gapText || !userArgument) return res.status(400).json({ error: "Need both the problem and your argument." });

  const run = runStore.get(reviewId);
  // Fall back to a client-supplied subject if the run expired (e.g. server restart).
  const subject = run?.subject || (req.body?.subject || "").toString().trim();
  const mode = run?.mode || (req.body?.mode === "project" ? "project" : "idea");
  if (!subject) return res.status(410).json({ error: "This review has expired — re-run it, then dispute." });

  try {
    const ruling = await adjudicateDispute({ mode, subject, gapText, userArgument });
    res.json(ruling);
  } catch (err) {
    console.error("dispute failed:", err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n  HackRate running -> http://localhost:${PORT}\n`);
  const providersInUse = [...new Set([...JUDGES.map((j) => j.provider), ...REASONING_CHAIN])];
  const missing = providersInUse
    .map((p) => PROVIDERS[p])
    .filter((p) => !(process.env[p.apiKeyEnv] || "").trim())
    .map((p) => p.apiKeyEnv);
  if (missing.length) console.warn(`  ⚠ missing keys in .env: ${[...new Set(missing)].join(", ")}`);
});
