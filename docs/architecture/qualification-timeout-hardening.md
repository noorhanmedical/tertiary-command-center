# Qualification timeout hardening

**Status:** Phase 1 reliability hotfix (review-only branch).
**Companion:** `scripts/qa-qualification-timeout-hardening.mjs`,
`scripts/smoke-qualification-timeout-hardening.mjs`.

## Old failure mode

Plexus IQ qualification was timing out on Replit / behind proxies even
though the runtime work itself completed successfully. Two surfaces
were holding the browser/proxy connection open while OpenAI ran:

1. **`POST /api/patients/:id/analyze` (legacy single-patient)** — the
   handler `await`ed `screenSinglePatientWithAI(...)` before
   responding. If OpenAI took 45–60s the proxy could close the socket;
   the browser surfaced a generic "Analysis failed" even though the
   server kept running and eventually persisted results.
2. **`POST /api/batches/:id/analyze` (Batch Generate)** — the handler
   *did* send `res.json({...})` early, but then `await`ed the
   `batchProcess` loop on the same request scope, duplicating the
   logic in `batchAnalysisRunner.ts`. The runner is the canonical
   durable path. The duplicate also dropped clinical fields (`dob`,
   `insurance`, `previousTests`) from the patient payload because it
   pasted an older signature.

Adjacent risks the hotfix also addresses:

3. `aiClient.ts`'s timeout used `Promise.race` against a setTimeout —
   the race resolved with rejection, but the underlying OpenAI fetch
   kept running until completion (the socket and rate-limit token
   stayed allocated).
4. Default `BATCH_ANALYSIS_CONCURRENCY=5` compounded with the 60s/attempt
   timeout — under Replit's per-process socket budget, a bad streak
   could pin all five sockets until the timeout expired.
5. No stuck-job recovery — once a job sat in `running` it stayed
   there until manual cleanup.
6. Client had no first-class polling primitive. Network blips during
   the long synchronous request were rendered as terminal job
   failures.

## New durable flow

```
client                       server
  │                            │
  ├─ POST /api/batches/:id/analyze     ─────▶ startBatchAnalysis(...)
  │                                            │   inserts analysis_jobs row
  │   ◀─── { jobId, totalPatients,             │   void runAnalysisLoop(...)
  │           async: true }                    │
  │                                            │ background: AI calls per patient
  ├─ poll /api/.../analysis-status     ─────▶  │
  │   ◀─── { status, completed, errors, ... }  │
  │   …repeat with backoff…                    │
  │                                            ▼
  ├─ on terminal: invalidate caches
```

Same shape applies to single-patient Generate. The new
`POST /api/patients/:id/analyze-async` accepts a single patient id,
resolves their batch, and starts the runner restricted to that one
patient via `restrictToPatientIds: [id]`. Returns `{ jobId, batchId }`
immediately. The client polls `/api/batches/:batchId/analysis-status`
the same way Batch Generate does.

## Endpoints

| Endpoint | Behavior |
|---|---|
| `POST /api/batches/:id/analyze` | Returns `{ success, jobId, patientCount, async: true }` immediately. Heavy work runs in `runAnalysisLoop`. |
| `POST /api/patients/:id/analyze-async` (**new**) | Single-patient durable kickoff. Returns `{ success, jobId, batchId, patientCount, async: true }`. |
| `POST /api/patients/:id/analyze` (legacy) | Synchronous — kept for admin/dev tooling only. Plexus IQ no longer depends on it. |
| `GET /api/batches/:id/analysis-status` | Existing — polled for batch progress. |
| `GET /api/plexus-iq/qualification-jobs/:jobId/status` | Existing — polled for clinical-import jobs. |
| `POST /api/plexus-iq/qualification-jobs/:jobId/retry-failed` | Existing — resets `status="error"` patients and re-kicks the runner. |
| `POST /api/plexus-iq/qualification-jobs/recover-stuck` (**new**) | Marks any `running` job older than `JOB_STUCK_THRESHOLD_MS` as `failed`, surfaces them for retry. |
| `GET /api/plexus-iq/qualification-config` (**new**) | Returns the active timeout / concurrency / stuck-threshold tuning values. |

## Env vars

| Variable | Default | Effect |
|---|---|---|
| `AI_TIMEOUT_MS` | 60000 | Per-attempt OpenAI timeout. Enforced via AbortController so timed-out fetches are cancelled at the socket. |
| `AI_MAX_RETRIES` | 3 | Total attempts on transient failures (429/500/503/timeout/ECONNRESET/socket/aborted). |
| `BATCH_ANALYSIS_CONCURRENCY` | **2** (was 5) | Lowered to fit Replit's per-process socket budget. Override upward on beefier hosts. |
| `JOB_STUCK_THRESHOLD_MS` | 900000 (15 min) | A `running` job older than this is treated as stuck by `recover-stuck`. |

## Stuck-job behavior

`POST /api/plexus-iq/qualification-jobs/recover-stuck` walks the
recent analysis_jobs rows, marks any that have been in `running` for
longer than `JOB_STUCK_THRESHOLD_MS` as `failed` with a clear
`errorMessage`, sets their owning batch back to `error`, and returns
the recovered list. The existing retry-failed route then resets the
patients and re-kicks the runner.

`completed` patients are not reset by either recover-stuck or
retry-failed — only `processing`/`error` patients move back to `draft`
for re-analysis.

## Client polling

`client/src/hooks/api/useQualificationJobStatus.ts` (new) is the
React Query helper:

- Polls every 2.5s when the connection is healthy.
- On fetch failure, sets `reconnecting=true` and backs off
  exponentially to `maxBackoffMs` (default 30s).
- Treats `consecutiveFailures` as a hint, not as job failure — the
  job's actual state is what the next successful poll reports.
- On terminal status (`completed` / `failed` / `cancelled`),
  invalidates the caller-supplied React Query keys.

The Plexus IQ single-patient Generate handler uses inline polling
against `/api/batches/:batchId/analysis-status` with the same
back-off discipline so we don't introduce a new dependency surface.

## Model preservation

No model change. `server/services/screening.ts` still calls
`openai.chat.completions.create({ model: "gpt-4o", ... })` with
`max_completion_tokens: 16000` and `response_format: { type: "json_object" }`
for the primary qualification path. The only modification to that
file is forwarding the AbortController signal so timeouts cancel at
the socket. ICDs, factors, pearls, reasoning structure, and supported
tests are untouched.

## What is live vs scaffold

| Surface | State |
|---|---|
| `aiClient.withRetry` AbortController | LIVE |
| `aiClient` env vars (`AI_TIMEOUT_MS`, `AI_MAX_RETRIES`) | LIVE |
| `batchAnalysisRunner` default concurrency = 2 | LIVE |
| `batchAnalysisRunner.startBatchAnalysis` `restrictToPatientIds` option | LIVE |
| `batchAnalysisRunner.recoverStuckAnalysisJobs` | LIVE |
| `POST /api/batches/:id/analyze` delegates to runner | LIVE |
| `POST /api/patients/:id/analyze-async` | LIVE |
| `POST /api/patients/:id/analyze` legacy | LIVE (admin/dev only) |
| `POST /api/plexus-iq/qualification-jobs/recover-stuck` | LIVE |
| `GET /api/plexus-iq/qualification-config` | LIVE |
| `useAnalyzePatientAsync` client hook | LIVE |
| `useQualificationJobStatus` client polling hook | LIVE (reserved for future surfaces; Plexus IQ Generate uses inline polling today) |
| Plexus IQ Generate handler swapped to async | LIVE |

## Remaining risks

- `recover-stuck` is invocable by any authenticated user. If multi-
  tenancy ever lands, this should be gated by an admin role.
- The single-patient inline polling loop in `client/src/pages/plexus-iq.tsx`
  could be migrated to `useQualificationJobStatus` for code reuse.
  Left as-is for the hotfix to minimize the protected-page diff.
- `aiClient` retries are 3 attempts of 60s each. A worst-case
  pathological run can take 3 minutes before surfacing a hard
  failure. Acceptable trade-off vs. spurious failures on transient
  blips; lower `AI_MAX_RETRIES` in the env if needed.
