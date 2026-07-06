---
name: Secret deletion via deleteEnvVars is a no-op
description: Removing secrets (not plain env vars) programmatically does not actually delete them
---

`deleteEnvVars({ keys: [...] })` returns a success payload echoing the requested keys
even for **secrets**, but the secrets are NOT actually removed — a follow-up
`viewEnvVars({ type: "secret", keys })` still shows them as `true`.

**Why:** The platform's programmatic env API manages plain environment variables;
secrets are a separate store and can only be deleted by the user in the Secrets UI.

**How to apply:** When a task requires deleting a *secret*, do not rely on
`deleteEnvVars`. Verify with `viewEnvVars` and, if it persists, tell the user to
remove it manually in the Secrets pane. The code no longer reading the secret is
what actually matters for "never used at runtime."
