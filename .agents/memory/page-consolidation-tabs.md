---
name: Consolidating pages into Radix Tabs
description: Latent per-page crashes (esp. Radix Select empty-value) surface when embedding whole pages as tab panels; smoke-test every tab.
---

# Embedding whole pages as Radix Tabs panels

When unifying many standalone routes into one tabbed page by embedding each
page's default export verbatim inside `<TabsContent>`, latent runtime crashes
that were rarely hit on the standalone route get surfaced as soon as that tab
(or its first sub-tab) mounts.

**Concrete trap:** a Radix `<SelectItem value="">` throws
`A <Select.Item /> must have a value prop that is not an empty string`. On a
standalone page this may only fire when the dropdown opens; once the page is a
tab panel it mounts with the tab and crashes the whole tab into the Vite error
overlay. Fix pattern: use a sentinel value like `"all"` for the "no filter"
option and treat that sentinel as "unset" in the filter/query logic (default
state and the SelectItem value both become the sentinel).

**Why:** Radix forbids empty-string item values (empty string is reserved for
clearing the Select). The bug is invisible until the component actually renders.

**How to apply:** After building/embedding a multi-tab consolidation, run an
e2e pass that clicks EVERY tab and sub-tab (not just the default one) and opens
each filter dropdown. tsc + HMR will NOT catch these — they are runtime-only.
For session-auth apps the e2e test can seed a temp admin via a `[DB]` INSERT
with a bcryptjs hash (the app uses `bcryptjs`, not native `bcrypt`), then log in
through `/api/auth/login`, and `DELETE` the user at the end.
