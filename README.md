# GAIN

Self-hosted training tracker for AI-authored exercise plans. Import a plan as
Markdown, run and log sessions from an offline-capable PWA, then export your full
plan and progress for an AI to review and revise.

> **Status: the loop closes, end to end.** Copy a bootstrap prompt into any AI chat,
> paste the plan back, and it imports. Run a full session on a phone in a garage with no
> signal — warm-ups, rest timers, per-side and ranged sets, skips, substitutions and a
> red-flag stop — and it survives a dropped connection, a locked phone or the browser
> being killed, syncing cleanly when it reconnects. Home suggests the next session;
> progress charts double progression, per-exercise and per-session-type trends and metric
> history; History drills into any past workout. A logged block leaves as one pasteable
> document, and the revision that comes back is reviewed in plain language before it is
> committed — with renamed exercises mapped onto their history rather than silently split.
> Plans archive reversibly, every version stays browsable as the document that was
> imported, a user can reset their own account, and an optional operator role sees per-user
> counts without ever reading anyone's training content.

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
and their own directory — isolation is physical, not a `WHERE` clause. An optional
operator role sees per-user counts and can reset a user's data, but no admin role can
read anyone's training _content_.

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
authentication. It is refused unless `ORIGIN` is a loopback address, so an
instance anyone else can reach will not start with that variable set — the guard
keys on `ORIGIN` rather than on `NODE_ENV`, which `node build` never sets.

### Backups

Everything mutable lives in the one volume, but a copy taken while the container is
running is not automatically a copy that restores. `control.db` and every user's
`gain.db` run in WAL mode, so at any instant some committed data sits in a `-wal`
sidecar rather than in the `.db` file itself. A `tar` or `docker cp` that reads the
two a moment apart captures a pair that never coexisted, and it restores to a state
that never existed — or fails to open at all. This is the only copy of the training
history, so take it one of these two ways rather than trusting a naive archive.

**Stop the container and copy.** The recipe to prefer for a household instance: a
stopped container has no writer, so the tree is consistent by definition, at the cost
of a few seconds of downtime.

```bash
docker compose stop gain
docker compose cp "gain:/data" "./gain-backup-$(date +%F)"
docker compose start gain
```

**Or snapshot the databases live.** `VACUUM INTO` asks SQLite for a consistent copy
of a database that is being written to, WAL and all, and writes it as one file with
no sidecars. Use it when the backup has to be scripted and the app cannot go down for
it. The runtime image ships no `sqlite3` binary, so the snippet drives the app's own
`better-sqlite3`; it copies each user's plan documents alongside, so the result is a
complete `/data` tree rather than loose databases.

```bash
docker compose exec -T gain node -e '
  const fs = require("fs"), path = require("path");
  const Database = require("better-sqlite3");
  const data = process.env.DATA_DIR || "/data";
  const out = path.join(data, "backups", new Date().toISOString().slice(0, 10));
  fs.rmSync(out, { recursive: true, force: true });
  const usersDir = path.join(data, "users");
  const users = fs.existsSync(usersDir) ? fs.readdirSync(usersDir) : [];
  for (const rel of ["control.db", ...users.map((u) => path.join("users", u, "gain.db"))]) {
    fs.mkdirSync(path.join(out, path.dirname(rel)), { recursive: true });
    const db = new Database(path.join(data, rel), { readonly: true });
    db.prepare("VACUUM INTO ?").run(path.join(out, rel));
    db.close();
  }
  for (const user of users) {
    const from = path.join(usersDir, user, "plans");
    if (fs.existsSync(from))
      fs.cpSync(from, path.join(out, "users", user, "plans"), { recursive: true });
  }
  console.log(out);
'
docker compose cp "gain:/data/backups/$(date +%F)" "./gain-backup-$(date +%F)"
docker compose exec -T gain rm -rf "/data/backups/$(date +%F)"
```

The snapshot is written inside the volume and then copied out because the container
runs as an unprivileged user that owns `/data` and nothing else; deleting it
afterwards stops the next backup from including the last one.

**Restoring** replaces the volume's contents wholesale, with the app stopped:

```bash
docker compose down
docker compose run --rm --no-deps -v "$PWD/gain-backup-2026-08-27:/restore:ro" \
  --entrypoint sh gain -c 'rm -rf /data/* && cp -a /restore/. /data/'
docker compose up -d
```

Restore a backup as a whole tree, never file by file: a cold copy may contain `-wal`
and `-shm` files, and a `.db` separated from the sidecar that sat beside it is the
same torn pair this section exists to avoid. A live snapshot has no sidecars at all,
which is normal — `VACUUM INTO` folds the WAL into the file it writes.

A backup nobody has opened is a hypothesis. SQLite will check one for you, against
the copy rather than the original:

```bash
docker compose exec -T gain node -e 'const D = require("better-sqlite3");
  console.log(new D(process.argv[1], { readonly: true }).pragma("integrity_check"));
' /data/backups/2026-08-27/control.db
```

## Documentation

|                                                |                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Design, decisions, data model, deployment                          |
| [`docs/CONTRACT.md`](docs/CONTRACT.md)         | The plan format an AI must produce                                 |
| [`docs/UI-DECISIONS.md`](docs/UI-DECISIONS.md) | How the session runner behaves, and why                            |
| [`CLAUDE.md`](CLAUDE.md)                       | Guidance for AI agents working in this repository                  |
| [`SECURITY.md`](SECURITY.md)                   | Supported versions, and how to report a vulnerability              |
| [`design/`](design/)                           | A clickable mockup of the session runner — open it in a browser    |
| [`fixtures/plans/`](fixtures/plans/)           | A complete reference plan                                          |
| [`templates/`](templates/)                     | The two prompts GAIN hands to an AI — author a plan, revise a plan |

## Licence

[GNU Affero General Public License v3.0](LICENSE).

If you run a modified version of GAIN as a network service, AGPL §13 requires you to
offer its source to your users. Self-hosting it unmodified for yourself, your household
or your friends carries no such obligation — run it however you like.

Copyright © 2026 Andrie Schoombee
