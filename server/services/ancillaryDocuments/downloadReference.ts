/**
 * Phase 2E-B2 — authorized download/view reference resolver.
 *
 * The reference row never stores bytes. A writer may stash an opaque source
 * pointer in metadata.download_reference (e.g. "documents:123"). This resolver
 * maps ONLY allowlisted pointers to an EXISTING authorized internal route and
 * returns null for anything else. It NEVER fabricates a sourceTable:sourceId
 * value and NEVER emits a raw bucket key, storage credential, filesystem path,
 * or arbitrary external URL.
 */

import type { AncillaryDocumentReference } from "@shared/schema/ancillaryDocuments";

// Allowlisted source-pointer → authorized internal route adapters. Each adapter
// accepts a numeric source id ONLY (no free-form strings), so a raw key or URL
// can never flow through.
//
// UNRESOLVED ADAPTER — `documents:<id>` (documents-library files):
//   The `/api/documents-library/:id/file` route requires authentication but is
//   NOT tenant-safe — the `documents` table has no clinic_id and the handler
//   applies no clinic scope, so any authenticated user could fetch another
//   clinic's file by id. Per Phase 2E-B3 §7 we DO NOT emit a fabricated
//   pointer and DO NOT add a new download route in this patch. The
//   `documents:` adapter is intentionally left OUT of the allowlist, so its
//   downloadReference resolves to null until a clinic-scoped file route exists
//   (e.g. one that joins through the clinic-scoped ancillary_document_references
//   or adds documents.clinic_id). Any pointer added below MUST resolve to an
//   authenticated, tenant-scoped route (enforced by a registration test).
const POINTER_ADAPTERS: Array<{ prefix: string; toRoute: (id: number) => string }> = [];

/** The prefixes this resolver will emit an authorized route for (may be empty). */
export const AUTHORIZED_POINTER_PREFIXES: readonly string[] = POINTER_ADAPTERS.map((a) => a.prefix);

/** The routes this resolver can emit, for the id-space it validates (tests assert these are registered + tenant-safe). */
export function emittedDownloadRoutes(sampleId = 1): string[] {
  return POINTER_ADAPTERS.map((a) => a.toRoute(sampleId));
}

/**
 * Resolve the stored metadata pointer to an authorized route, or null.
 *
 * Order Notes deliberately return null here: there is no dedicated authorized
 * procedure_notes file/view route to hand out, so we never fabricate one.
 */
export function resolveAuthorizedDownloadReference(
  ref: AncillaryDocumentReference,
): string | null {
  const meta = (ref.metadata ?? {}) as Record<string, unknown>;
  const pointer = meta.download_reference;
  if (typeof pointer !== "string" || pointer.length === 0) return null;

  // Strict shape: "<prefix>:<positive-integer>". Anything with slashes,
  // schemes, dots, or non-numeric ids is rejected outright.
  const match = /^([a-z_]+):(\d+)$/.exec(pointer);
  if (!match) return null;
  const [, prefix, idStr] = match;
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) return null;

  const adapter = POINTER_ADAPTERS.find((a) => a.prefix === prefix);
  return adapter ? adapter.toRoute(id) : null;
}
