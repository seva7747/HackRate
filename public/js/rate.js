const $ = (id) => document.getElementById(id);

// Question sets. Criteria is always first. Kept to <=5 per mode.
const QUESTIONS = {
  idea: [
    {
      key: "criteria", type: "textarea", optional: true,
      title: 'What is this hackathon <span class="serif">judging on?</span>',
      hint: "Its theme, rubric, or sponsor requirements — this becomes your Criteria Fit score. Leave blank if it's totally open-ended.",
      placeholder: "e.g. Judged on social impact & accessibility. Must use the Acme API. Bonus for real-time features.",
    },
    {
      key: "oneliner", type: "text", min: 5,
      title: "In one sentence, what are you building?",
      hint: "The elevator pitch — just the core of it.",
      placeholder: "An app that turns a photo of your fridge into recipes you can cook tonight.",
    },
    {
      key: "problem", type: "textarea", min: 10,
      title: "What problem does it solve — and who has it?",
      hint: "The pain point, and the person who actually feels it.",
      placeholder: "Busy people waste food and money because they never know what to cook with what's already in the fridge.",
    },
    {
      key: "how", type: "textarea", min: 10,
      title: "How does it work?",
      hint: "The core flow, start to finish. No code — just the concept.",
      placeholder: "Snap a photo → a vision model detects the ingredients → it ranks recipes by fewest missing items.",
    },
    {
      key: "standout", type: "textarea", optional: true,
      title: "What would you <span class=\"serif\">demo</span>?",
      hint: "The wow moment a judge would remember. Optional but it sharpens the score.",
      placeholder: "Live: point a phone at a real fridge and get a cookable recipe in under 5 seconds.",
    },
  ],
  project: [
    {
      key: "criteria", type: "textarea", optional: true,
      title: 'What is this hackathon <span class="serif">judging on?</span>',
      hint: "Its theme, rubric, or sponsor requirements — this becomes your Criteria Fit score.",
      placeholder: "e.g. Judged on social impact & accessibility. Must use the Acme API.",
    },
    {
      key: "url", type: "text", min: 4, isUrl: true,
      title: "What's the URL of your <span class=\"serif\">built</span> project?",
      hint: "HackRate crawls the landing page AND its sub-pages, so features on other pages aren't missed.",
      placeholder: "https://your-project.vercel.app",
    },
    {
      key: "pitch", type: "textarea", optional: true,
      title: "What did you set out to build?",
      hint: "So judges can flag what's missing vs. the plan. Optional — pulled from your idea check if you ran one.",
      placeholder: "A fridge-to-recipe app that ranks meals by fewest missing ingredients.",
    },
  ],
};

let mode = new URLSearchParams(location.search).get("mode") === "project" ? "project" : "idea";
let steps = [];        // question configs for current mode
let answers = {};      // key -> value
let idx = 0;
let animating = false;
const lastReviewId = sessionStorage.getItem("hr_last_idea_review") || "";

buildQuiz();

function buildQuiz() {
  steps = QUESTIONS[mode];
  answers = {};
  idx = 0;
  $("modeTag").textContent = mode === "project" ? "BUILD REVIEW" : "IDEA CHECK";
  $("quizEyebrow").textContent = mode === "project" ? "REVIEW YOUR BUILD" : "THE BEFORE-YOU-BUILD CHECK";
  $("quizSwitch").innerHTML =
    mode === "project"
      ? 'Reviewing a finished build · <a id="switchMode">rate an idea instead →</a>'
      : 'Rating an idea · <a id="switchMode">reviewing a finished build? →</a>';
  $("switchMode").addEventListener("click", () => { mode = mode === "idea" ? "project" : "idea"; buildQuiz(); });

  const host = $("quizSteps");
  host.replaceChildren();
  steps.forEach((q, i) => {
    const el = document.createElement("div");
    el.className = "qstep" + (i === 0 ? " active" : "");
    el.dataset.index = i;
    const tag = q.type === "textarea" ? "textarea" : "input";
    const attrs = q.type === "textarea" ? 'rows="4"' : 'type="text"';
    el.innerHTML = `
      <div class="qnum">QUESTION ${i + 1}${q.optional ? ' · <span class="qopt">OPTIONAL</span>' : ""}</div>
      <h2 class="qtitle">${q.title}</h2>
      <p class="qhint">${q.hint}</p>
      <${tag} class="quiz-input" id="q_${q.key}" ${attrs} placeholder="${q.placeholder.replace(/"/g, "&quot;")}"></${tag}>`;
    host.appendChild(el);
  });

  updateChrome();
  setTimeout(() => focusCurrent(), 60);
}

function currentEl() { return $("quizSteps").children[idx]; }
function inputEl(i = idx) { return document.getElementById(`q_${steps[i].key}`); }

function updateChrome() {
  $("stepCount").textContent = `${idx + 1} / ${steps.length}`;
  $("quizBar").style.width = `${((idx + 1) / steps.length) * 100}%`;
  $("backBtn").classList.toggle("invisible", idx === 0);
  const last = idx === steps.length - 1;
  $("nextBtn").textContent = last ? (mode === "project" ? "REVIEW THE BUILD →" : "SEND TO THE JUDGES →") : "NEXT →";
  const q = steps[idx];
  $("enterTip").textContent = q.type === "textarea" ? "Shift+Enter for a new line · Enter to continue" : "Press Enter to continue";
}

function focusCurrent() { const el = inputEl(); if (el) el.focus(); }

function validateCurrent() {
  const q = steps[idx];
  const val = (inputEl().value || "").trim();
  if (q.optional && !val) return true;
  if (!val) return err("This one's needed to judge fairly.");
  if (q.min && val.length < q.min) return err("A little more detail, please.");
  if (q.isUrl && !/^([a-z]+:\/\/)?[\w.-]+\.[a-z]{2,}/i.test(val)) return err("That doesn't look like a URL.");
  return true;
}
function err(msg) { $("formError").textContent = msg; return false; }

function go(target) {
  if (animating || target < 0 || target >= steps.length) return;
  answers[steps[idx].key] = (inputEl().value || "").trim();
  $("formError").textContent = "";
  const dir = target > idx ? "fwd" : "back";
  const cur = currentEl();
  const nxt = $("quizSteps").children[target];
  animating = true;

  cur.classList.remove("active");
  cur.classList.add(dir === "fwd" ? "exit-left" : "exit-right");
  nxt.classList.remove("exit-left", "exit-right", "enter-left", "enter-right");
  nxt.classList.add(dir === "fwd" ? "enter-right" : "enter-left");

  requestAnimationFrame(() => requestAnimationFrame(() => {
    nxt.classList.remove("enter-right", "enter-left");
    nxt.classList.add("active");
  }));

  idx = target;
  updateChrome();
  setTimeout(() => { animating = false; focusCurrent(); }, 460);
}

function next() {
  if (!validateCurrent()) return;
  if (idx < steps.length - 1) go(idx + 1);
  else submit();
}

function submit() {
  answers[steps[idx].key] = (inputEl().value || "").trim();
  const criteria = answers.criteria || "";
  let payload;
  if (mode === "idea") {
    const idea = [
      answers.oneliner,
      answers.problem && `Problem & who it's for: ${answers.problem}`,
      answers.how && `How it works: ${answers.how}`,
      answers.standout && `What I'd demo: ${answers.standout}`,
    ].filter(Boolean).join("\n\n");
    payload = { endpoint: "/api/review-idea", mode, body: { idea, criteria } };
  } else {
    payload = {
      endpoint: "/api/review-project", mode,
      body: { url: answers.url, criteria, originalIdea: answers.pitch || "", reviewId: lastReviewId },
    };
  }
  sessionStorage.setItem("hr_run", JSON.stringify(payload));
  location.href = "/results";
}

$("nextBtn").addEventListener("click", next);
$("backBtn").addEventListener("click", () => go(idx - 1));
$("quizForm").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  // Enter advances; in a textarea only plain Enter (Shift+Enter = newline).
  if (e.target.tagName === "TEXTAREA" && e.shiftKey) return;
  e.preventDefault();
  next();
});
