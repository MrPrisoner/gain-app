# Security Policy

GAIN is a self-hosted, single-operator app (`docs/ARCHITECTURE.md` §3), not a
service with customers or a compliance surface — `docs/ARCHITECTURE.md` §12,
"Toolchain, settled", records what that does and does not mean for dependency
scanning. It still handles OIDC tokens and personal
training data, so a real vulnerability is worth reporting properly rather than
filed as a public issue.

## Supported versions

There is one supported version: the latest tag on
[GHCR](https://github.com/MrPrisoner/gain-app/pkgs/container/gain), built from
the tip of `main`. This is a homelab project with one maintainer, not a
product with a support matrix — older tags do not receive backported fixes.
The fix is to update.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting rather than a public
issue:

1. Go to this repository's
   [Security tab](https://github.com/MrPrisoner/gain-app/security).
2. Click **Report a vulnerability**.

That reaches the maintainer directly and keeps the report private until a fix
ships. Everything else — bugs, feature requests — still goes through the
normal issue tracker.

## Scope

In scope: the application code in this repository (`src/`, `Dockerfile`,
`compose.yaml`, `.github/workflows/`) and how it handles OIDC tokens, session
cookies, and per-user data isolation (`docs/ARCHITECTURE.md` §3–4;
`CLAUDE.md`'s "Isolation is physical, not a WHERE clause").

Out of scope: your own deployment's reverse proxy, Authentik instance, or host
configuration — those are yours to secure, this project ships neither.
