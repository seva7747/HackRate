const $ = (id) => document.getElementById(id);
let CURRENT = null; // { aggregate, mode, reviewId, subjectText }

init();

async function init() {
  await HR.loadJudges();
  const runRaw = sessionStorage.getItem("hr_run");

  if (runRaw) {
    // Fresh run coming from the rate page — consume it once.
    sessionStorage.removeItem("hr_run");
    sessionStorage.removeItem("hr_outcomes");
    const run = JSON.parse(runRaw);
    startRun(run);
  } else {
    // Returning (e.g. from a dispute) — re-render the stored result.
    const stored = sessionStorage.getItem("hr_result");
    if (stored) {
      CURRENT = JSON.parse(stored);
      $("statusRow").classList.add("hidden");
      $("stageNote").classList.add("hidden");
      renderSubject(CURRENT.mode, CURRENT.subjectLabel);
      renderResult(CURRENT.aggregate);
    } else {
      $("subject").textContent = "Nothing to judge yet.";
      $("results").innerHTML = `<p class="stage-note"><a class="back-link" href="/rate">→ Start a rating</a></p>`;
      $("statusRow").classList.add("hidden");
      $("stageNote").classList.add("hidden");
    }
  }
}

function renderSubject(mode, label) {
  $("whatLabel").textContent = mode === "project" ? "REVIEWING YOUR BUILD" : "JUDGING YOUR IDEA";
  $("subject").textContent = label || "—";
}

function buildStatusChips() {
  const row = $("statusRow");
  row.classList.remove("hidden");
  row.replaceChildren();
  HR.JUDGES.forEach((j) => {
    const chip = document.createElement("div");
    chip.className = "status-chip pending";
    chip.id = `chip-${j.id}`;
    chip.innerHTML = `<span class="spinner"></span><span>${j.label}</span>`;
    row.appendChild(chip);
  });
}

function setChip(id, ok) {
  const chip = $(`chip-${id}`);
  if (!chip) return;
  const label = chip.querySelector("span:last-child").textContent;
  chip.className = `status-chip ${ok ? "ok" : "fail"}`;
  chip.innerHTML = `${ok ? HR.CHECK_SVG : HR.X_SVG}<span>${label}</span>`;
}

async function startRun(run) {
  const label =
    run.mode === "project" ? run.body.url : HR.truncate(run.body.idea, 160);
  renderSubject(run.mode, label);
  buildStatusChips();
  $("stageNote").classList.remove("hidden");
  $("stageNote").textContent = "Generating a rubric from your criteria…";

  try {
    const res = await fetch(run.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(run.body),
    });
    if (!res.ok && (res.headers.get("content-type") || "").includes("application/json")) {
      throw new Error((await res.json()).error || "request failed");
    }
    await readStream(res.body, run, label);
  } catch (err) {
    showError(err.message);
  }
}

async function readStream(body, run, label) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) handleEvent(JSON.parse(line), run, label);
    }
  }
}

function handleEvent(ev, run, label) {
  switch (ev.type) {
    case "scraped":
      $("stageNote").textContent = `Crawled ${ev.pages.length} page${ev.pages.length === 1 ? "" : "s"} — generating rubric…`;
      break;
    case "rubric":
      $("stageNote").textContent = `Rubric ready (${ev.dimensions.length} dimensions) — judges scoring…`;
      break;
    case "judge_done":
      setChip(ev.judge.id, ev.status === "ok");
      break;
    case "result": {
      const subjectLabel = label;
      CURRENT = { aggregate: ev.aggregate, mode: run.mode, reviewId: ev.reviewId, subjectLabel };
      sessionStorage.setItem("hr_result", JSON.stringify(CURRENT));
      if (run.mode === "idea") sessionStorage.setItem("hr_last_idea_review", ev.reviewId || "");
      $("stageNote").classList.add("hidden");
      renderResult(ev.aggregate);
      break;
    }
    case "error":
      showError(ev.error);
      break;
  }
}

function barColor(v) {
  if (v == null) return "#ccc";
  if (v >= 7.5) return "#14b8a6";
  if (v >= 5.5) return "#2f6df6";
  if (v >= 4) return "#e08a3c";
  return "#e06666";
}

function renderResult(agg) {
  const outcomes = JSON.parse(sessionStorage.getItem("hr_outcomes") || "{}");
  const overall = agg.overall ?? "—";
  const pct = agg.overall ? (agg.overall / 10) * 100 : 0;

  const allDims = agg.dimensions || [];
  const criteriaDim = allDims.find((d) => d.isCriteria);
  const dims = allDims
    .filter((d) => !d.isCriteria)
    .map((d) => {
      const v = d.average;
      const p = v ? (v / 10) * 100 : 0;
      return `<div class="dim-row">
        <div class="dim-head"><span class="n">${HR.esc(d.label)} <span class="w">W${d.weight}</span></span><span class="v">${v ?? "n/a"}${v ? "/10" : ""}</span></div>
        <div class="dim-track"><div class="dim-fill" style="width:${p}%;background:${barColor(v)}"></div></div>
        <p class="dim-desc">${HR.esc(d.description || "")}</p>
      </div>`;
    })
    .join("");

  // Dedicated "how well was the criteria/rubric followed" section.
  const cv = criteriaDim?.average;
  const criteriaBlock = criteriaDim
    ? `<div class="sec-title">CRITERIA FIT — how well it follows the rubric</div>
       <div class="criteria-fit">
         <div class="cf-score" style="color:${barColor(cv)}">${cv ?? "n/a"}${cv ? "/10" : ""}</div>
         <div class="cf-body">
           <div class="cf-track"><div class="cf-fill" style="width:${cv ? (cv / 10) * 100 : 0}%;background:${barColor(cv)}"></div></div>
           <p class="cf-note">${HR.esc(agg.criteriaSummary || criteriaDim.description || "")}</p>
         </div>
       </div>`
    : "";

  const gaps = (agg.gapsRich || (agg.gaps || []).map((text) => ({ text, judges: [] })))
    .map((g, i) => gapHtml(g, i, outcomes[`g${i}`]))
    .join("") || `<li class="gap-item"><span class="txt">None flagged.</span></li>`;

  const shines = (agg.shinesRich || (agg.shines || []).map((text) => ({ text, judges: [] })))
    .map((s) => `<li class="shine-item"><span class="txt">${HR.esc(s.text)}</span>${who(s.judges)}</li>`)
    .join("") || `<li class="shine-item"><span class="txt">Nothing stood out yet.</span></li>`;

  const jtags = (agg.judges?.detail || [])
    .map((d) => {
      const ok = d.status === "ok";
      const title = ok ? `${d.title} · ${d.model || ""}` : `${d.title} · ${d.error || "unavailable"}`;
      return `<span class="jtag ${ok ? "ok" : "fail"}" title="${HR.esc(title)}">${HR.esc(d.id)}</span>`;
    })
    .join("");

  const crawl = agg.crawledPages?.length
    ? `<div class="sec-title">PAGES CRAWLED (${agg.crawledPages.length})</div>
       <div class="crawl-list">${agg.crawledPages.map((p) => `↳ ${HR.esc(p.url)}`).join("<br>")}</div>`
    : "";

  const verdict = agg.verdict
    ? `<div class="verdict"><span class="tag">VERDICT · ${agg.verdictSource === "heuristic" ? "summary" : HR.esc(agg.verdictSource || "meta")}</span>${HR.esc(agg.verdict)}</div>
       ${agg.topPriority ? `<p class="priority">→ <b>Top priority:</b> ${HR.esc(agg.topPriority)}</p>` : ""}`
    : "";

  const respCount = agg.judges?.responded?.length || 0;

  $("results").innerHTML = `
    <div class="score-hero"><span class="score">${overall}</span><span class="outof">/ 10</span></div>
    <div class="score-label">OVERALL HACKRATE SCORE</div>
    <p class="criteria-summary">${HR.esc(agg.criteriaSummary || "")}</p>
    <div class="score-bar-wrap"><div class="score-bar" style="width:${pct}%"></div></div>
    ${verdict}
    ${criteriaBlock}
    <div class="sec-title">RUBRIC BREAKDOWN — does the idea work?</div>
    ${dims}
    <div class="sec-title">GAPS TO FIX <span style="text-transform:none;letter-spacing:0;color:var(--ink-faint)">· hover a problem to dispute it</span></div>
    <ul class="list">${gaps}</ul>
    <div class="sec-title">WHAT SHINES</div>
    <ul class="list">${shines}</ul>
    <div class="sec-title">JUDGE PANEL — ${respCount}/${(agg.judges?.detail || []).length} responded</div>
    <div class="jtags">${jtags}</div>
    ${crawl}
  `;
}

function who(judges) {
  return judges && judges.length ? `<span class="who">flagged by ${judges.join(", ")}</span>` : "";
}

function gapHtml(g, i, outcome) {
  const gid = `g${i}`;
  let cls = "gap-item";
  let note = "";
  if (outcome) {
    if (outcome.ruling === "withdrawn") { cls += " resolved"; note = `<span class="ruling-note">✓ Dispute upheld — withdrawn: ${HR.esc(outcome.explanation)}</span>`; }
    else if (outcome.ruling === "revised") { cls += " resolved"; note = `<span class="ruling-note">↻ Revised to: ${HR.esc(outcome.revisedText || outcome.explanation)}</span>`; }
    else { note = `<span class="ruling-note" style="color:var(--ink-soft)">✕ Dispute reviewed — flag stands: ${HR.esc(outcome.explanation)}</span>`; }
  }
  return `<li class="${cls}" data-gid="${gid}">
    <span class="txt">${HR.esc(g.text)}</span>${who(g.judges)}${note}
    <button class="dispute-btn" data-gid="${gid}" data-text="${HR.esc(g.text)}">DISPUTE</button>
  </li>`;
}

// Dispute buttons -> stash context, go to dispute page.
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".dispute-btn");
  if (!btn || !CURRENT) return;
  sessionStorage.setItem(
    "hr_dispute",
    JSON.stringify({
      reviewId: CURRENT.reviewId,
      mode: CURRENT.mode,
      gapId: btn.dataset.gid,
      gapText: btn.dataset.text,
    })
  );
  location.href = "/dispute";
});

function showError(msg) {
  $("statusRow").classList.add("hidden");
  $("stageNote").classList.add("hidden");
  $("results").innerHTML = `<div class="err-box"><strong>Run failed.</strong><br>${HR.esc(msg)}<br><br><a class="back-link" href="/rate">← try again</a></div>`;
}
