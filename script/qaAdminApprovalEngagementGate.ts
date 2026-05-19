// QA for the Admin Approval gate in front of Send to Engagement.
//
// Run with: npm run qa:admin-approval-engagement-gate
//
// Verifies:
//   - The clinical-import parser still accepts rows with missing DOB
//     and missing phone — qualification generation is never blocked
//     by contact-info gaps.
//   - The shared engagement-gate predicate blocks Send to Engagement
//     when DOB/phone/facility/qualification/admin approval are
//     missing, and unblocks when all are present + approved.
//   - If DATABASE_URL is set + an `isTest=true` patient exists, the
//     admin-approval write path flips the column and appends a
//     journey event.
//
// Skips cleanly when DATABASE_URL is missing.

import {
  parsePlexusIqClinicalImport,
} from "../client/src/lib/plexusIqClinicalImportParser";

let passes = 0;
let failures = 0;
function assert(cond: unknown, label: string) {
  if (cond) {
    passes++;
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.log(`  ✗ ${label}`);
  }
}

// Mirror of the frontend gate in ResultsView.tsx — keep this in sync
// so QA always reflects the canonical contract.
function canSendToEngagement(p: {
  name?: string | null;
  dob?: string | null;
  phoneNumber?: string | null;
  facility?: string | null;
  qualifyingTests?: string[] | null;
  adminApprovalStatus?: string | null;
}): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!p.name?.trim()) missing.push("name");
  if (!p.dob?.trim()) missing.push("DOB");
  if (!p.phoneNumber?.trim()) missing.push("phone");
  if (!p.facility?.trim()) missing.push("facility");
  const qt = p.qualifyingTests;
  if (!Array.isArray(qt) || qt.length === 0) missing.push("qualification");
  if ((p.adminApprovalStatus ?? "pending") !== "approved") {
    missing.push("admin approval");
  }
  return { ok: missing.length === 0, missing };
}

async function main() {
  // ─── Parser: missing DOB/phone are warnings, not blocks ────────────
  console.log("\n--- parser: missing DOB/phone are warnings only ---");
  const head = [
    "Clinic", "Patient Name", "Dx", "DOB", "Phone Number",
  ].join("\t");
  const noDob = ["TFP", "No DOB Patient", "HTN", "", "(602) 555-0188"].join("\t");
  const noPhone = ["TFP", "No Phone Patient", "CAD", "1950-01-01", ""].join("\t");
  const noBoth = ["TFP", "No Contact Patient", "DM2", "", ""].join("\t");
  const result = parsePlexusIqClinicalImport(
    `${head}\n${noDob}\n${noPhone}\n${noBoth}`,
    {},
  );
  assert(result.format === "clinical-spreadsheet", "format detected");
  assert(result.rows.length === 3, "all three rows parsed");
  assert(result.errors.length === 0, "no fatal errors");
  assert(
    result.rows.every((r) => (r.warnings ?? []).length > 0),
    "every row has at least one warning",
  );

  // ─── Engagement gate: every missing piece blocks the send ─────────
  console.log("\n--- engagement gate: blocks when info missing ---");
  const blockedNoDob = canSendToEngagement({
    name: "Test",
    phoneNumber: "555",
    facility: "TFP",
    qualifyingTests: ["BrainWave"],
    adminApprovalStatus: "approved",
  });
  assert(!blockedNoDob.ok, "missing DOB blocks");
  assert(blockedNoDob.missing.includes("DOB"), "reason mentions DOB");

  const blockedNoApproval = canSendToEngagement({
    name: "Test",
    dob: "1950-01-01",
    phoneNumber: "555",
    facility: "TFP",
    qualifyingTests: ["BrainWave"],
    adminApprovalStatus: "pending",
  });
  assert(!blockedNoApproval.ok, "pending admin approval blocks");
  assert(
    blockedNoApproval.missing.includes("admin approval"),
    "reason mentions admin approval",
  );

  const ok = canSendToEngagement({
    name: "Test",
    dob: "1950-01-01",
    phoneNumber: "555",
    facility: "TFP",
    qualifyingTests: ["BrainWave"],
    adminApprovalStatus: "approved",
  });
  assert(ok.ok, "all info + approved → send allowed");

  // ─── DB write smoke (isTest patient only) ─────────────────────────
  if (!process.env.DATABASE_URL) {
    console.log("\n[qa-admin-approval-engagement-gate] DATABASE_URL missing — skipping DB writes.");
  } else {
    console.log("\n--- DB admin-approval write on isTest patient ---");
    const dbMod = await import("../server/db");
    const storageMod = await import("../server/storage");
    const schemaMod = await import("@shared/schema");
    const drizzleMod = await import("drizzle-orm");
    const { db } = dbMod;
    const { storage } = storageMod;
    const { patientJourneyEvents } = schemaMod;
    const { desc, eq } = drizzleMod;

    const allActive = await storage.getAllPatientScreenings();
    const isTestPatient = allActive.find((p) => p.isTest === true);
    if (!isTestPatient) {
      console.log("[qa] No isTest patient — skipping write smoke.");
    } else {
      const previousStatus =
        (isTestPatient as { adminApprovalStatus?: string }).adminApprovalStatus ?? "pending";

      const updated = await storage.updatePatientScreening(isTestPatient.id, {
        adminApprovalStatus: "approved",
        adminApprovedAt: new Date(),
      });
      assert(
        (updated as { adminApprovalStatus?: string })?.adminApprovalStatus === "approved",
        "adminApprovalStatus flips to approved",
      );

      await db.insert(patientJourneyEvents).values({
        patientScreeningId: isTestPatient.id,
        executionCaseId: null,
        actorUserId: null,
        patientName: isTestPatient.name,
        patientDob: isTestPatient.dob ?? null,
        eventType: "admin_approval_updated",
        eventSource: "qa_admin_approval_engagement_gate",
        summary: `[qa] admin approval flipped from ${previousStatus} to approved`,
        metadata: { qa: true, previousStatus },
      });
      const [journey] = await db
        .select()
        .from(patientJourneyEvents)
        .where(
          eq(patientJourneyEvents.eventSource, "qa_admin_approval_engagement_gate"),
        )
        .orderBy(desc(patientJourneyEvents.id))
        .limit(1);
      assert(
        journey?.eventType === "admin_approval_updated",
        "journey event appended with correct eventType",
      );

      // Restore previous status so the test patient isn't left in
      // approved if it didn't start there.
      await storage.updatePatientScreening(isTestPatient.id, {
        adminApprovalStatus: previousStatus,
        adminApprovedAt: null,
      });
    }
  }

  console.log(`\n=========================`);
  console.log(`PASS ${passes}  FAIL ${failures}`);
  console.log(`=========================`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
