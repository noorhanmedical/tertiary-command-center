---
name: Plexus IQ BatchFlow session isolation
description: How BatchFlow intake placement (newRun vs append) + active-batch session token work on the Plexus IQ page.
---

# BatchFlow session isolation

The "Plexus BatchFlow" hub tile opens a landing dialog (`PlexusIQBatchFlowDialog`) FIRST — not the bulk import modal directly. The dialog's choice sets a placement intent ref on the page before the bulk modal opens.

- **Placement intent** lives in a `useRef<PlexusIqBatchPlacement>` on `plexus-iq.tsx`, default `{ mode: "newRun" }`. Start New → newRun; Resume → `{ mode: "append", targetBatchId }`. After every successful import the ref is RESET to newRun so the next intake defaults to an isolated batch.
- Backend already supports placement on `POST /api/plexus-iq/clinical-import` and `POST /api/batches`; default server-side is `append`, so the client MUST pass `newRun` explicitly to isolate. newRun creates sibling "(Run N)" batches.
- **Active batch token**: sessionStorage key `plexusIq.activeBatchId`, managed via `client/src/lib/plexusIqBatchSession.ts` (`setActiveBatchId`, `useActiveBatchId` hook syncs via CustomEvent `plexusIq:activeBatchChanged` + storage event). Set after import success to the landed batch.
- **Source map** (paste vs file import) is separate localStorage in the same helper module; the bulk modal reports `source: "paste"|"import"` (tracked by a `usedFile` flag set in `handleFile`). Batch History shows it via `batchSourceLabel`.

**Why:** qualification + Admin Review are already scoped per-batch (by `result.batchIds`), so newRun isolation falls out for free — no extra scoping code needed. The only thing the client owns is choosing the right placement and recording session/source metadata (no schema changes).
