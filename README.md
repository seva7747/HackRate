# HackRate

Run a hackathon idea (or a finished project URL) past **four independent AI judges** —
each with a different job — and get one honest score out of 10 for whether the **idea itself
would work**, plus a Criteria Fit score for your hackathon's theme and the concrete gaps
worth fixing. Disagree with a flag? Dispute it.

HackRate judges the **idea**, not your code: it never nitpicks implementation you haven't
written (error handling, rate limits, auth, tests). The one tech exception it will flag is an
idea that depends on a capability/AI that doesn't exist or is prohibitively expensive.

## Pages (each workflow is its own page)

| Route | What it is |
|-------|-----------|
| `/` | Long marketing landing page (hero + how-it-works + judges + rubric + disputes + CTA) |
| `/rate` | Input page — idea **or** built-project URL, plus the hackathon's **criteria** |
| `/results` | Live judging (each API flips spinner → checkmark) then the aggregated verdict |
| `/dispute` | Contest a single flagged problem; a reasoning model re-rules it |

## The panel — four judges who disagree on purpose

| Judge | Provider | Role |
|-------|----------|------|
| Speed Judge | Groq (Llama 3.3 70B) | blunt feasibility & scope reality-check |
| Variety Judge | OpenRouter (rotating `:free` models) | novelty & market-precedent |
| Throughput Judge | Cerebras | second opinion on difficulty & realism (optional) |
| Depth Judge | Mistral | ambiguity / underspecification |

All four score **in parallel** against the same rubric, then scores are aggregated
**deterministically**. Any judge that fails or returns junk is marked *unavailable*
rather than crashing the run.

## The rubric — fixed, idea-level, plus a Criteria Fit score

HackRate scores every idea on a fixed idea-level rubric (problem clarity, novelty,
feasibility in a hackathon, target-user clarity, usefulness, market precedent, demo-ability,
wow factor, scope realism, tech realism, ethics) — see [src/rubric.js](src/rubric.js). It's
about whether the **concept** works, not implementation.

The hackathon's **criteria** feed a dedicated `criteria_fit` dimension that rates how well
the idea follows the stated theme/rubric — surfaced as its own **Criteria Fit** section on
the results page.

## Disputes

Every flagged problem has a **Dispute** button on hover. It opens `/dispute`, you argue
your case, and a reasoning model re-reads the project and rules **withdrawn**, **revised**,
or **upheld** — it won't cave without substance. The outcome is reflected back on the
results page. See [src/judges.js](src/judges.js) `adjudicateDispute`.

## Better site reading (Part 2)

The crawler follows same-origin internal links (nav / product / pricing / about / docs)
up to `MAX_CRAWL_PAGES` (default 6), so a feature living on a sub-page isn't mistaken for
"missing" or "false advertising". Judges are told a feature is only missing if it's absent
from **all** crawled pages. See [src/scrape.js](src/scrape.js).

## Setup

```
npm install
npm start          # http://localhost:3000  (npm run dev = auto-reload)
```

`.env` (already present, git-ignored):
```
GROQ_API_KEY=...
OPEN_ROUTE_API_KEY=...
CEREBRAL_API_KEY=...
MISTRAL_API_KEY=...
```
Optional: `PORT`, `CALL_TIMEOUT_MS`, `MAX_CRAWL_PAGES`.

## Run it from GitHub (Codespaces)

HackRate is a Node server, so GitHub **Pages** can't run it (Pages is static-only, and
your keys must stay server-side). GitHub **Codespaces** runs the whole app in the cloud and
gives you a shareable link. This repo ships a `.devcontainer/` so it auto-installs and starts.

1. **Add your keys as Codespaces secrets** (so they never touch the repo):
   GitHub → this repo → **Settings → Secrets and variables → Codespaces → New repository secret**.
   Add each of: `GROQ_API_KEY`, `OPEN_ROUTE_API_KEY`, `CEREBRAL_API_KEY`, `MISTRAL_API_KEY`.
   Codespaces injects them as environment variables — the app reads `process.env` directly.
2. **Open a Codespace**: green **Code** button → **Codespaces** → **Create codespace on main**.
   It runs `npm install`, then `npm start` automatically.
3. **Get the link**: when port **3000** forwards, open the **Ports** tab, and (to share it)
   right-click port 3000 → **Port Visibility → Public**. That forwarded URL
   (`https://<name>-3000.app.github.dev`) is your live site.

> The Codespace only serves while it's running (it sleeps when you close it), and the URL is
> temporary. For a permanent 24/7 link, deploy the same repo to a Node host (Render, Railway,
> Fly.io) and set the four keys as env vars there — no code change needed.

## Architecture

```
server.js              Express: page routes + streaming NDJSON endpoints + /api/dispute
src/
  config.js            Providers (base URL, key env, fallback models), judge roles, REASONING_CHAIN
  callModel.js         Generic OpenAI-compatible caller + callReasoning() fallback chain
  rubric.js            The fixed idea-level rubric (DIMENSIONS) + the criteria_fit dimension
  prompts.js           Prompt builders (idea / project / meta / dispute) + safe JSON extraction
  aggregate.js         Score validation, weighted overall, gap/shine merge w/ provenance
  judges.js            Parallel panel -> aggregate -> verdict; dispute adjudication
  scrape.js            Multi-page same-origin crawler -> readable text
public/
  index.html rate.html results.html dispute.html
  style.css
  js/ common.js landing.js rate.js results.js dispute.js
```

### API endpoints
- `GET  /api/judges` — the panel lineup.
- `POST /api/review-idea` — `{ idea, criteria }` → streams NDJSON (`rubric`, `judge_start/done`, `result`).
- `POST /api/review-project` — `{ url, criteria, reviewId?, originalIdea? }` → crawls + streams.
- `POST /api/dispute` — `{ reviewId, gapText, argument }` → `{ ruling, explanation, revisedText }`.

## Notes on free tiers
Free model catalogs churn. Each provider has an ordered fallback list in
[src/config.js](src/config.js); if the first model 404s or rate-limits, the caller tries the
next. Re-verify live names by hitting each provider's `/v1/models`. `.env` is git-ignored —
don't commit keys.
