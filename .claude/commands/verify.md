---
description: Run the full check suite — typecheck, lint, format, tests
allowed-tools: Bash(npm run verify), Bash(npm run *)
---

Run `npm run verify` and report the result.

This is typecheck → lint → format:check → tests, the same four checks CI runs, in the
same order. The whole thing takes about three seconds, so run it before claiming work is
done rather than reasoning about whether it would pass.

If it fails, fix the failure and run it again. Do not report success on a partial pass:
`verify` short-circuits, so a lint failure means the tests never ran.
