// Patient Directory writer service (Batch B).
//
// Real storage-backed mutations. Every public function writes an
// audit event via writePatientDirectoryEvent when the
// patient_directory_events table exists; otherwise the event write is
// a no-op (so the call still succeeds against the existing schema).
//
// Activation flag: USE_PATIENT_DIRECTORY_ACTIVATION (default OFF).
// Route registration consults this flag — see server/routes/patientDirectory.ts.

import { db } from "../../db";
import { sql } from "drizzle-orm";
import { storage } from "../../storage";
import {
  buildPatientIdentityIndex,
  lookupPatientInIndex,
  type PatientIdentityInput,
} from "../../../shared/patientIdentity";

export type PatientDirectoryEventKind =
  | "patient_created"
  | "imported"
  | "source_file_linked"
  | "qualification_run_seen"
  | "admin_review_opened"
  | "admin_approved"
  | "sent_to_engagement"
  | "call_list_added"
  | "call_result_recorded"
  | "follow_up_set"
  | "cooldown_set"
  | "cooldown_cleared"
  | "dnc_set"
  | "dnc_cleared"
  | "prior_test_added"
  | "packet_generated"
  | "profile_updated"
  | "visit_linked"
  | "procedure_linked"
  | "batch_deleted"
  | "import_submitted_for_approval";

export type PatientDirectoryEventWrite = {
  patientScreeningId: number | null;
  kind: PatientDirectoryEventKind;
  actorUserId?: string | null;
  sourceModule?: string | null;
  relatedEntityId?: number | null;
  relatedEntityType?: string | null;
  payload?: Record<string, unknown>;
};

// Re-export the activation flag accessor from its dedicated tiny
// module so callers that want only the flag can read it without
// pulling the db / storage layer.
export { isPatientDirectoryActivationEnabled } from "./patientDirectoryActivationFlag";

/** Insert an audit event. Safe no-op when the 0029 table is missing. */
export async function writePatientDirectoryEvent(event: PatientDirectoryEventWrite): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO patient_directory_events
        (patient_screening_id, kind, actor_user_id, source_module,
         related_entity_id, related_entity_type, payload)
      VALUES
        (${event.patientScreeningId},
         ${event.kind},
         ${event.actorUserId ?? null},
         ${event.sourceModule ?? "patient-directory"},
         ${event.relatedEntityId ?? null},
         ${event.relatedEntityType ?? null},
         ${JSON.stringify(event.payload ?? {})}::jsonb)
    `);
  } catch {
    // Table absent (0029 not applied) — silent no-op. The caller does
    // not lose its primary write; the audit row is best-effort.
  }
}

// Search ------------------------------------------------------------------

export type PatientDirectorySearchHit = {
  patientScreeningId: number;
  name: string;
  facility: string | null;
  dob: string | null;
  phoneNumber: string | null;
  mrn: string | null;
};

export async function searchPatientDirectory(
  query: string,
  limit = 50,
): Promise<ReadonlyArray<PatientDirectorySearchHit>> {
  const q = query.trim();
  if (q.length === 0) return [];
  // Use storage.getAllPatientScreenings + filter; lightweight for
  // staging. A future batch can swap for a dedicated indexed query.
  const all = await storage.getAllPatientScreenings();
  const lower = q.toLowerCase();
  const out: PatientDirectorySearchHit[] = [];
  for (const row of all) {
    const rec = row as unknown as Record<string, unknown>;
    const name = ((rec.name as string) ?? "").toLowerCase();
    const dob = (rec.dob as string | null) ?? "";
    const phone = (rec.phoneNumber as string | null) ?? "";
    const mrn = (rec.mrn as string | null) ?? "";
    if (
      name.includes(lower) ||
      dob.includes(q) ||
      phone.includes(q) ||
      (mrn && mrn.toLowerCase().includes(lower))
    ) {
      out.push({
        patientScreeningId: (rec.id as number) ?? 0,
        name: (rec.name as string) ?? "",
        facility: (rec.facility as string | null) ?? null,
        dob: dob || null,
        phoneNumber: phone || null,
        mrn: mrn || null,
      });
      if (out.length >= limit) break;
    }
  }
  return out;
}

// Create / update ---------------------------------------------------------

export type CreateProfileInput = {
  name: string;
  facility?: string | null;
  dob?: string | null;
  mrn?: string | null;
  phoneNumber?: string | null;
  email?: string | null;
  insurance?: string | null;
  notes?: string | null;
  batchId: number;
  patientType?: "visit" | "outreach";
  actorUserId?: string | null;
};

export async function createPatientDirectoryProfile(
  input: CreateProfileInput,
): Promise<{ patientScreeningId: number }> {
  if (!input.name) throw new Error("name required");
  if (!input.dob) throw new Error("dob required");
  // mrn is encouraged but not required (tier 2 / 3 still match).
  const insert: Record<string, unknown> = {
    batchId: input.batchId,
    name: input.name,
    dob: input.dob,
    facility: input.facility ?? null,
    phoneNumber: input.phoneNumber ?? null,
    email: input.email ?? null,
    insurance: input.insurance ?? null,
    notes: input.notes ?? null,
    patientType: input.patientType ?? "visit",
  };
  if (input.mrn) (insert as Record<string, unknown>).mrn = input.mrn;
  const created = await storage.createPatientScreening(insert as never);
  const id = (created as unknown as { id: number }).id;
  await writePatientDirectoryEvent({
    patientScreeningId: id,
    kind: "patient_created",
    actorUserId: input.actorUserId ?? null,
    payload: { batchId: input.batchId, facility: input.facility ?? null },
  });
  return { patientScreeningId: id };
}

export async function updatePatientDirectoryProfile(
  id: number,
  updates: Partial<CreateProfileInput>,
  actorUserId: string | null,
): Promise<void> {
  const patch: Record<string, unknown> = {};
  for (const k of ["name", "facility", "dob", "mrn", "phoneNumber", "email", "insurance", "notes"]) {
    const v = (updates as Record<string, unknown>)[k];
    if (v !== undefined) patch[k] = v;
  }
  if (Object.keys(patch).length === 0) return;
  await storage.updatePatientScreening(id, patch as never);
  await writePatientDirectoryEvent({
    patientScreeningId: id,
    kind: "profile_updated",
    actorUserId,
    payload: { fields: Object.keys(patch) },
  });
}

// Duplicate facts ---------------------------------------------------------

export type DuplicateFactsFor = {
  patientScreeningId: number;
  identity: PatientIdentityInput;
};

export type DuplicateFactsResponse = {
  sentToEngagement: Array<{ patientScreeningId: number; identity: PatientIdentityInput; sentAt: string | null }>;
  doNotContact: Array<{ patientScreeningId: number; identity: PatientIdentityInput; reason: string | null; setAt: string | null }>;
  cooldowns: Array<{ patientScreeningId: number; identity: PatientIdentityInput; active: boolean; endsAt: string | null; reason: string | null }>;
  priorTests: Array<{ identity: PatientIdentityInput; testName: string; dateOfService: string | null; facility: string | null }>;
};

export async function buildDuplicateFacts(
  targets: ReadonlyArray<DuplicateFactsFor>,
): Promise<DuplicateFactsResponse> {
  if (targets.length === 0) {
    return { sentToEngagement: [], doNotContact: [], cooldowns: [], priorTests: [] };
  }
  const all = await storage.getAllPatientScreenings();
  // Build an index by identity tier so we only pull rows that match.
  const idx = buildPatientIdentityIndex(all, (r) => ({
    name: (r as unknown as { name?: string }).name ?? null,
    facility: (r as unknown as { facility?: string | null }).facility ?? null,
    mrn: ((r as unknown as Record<string, unknown>).mrn as string | undefined) ?? null,
    dob: (r as unknown as { dob?: string | null }).dob ?? null,
    phoneNumber: (r as unknown as { phoneNumber?: string | null }).phoneNumber ?? null,
  }));

  const sentToEngagement: DuplicateFactsResponse["sentToEngagement"] = [];
  const dnc: DuplicateFactsResponse["doNotContact"] = [];
  const cooldowns: DuplicateFactsResponse["cooldowns"] = [];
  const priorTests: DuplicateFactsResponse["priorTests"] = [];

  for (const t of targets) {
    const hit = lookupPatientInIndex(idx, t.identity);
    if (!hit) continue;
    const row = hit.row as unknown as Record<string, unknown>;
    const id = (row.id as number) ?? 0;

    // sent-to-engagement: presence of any scheduler assignment.
    try {
      const assignment = await storage.getActiveAssignmentForPatient(id);
      if (assignment) {
        sentToEngagement.push({
          patientScreeningId: id,
          identity: t.identity,
          sentAt: ((): string | null => {
            const v = (assignment as unknown as Record<string, unknown>).createdAt;
            return v instanceof Date ? v.toISOString() : (v as string | null) ?? null;
          })(),
        });
      }
    } catch { /* skip */ }

    // DNC: prefer 0027 column, fall back to refused_dnc call outcome.
    const dncFlag = (row.do_not_contact as boolean | undefined) ?? false;
    if (dncFlag) {
      dnc.push({
        patientScreeningId: id,
        identity: t.identity,
        reason: (row.do_not_contact_reason as string | null) ?? null,
        setAt: ((row.do_not_contact_set_at as Date | string | null) ?? null) as string | null,
      });
    } else {
      try {
        const calls = await storage.listOutreachCallsForPatient(id);
        const dncCall = calls.find((c) => (c as unknown as { outcome?: string }).outcome === "refused_dnc");
        if (dncCall) {
          dnc.push({
            patientScreeningId: id,
            identity: t.identity,
            reason: ((dncCall as unknown as { notes?: string | null }).notes ?? null),
            setAt: ((dncCall as unknown as { startedAt?: Date | string | null }).startedAt ?? null) as string | null,
          });
        }
      } catch { /* skip */ }
    }

    // Cooldown: latest cooldown_record.
    try {
      const rows = await db.execute(sql`
        SELECT cooldown_status, cooldown_end_date, note
        FROM cooldown_records
        WHERE patient_screening_id = ${id}
        ORDER BY created_at DESC
        LIMIT 1
      `);
      const r = (rows as unknown as { rows?: Array<Record<string, unknown>> }).rows;
      const first = r?.[0];
      if (first) {
        cooldowns.push({
          patientScreeningId: id,
          identity: t.identity,
          active: (first.cooldown_status as string) === "active",
          endsAt: (first.cooldown_end_date as string | null) ?? null,
          reason: (first.note as string | null) ?? null,
        });
      }
    } catch { /* skip */ }

    // Prior tests via existing storage helper.
    try {
      const name = (row.name as string) ?? "";
      const dob = (row.dob as string | null) ?? null;
      if (name) {
        const tests = await storage.getPatientGroupTestHistory(name, dob);
        for (const test of tests) {
          const rec = test as unknown as Record<string, unknown>;
          priorTests.push({
            identity: t.identity,
            testName: (rec.testType as string) ?? "",
            dateOfService: (rec.dateOfService as string | null) ?? null,
            facility: (rec.facility as string | null) ?? null,
          });
        }
      }
    } catch { /* skip */ }
  }

  return { sentToEngagement, doNotContact: dnc, cooldowns, priorTests };
}

// DNC -------------------------------------------------------------------

export type SetDncInput = { reason: string | null; actorUserId: string | null };

export async function setDoNotContact(id: number, input: SetDncInput): Promise<void> {
  // Defensive write: only persists when 0027 columns exist.
  try {
    await db.execute(sql`
      UPDATE patient_screenings
      SET do_not_contact = true,
          do_not_contact_set_at = now(),
          do_not_contact_reason = ${input.reason ?? null},
          do_not_contact_set_by_user_id = ${input.actorUserId ?? null}
      WHERE id = ${id}
    `);
  } catch {
    // 0027 not applied — column doesn't exist. The audit event still
    // records the operator's intent so the action isn't lost.
  }
  await writePatientDirectoryEvent({
    patientScreeningId: id,
    kind: "dnc_set",
    actorUserId: input.actorUserId ?? null,
    payload: { reason: input.reason ?? null },
  });
}

export async function clearDoNotContact(id: number, actorUserId: string | null): Promise<void> {
  try {
    await db.execute(sql`
      UPDATE patient_screenings
      SET do_not_contact = false,
          do_not_contact_set_at = NULL,
          do_not_contact_reason = NULL,
          do_not_contact_set_by_user_id = NULL
      WHERE id = ${id}
    `);
  } catch { /* 0027 not applied */ }
  await writePatientDirectoryEvent({
    patientScreeningId: id,
    kind: "dnc_cleared",
    actorUserId,
  });
}

// Cooldown ----------------------------------------------------------------

export type SetCooldownInput = {
  endsAt: string; // ISO
  reason: string | null;
  actorUserId: string | null;
};

export async function setCooldown(id: number, input: SetCooldownInput): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO cooldown_records
        (patient_screening_id, service_type, cooldown_start_date,
         cooldown_end_date, cooldown_status, note, reviewed_by_user_id)
      VALUES
        (${id},
         ${"manual"},
         ${new Date().toISOString().slice(0, 10)},
         ${input.endsAt.slice(0, 10)},
         ${"active"},
         ${input.reason ?? null},
         ${input.actorUserId ?? null})
    `);
  } catch { /* cooldown_records exists today; only fails on connection error */ }
  await writePatientDirectoryEvent({
    patientScreeningId: id,
    kind: "cooldown_set",
    actorUserId: input.actorUserId ?? null,
    payload: { endsAt: input.endsAt, reason: input.reason ?? null },
  });
}

export async function clearCooldown(id: number, actorUserId: string | null): Promise<void> {
  try {
    await db.execute(sql`
      UPDATE cooldown_records
      SET cooldown_status = 'expired',
          reviewed_by_user_id = ${actorUserId ?? null},
          reviewed_at = now(),
          updated_at = now()
      WHERE patient_screening_id = ${id}
        AND cooldown_status = 'active'
    `);
  } catch { /* skip */ }
  await writePatientDirectoryEvent({
    patientScreeningId: id,
    kind: "cooldown_cleared",
    actorUserId,
  });
}

// Prior tests -------------------------------------------------------------

export type AddPriorTestInput = {
  patientName: string;
  testName: string;
  dateOfService: string | null;
  facility: string | null;
  source: string | null;
  notes: string | null;
  actorUserId: string | null;
};

export async function addPriorTest(id: number, input: AddPriorTestInput): Promise<void> {
  await storage.createTestHistory({
    patientName: input.patientName,
    testType: input.testName,
    dateOfService: input.dateOfService ?? "",
  } as never);
  await writePatientDirectoryEvent({
    patientScreeningId: id,
    kind: "prior_test_added",
    actorUserId: input.actorUserId ?? null,
    payload: {
      testName: input.testName,
      dateOfService: input.dateOfService ?? null,
      facility: input.facility ?? null,
      source: input.source ?? null,
    },
  });
}
