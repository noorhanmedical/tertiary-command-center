// Slice F (DB wiring) — resolve the evidence needed to render a canonical
// Procedure Note body: patient identity, ordering clinician, the EXACT signed
// Order Note association, and validated procedure component evidence.
//
// DB-backed. NOT DB-VERIFIED until staging. Fail-closed: returns null / no
// association rather than fabricating.

import { db } from "../../db";
import { eq, and } from "drizzle-orm";
import { procedureEvents } from "@shared/schema/procedureEvents";
import { patientScreenings, screeningBatches } from "@shared/schema/screening";
import { getAncillaryCaseById } from "../../repositories/ancillaryCases.repo";
import { getActiveOrderNoteForCase } from "../../repositories/orderNoteLifecycle.repo";
import {
  parseProcedureComponents,
  type ProcedureComponents,
} from "@shared/schema/procedureComponents";
import { resolveClinicianNpi } from "../../../shared/plexus";
import type { ProcedureNoteAssociatedOrder } from "./procedureNoteBody";

export function procedureServiceLabel(service: string): string {
  const s = (service || "").toLowerCase();
  if (s.includes("brain")) return "BrainWave – Comprehensive Assessment";
  if (s.includes("vital")) return "VitalWave – Comprehensive Autonomic & Vascular Assessment";
  return service;
}

export type ProcedureNoteContext = {
  patient: { name: string; dob: string | null; plexusId: string | null };
  clinician: { name: string; npi: string | null };
  associatedOrder: ProcedureNoteAssociatedOrder | null; // present only when a current SIGNED order note exists
};

/** Load patient/clinician + the EXACT signed Order Note association for a case. */
export async function resolveProcedureNoteContext(
  clinicId: number,
  ancillaryCaseId: number,
): Promise<ProcedureNoteContext | null> {
  const acase = await getAncillaryCaseById(ancillaryCaseId);
  if (!acase || acase.clinicId !== clinicId) return null;

  const screeningId = (acase as { originatingScreeningId?: number | null }).originatingScreeningId ?? null;
  let ps: typeof patientScreenings.$inferSelect | undefined;
  if (screeningId != null) {
    [ps] = await db.select().from(patientScreenings).where(eq(patientScreenings.id, screeningId)).limit(1);
  }
  let clinicianName: string | null = null;
  if (ps?.batchId != null) {
    const [batch] = await db.select().from(screeningBatches).where(eq(screeningBatches.id, ps.batchId)).limit(1);
    clinicianName = batch?.clinicianName ?? null;
  }

  // EXACT signed Order Note association — the current non-superseded order note,
  // only when actually signed (never fabricate a signature).
  const orderNote = await getActiveOrderNoteForCase(ancillaryCaseId);
  const associatedOrder: ProcedureNoteAssociatedOrder | null =
    orderNote && orderNote.clinicId === clinicId && orderNote.signatureStatus === "signed"
      ? {
          orderNoteId: orderNote.id,
          orderDate: orderNote.effectiveClinicalDate?.toISOString() ?? null,
          signedAt: orderNote.signedAt?.toISOString() ?? null,
          orderingClinicianName: clinicianName,
          status: "signed",
        }
      : null;

  return {
    patient: {
      name: ps?.name ?? "Patient",
      dob: ps?.dob ?? null,
      plexusId: (acase as { globalPlexusPatientId?: number | null }).globalPlexusPatientId?.toString() ?? null,
    },
    clinician: { name: clinicianName ?? "Ordering Clinician", npi: (clinicianName ? resolveClinicianNpi(clinicianName) : null) ?? null },
    associatedOrder,
  };
}

/** Read validated procedure component evidence from procedure_events.metadata. */
export async function loadProcedureComponents(procedureEventId: number, serviceType: string): Promise<ProcedureComponents | null> {
  const [pe] = await db.select().from(procedureEvents).where(eq(procedureEvents.id, procedureEventId)).limit(1);
  if (!pe) return null;
  const raw = (pe.metadata as Record<string, unknown> | null)?.["components"] ?? null;
  return parseProcedureComponents(serviceType, raw);
}

export type RecordComponentsResult =
  | { status: "recorded" }
  | { status: "invalid_components" }
  | { status: "not_found" }
  | { status: "cross_clinic_denied" }
  | { status: "not_complete" };

/**
 * Persist VALIDATED component evidence onto procedure_events.metadata.components.
 * Rejects arbitrary JSON (must parse against the typed schema for the service),
 * requires the procedure to be complete, and is clinic-scoped. Additive merge
 * into metadata (never drops existing keys). DB write — NOT DB-VERIFIED.
 */
export async function recordProcedureComponents(args: {
  clinicId: number;
  procedureEventId: number;
  serviceType: string;
  rawComponents: unknown;
}): Promise<RecordComponentsResult> {
  const parsed = parseProcedureComponents(args.serviceType, args.rawComponents);
  if (!parsed) return { status: "invalid_components" };
  const [pe] = await db.select().from(procedureEvents).where(eq(procedureEvents.id, args.procedureEventId)).limit(1);
  if (!pe) return { status: "not_found" };
  if (pe.clinicId != null && pe.clinicId !== args.clinicId) return { status: "cross_clinic_denied" };
  if (pe.procedureStatus !== "complete") return { status: "not_complete" };
  const metadata = { ...((pe.metadata as Record<string, unknown>) ?? {}), components: parsed.components };
  await db
    .update(procedureEvents)
    .set({ metadata: metadata as never, updatedAt: new Date() })
    .where(and(eq(procedureEvents.id, args.procedureEventId), eq(procedureEvents.procedureStatus, "complete")));
  return { status: "recorded" };
}
