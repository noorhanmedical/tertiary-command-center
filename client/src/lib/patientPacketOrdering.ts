// Single source of truth for the visible / packet / PDF ordering.
//
// The Plexus IQ flow has three surfaces that must agree on ordering:
//   1. Completed section visible list
//   2. PdfPatientSelectDialog (checkbox popup)
//   3. PDF preview + final saved PDF
//
// All three call this helper. It wraps orderPatientsWithinRun (the
// canonical Run-ordering helper) but accepts the wider PatientScreening
// shape so callers don't need to map twice. Outreach patients sort
// alphabetically by display name (A→Z), visit patients sort by
// appointment time ascending. Mixed lists put outreach first, then visit.

import type { PatientScreening } from "@shared/schema";
import { orderPatientsWithinRun } from "./qualificationRunOrdering";

export type PacketPatientLike = Pick<
  PatientScreening,
  "id" | "name" | "patientType" | "time"
>;

/**
 * Order a packet's patient roster for visible display, packet popup,
 * and PDF output. Returns a new array; never mutates the input.
 *
 *   raw outreach order: Zimmerman, Brown, Adams, Miller
 *   returned order:     Adams, Brown, Miller, Zimmerman
 *
 *   raw visit order:    10:00, 8:30, 9:15
 *   returned order:     8:30, 9:15, 10:00
 *
 * Mixed lists: outreach (alphabetical) first, visit (by appt time)
 * second.
 */
export function orderPacketPatientsForDisplayAndPdf<T extends PacketPatientLike>(
  patients: ReadonlyArray<T>,
): T[] {
  if (patients.length <= 1) return patients.slice() as T[];
  const rows = patients.map((p) => ({
    batchId: 0,
    batchCreatedAt: "",
    patientType: (p.patientType ?? "visit") as "visit" | "outreach" | string,
    patientId: p.id,
    name: p.name,
    appointmentTime: p.time ?? null,
  }));
  const ordered = orderPatientsWithinRun(rows);
  const byId = new Map(patients.map((p) => [p.id, p]));
  const out: T[] = [];
  for (const r of ordered) {
    const original = byId.get(r.patientId);
    if (original) out.push(original);
  }
  return out;
}
