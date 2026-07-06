---
name: Per-user localStorage persistence key-switch
description: Avoiding cross-user data leak in React hooks that persist to localStorage keyed by an async-resolved user id.
---

When a hook persists state to `localStorage` under a per-user key that only
resolves after an async `/api/auth/me` query (i.e. the key is `null` on first
render, then becomes the user id), the load/persist effect must handle the
key transition carefully.

**The rule:** on every `storageKey` change, resolve state FROM that key's saved
data — parsed array if present, otherwise `[]`. Update the write-through key ref
in the same effect. The ONLY carry-forward is the very first bind
(`null -> firstKey`): adopt any pre-auth in-memory state once, and persist it to
the new bucket.

**Why:** if the load effect keeps prior in-memory state when the new key has no
saved data (e.g. `if (raw) setState(parsed)` with no else), and it eagerly
switches the persist key ref, the next mutation writes user A's data into user
B's bucket. This is a real cross-user data-isolation leak, not just a UI glitch.
It surfaces on any A→B(no data) key transition (view-as, re-login, account
switch).

**How to apply:** read current state via the `setState(prev => …)` functional
form inside the effect so the carry-forward decision sees fresh state; validate
the parsed payload shape before trusting it (never trust localStorage blindly).
Seen in the Team Portal `useWorkspaceWidgets` sticky-notes persistence.
