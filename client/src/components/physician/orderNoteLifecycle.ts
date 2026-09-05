// Phase P1 — pure clinician ancillary-workflow presentation logic.
//
// ZERO React, zero I/O, zero data fetching. Everything here is a pure function
// over the canonical, server-computed facts the UI already receives:
//   • PhysicianSignatureItem  (/api/physician-portal/signature-items)
//   • ClinicianPortalCanonicalOverview  (/api/clinician-portal/canonical-overview)
//
// This module is the SINGLE source of truth for how canonical Order Note portal
// states, signature-worklist action filters, the Order Note document structure,
// and the per-case lifecycle timeline are LABELLED and TONED for display. It
// deliberately holds NO lifecycle transition logic — it never decides what a
// case's state IS (the server does that); it only decides how an already-decided
// server state is presented. There is no frontend state machine and no
// service-name inference here (screening applicability comes from the server
// `requiresScreening` flag, never from parsing the service string).

import type {
  ClinicianPortalCanonicalOverview,
  OrdersNotesRow,
  FinanceOverviewRow,
  EngagementRow,
} from "@shared/clinicianPortalOverview";

// ─── Canonical Order Note portal state — display labels ───────────────────────
// Mirrors server ORDER_NOTE_PORTAL_STATES. `signed_stale_review_required` is a
// FIRST-CLASS state (a previously-signed note whose material evidence changed):
// it is NEVER shown as plain "Signed" and NEVER collapsed into a generic error.
export const ORDER_NOTE_STATE_LABELS: Record<string, string> = {
  awaiting_screening: "Awaiting Screening",
  ready_for_review: "Ready for Review",
  updated_review_required: "Updated — Review Required",
  signed: "Signed",
  signed_stale_review_required: "Signed — Re-review Required",
  pending: "Pending",
};

export type LifecycleTone = "green" | "amber" | "blue" | "violet" | "gray" | "red";

/** Presentational tone for a canonical Order Note portal state. `red` is
 *  reserved for the states that block the procedure and demand clinician action
 *  (stale-after-signature re-review). */
export function orderNoteStateTone(state: string | null | undefined): LifecycleTone {
  switch (state) {
    case "signed":
      return "green";
    case "ready_for_review":
      return "blue";
    case "updated_review_required":
      return "amber";
    case "signed_stale_review_required":
      return "red";
    case "awaiting_screening":
      return "gray";
    default:
      return "gray";
  }
}

export function orderNoteStateLabel(state: string | null | undefined): string {
  if (!state) return "—";
  return ORDER_NOTE_STATE_LABELS[state] ?? state.replace(/_/g, " ");
}

/** The two portal states that mean "a signed note no longer authorizes the
 *  procedure — a fresh clinician review/signature is required." Surfaced with a
 *  destructive treatment; never hidden behind generic messaging. */
export function isReReviewState(state: string | null | undefined): boolean {
  return state === "signed_stale_review_required" || state === "updated_review_required";
}

// ─── Signature-worklist action filters (client-side over fetched items) ───────
// The signature-items endpoint returns the notes that are in the clinician's
// signing worklist. These filters slice that already-canonical list by ACTION
// REQUIRED — they never re-derive a case's lifecycle stage (that lives in the
// Case Lifecycle view / the ACS-PCS operational queue). Each predicate reads
// ONLY server-provided fields.

export type SignatureWorklistItem = {
  signable: boolean;
  signatureStatus: string;
  noteType: string;
  orderNotePortalState: string | null;
  requiresScreening: boolean;
  screeningComplete: boolean | null;
};

export type WorklistFilterId =
  | "all"
  | "needs_my_signature"
  | "screening_incomplete"
  | "re_review_required"
  | "returned"
  | "signed";

export type WorklistFilter = {
  id: WorklistFilterId;
  label: string;
  /** True when the item belongs in this filtered view. */
  match: (item: SignatureWorklistItem) => boolean;
};

export const WORKLIST_FILTERS: WorklistFilter[] = [
  { id: "all", label: "All", match: () => true },
  {
    id: "needs_my_signature",
    label: "Needs my signature",
    match: (i) => i.signable === true,
  },
  {
    id: "screening_incomplete",
    // Screening only counts as a blocker for services that actually require it
    // (server `requiresScreening`) — never inferred from the service name.
    label: "Screening incomplete",
    match: (i) =>
      i.requiresScreening === true &&
      i.orderNotePortalState === "awaiting_screening",
  },
  {
    id: "re_review_required",
    label: "Re-review required",
    match: (i) => isReReviewState(i.orderNotePortalState),
  },
  {
    id: "returned",
    label: "Returned for correction",
    match: (i) => i.signatureStatus === "returned_for_correction",
  },
  {
    id: "signed",
    label: "Signed",
    match: (i) => i.signatureStatus === "signed",
  },
];

export function worklistFilterById(id: string): WorklistFilter {
  return WORKLIST_FILTERS.find((f) => f.id === id) ?? WORKLIST_FILTERS[0];
}

export function filterWorklist<T extends SignatureWorklistItem>(items: T[], id: string): T[] {
  const f = worklistFilterById(id);
  return items.filter((i) => f.match(i));
}

// ─── Order Note document structure (parse the rendered body into sections) ────
// The server renders the Order Note body as repeated blocks of:
//     HEADING
//     ------------   (a run of dashes matching the heading)
//     body text…
// joined by blank lines. We parse that structure back into titled sections so
// the clinician reads a clean clinical document (never a raw text dump and never
// an AI-chat transcript). We do NOT hardcode a fixed set of headings: whatever
// sections the canonical generator emitted are shown, in order. No content is
// invented, reordered, or dropped.

export type OrderNoteRenderedSection = { heading: string | null; body: string };

const DASH_RULE = /^[-–—]{3,}\s*$/;

export function parseOrderNoteSections(text: string | null | undefined): OrderNoteRenderedSection[] {
  const raw = (text ?? "").replace(/\r\n/g, "\n");
  if (!raw.trim()) return [];
  const lines = raw.split("\n");
  const sections: OrderNoteRenderedSection[] = [];
  let current: OrderNoteRenderedSection | null = null;
  let preambleLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const next = lines[i + 1];
    const isHeading =
      line.trim().length > 0 && next != null && DASH_RULE.test(next);
    if (isHeading) {
      if (current) {
        current.body = current.body.replace(/\n+$/, "");
        sections.push(current);
      } else if (preambleLines.join("").trim()) {
        sections.push({ heading: null, body: preambleLines.join("\n").trim() });
      }
      preambleLines = [];
      current = { heading: line.trim(), body: "" };
      i++; // skip the dash rule line
      continue;
    }
    if (current) {
      current.body += (current.body ? "\n" : "") + line;
    } else {
      preambleLines.push(line);
    }
  }
  if (current) {
    current.body = current.body.replace(/\n+$/, "");
    sections.push(current);
  } else if (preambleLines.join("").trim()) {
    sections.push({ heading: null, body: preambleLines.join("\n").trim() });
  }

  // Fallback: no structured headings detected → one untitled section with the
  // whole body (still never a raw <pre> dump; the viewer renders it as prose).
  if (sections.length === 0) return [{ heading: null, body: raw.trim() }];
  return sections;
}

// ─── Per-case lifecycle timeline (composed from the canonical overview DTO) ───
// Builds an ORDERED set of lifecycle steps for ONE ancillary case out of the
// server-computed overview rows. Each step's `status` string is copied VERBATIM
// from the server; this module only decides ordering, a display label, whether
// the step has been reached, and a tone. No status is recomputed and no step is
// synthesized from data the server did not provide.

export type CaseTimelineStepKey =
  | "screening"
  | "order_note"
  | "procedure_note"
  | "report"
  | "billing";

export type CaseTimelineStep = {
  key: CaseTimelineStepKey;
  label: string;
  /** Server status string, shown verbatim (null when the step has no canonical
   *  row yet). */
  status: string | null;
  /** Presentational: has this step been satisfied per the server facts. */
  reached: boolean;
  /** Presentational: does this step currently require clinician attention. */
  attention: boolean;
  tone: LifecycleTone;
  detail: string | null;
};

export type CaseLifecycleInputs = {
  ancillaryCaseId: number;
  /** Server flag — screening step is only part of THIS case's lifecycle when
   *  the service requires structured screening. */
  requiresScreening: boolean;
  screeningComplete: boolean | null;
  /** The canonical Order Note portal state for this case's active order note. */
  orderNotePortalState: string | null;
};

function findCaseRows<T extends { ancillaryCaseId: number }>(rows: T[], caseId: number): T[] {
  return rows.filter((r) => r.ancillaryCaseId === caseId);
}

function docRow(rows: OrdersNotesRow[], kind: OrdersNotesRow["documentKind"]): OrdersNotesRow | undefined {
  return rows.find((r) => r.documentKind === kind);
}

/** Compose the ordered lifecycle timeline for one case. Pure; safe to unit test
 *  with a hand-built overview DTO. */
export function buildCaseTimeline(
  overview: ClinicianPortalCanonicalOverview | null | undefined,
  inputs: CaseLifecycleInputs,
): CaseTimelineStep[] {
  const ordersRows: OrdersNotesRow[] = overview
    ? findCaseRows(overview.ordersNotes.rows, inputs.ancillaryCaseId)
    : [];
  const financeRow: FinanceOverviewRow | undefined = overview
    ? findCaseRows(overview.finance.rows, inputs.ancillaryCaseId)[0]
    : undefined;

  const steps: CaseTimelineStep[] = [];

  // 1. Screening — only when the service requires it (server flag).
  if (inputs.requiresScreening) {
    const complete = inputs.screeningComplete === true;
    steps.push({
      key: "screening",
      label: "Screening",
      status: complete ? "complete" : "incomplete",
      reached: complete,
      attention: !complete,
      tone: complete ? "green" : "amber",
      detail: complete ? "Structured screening complete" : "Structured screening required",
    });
  }

  // 2. Order Note — canonical document status + portal state (stale surfaced).
  {
    const row = docRow(ordersRows, "order_note");
    const portal = inputs.orderNotePortalState;
    const reReview = isReReviewState(portal);
    const signed = !!row?.signedAt || portal === "signed";
    steps.push({
      key: "order_note",
      label: "Order Note",
      status: row?.documentStatus ?? (portal ? orderNoteStateLabel(portal) : null),
      reached: signed && !reReview,
      attention: reReview || (!signed && portal === "ready_for_review"),
      tone: reReview ? "red" : signed ? "green" : orderNoteStateTone(portal),
      detail: portal ? orderNoteStateLabel(portal) : row?.documentStatus ?? null,
    });
  }

  // 3. Procedure Note — canonical procedure note document.
  {
    const row = docRow(ordersRows, "procedure_note");
    const signed = !!row?.signedAt;
    steps.push({
      key: "procedure_note",
      label: "Procedure Note",
      status: row?.documentStatus ?? null,
      reached: signed,
      attention: !!row && !signed,
      tone: signed ? "green" : row ? "amber" : "gray",
      detail: row ? row.documentStatus : "Not yet available",
    });
  }

  // 4. Diagnostic Report — canonical report document (separate from the notes).
  {
    const row = docRow(ordersRows, "report");
    const present = !!row;
    steps.push({
      key: "report",
      label: "Diagnostic Report",
      status: row?.documentStatus ?? null,
      reached: present,
      attention: false,
      tone: present ? "green" : "gray",
      detail: row ? row.documentStatus : "Not yet available",
    });
  }

  // 5. Billing readiness — canonical readiness + billing document status.
  {
    const status = financeRow?.readinessStatus ?? null;
    const ready = status === "ready_to_generate" || !!financeRow?.billingDocumentStatus;
    const blockers = (financeRow?.billingBlockerCount ?? 0) + (financeRow?.claimBlockerCount ?? 0);
    steps.push({
      key: "billing",
      label: "Billing",
      status: financeRow?.billingDocumentStatus ?? status,
      reached: ready && blockers === 0,
      attention: blockers > 0,
      tone: ready && blockers === 0 ? "green" : blockers > 0 ? "amber" : "gray",
      detail: financeRow
        ? [status, blockers > 0 ? `${blockers} blocker(s)` : null].filter(Boolean).join(" · ") || null
        : "Not yet evaluated",
    });
  }

  return steps;
}

/** Convenience: the engagement lifecycle/admin-review summary for a case (shown
 *  as context above the timeline). Returns null when the case has no engagement
 *  row. Pure. */
export function caseEngagementSummary(
  overview: ClinicianPortalCanonicalOverview | null | undefined,
  ancillaryCaseId: number,
): { lifecycleStatus: string | null; adminReviewStatus: string | null } | null {
  if (!overview) return null;
  const row: EngagementRow | undefined = overview.engagement.rows.find(
    (r) => r.ancillaryCaseId === ancillaryCaseId,
  );
  if (!row) return null;
  return { lifecycleStatus: row.lifecycleStatus, adminReviewStatus: row.adminReviewStatus };
}
