---
name: Plexus task/project create schema null trap
description: POST /api/plexus/tasks|projects reject null for optional-but-not-nullable string fields; send undefined, not null.
---

The Plexus create routes hand-roll zod schemas (not drizzle-zod) and are asymmetric with the update schemas:

- `createTaskSchema.description` and `createProjectSchema.description` are `z.string().optional()` — **optional but NOT nullable**. Sending `description: null` returns `400 "Expected string, received null"`.
- `updateTaskSchema.description` IS `.optional().nullable()`, so update can send `null` to clear.
- Same pattern applies to any field that is `.optional()` without `.nullable()` on the create schemas.

**Why:** A frontend composer that uniformly sends `field || null` for empty inputs will silently 400 on create while working on update. The error message is generic and easy to misattribute to the wrong field.

**How to apply:** In create payloads send `undefined` (omit) for empty optional-non-nullable fields; only send `null` where the target schema is `.nullable()`. For a shared create/update payload object, default to `undefined` and override with `null` in the update branch when clear-on-edit is desired.

Note also: "My Work" view = `getTasksByAssignee` (assigned-to-me only). A task you create **unassigned** correctly does NOT appear in My Work — it shows under "Sent" (`getTasksByCreatorWithActivity`). Don't mistake this for a cache-invalidation bug.
