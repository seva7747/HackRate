// Shared helpers across HackRate pages.
window.HR = {
  esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  },
  truncate(s, n) { return s && s.length > n ? s.slice(0, n) + "…" : s; },

  // Default lineup; overwritten by /api/judges when available.
  JUDGES: [
    { id: "groq", label: "Groq", title: "Speed Judge" },
    { id: "openrouter", label: "OpenRouter", title: "Variety Judge" },
    { id: "cerebras", label: "Cerebras", title: "Throughput Judge" },
    { id: "mistral", label: "Mistral", title: "Depth Judge" },
  ],

  async loadJudges() {
    try {
      const res = await fetch("/api/judges");
      const data = await res.json();
      if (Array.isArray(data.judges) && data.judges.length) this.JUDGES = data.judges;
    } catch { /* keep defaults */ }
    return this.JUDGES;
  },

  buildMarquee(el) {
    const names = this.JUDGES.map((j) => j.label);
    const track = document.createElement("div");
    track.className = "marquee-track";
    [...names, ...names].forEach((n) => {
      const span = document.createElement("span");
      span.className = "marquee-item";
      span.textContent = n;
      track.appendChild(span);
    });
    el.replaceChildren(track);
  },

  CHECK_SVG: `<svg class="check" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`,
  X_SVG: `<svg class="icon-x" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>`,
};
