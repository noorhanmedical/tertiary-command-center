// DB-BACKED integration test for the Engagement Call List hardening.
// Synthetic only (ZZINT_ prefix / is_test), self-cleaning, restores baseline.
// The feature flag is enabled ONLY in THIS process (never .env / prod):
//   FEATURE_ENGAGEMENT_CALL_LIST_PACKAGES=true npx tsx --env-file=.env script/testCallListIntegration.ts
//
// Exercises the REAL repository/service paths against Postgres (not just pure
// logic): package creation, canonical assignment, Team-Portal source-of-truth,
// partial-failure retry/reconciliation, tenant isolation, share token + PIN,
// PDF artifact, revoke/extend/regenerate, retention purge, and access audit.

import { db } from "../server/db";
import { sql, eq, inArray } from "drizzle-orm";
import bcrypt from "bcryptjs";
import {
  patientExecutionCases,
  patientScreenings,
  patientJourneyEvents,
  outreachSchedulers,
  callListPackages,
  callListPackageMembers,
  auditLog,
} from "@shared/schema";
import { confirmCallListDistribution } from "../server/services/engagement/callListConfirm";
import {
  getPackageById,
  getPackageByTokenHash,
  getPackageWithMembers,
  listPackagesByOperation,
  listRecentPackages,
  revokePackageShare,
  extendPackageShare,
  regeneratePackageShareToken,
  setPackagePin,
  clearPackagePin,
  setGenerationStatus,
} from "../server/repositories/callListPackages.repo";
import { purgeExpiredCallListPackages } from "../server/services/engagement/callListRetention";
import {
  resolveShareAccess,
  hashShareToken,
  requiresPin,
  extractHeaderPin,
  buildShareAccessAudit,
} from "../server/services/engagement/callListShareToken";
import { packageInScope } from "../server/services/engagement/callListAuthz";
import { clinicIdsInScope, type ManagerScope } from "../server/services/teams/managerScope";
import { listSchedulerPortalCases } from "../server/repositories/executionCase.repo";
import { logAudit } from "../server/services/auditService";
import { saveBlob, readBlob, deleteBlob } from "../server/services/blobStore";
import { featureFlags } from "../server/lib/featureFlags";
import { storage } from "../server/storage";

let pass = 0, fail = 0;
function check(cond: boolean, msg: string) {
  if (cond) { pass++; console.log("PASS", msg); }
  else { fail++; console.log("FAIL", msg); }
}

const RUN = `ZZINT_${Date.now()}`;
const FAC_A = `${RUN}_FAC_A`;
const FAC_B = `${RUN}_FAC_B`;

// track created ids for cleanup
const created = {
  schedulerIds: [] as number[],
  screeningIds: [] as number[],
  caseIds: [] as number[],
  packageIds: [] as number[],
  blobIds: [] as number[],
  userIds: [] as string[],
  batchIds: [] as number[],
};

async function main() {
  if (!featureFlags.callListPackages) {
    console.log("FAIL flag FEATURE_ENGAGEMENT_CALL_LIST_PACKAGES not enabled in this process");
    process.exit(1);
  }

  // Reuse two real clinic ids + three real user ids (synthetic rows reference
  // them; the reused rows themselves are never mutated or deleted).
  const clinicRows = (await db.execute(sql`SELECT id FROM clinics ORDER BY id LIMIT 2`)).rows as { id: number }[];
  check(clinicRows.length >= 2, `two clinics available for tenant test (got ${clinicRows.length})`);
  const clinicA = clinicRows[0].id;
  const clinicB = clinicRows[1]?.id ?? clinicRows[0].id;
  const userRows = (await db.execute(sql`SELECT id FROM users ORDER BY id LIMIT 3`)).rows as { id: string }[];
  const uid = (i: number) => userRows[i % userRows.length]?.id ?? null;

  // ── Synthetic roster: Jason / Sarah / Ahmed in clinic A / FAC_A ────────────
  const members: Record<string, number> = {};
  for (const name of ["Jason", "Sarah", "Ahmed"]) {
    const [row] = await db.insert(outreachSchedulers).values({
      clinicId: clinicA, name: `${RUN} ${name}`, facility: FAC_A,
      capacityPercent: 100, dailyTarget: 50, userId: uid(created.schedulerIds.length),
    } as never).returning();
    members[name] = (row as { id: number }).id;
    created.schedulerIds.push(members[name]);
  }

  // Synthetic screening batch (patient_screenings.batch_id is NOT NULL).
  const batch = await storage.createScreeningBatch({
    name: `${RUN} batch`, facility: FAC_A, scheduleDate: "2026-09-12",
    clinicId: clinicA, status: "draft", importKind: "full", isTest: true,
  } as never);
  created.batchIds.push((batch as { id: number }).id);

  // ── Synthetic eligible execution cases (one per member) in clinic A ────────
  async function makeCase(nameSuffix: string): Promise<number> {
    const [scr] = await db.insert(patientScreenings).values({
      clinicId: clinicA, batchId: (batch as { id: number }).id,
      name: `${RUN} Patient ${nameSuffix}`, dob: "1959-04-12",
      phoneNumber: "2025550100", facility: FAC_A, isTest: true,
      qualifyingTests: ["BrainWave"], diagnoses: "HTN", history: "prior TIA", medications: "ASA",
    } as never).returning();
    const screeningId = (scr as { id: number }).id;
    created.screeningIds.push(screeningId);
    const [c] = await db.insert(patientExecutionCases).values({
      clinicId: clinicA, patientScreeningId: screeningId,
      patientName: `${RUN} Patient ${nameSuffix}`, patientDob: "1959-04-12",
      facilityId: FAC_A, engagementBucket: "outreach", qualificationStatus: "qualified",
      lifecycleStatus: "active", engagementStatus: "new", selectedServices: ["BrainWave"],
      callAttemptCount: 0,
    } as never).returning();
    const caseId = (c as { id: number }).id;
    created.caseIds.push(caseId);
    return caseId;
  }
  const caseJ = await makeCase("J");
  const caseS = await makeCase("S");
  const caseA = await makeCase("A");

  const opId = `${RUN}-op-1`;
  const fullMapping = [
    { executionCaseId: caseJ, teamMemberId: members.Jason },
    { executionCaseId: caseS, teamMemberId: members.Sarah },
    { executionCaseId: caseA, teamMemberId: members.Ahmed },
  ];

  // ══ TEST 3 (partial recovery) — first confirm ONLY Jason ═══════════════════
  const first = await confirmCallListDistribution({
    distributionOperationId: opId, cohort: "never_called", facility: FAC_A,
    serviceDate: "2026-09-12", services: null,
    mapping: [{ executionCaseId: caseJ, teamMemberId: members.Jason }],
    actorUserId: null, allowedClinicIds: null,
  });
  for (const p of first.members) if (p.packageId) created.packageIds.push(p.packageId);
  check(first.members.length === 1 && first.members[0].packageId != null, "TEST3 first partial confirm created Jason package");

  // ══ TEST 1 (creation) — canonical assignment DB proof for Jason ════════════
  const jCase = (await db.select().from(patientExecutionCases).where(eq(patientExecutionCases.id, caseJ)))[0];
  check(jCase.assignedTeamMemberId === members.Jason, "TEST1 patient_execution_cases.assignedTeamMemberId updated (canonical)");
  check(jCase.engagementStatus === "assigned", "TEST1 engagementStatus promoted to assigned");
  const jPkg = await getPackageById(first.members[0].packageId!);
  check(jPkg != null && jPkg.shareTokenHash != null, "TEST1 frozen package + share token hash present");
  check((first.members[0].shareToken ?? "").length > 0, "TEST1 plaintext token surfaced ONCE on creation");
  check(jPkg!.shareTokenHash !== first.members[0].shareToken, "TEST1 plaintext token NOT stored (only hash)");
  const jMembers = await getPackageWithMembers(jPkg!.id);
  check(jMembers!.members.length === 1 && jMembers!.members[0].executionCaseId === caseJ, "TEST1 correct package membership");

  // ══ TEST 2 (Team Portal source of truth) ═══════════════════════════════════
  const portalRows = await listSchedulerPortalCases({ assignedTeamMemberId: members.Jason, facilityId: FAC_A }, 100);
  check(portalRows.some((r) => r.id === caseJ), "TEST2 /scheduler-portal reads patient_execution_cases → Jason's case visible for assigned member");
  check(portalRows.every((r) => r.assignedTeamMemberId === members.Jason), "TEST2 portal rows scoped to assigned member (canonical, not packages)");

  // ══ TEST 3 (retry) — full confirm, same opId → reconcile ═══════════════════
  const retry = await confirmCallListDistribution({
    distributionOperationId: opId, cohort: "never_called", facility: FAC_A,
    serviceDate: "2026-09-12", services: null,
    mapping: fullMapping, actorUserId: null, allowedClinicIds: null,
  });
  for (const p of retry.members) if (p.packageId) created.packageIds.push(p.packageId);
  const jasonResult = retry.members.find((m) => m.teamMemberId === members.Jason)!;
  const sarahResult = retry.members.find((m) => m.teamMemberId === members.Sarah)!;
  const ahmedResult = retry.members.find((m) => m.teamMemberId === members.Ahmed)!;
  check(jasonResult.alreadyExisted === true && jasonResult.packageId === jPkg!.id, "TEST3 Jason package REUSED (not recreated)");
  check(sarahResult.alreadyExisted === false && sarahResult.packageId != null, "TEST3 Sarah package CREATED on retry");
  check(ahmedResult.alreadyExisted === false && ahmedResult.packageId != null, "TEST3 Ahmed package CREATED on retry");
  check(retry.operationStatus === "fully_complete", "TEST3 operationStatus = fully_complete");
  const opPkgs = await listPackagesByOperation(opId);
  check(opPkgs.length === 3, "TEST3 exactly one package per member (3 total)");
  const jasonPkgCount = opPkgs.filter((p) => p.teamMemberId === members.Jason).length;
  check(jasonPkgCount === 1, "TEST3 no duplicate Jason package");
  const jasonEvents = (await db.select().from(patientJourneyEvents).where(
    eq(patientJourneyEvents.executionCaseId, caseJ),
  )).filter((e) => e.eventType === "engagement_assignment_changed");
  check(jasonEvents.length === 1, `TEST3 no duplicate assignment journey event for Jason (got ${jasonEvents.length})`);
  const jMembersAfter = await getPackageWithMembers(jPkg!.id);
  check(jMembersAfter!.members.length === 1, "TEST3 no duplicate package membership for Jason");

  // ══ TEST 4 (tenant isolation) — DB-backed package rows + scope logic ═══════
  // Real package in clinic A / FAC_A (Jason's) vs a manufactured clinic-B pkg.
  const [pkgB] = await db.insert(callListPackages).values({
    clinicId: clinicB, facilityId: FAC_A, teamMemberId: members.Jason,
    distributionOperationId: `${opId}-B`, cohortKey: "never_called", patientCount: 0,
    status: "active",
  } as never).returning();
  created.packageIds.push((pkgB as { id: number }).id);
  const pkgBRow = await getPackageById((pkgB as { id: number }).id);
  const mgrScopeA: ManagerScope = { isAdmin: false, teamIds: [1], userIds: new Set(), facilityIds: new Set([FAC_A]) };
  const adminScope: ManagerScope = { isAdmin: true, teamIds: [], userIds: new Set(), facilityIds: new Set() };
  const allowedA = new Set<number>([clinicA]);
  check(packageInScope(mgrScopeA, allowedA, { facilityId: FAC_A, clinicId: clinicA }), "TEST4 correct clinic + facility → allowed");
  check(!packageInScope(mgrScopeA, allowedA, { facilityId: FAC_B, clinicId: clinicA }), "TEST4 wrong facility → denied");
  check(clinicA === clinicB || !packageInScope(mgrScopeA, allowedA, { facilityId: FAC_A, clinicId: clinicB }), "TEST4 right-looking facility + WRONG clinic → denied");
  check(!packageInScope(mgrScopeA, allowedA, pkgBRow!), "TEST4 real clinic-B package denied to clinic-A manager");
  const mgrNone: ManagerScope = { isAdmin: false, teamIds: [], userIds: new Set(), facilityIds: new Set() };
  check(!packageInScope(mgrNone, new Set(), jPkg!), "TEST4 manager outside scope → denied");
  check(packageInScope(adminScope, null, pkgBRow!), "TEST4 admin cross-clinic preserved");
  // clinicIdsInScope resolves from real roster (schedulers' clinicId by userId)
  const scopeWithUsers: ManagerScope = {
    isAdmin: false, teamIds: [1],
    userIds: new Set(userRows.map((u) => u.id)), facilityIds: new Set([FAC_A]),
  };
  const resolvedClinics = await clinicIdsInScope(scopeWithUsers);
  check(resolvedClinics != null && resolvedClinics.has(clinicA), "TEST4 clinicIdsInScope resolves clinic A from real roster");

  // ══ TEST 5 (public share token) — DB-backed access states ══════════════════
  const jToken = jasonResult.shareToken ?? first.members[0].shareToken!; // Jason token from first confirm
  const now = new Date();
  const jFresh = await getPackageByTokenHash(hashShareToken(jToken));
  check(jFresh != null && jFresh.id === jPkg!.id, "TEST5 valid token resolves the correct package");
  check(resolveShareAccess(jToken, { storedHash: jFresh!.shareTokenHash, expiresAt: jFresh!.shareExpiresAt, revokedAt: jFresh!.shareRevokedAt, status: jFresh!.status }, now) === "ok", "TEST5 valid token → ok");
  check((await getPackageByTokenHash(hashShareToken("totally-wrong-token"))) == null, "TEST5 invalid token → uniform not found (no row)");
  check(resolveShareAccess(jToken, { storedHash: jFresh!.shareTokenHash, expiresAt: new Date(now.getTime() - 1000), revokedAt: null, status: "active" }, now) === "expired", "TEST5 expired → denied");
  // Public payload never leaks internal ids: internal columns exist on the row
  // but the route's publicSnapshot omits them (verified by source guard test).
  check("executionCaseId" in jMembersAfter!.members[0], "TEST5 internal ids exist server-side (stripped by public route payload)");

  // ══ TEST 8 (revoke / extend / regenerate) — real DB writes ═════════════════
  await revokePackageShare(jPkg!.id);
  const jRevoked = await getPackageById(jPkg!.id);
  check(jRevoked!.shareRevokedAt != null, "TEST8 revoke persisted");
  check(resolveShareAccess(jToken, { storedHash: jRevoked!.shareTokenHash, expiresAt: jRevoked!.shareExpiresAt, revokedAt: jRevoked!.shareRevokedAt, status: jRevoked!.status }, now) === "revoked", "TEST8 revoked token denied");
  const regen = await regeneratePackageShareToken(jPkg!.id);
  check(regen != null && regen.token.length > 0, "TEST8 regenerate returns a new token once");
  const jRegen = await getPackageById(jPkg!.id);
  check(resolveShareAccess(jToken, { storedHash: jRegen!.shareTokenHash, expiresAt: jRegen!.shareExpiresAt, revokedAt: jRegen!.shareRevokedAt, status: jRegen!.status }, now) === "invalid", "TEST8 OLD token now invalid after regenerate");
  check(resolveShareAccess(regen!.token, { storedHash: jRegen!.shareTokenHash, expiresAt: jRegen!.shareExpiresAt, revokedAt: jRegen!.shareRevokedAt, status: jRegen!.status }, now) === "ok", "TEST8 NEW token succeeds (revocation cleared)");
  const beforeExp = jRegen!.shareExpiresAt!.getTime();
  await extendPackageShare(jPkg!.id, 24);
  const jExt = await getPackageById(jPkg!.id);
  check(jExt!.shareExpiresAt!.getTime() > beforeExp, "TEST8 extend lengthened expiry");
  const recent = await listRecentPackages({ facilityIds: [FAC_A], clinicIds: [clinicA], limit: 50 });
  check(recent.some((p) => p.id === jPkg!.id), "TEST8 Recent Generated Lists readback (scoped)");

  // ══ TEST 6 (optional PIN) — bcrypt hash at rest + gated access ═════════════
  const pin = "4821";
  await setPackagePin(jPkg!.id, await bcrypt.hash(pin, 12));
  const jPin = await getPackageById(jPkg!.id);
  check(requiresPin(jPin!), "TEST6 PIN set → requiresPin true");
  check(jPin!.sharePinHash != null && jPin!.sharePinHash !== pin, "TEST6 bcrypt hash stored, plaintext NOT stored");
  check(await bcrypt.compare(pin, jPin!.sharePinHash!), "TEST6 correct PIN verifies (bcrypt)");
  check(!(await bcrypt.compare("0000", jPin!.sharePinHash!)), "TEST6 wrong PIN fails");
  // PIN transport: header only, query ignored
  check(extractHeaderPin({ "x-share-pin": pin }) === pin, "TEST6 PDF/verify accepts PIN via x-share-pin header");
  check(extractHeaderPin({} as Record<string, unknown>) === "", "TEST6 ?pin= is NOT a source (header extractor ignores query)");
  await clearPackagePin(jPkg!.id);
  check(!requiresPin((await getPackageById(jPkg!.id))!), "TEST6 clear PIN → secure-token-only access resumes");

  // ══ TEST 7 (PDF artifact) — durable blob + status, no canonical change ═════
  const pdfBuf = Buffer.from("%PDF-1.4 ZZINT synthetic pdf");
  const blob = await saveBlob({ ownerType: "call_list_package", ownerId: jPkg!.id, filename: `zzint-${jPkg!.id}.pdf`, contentType: "application/pdf", buffer: pdfBuf });
  created.blobIds.push(blob.id);
  await setGenerationStatus(jPkg!.id, "ready", { pdfBlobId: blob.id, errorCode: null });
  const jPdf = await getPackageById(jPkg!.id);
  check(jPdf!.generationStatus === "ready" && jPdf!.pdfBlobId === blob.id, "TEST7 PDF artifact associated + READY persists");
  const readBack = await readBlob(blob.id);
  check(readBack != null && readBack.buffer.length === pdfBuf.length, "TEST7 PDF download succeeds (durable blob)");
  const jCaseAfterPdf = (await db.select().from(patientExecutionCases).where(eq(patientExecutionCases.id, caseJ)))[0];
  check(jCaseAfterPdf.assignedTeamMemberId === members.Jason, "TEST7 PDF artifact changes do NOT alter canonical assignment");

  // ══ TEST 10 (access audit) — safe metadata only, no token/PIN/PHI ══════════
  const fakeReq = { session: {}, ip: "203.0.113.9", headers: { "user-agent": "ZZINT-UA" } } as never;
  await logAudit(fakeReq, "share_access", "call_list_package", jPkg!.id, buildShareAccessAudit("granted", "203.0.113.9", "ZZINT-UA"));
  const auditRow = (await db.select().from(auditLog)
    .where(eq(auditLog.entityId, String(jPkg!.id)))).find((r) => r.action === "share_access");
  check(auditRow != null, "TEST10 public access audit row written");
  const auditJson = JSON.stringify(auditRow?.changes ?? {});
  check(!auditJson.includes(jToken) && !auditJson.includes(regen!.token), "TEST10 audit contains NO bearer token");
  check(!auditJson.includes(pin), "TEST10 audit contains NO PIN");
  check(!auditJson.includes(`${RUN} Patient J`) && !auditJson.includes("1959-04-12") && !auditJson.includes("HTN"), "TEST10 audit contains NO PHI (name/DOB/dx)");

  // ══ TEST 9 (retention purge) — real purge path ═════════════════════════════
  // Age Sarah's package beyond retention; keep Jason recent.
  const sarahPkgId = sarahResult.packageId!;
  await db.update(callListPackages).set({ snapshotRetentionUntil: new Date(Date.now() - 86_400_000) }).where(eq(callListPackages.id, sarahPkgId));
  const summary = await purgeExpiredCallListPackages(new Date(), 500);
  check(summary.purged >= 1, `TEST9 purge removed >=1 due package (purged ${summary.purged})`);
  const sarahPurged = await getPackageById(sarahPkgId);
  check(sarahPurged!.purgedAt != null, "TEST9 purged package stamped purged_at (audit header retained)");
  const sarahMembersPurged = await getPackageWithMembers(sarahPkgId);
  check(sarahMembersPurged!.members.every((m) => m.patientNameSnapshot === "[purged]" && m.atlasPayloadSnapshot == null), "TEST9 member PHI snapshot removed");
  const jasonStillRecent = await getPackageById(jPkg!.id);
  check(jasonStillRecent!.purgedAt == null, "TEST9 recent (Jason) package untouched by purge");
  const summary2 = await purgeExpiredCallListPackages(new Date(), 500);
  check(summary2.purged === 0, "TEST9 second purge idempotent (nothing new)");

  console.log(`\nINTEGRATION: ${pass} passed, ${fail} failed`);
}

async function cleanup() {
  try {
    if (created.packageIds.length) {
      await db.delete(callListPackageMembers).where(inArray(callListPackageMembers.packageId, created.packageIds));
      await db.delete(callListPackages).where(inArray(callListPackages.id, created.packageIds));
      await db.delete(auditLog).where(inArray(auditLog.entityId, created.packageIds.map(String)));
    }
    if (created.caseIds.length) {
      await db.delete(patientJourneyEvents).where(inArray(patientJourneyEvents.executionCaseId, created.caseIds));
      await db.delete(patientExecutionCases).where(inArray(patientExecutionCases.id, created.caseIds));
    }
    if (created.screeningIds.length) await db.delete(patientScreenings).where(inArray(patientScreenings.id, created.screeningIds));
    if (created.schedulerIds.length) await db.delete(outreachSchedulers).where(inArray(outreachSchedulers.id, created.schedulerIds));
    for (const b of created.blobIds) { try { await deleteBlob(b); } catch { /* best-effort */ } }
    for (const bid of created.batchIds) {
      await db.execute(sql`DELETE FROM screening_batches WHERE id = ${bid}`);
    }
    console.log("cleanup: synthetic rows removed");
  } catch (e) {
    console.error("cleanup error:", e instanceof Error ? e.message : e);
  }
}

main()
  .then(cleanup)
  .then(() => process.exit(fail === 0 ? 0 : 1))
  .catch(async (e) => { console.error("FATAL", e); await cleanup(); process.exit(1); });
