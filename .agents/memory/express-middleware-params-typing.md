---
name: Express middleware changes req.params typing
description: Adding a middleware argument to app.get/post/patch shifts TS overload inference so req.params values become string | string[]
---

Adding a middleware (e.g. a `requireRole(...)` gate) as a second argument to `app.post(path, mw, handler)` in this codebase makes TypeScript pick a different Express overload, so `req.params.id` types as `string | string[]` instead of `string` — code that compiled without the middleware breaks with TS2345.

**Why:** Express's generic route overloads infer `Params` differently when extra `RequestHandler` args are present.

**How to apply:** When gating an existing route with middleware, wrap param usages as `String(req.params.id)` (or type the handler explicitly) and re-run `npx tsc --noEmit`.
