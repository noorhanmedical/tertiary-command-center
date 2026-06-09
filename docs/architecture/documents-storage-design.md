# Documents storage design

**Date:** 2026-06-09
**Scope:** READ-ONLY descriptive architecture doc. No source code changed by this doc.
**Purpose:** Capture how patient documents, consents, reports, and generated notes are stored today; lock the production-safety guardrails; and define the Batch 16 wrap targets without committing to any of them.

> Cross-reference: `portals-route-parity-inventory.md` §1.7 (upload), §1.8 (sign-consent), `pdf-protection-contract.md` (read side), `canonical-workflow-wiring-map.md` §7 (Stage [6] report uploaded).

---

## 0. How this document is used

Every documents- or reports-touching PR must cite the relevant §-number from this doc + verify the production-safety check + verify the `ownerType` discriminated union has not silently added a new member without explicit review.

---

## 1. The blobStore abstraction *(server/services/blobStore.ts)*

The single entry point for binary document storage. All upload, report, generated-note, marketing-material, and library-document blobs flow through this module.

### 1.1 Public surface
- `saveBlob(input: SaveBlobInput): Promise<DocumentBlob>` *(blobStore.ts:33)*
- `readBlob(blobId: number): Promise<{ blob: DocumentBlob; buffer: Buffer } | null>` *(blobStore.ts:62)*
- `getLatestBlobForOwner(...)` *(blobStore.ts:75)*
- `deleteBlob(blobId: number): Promise<void>` *(blobStore.ts:88)*
- `deleteTestBlobs(): Promise<number>` *(blobStore.ts:96)*

### 1.2 `SaveBlobInput.ownerType` — discriminated union *(blobStore.ts:25)*

| Value | What it stores |
| --- | --- |
| `"uploaded_document"` | Patient-uploaded files via `POST /api/portal/uploads` |
| `"generated_note"` | AI-generated procedure notes from the note pipeline |
| `"test_fixture"` | Test-only blobs; cleared by `deleteTestBlobs()` |
| `"marketing_material"` | Operator-uploaded marketing assets |
| `"library_document"` | Centrally-managed library documents (consents, intake forms, etc.) |

Adding a new `ownerType` literal is a contract change — every site that switches on the union must add a branch.

### 1.3 Filesystem layout *(blobStore.ts:7)*
- Root: `<cwd>/storage/documents/`
- Per-blob subdir: `<root>/<ownerType>/<sha256[:2]>/`
- Filename: `<sha256[2:16]>_<safeName>` (filename sanitization: `[^a-zA-Z0-9._\-]` → `_`, truncated to 120 chars)
- SHA256 hash is computed from the buffer at save time and stored with the row.

### 1.4 Production-safety check — `assertLocalBlobsAllowed` *(blobStore.ts:14)*

**Invariant:** in production, `STORAGE_PROVIDER` MUST be `"s3"`. Any other value throws on the first `saveBlob` call.

```
if (process.env.NODE_ENV === "production" && process.env.STORAGE_PROVIDER !== "s3") {
  throw new Error("Refusing to write document blobs to the local filesystem in production. ...");
}
```

This guard exists so a misconfigured prod deploy fails LOUD at first write, not silently to a non-durable filesystem inside a container that will be recycled.

**Stop condition:** any PR that removes or relaxes this check requires explicit approval. The check is part of the production-readiness gate.

---

## 2. Storage providers

| Provider | Env var | When | Where data lives |
| --- | --- | --- | --- |
| Local filesystem | unset (default) | Dev only | `<cwd>/storage/documents/` |
| S3 | `STORAGE_PROVIDER=s3` + `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET_NAME` | **Required in production** | The configured S3 bucket |
| Google Drive | `STORAGE_PROVIDER=google_drive` + `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_DRIVE_ROOT_FOLDER_ID` | Optional dev/legacy | The configured Drive folder |

Today the abstraction lives in `server/integrations/` for S3 + Drive. The `blobStore.ts` writes to the local filesystem; the dispatcher between providers is in `server/services/blobStore.ts` + adjacent integration adapters. Batch 16 will consolidate the dispatcher into one explicit `StorageProvider` interface (see §4 below).

---

## 3. Document tables

| Table | Owner | Purpose |
| --- | --- | --- |
| `document_blobs` | `blobStore.ts` | Binary content + sha256 + storage path + ownerType discriminator |
| `documents` | `documentLibrary.repo.ts` | Document metadata (kind, surface, signature requirement, patient/scope linkage) |
| `uploaded_documents` | `documentLibrary.repo.ts` | Uploads-specific metadata layer (used by `/api/portal/uploads`) |
| `case_document_readiness` | `documentReadiness.repo.ts` | Per-case completion-state matrix |
| `document_surface_assignments` | `documentLibrary.repo.ts` | Many-to-many `(document, surface)` linkage |

The shape of every table comes from `shared/schema/*.ts` — already shared-typed.

---

## 4. Batch 16 wrap targets

This section lists what Batch 16 will do. **This PR does NOT do any of it.** It documents the targets so future PRs cite this §-number.

### 4.1 `StorageProvider` interface

A single TypeScript interface every provider (local FS, S3, Drive) implements:

```ts
interface StorageProvider {
  save(input: SaveBlobInput): Promise<DocumentBlob>;
  read(blobId: number): Promise<{ blob: DocumentBlob; buffer: Buffer } | null>;
  delete(blobId: number): Promise<void>;
}
```

`saveBlob` / `readBlob` / `deleteBlob` become thin dispatchers that resolve the provider from `process.env.STORAGE_PROVIDER` and delegate.

### 4.2 Provider switch lives in one file

`server/services/storage/providerSwitch.ts` — single export: `resolveStorageProvider(): StorageProvider`. Cached after first call.

### 4.3 `assertLocalBlobsAllowed` moves into the local provider

The production-safety check becomes a constructor-time assertion inside `LocalFilesystemProvider`, not a per-call check. Same effect, cleaner ownership.

### 4.4 Shared `DocumentBlobOwnerType` contract

The `ownerType` discriminated union moves from inline in `SaveBlobInput` to `shared/contracts/documentBlob.ts`. Same five members; consumers re-import.

---

## 5. Stop conditions

A future documents/reports-touching PR MUST stop and ask if:

1. `assertLocalBlobsAllowed` is removed or weakened.
2. A new `ownerType` literal is added without an explicit § entry in this doc.
3. The filesystem layout (sha256-prefixed subdir + truncated safe filename) changes — existing blobs will not be findable.
4. The provider switch grows a fourth provider without Batch 16 being formally opened.
5. Any code path bypasses `blobStore.ts` and writes to `document_blobs` directly.
6. PDF-generation or packet-generation behavior changes — that's in `pdf-protection-contract.md`, NOT this doc.

End of design.
