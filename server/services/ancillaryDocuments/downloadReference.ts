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
const POINTER_ADAPTERS: Array<{ prefix: string; toRoute: (id: number) => string }> = [
  // Reports / consents / screening forms live in the documents library and are
  // served by the existing authorized blob route.
  { prefix: "documents", toRoute: (id) => `/api/documents-library/${id}/file` },
];

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
