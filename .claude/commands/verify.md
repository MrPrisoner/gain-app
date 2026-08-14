---
description: Run the full check suite — typecheck, svelte-check, lint, format, tests, build
allowed-tools: Bash(npm run verify), Bash(npm run *)
---

Run `npm run verify` and report the result.

This is typecheck → check (svelte-check) → lint → check:chars → format:check → tests →
build, the same chain CI runs, in the same order. The whole thing takes a few seconds, so
run it before claiming work is done rather than reasoning about whether it would pass.
The build is in there because typecheck and svelte-check do not exercise the adapter, the
`?raw` asset imports or the Vite config — code that passes both and still cannot ship is
a real failure mode here, not a hypothetical one.

If it fails, fix the failure and run it again. Do not report success on a partial pass:
`verify` short-circuits, so a lint failure means the tests never ran.
