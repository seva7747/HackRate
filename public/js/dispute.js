const $ = (id) => document.getElementById(id);
const ctx = JSON.parse(sessionStorage.getItem("hr_dispute") || "null");

if (!ctx) {
  $("gapText").textContent = "No problem selected.";
  $("disputeForm").classList.add("hidden");
} else {
  $("gapText").textContent = ctx.gapText;
}

$("disputeForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("formError");
  err.textContent = "";
  const argument = $("argInput").value.trim();
  if (argument.length < 8) { err.textContent = "Explain your reasoning a little more."; return; }

  const btn = $("submitBtn");
  btn.disabled = true;
  btn.textContent = "RE-JUDGING…";

  try {
    const res = await fetch("/api/dispute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewId: ctx.reviewId, mode: ctx.mode, gapText: ctx.gapText, argument }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "dispute failed");

    // Persist the outcome so the results page reflects it on return.
    const outcomes = JSON.parse(sessionStorage.getItem("hr_outcomes") || "{}");
    outcomes[ctx.gapId] = { ruling: data.ruling, explanation: data.explanation, revisedText: data.revisedText };
    sessionStorage.setItem("hr_outcomes", JSON.stringify(outcomes));

    renderRuling(data);
  } catch (e2) {
    err.textContent = e2.message;
    btn.disabled = false;
    btn.textContent = "SUBMIT DISPUTE →";
  }
});

function renderRuling(data) {
  const word = { withdrawn: "WITHDRAWN", revised: "REVISED", upheld: "UPHELD" }[data.ruling] || "REVIEWED";
  $("ruling").innerHTML = `
    <div class="ruling ${data.ruling}">
      <div class="verdict-word">${word}</div>
      <p>${HR.esc(data.explanation)}</p>
      ${data.revisedText ? `<div class="revised-text"><b>Reworded:</b> ${HR.esc(data.revisedText)}</div>` : ""}
      <p style="margin-top:16px"><a class="back-link" href="/results">← back to results</a></p>
    </div>`;
  $("submitBtn").textContent = "SUBMITTED";
  $("submitBtn").disabled = true;
}
