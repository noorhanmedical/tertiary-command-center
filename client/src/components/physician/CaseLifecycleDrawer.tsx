// Phase P1 — Case Lifecycle drawer.
//
// One coherent, read-only view of a COMPLETE ancillary case, composed ENTIRELY
// from existing canonical lifecycle/state APIs — no parallel frontend state
// machine, no service-name inference:
//   • Lifecycle timeline + billing/engagement status → the cached
//     /api/clinician-portal/canonical-overview DTO (server-computed statuses,
//     shown verbatim), sliced to this case by orderNoteLifecycle.buildCaseTimeline.
//   • Active Order Note body + audit → GET /api/order-notes/case/:ancillaryCaseId
//   • Superseded Order Note versions → GET /api/order-notes/screening/:screeningId
//   • Procedure Note + its EXACT signed Order Note linkage →
//     GET /api/procedure-notes?patientScreeningId= then the Procedure Note's
//     source_data.associated_order_note_id opened verbatim via
//     GET /api/procedure-notes/:id (never the newest note, never regenerated).
//
// The Diagnostic Report and Billing Document are shown as SEPARATE reference
// sections (canonical status only) — ICD-10/CPT codes belong to the Billing
// Document, never to the Order/Procedure clinical notes rendered here.

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Loader2, FileText, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SideDrawer, StatusPill, ServiceChip } from "./ui/primitives";
import { OrderNoteDocumentView } from "./OrderNoteDocumentView";
import { useCanonicalOverview } from "./useCanonicalOverview";
import {
  buildCaseTimeline,
  caseEngagementSummary,
  orderNoteStateLabel,
  orderNoteStateTone,
  isReReviewState,
  type CaseTimelineStep,
  type LifecycleTone,
} from "./orderNoteLifecycle";

type AnyNote = {
  id: number;
  noteType?: string;
  serviceType?: string;
  generatedText?: string | null;
  generated_text?: string | null;
  signatureStatus?: string | null;
  signedAt?: string | null;
  evidenceFingerprint?: string | null;
  evaluatedScreeningEvidenceVersion?: string | null;
  generatedByAi?: boolean | null;
  effectiveClinicalDate?: string | null;
  supersededAt?: string | null;
  createdAt?: string | null;
  sourceData?: Record<string, unknown> | null;
  source_data?: Record<string, unknown> | null;
};

export type CaseLifecycleTarget = {
  ancillaryCaseId: number;
  patientScreeningId: number | null;
  serviceType: string;
  patientName: string | null;
  requiresScreening: boolean;
  screeningComplete: boolean | null;
  orderNotePortalState: string | null;
};

function bodyOf(n: AnyNote | null | undefined): string | null {
  if (!n) return null;
  return n.generatedText ?? n.generated_text ?? null;
}
function sourceOf(n: AnyNote | null | undefined): Record<string, unknown> {
  return (n?.sourceData ?? n?.source_data ?? {}) as Record<string, unknown>;
}
function associatedOrderNoteId(procNote: AnyNote | null | undefined): number | null {
  const sd = sourceOf(procNote);
  const raw = sd["associated_order_note_id"] ?? sd["associatedOrderNoteId"];
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) ? n : null;
}

async function getJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url, { credentials: "include" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Request failed: ${url}`);
  return res.json();
}

function TimelineRow({ step }: { step: CaseTimelineStep }) {
  const dot =
    step.tone === "green" ? "bg-emerald-500"
    : step.tone === "red" ? "bg-rose-500"
    : step.tone === "amber" ? "bg-amber-500"
    : step.tone === "blue" ? "bg-blue-500"
    : "bg-slate-300";
  return (
    <li className="flex items-start gap-3" data-testid={`lifecycle-step-${step.key}`}>
      <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-finance-text">{step.label}</span>
          {step.attention && (
            <StatusPill label="Action required" tone="red" testId={`lifecycle-attention-${step.key}`} />
          )}
        </div>
        <div className="text-xs text-finance-text-muted" data-testid={`lifecycle-detail-${step.key}`}>
          {step.detail ?? step.status ?? "—"}
        </div>
      </div>
    </li>
  );
}

function ReferenceRow({ label, status, tone, testId }: { label: string; status: string | null; tone: LifecycleTone; testId: string }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2" data-testid={testId}>
      <span className="text-sm text-finance-text">{label}</span>
      <StatusPill label={status ?? "Not yet available"} tone={tone} />
    </div>
  );
}

export function CaseLifecycleDrawer({
  target,
  open,
  onOpenChange,
}: {
  target: CaseLifecycleTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: overview } = useCanonicalOverview();
  const caseId = target?.ancillaryCaseId ?? null;
  const screeningId = target?.patientScreeningId ?? null;
  const [showSignedOrder, setShowSignedOrder] = useState(false);

  // Active Order Note for the case.
  const orderNoteQ = useQuery<AnyNote | null>({
    queryKey: ["/api/order-notes/case", caseId],
    enabled: open && caseId != null,
    queryFn: () => getJson<AnyNote>(`/api/order-notes/case/${caseId}`),
  });

  // Superseded / historical Order Note versions for the screening.
  const versionsQ = useQuery<AnyNote[]>({
    queryKey: ["/api/order-notes/screening", screeningId],
    enabled: open && screeningId != null,
    queryFn: async () => (await getJson<AnyNote[]>(`/api/order-notes/screening/${screeningId}`)) ?? [],
  });

  // Procedure Note(s) for the screening — to surface the EXACT signed Order Note
  // linkage recorded on the procedure note.
  const procNotesQ = useQuery<AnyNote[]>({
    queryKey: ["/api/procedure-notes", "screening", screeningId],
    enabled: open && screeningId != null,
    queryFn: async () => (await getJson<AnyNote[]>(`/api/procedure-notes?patientScreeningId=${screeningId}`)) ?? [],
  });

  const procNote = (procNotesQ.data ?? []).find((n) => n.noteType === "post_procedure_note") ?? null;
  const linkedOrderId = associatedOrderNoteId(procNote);

  // The EXACT signed Order Note the Procedure Note was built on — fetched by the
  // recorded id, never "the newest". Only when the clinician opens it.
  const signedOrderQ = useQuery<AnyNote | null>({
    queryKey: ["/api/procedure-notes", linkedOrderId],
    enabled: open && showSignedOrder && linkedOrderId != null,
    queryFn: () => getJson<AnyNote>(`/api/procedure-notes/${linkedOrderId}`),
  });

  if (!target) return null;

  const timeline = buildCaseTimeline(overview, {
    ancillaryCaseId: target.ancillaryCaseId,
    requiresScreening: target.requiresScreening,
    screeningComplete: target.screeningComplete,
    orderNotePortalState: target.orderNotePortalState,
  });
  const engagement = caseEngagementSummary(overview, target.ancillaryCaseId);
  const caseRows = overview?.ordersNotes.rows.filter((r) => r.ancillaryCaseId === target.ancillaryCaseId) ?? [];
  const reportRow = caseRows.find((r) => r.documentKind === "report");
  const financeRow = overview?.finance.rows.find((r) => r.ancillaryCaseId === target.ancillaryCaseId);

  const activeNote = orderNoteQ.data ?? null;
  const supersededVersions = (versionsQ.data ?? []).filter((n) => n.supersededAt != null);
  const reReview = isReReviewState(target.orderNotePortalState);

  return (
    <SideDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={target.patientName ?? "Patient"}
      subtitle={`Ancillary case #${target.ancillaryCaseId}`}
      testId="case-lifecycle-drawer"
    >
      <div className="space-y-5">
        <div className="flex items-center gap-2">
          <ServiceChip service={target.serviceType} />
          <StatusPill
            label={orderNoteStateLabel(target.orderNotePortalState)}
            tone={orderNoteStateTone(target.orderNotePortalState)}
            testId="case-order-note-state"
          />
        </div>

        {reReview && (
          <div
            data-testid="case-rereview-banner"
            className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-800"
          >
            The signed Order Note no longer authorizes this procedure because the material clinical
            evidence changed after signature. A fresh clinician review and signature are required.
          </div>
        )}

        {/* ── Lifecycle timeline ─────────────────────────────────────────── */}
        <section data-testid="case-lifecycle-timeline">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-finance-text-muted">Case lifecycle</h4>
          {engagement && (
            <div className="mb-2 text-xs text-finance-text-muted" data-testid="case-engagement-summary">
              {[engagement.lifecycleStatus ? `Lifecycle: ${engagement.lifecycleStatus}` : null,
                engagement.adminReviewStatus ? `Admin review: ${engagement.adminReviewStatus}` : null]
                .filter(Boolean).join(" · ") || "—"}
            </div>
          )}
          <ol className="space-y-2.5">
            {timeline.map((s) => <TimelineRow key={s.key} step={s} />)}
          </ol>
        </section>

        {/* ── Active Order Note ──────────────────────────────────────────── */}
        <section data-testid="case-order-note">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-finance-text-muted">Order Note</h4>
          {orderNoteQ.isLoading ? (
            <div className="py-4 text-center text-xs text-finance-text-muted"><Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />Loading…</div>
          ) : activeNote ? (
            <OrderNoteDocumentView
              text={bodyOf(activeNote)}
              testId="case-order-note-document"
              audit={{
                evidenceFingerprint: activeNote.evidenceFingerprint,
                evaluatedScreeningEvidenceVersion: activeNote.evaluatedScreeningEvidenceVersion,
                generatedByAi: activeNote.generatedByAi,
                signedAt: activeNote.signedAt,
                effectiveClinicalDate: activeNote.effectiveClinicalDate,
              }}
            />
          ) : (
            <div className="text-xs text-finance-text-muted">No active Order Note for this case.</div>
          )}

          {supersededVersions.length > 0 && (
            <div className="mt-2 text-xs text-finance-text-muted" data-testid="case-order-note-versions">
              <span className="font-medium">Superseded versions:</span>{" "}
              {supersededVersions.map((v) => `#${v.id}`).join(", ")}
            </div>
          )}
        </section>

        {/* ── Procedure Note + EXACT signed Order Note linkage ───────────── */}
        {procNote && (
          <section data-testid="case-procedure-note">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-finance-text-muted">Procedure Note</h4>
            <OrderNoteDocumentView
              text={bodyOf(procNote)}
              testId="case-procedure-note-document"
              audit={{ signedAt: procNote.signedAt, effectiveClinicalDate: procNote.effectiveClinicalDate }}
            />
            {linkedOrderId != null && (
              <div className="mt-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowSignedOrder((v) => !v)}
                  data-testid="button-view-signed-order-note"
                >
                  <FileText className="mr-1.5 h-3.5 w-3.5" />
                  {showSignedOrder ? "Hide signed Order Note" : "View signed Order Note"}
                  <span className="ml-1 text-xs text-finance-text-muted">(#{linkedOrderId})</span>
                </Button>
                {showSignedOrder && (
                  <div className="mt-2" data-testid="case-signed-order-note">
                    {signedOrderQ.isLoading ? (
                      <div className="py-3 text-center text-xs text-finance-text-muted"><Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />Loading exact signed version…</div>
                    ) : signedOrderQ.data ? (
                      <OrderNoteDocumentView
                        text={bodyOf(signedOrderQ.data)}
                        testId="case-signed-order-note-document"
                        audit={{
                          evidenceFingerprint: signedOrderQ.data.evidenceFingerprint,
                          evaluatedScreeningEvidenceVersion: signedOrderQ.data.evaluatedScreeningEvidenceVersion,
                          signedAt: signedOrderQ.data.signedAt,
                        }}
                      />
                    ) : (
                      <div className="text-xs text-rose-600">Could not load the referenced Order Note.</div>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {/* ── Diagnostic Report (separate) ───────────────────────────────── */}
        <section data-testid="case-report">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-finance-text-muted">Diagnostic Report</h4>
          <ReferenceRow
            label="Report (findings & interpretation)"
            status={reportRow ? reportRow.documentStatus : null}
            tone={reportRow ? "green" : "gray"}
            testId="case-report-row"
          />
        </section>

        {/* ── Billing Document (separate; ICD-10/CPT live here, not the notes) */}
        <section data-testid="case-billing">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-finance-text-muted">Billing Document</h4>
          <ReferenceRow
            label="Billing document (ICD-10 / CPT)"
            status={financeRow ? (financeRow.billingDocumentStatus ?? financeRow.readinessStatus) : null}
            tone={financeRow?.billingDocumentStatus ? "green" : (financeRow?.billingBlockerCount ?? 0) + (financeRow?.claimBlockerCount ?? 0) > 0 ? "amber" : "gray"}
            testId="case-billing-row"
          />
          <p className="mt-1 text-[11px] text-finance-text-muted">
            Diagnosis and procedure codes appear on the Billing Document only — never on the Order or Procedure clinical notes.
          </p>
        </section>
      </div>
    </SideDrawer>
  );
}
