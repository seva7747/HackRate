# HackRate Agents — how the three-agent team connects

HackRate is wrapped by three **Kylon agents** that automate reviewing, planning, and
fixing on every pull request. This doc explains what each agent does, what it connects
to, and how to set it up from scratch.

## The team at a glance

| Agent | Job | Fires on |
|-------|-----|----------|
| **Nora** | Reviews each PR against the criteria; posts a comment, emails you, and records each problem | GitHub webhook (instant) |
| **Max** | Turns each recorded problem into a ranked GitHub issue + a task list | 10-min poll |
| **Fixer** | Comments a concrete "💡 Suggested fix" on each issue | 10-min poll |

Flow: **PR opened → Nora judges → Max plans → Fixer suggests fixes** — all hands-free.

> **Platform limit:** Kylon scheduled workflows can't run faster than every 10 minutes,
> so Max and Fixer each poll on a 10-min floor. Budget up to ~20 min for the whole chain
> to finish after a PR opens. This is a platform cap, not a setting.

## How the agents "talk" — the shared table

Agents don't message each other. They hand off work through a shared **data app** (table)
called **Review Findings**, living in the `#hackrate` Kylon channel:

- **Nora writes** one record per problem (`status = new`).
- **Max reads** new records, creates issues, marks them `issue_created`.
- **Fixer reads** the GitHub issues Max created and comments a fix.

Think of it as a shared to-do list, not a conversation.

## What connects to what

- **GitHub** (`@seva7747`) — all three agents use it: Nora reads PR files + writes comments,
  Max creates issues, Fixer reads issues/PR files + comments.
- **Gmail** — only Nora sends email, via **SMTP + a Gmail app password** stored as a Kylon
  workspace secret (`GMAIL_APP_PASSWORD`). This is the only path that truly auto-sends;
  the built-in Gmail connection always requires a manual approval tap.
- **HackRate API** (on Render, `https://hackrate.onrender.com`) — the "brain":
  - `POST /api/review-pr` — Nora calls this to score a PR (4 judges → gaps + score).
  - `POST /api/suggest-fix` — Fixer calls this to turn one gap into a concrete fix.

## The criteria

The hackathon criteria lives in **`hackrate-criteria.txt`** in the repo root, read from the
**`main`** branch on every review (never the PR's own branch — so a PR can't soften its own
score). Edit that file to change the bar; blank/missing → falls back to general fundamentals.

## Setup from scratch

### 0. Prereqs
- HackRate deployed on Render with the 4 judge keys set in its **Environment** tab
  (`GROQ_API_KEY`, `OPEN_ROUTE_API_KEY`, `CEREBRAL_API_KEY`, `MISTRAL_API_KEY`).
- A Kylon workspace with GitHub connected as `@seva7747`.
- A `#hackrate` Kylon channel (Nora + Max + Fixer are members).

### 1. Nora — the reviewer
- Register a **GitHub webhook** on the repo (Settings → Webhooks) pointing at Nora's
  workflow URL, `application/json`, **Pull request** events only.
- Nora's workflow, per PR: fetch changed files → read `hackrate-criteria.txt` from `main`
  → `POST /api/review-pr` → post PR comment → SMTP-email the summary → **write one
  `review_findings` record per gap** (`source_pr`, `gap_summary`, `gap_detail`, `criteria`,
  `severity`, `status` left unset → defaults to `new`).

### 2. Max — the planner
- Watches `review_findings` (10-min poll). For each `status = new` row: create a GitHub
  issue labeled `hackrate-review` (title = short gap, body = detail + PR + criteria),
  mark the row `issue_created`, then post/email a "New tasks from PR #N" list, ordered by
  severity.

### 3. Fixer — the fix advisor
- Watches open `hackrate-review` issues without a Fixer comment (10-min poll). For each:
  read the gap + source PR + criteria, fetch that PR's changed files, `POST /api/suggest-fix`,
  then post the response as a **💡 Suggested fix** comment (summary, steps, code sketch).
  Never comments twice.

## API contracts

`POST /api/review-pr`
```json
// request
{ "prTitle": "...", "criteria": "...", "originalIdea": "...",
  "files": [{ "filename": "...", "patch": "..." }] }
// response
{ "score": 6.3, "criteriaFit": 5.3, "verdict": "...", "topPriority": "...",
  "gaps": ["..."], "shines": ["..."], "judges": ["groq","openrouter","cerebras","mistral"] }
```

`POST /api/suggest-fix`
```json
// request
{ "gap": "...", "criteria": "...", "files": [{ "filename": "...", "content": "..." }] }
// response
{ "summary": "...", "steps": ["..."], "file": "src/...", "codeSketch": "..." }
```

## Known limits
- 10-minute minimum on scheduled polls (Max, Fixer) — platform cap.
- Render free tier sleeps after ~15 min idle; first PR after a nap waits ~30–60s to wake.
  A free uptime monitor pinging the URL every 5 min keeps it warm.
- Only Nora emails (SMTP). Fixer/Max post to GitHub + the channel.
