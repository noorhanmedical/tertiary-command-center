/**
 * Phase 2J backfill — canonical claim / invoice / payment lifecycle.
 *
 * Contract:
 *   • DRY-RUN by default. For each active, admin-approved ancillary case that has a
 *     CURRENT canonical Billing Document, it evaluates claim readiness from EXACT
 *     evidence (the current billing-readiness snapshot + the bound Billing Document)
 *     and prints a PHI-free plan (case ids + claim-ready + blocker codes + counts).
 *     ZERO writes, ZERO external financial operations.
 *   • Apply is INTENTIONALLY NOT IMPLEMENTED. A claim/invoice/payment status may be
 *     persisted only from an exact authorized source event or explicit authorized
 *     manual attestation (frozen scope) — never fabricated by a backfill. So even
 *     with BACKFILL_CANONICAL_FINANCIAL_APPLY=YES + every runtime flag on, apply is
 *     a guarded no-op that reports `apply_deferred_no_authorized_source` and writes
 *     nothing. This script NEVER transmits a claim, contacts a clearinghouse,
 *     charges a card, initiates ACH, issues a refund, posts a payment, or delivers
 *     an invoice/statement. It never modifies clinics and never deletes data.
 *
 * Run (dry-run):   npx tsx script/backfillCanonicalClaimsInvoicesPayments.ts
 */

import { db } from "../server/db";
import { and, eq, isNull, inArray } from "drizzle-orm";
import { patientAncillaryCases, ANCILLARY_ACTIVE_LIFECYCLE_STATUSES } from "@shared/schema/ancillaryCases";
import { canonicalBillingReadinessChecks } from "@shared/schema/billingReadiness";
import { canonicalBillingDocumentRequests } from "@shared/schema/billingDocuments";
import { canonicalClaimsRuntimeEnabled } from "../server/lib/featureFlags";
import { evaluateClaimReadiness } from "../server/services/canonicalFinancial/claimReadiness";

const APPLY = process.env.BACKFILL_CANONICAL_FINANCIAL_APPLY === "YES";
const LIMIT = Math.min(Math.max(1, parseInt(process.env.BACKFILL_CANONICAL_FINANCIAL_LIMIT ?? "200", 10) || 200), 1000);
const ACTIVE = new Set<string>(ANCILLARY_ACTIVE_LIFECYCLE_STATUSES as unknown as string[]);
const MIGRATION_CODES = new Set(["42P01", "42703"]);

export type Outcome =
  | "not_active" | "not_approved" | "no_current_billing_document"
  | "claim_ready" | "claim_blocked" | "evidence_conflict"
  | "migration_missing" | "apply_deferred_no_authorized_source";

/** Never advance a real financial state from a backfill. */
export function canApply(): boolean {
  return APPLY && canonicalClaimsRuntimeEnabled();
}

export type CasePlan = { ancillaryCaseId: number; serviceType: string; outcomes: Outcome[]; blockers: string[] };

/** Read-only classification for one case (never writes). */
export async function classify(acase: typeof patientAncillaryCases.$inferSelect): Promise<CasePlan> {
  const plan: CasePlan = { ancillaryCaseId: acase.id, serviceType: acase.serviceType, outcomes: [], blockers: [] };
  if (acase.clinicId == null || !ACTIVE.has(acase.lifecycleStatus)) { plan.outcomes.push("not_active"); return plan; }
  if (acase.adminReviewStatus !== "approved") { plan.outcomes.push("not_approved"); return plan; }
  const clinicId = acase.clinicId;
  const readiness = (await db.select().from(canonicalBillingReadinessChecks).where(and(eq(canonicalBillingReadinessChecks.clinicId, clinicId), eq(canonicalBillingReadinessChecks.ancillaryCaseId, acase.id), isNull(canonicalBillingReadinessChecks.supersededAt))).limit(10)).filter((r) => r.clinicId === clinicId && r.ancillaryCaseId === acase.id);
  const docs = (await db.select().from(canonicalBillingDocumentRequests).where(and(eq(canonicalBillingDocumentRequests.clinicId, clinicId), eq(canonicalBillingDocumentRequests.ancillaryCaseId, acase.id), isNull(canonicalBillingDocumentRequests.supersededAt))).limit(10)).filter((r) => r.clinicId === clinicId && r.ancillaryCaseId === acase.id);
  if (docs.length === 0) { plan.outcomes.push("no_current_billing_document"); return plan; }
  // Pass the case's verified identity so the §4 BD-identity check is active in the
  // dry-run report (a BD pointing at the wrong patient is reported, not silently ready).
  const result = evaluateClaimReadiness({ clinicId, ancillaryCaseId: acase.id, serviceType: acase.serviceType, verifiedGlobalPlexusPatientId: acase.globalPlexusPatientId ?? null, verifiedPatientClinicMembershipId: acase.patientClinicMembershipId ?? null }, readiness, docs);
  plan.blockers = result.blockers.map((b) => b.code);
  if (result.integrity === "conflicting") plan.outcomes.push("evidence_conflict");
  else if (result.claimReady) plan.outcomes.push("claim_ready");
  else plan.outcomes.push("claim_blocked");
  return plan;
}

async function main() {
  const mode = canApply() ? "APPLY(guarded-noop)" : APPLY ? "APPLY-REQUESTED(flags-off → dry-run)" : "DRY-RUN";
  console.log(`[phase2j-backfill] mode=${mode} limit=${LIMIT}`);
  let cases: typeof patientAncillaryCases.$inferSelect[];
  try {
    cases = await db.select().from(patientAncillaryCases).where(inArray(patientAncillaryCases.lifecycleStatus, [...ACTIVE])).limit(LIMIT);
  } catch (e) {
    if (MIGRATION_CODES.has((e as { code?: string })?.code ?? "")) { console.log("[phase2j-backfill] migration_missing — canonical tables not applied; nothing to do."); return; }
    throw e;
  }
  const tally = new Map<Outcome, number>();
  for (const c of cases) {
    let plan: CasePlan;
    try { plan = await classify(c); }
    catch (e) { if (MIGRATION_CODES.has((e as { code?: string })?.code ?? "")) plan = { ancillaryCaseId: c.id, serviceType: c.serviceType, outcomes: ["migration_missing"], blockers: [] }; else throw e; }
    for (const o of plan.outcomes) tally.set(o, (tally.get(o) ?? 0) + 1);
    if (plan.outcomes.some((o) => o === "claim_ready" || o === "evidence_conflict" || o === "claim_blocked"))
      console.log(`  case#${plan.ancillaryCaseId} ${plan.serviceType}: ${plan.outcomes.join(",")}${plan.blockers.length ? ` [${plan.blockers.join(",")}]` : ""}`);
  }
  if (canApply()) console.log("[phase2j-backfill] apply_deferred_no_authorized_source — no claim/invoice/payment created (frozen scope: statuses require an authorized source event or manual attestation).");
  console.log(`[phase2j-backfill] summary ${[...tally.entries()].map(([k, v]) => `${k}=${v}`).join(" ") || "(no cases)"}`);
}

// Only run when invoked directly (not when imported by a test).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().then(() => process.exit(0)).catch((e) => { console.error("[phase2j-backfill] error", e); process.exit(1); });
}
