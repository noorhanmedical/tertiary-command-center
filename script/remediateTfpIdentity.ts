/**
 * ONE-TIME remediation — TFP 1,820 canonical identity build (Option B).
 *
 * Corrects the historical contamination from import job 124, where the old
 * importer wrote the 43-char EXTERNAL Patient ID into patient_screenings.mrn
 * for a clinic-null population that never got a canonical identity. Per matched
 * (source ↔ screening) row this:
 *   1. assigns clinic_id = TFP (resolved, not guessed)
 *   2. writes the TRUE MRN (from the authoritative source file) onto the screening
 *   3. creates/reuses global_plexus_patient + patient_clinic_membership via the
 *      SHARED canonical orchestrator (clinic_mrn = true MRN)
 *   4. persists the external Patient ID as ehr_patient_id (never as MRN)
 *   5. links the existing screening (no new screening row)
 *
 * Safety:
 *   • DRY-RUN by default. Prints counts only; zero writes.
 *   • APPLY requires BOTH:  REMEDIATE_TFP_APPLY=YES  and  FEATURE_PLEXUS_IDENTITY_WRITE=true
 *   • Fresh name+DOB+phone exact-one match recomputed every run.
 *   • Per-row precondition re-check immediately before each write.
 *   • Idempotent + resumable (ALREADY_REMEDIATED detection).
 *   • The single known outlier (screeningId 50) is held, never touched.
 *   • Never re-imports patients. Never creates a screening. Never merges on name.
 *   • No PHI in output — counts, outcome codes, and integer ids only.
 *
 * Usage:
 *   npx tsx script/remediateTfpIdentity.ts                                   # dry-run
 *   REMEDIATE_TFP_APPLY=YES FEATURE_PLEXUS_IDENTITY_WRITE=true \
 *     npx tsx script/remediateTfpIdentity.ts                                 # apply
 */

import fs from "node:fs";
import { db, pool } from "../server/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { patientScreenings } from "@shared/schema/screening";
import { patientClinicMemberships } from "@shared/schema/plexusIdentity";
import { featureFlags } from "../server/lib/featureFlags";
import { parseLargeFile } from "../server/services/largeImport/streamingParsers";
import { resolveAndLinkPlexusIdentityForScreening } from "../server/services/plexusIdentity/screeningIntegration";
import { findExternalIdentifiersByMatchValue } from "../server/repositories/plexusIdentity.repo";
import {
  classifyRemediation,
  wouldMrnCollide,
  wouldExternalIdCollide,
  type RemediationRowState,
} from "../server/services/plexusIdentity/tfpRemediationClassify";

const SOURCE_FILE = process.env.TFP_SOURCE_FILE || "/Users/aliimran/Downloads/Active 1,820 TFP Patients.csv";
const TFP_CLINIC_ID = 1; // "Taylor Family Practice" — resolved from clinics table (active, unique)
const OUTLIER_SCREENING_IDS = new Set<number>([50]); // held for manual identity review
const BATCH = 100;
const SOURCE_SYSTEM = "remediate_tfp_identity";

const nName = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z]/g, "");
const nPhone = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
const nMrnKey = (clinicId: number, mrn: string) => `${clinicId}::${mrn.replace(/\s+/g, " ").trim().toUpperCase()}`;
const nExtId = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ").toUpperCase();

type SrcRow = { name: string; dob: string | null; phone: string | null; email: string | null; mrn: string | null; patientId: string | null };

async function main(): Promise<void> {
  const apply = process.env.REMEDIATE_TFP_APPLY === "YES";
  if (apply && !featureFlags.plexusIdentityWrite) {
    console.error("Refusing to apply: REMEDIATE_TFP_APPLY=YES but FEATURE_PLEXUS_IDENTITY_WRITE is not enabled.");
    process.exit(2);
  }

  // ── source (authoritative) ────────────────────────────────────────────
  const parse = await parseLargeFile(SOURCE_FILE, "csv", { defaultFacility: null });
  const srcRows: SrcRow[] = parse.rows.map((r) => ({
    name: r.name, dob: r.dob, phone: r.phone, email: r.email, mrn: r.mrn, patientId: r.patientId ?? null,
  }));

  // ── DB screenings (active) ────────────────────────────────────────────
  const screenings = await db
    .select({
      id: patientScreenings.id,
      clinicId: patientScreenings.clinicId,
      name: patientScreenings.name,
      dob: patientScreenings.dob,
      phone: patientScreenings.phoneNumber,
      mrn: patientScreenings.mrn,
      membershipId: patientScreenings.patientClinicMembershipId,
      globalId: patientScreenings.globalPlexusPatientId,
    })
    .from(patientScreenings)
    .where(isNull(patientScreenings.deletedAt));

  const byNdp = new Map<string, typeof screenings>();
  for (const s of screenings) {
    const k = `${nName(s.name)}|${(s.dob ?? "").trim()}|${nPhone(s.phone)}`;
    (byNdp.get(k) ?? byNdp.set(k, []).get(k)!).push(s);
  }

  // ── clinic-mrn ownership index (collision guard) ──────────────────────
  const memberships = await db
    .select({ id: patientClinicMemberships.id, clinicId: patientClinicMemberships.clinicId, clinicMrn: patientClinicMemberships.clinicMrn })
    .from(patientClinicMemberships);
  const ownedByClinicMrn = new Map<string, number>();
  for (const m of memberships) {
    if (m.clinicMrn && m.clinicMrn.trim()) ownedByClinicMrn.set(nMrnKey(m.clinicId, m.clinicMrn), m.id);
  }

  // ── match + classify ──────────────────────────────────────────────────
  type Plan = { row: number; screeningId: number | null; cls: string; reason?: string };
  const plan: Plan[] = [];
  const safe: Array<{ srcIndex: number; screeningId: number; src: SrcRow }> = [];

  srcRows.forEach((src, i) => {
    const k = `${nName(src.name)}|${(src.dob ?? "").trim()}|${nPhone(src.phone)}`;
    const cands = byNdp.get(k) ?? [];
    if (cands.length === 0) { plan.push({ row: i + 1, screeningId: null, cls: "UNMATCHED" }); return; }
    if (cands.length > 1) { plan.push({ row: i + 1, screeningId: null, cls: "AMBIGUOUS", reason: `n=${cands.length}` }); return; }
    const s = cands[0];
    const state: RemediationRowState = {
      screeningId: s.id, dbMrn: s.mrn, dbClinicId: s.clinicId, dbMembershipId: s.membershipId, dbGlobalId: s.globalId,
      sourceMrn: src.mrn, sourcePatientId: src.patientId, isOutlier: OUTLIER_SCREENING_IDS.has(s.id),
    };
    const d = classifyRemediation(state);
    // live collision guards for otherwise-safe rows
    if (d.classification === "SAFE_REMEDIATE" && src.mrn) {
      if (wouldMrnCollide({ targetMrn: src.mrn, clinicId: TFP_CLINIC_ID, ownedByClinicMrn, selfMembershipId: s.membershipId })) {
        plan.push({ row: i + 1, screeningId: s.id, cls: "BLOCKED_MRN_COLLISION" }); return;
      }
    }
    plan.push({ row: i + 1, screeningId: s.id, cls: d.classification, reason: d.reason });
    if (d.classification === "SAFE_REMEDIATE") safe.push({ srcIndex: i, screeningId: s.id, src });
  });

  const tally = (c: string) => plan.filter((p) => p.cls === c).length;
  const summaryBase = {
    mode: apply ? "APPLY" : "DRY_RUN",
    tfpClinicId: TFP_CLINIC_ID,
    sourceRows: srcRows.length,
    matchedExactOne: plan.filter((p) => p.screeningId != null).length,
    SAFE_REMEDIATE: tally("SAFE_REMEDIATE"),
    ALREADY_REMEDIATED: tally("ALREADY_REMEDIATED"),
    OUTLIER_MANUAL_REVIEW: tally("OUTLIER_MANUAL_REVIEW"),
    BLOCKED_MRN_COLLISION: tally("BLOCKED_MRN_COLLISION"),
    BLOCKED_MISSING_SOURCE: tally("BLOCKED_MISSING_SOURCE"),
    BLOCKED_UNEXPECTED_STATE: tally("BLOCKED_UNEXPECTED_STATE"),
    UNMATCHED: tally("UNMATCHED"),
    AMBIGUOUS: tally("AMBIGUOUS"),
    distinctSourceMrns: new Set(srcRows.map((r) => (r.mrn ?? "").trim()).filter(Boolean)).size,
  };

  if (!apply) {
    console.log(JSON.stringify({ summary: summaryBase, note: "DRY-RUN — zero writes" }, null, 2));
    await pool.end();
    return;
  }

  // ── APPLY (gated) ─────────────────────────────────────────────────────
  const result = { attempted: 0, remediated: 0, alreadyRemediated: 0, failed: 0, newGlobal: 0, reuseGlobal: 0, newMembership: 0, reuseMembership: 0, extIdCollision: 0 };
  const failures: Array<{ screeningId: number; code?: string }> = [];

  for (let b = 0; b < safe.length; b += BATCH) {
    const chunk = safe.slice(b, b + BATCH);
    for (const item of chunk) {
      result.attempted += 1;
      try {
        // Precondition re-check against the LIVE row (resumable + idempotent).
        const [live] = await db
          .select({ id: patientScreenings.id, clinicId: patientScreenings.clinicId, name: patientScreenings.name, dob: patientScreenings.dob, phone: patientScreenings.phoneNumber, mrn: patientScreenings.mrn, membershipId: patientScreenings.patientClinicMembershipId, globalId: patientScreenings.globalPlexusPatientId })
          .from(patientScreenings)
          .where(and(eq(patientScreenings.id, item.screeningId), isNull(patientScreenings.deletedAt)));
        if (!live) { result.failed += 1; failures.push({ screeningId: item.screeningId, code: "row_gone" }); continue; }
        const d = classifyRemediation({
          screeningId: live.id, dbMrn: live.mrn, dbClinicId: live.clinicId, dbMembershipId: live.membershipId, dbGlobalId: live.globalId,
          sourceMrn: item.src.mrn, sourcePatientId: item.src.patientId, isOutlier: OUTLIER_SCREENING_IDS.has(live.id),
        });
        if (d.classification === "ALREADY_REMEDIATED") { result.alreadyRemediated += 1; continue; }
        if (d.classification !== "SAFE_REMEDIATE") { result.failed += 1; failures.push({ screeningId: item.screeningId, code: d.classification }); continue; }

        // external-id collision guard (live)
        const owners = await findExternalIdentifiersByMatchValue({ identifierType: "ehr_patient_id", normalizedOrHashedMatchValue: nExtId(item.src.patientId) });
        if (wouldExternalIdCollide({ ownerGlobalIds: owners.map((o) => o.globalPlexusPatientId), selfGlobalId: live.globalId })) {
          result.extIdCollision += 1; result.failed += 1; failures.push({ screeningId: item.screeningId, code: "ext_id_collision" }); continue;
        }

        // (1)+(2) assign clinic + write TRUE MRN onto the existing screening.
        await db.update(patientScreenings)
          .set({ clinicId: TFP_CLINIC_ID, mrn: (item.src.mrn ?? "").trim() })
          .where(eq(patientScreenings.id, item.screeningId));

        // (3)+(4)+(5) canonical global + membership (clinic_mrn = true MRN) +
        // ehr_patient_id + screening linkage, via the SHARED orchestrator.
        const link = await resolveAndLinkPlexusIdentityForScreening({
          screeningId: item.screeningId,
          clinicId: TFP_CLINIC_ID,
          sourceSystem: SOURCE_SYSTEM,
          sourcePatientIdentifier: item.src.patientId,
          clinicMrn: item.src.mrn,
          externalPatientId: item.src.patientId,
          demographics: { displayName: item.src.name, dob: item.src.dob, phone: item.src.phone, email: item.src.email },
        });
        if (link.status !== "linked") { result.failed += 1; failures.push({ screeningId: item.screeningId, code: link.status }); continue; }
        result.remediated += 1;
        if (link.isNewGlobal) result.newGlobal += 1; else result.reuseGlobal += 1;
        if (link.isNewMembership) result.newMembership += 1; else result.reuseMembership += 1;
      } catch (e) {
        result.failed += 1;
        failures.push({ screeningId: item.screeningId, code: (e as { code?: string })?.code });
      }
    }
    console.error(`[progress] ${Math.min(b + BATCH, safe.length)}/${safe.length} processed`);
  }

  console.log(JSON.stringify({ summary: summaryBase, apply: result, failures: failures.slice(0, 50), failureCount: failures.length }, null, 2));
  await pool.end();
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(JSON.stringify({ level: "error", source: "remediate_tfp_identity", code: (err as { code?: string })?.code, message: (err as Error)?.message ?? String(err) }));
    process.exit(1);
  },
);

void sql;
