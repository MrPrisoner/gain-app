# GAIN

Self-hosted training tracker for AI-authored exercise plans. Import a plan as
Markdown, run and log sessions from an offline-capable PWA, then export your full
plan and progress for an AI to review and revise.

> **Status: phase 5 of 8.** The round-trip core (contract parser, diff engine, export
> generator, prompt templates), the per-user storage layer, the web app, the session
> runner and the export UI are built: OIDC sign-in against Authentik, the container,
> first run — copy a bootstrap prompt into any AI chat, paste the plan back, and it
> imports — a full session of a real plan logged on a phone, rest timers and deviations
> included, and a logged block leaving GAIN as one pasteable document for the next AI
> review. Offline sync, progress charts and revision diff review are still ahead — see
> [`docs/ROADMAP.md`](docs/ROADMAP.md).

---

## Health disclaimer

**GAIN is a logging tool, not a source of medical or fitness advice.**

Plans tracked in this app are written by general-purpose AI assistants, which are
not clinicians, do not examine you, and can be confidently wrong. Nothing produced by
this software or by an AI using its exports constitutes medical advice, diagnosis or
treatment.

Exercise carries risk of injury. If you have pain, an existing injury, a medical
condition, or you are unsure whether an activity is appropriate for you, consult a
qualified healthcare professional — and follow their guidance over anything an AI
suggests. Stop exercising and seek medical attention for chest pain, breathlessness,
dizziness, or sharp, escalating or radiating pain.

You are responsible for what you choose to do with the plans you track here.

---

## What it is

GAIN sits in the middle of a loop that otherwise has no memory:

```
AI chat  ──md──►  import  ──►  train & log  ──►  export  ──md──►  AI chat
(external)      (structured)   (offline PWA)   (bundle)         (external)
```

You compile a plan by chatting with an AI somewhere else. GAIN imports that
Markdown, turns it into sessions you can actually run on your phone in the garage, and
records what you did. When the block ends, it exports a single Markdown file — the
plan in full, plus your progress — that you paste back into an AI to get the next
revision.

**The AI is in the name, not in the code.** G‑**AI**‑N is spelled that way on purpose:
AI sits on both ends of this loop and nowhere inside it. It writes your plan and it
revises it — but GAIN itself never talks to an AI. No API keys, no in-app chat, no LLM
in any code path. You keep using whichever assistant you prefer, and no third party sits
between you and your training data.

### What it does

- **Import** an AI-authored plan from Markdown, with a diff review before anything
  is committed. Plan versions are immutable, so past sessions stay attached to the
  plan that prescribed them.
- **Run a session** from a mobile-first PWA: exercises in sequence, current one
  highlighted, targets pre-filled from last time, rest timers, and one-tap logging of
  reps, weight and difficulty. Works offline — a dropped connection or a locked phone
  never costs you a workout.
- **Deviate honestly.** Skip, substitute, or add sets mid-session with a reason
  recorded. A plan that adapts to a bad day produces better data than one you
  silently abandon.
- **Track progress** per exercise and per session, including any custom metrics your
  plan declares — effort, technique, symptoms, energy, whatever it asks for.
- **Export** a self-contained Markdown bundle: your editable instructions to the AI, the
  plan context verbatim, a computed progress summary, and the raw logs as CSV.

### How it's built

Self-hosted as a single container behind your own reverse proxy. Authentication via
Authentik (OIDC), with access gated on a group. Each user gets their own SQLite database
and their own directory — isolation is physical, not a `WHERE` clause, and there is no
admin role that can read anyone's training data.

TypeScript, SvelteKit, SQLite. One image, one port, one volume.

## Running it

One image, one container, one port, one volume:

```bash
cp .env.example .env # fill in ORIGIN, the OIDC_* values and SESSION_SECRET
docker compose up -d --build
```

Register `${ORIGIN}/auth/callback` as the redirect URI of the Authentik
OAuth2/OpenID provider, and gate access with the group named by
`OIDC_REQUIRED_GROUP`. `/healthz` answers without authentication for uptime
checks, and the container logs the effective origin and redirect URI at
startup so a proxy misconfiguration is easy to spot.

For local development without an IdP, `GAIN_DEV_USER=you npm run dev` bypasses
authentication — a production build refuses to start with that variable set.

## Documentation

|                                                |                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Design, decisions, data model, build order                         |
| [`docs/ROADMAP.md`](docs/ROADMAP.md)           | What is left to build, and what proves each piece done             |
| [`docs/CONTRACT.md`](docs/CONTRACT.md)         | The plan format an AI must produce                                 |
| [`docs/UI-DECISIONS.md`](docs/UI-DECISIONS.md) | How the session runner behaves, and why                            |
| [`design/`](design/)                           | A clickable mockup of the session runner — open it in a browser    |
| [`fixtures/plans/`](fixtures/plans/)           | A complete reference plan                                          |
| [`templates/`](templates/)                     | The two prompts GAIN hands to an AI — author a plan, revise a plan |

## Licence

[GNU Affero General Public License v3.0](LICENSE).

If you run a modified version of GAIN as a network service, AGPL §13 requires you to
offer its source to your users. Self-hosting it unmodified for yourself, your household
or your friends carries no such obligation — run it however you like.

Copyright © 2026 Andrie Schoombee
