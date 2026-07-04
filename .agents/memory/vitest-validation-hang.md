---
name: Vitest validation install-prompt hang
description: Why the registered `test` validation step can silently stall and how to fix it
---
The registered `test` validation runs `npx vitest run`. If `vitest` is missing from node_modules (dependency sync drift after merges/rollbacks), npx prompts "Ok to proceed? (y)" and the validation stalls in RUNNING forever instead of failing.

**Why:** npx auto-installs on a TTY prompt; validation infra never answers it.

**How to apply:** if `mark_task_complete` reports the `test` step stuck RUNNING with an install prompt in its log, check `node_modules/.bin` for vitest and reinstall via the packager (`installLanguagePackages`, language "nodejs") — plain package-manager shell commands are blocked by the bash tool. Then rerun `npx vitest run` to confirm before re-marking complete.
