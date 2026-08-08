# Gain

Self-hosted training tracker for AI-authored exercise programmes. Import a programme as
Markdown, run and log sessions from an offline-capable PWA, then export your full
programme and progress for an AI to review and revise.

> **Status: design stage.** This repository currently contains the architecture, the
> programme specification, a reference fixture and a template. There is no application
> code yet and nothing to deploy.

---

## Health disclaimer

**Gain is a logging tool, not a source of medical or fitness advice.**

Programmes tracked in this app are written by general-purpose AI assistants, which are
not clinicians, do not examine you, and can be confidently wrong. Nothing produced by
this software or by an AI using its exports constitutes medical advice, diagnosis or
treatment.

Exercise carries risk of injury. If you have pain, an existing injury, a medical
condition, or you are unsure whether an activity is appropriate for you, consult a
qualified healthcare professional — and follow their guidance over anything an AI
suggests. Stop exercising and seek medical attention for chest pain, breathlessness,
dizziness, or sharp, escalating or radiating pain.

You are responsible for what you choose to do with the programmes you track here.

---

## What it is

Gain sits in the middle of a loop that otherwise has no memory:

```
AI chat  ──md──►  import  ──►  train & log  ──►  export  ──md──►  AI chat
(external)      (structured)   (offline PWA)   (bundle)         (external)
```

You compile a programme by chatting with an AI somewhere else. Gain imports that
Markdown, turns it into sessions you can actually run on your phone in the garage, and
records what you did. When the block ends, it exports a single Markdown file — the
programme in full, plus your progress — that you paste back into an AI to get the next
revision.

**Gain never talks to an AI itself.** No API keys, no in-app chat, no LLM in any code
path. You keep using whichever assistant you prefer, and no third party sits between you
and your training data.

### What it does

- **Import** an AI-authored programme from Markdown, with a diff review before anything
  is committed. Programme versions are immutable, so past sessions stay attached to the
  programme that prescribed them.
- **Run a session** from a mobile-first PWA: exercises in sequence, current one
  highlighted, targets pre-filled from last time, rest timers, and one-tap logging of
  reps, weight and difficulty. Works offline — a dropped connection or a locked phone
  never costs you a workout.
- **Deviate honestly.** Skip, substitute, or add sets mid-session with a reason
  recorded. A programme that adapts to a bad day produces better data than one you
  silently abandon.
- **Track progress** per exercise and per session, including any custom metrics your
  programme declares — effort, technique, symptoms, energy, whatever it asks for.
- **Export** a self-contained Markdown bundle: your editable instructions to the AI, the
  programme context verbatim, a computed progress summary, and the raw logs as CSV.

### How it's built

Self-hosted as a single container behind your own reverse proxy. Authentication via
Authentik (OIDC), with access gated on a group. Each user gets their own SQLite database
and their own directory — isolation is physical, not a `WHERE` clause, and there is no
admin role that can read anyone's training data.

TypeScript, SvelteKit, SQLite. One image, one port, one volume.

## Documentation

| | |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Design, decisions, data model, build order |
| [`docs/CONTRACT.md`](docs/CONTRACT.md) | The programme format an AI must produce |
| [`fixtures/programmes/`](fixtures/programmes/) | A complete reference programme |
| [`templates/`](templates/) | Default instructions sent to the reviewing AI |

## Licence

[GNU Affero General Public License v3.0](LICENSE).

If you run a modified version of Gain as a network service, AGPL §13 requires you to
offer its source to your users. Self-hosting it unmodified for yourself, your household
or your friends carries no such obligation — run it however you like.

Copyright © 2026 Andrie Schoombee
