import type { Express, Request, Response } from "express";
import { getPatientPacket } from "../repositories/patientPacket.repo";

async function handlePatientPacket(req: Request, res: Response) {
  try {
    const q = req.query as Record<string, string | undefined>;
    const lookup: Parameters<typeof getPatientPacket>[0] = {};

    if (q.executionCaseId) {
      const id = parseInt(q.executionCaseId, 10);
      if (!isNaN(id)) lookup.executionCaseId = id;
    }
    if (q.patientScreeningId) {
      const id = parseInt(q.patientScreeningId, 10);
      if (!isNaN(id)) lookup.patientScreeningId = id;
    }
    if (q.patientName) lookup.patientName = q.patientName;
    if (q.patientDob) lookup.patientDob = q.patientDob;

    const hasLookup = lookup.executionCaseId != null
      || lookup.patientScreeningId != null
      || (lookup.patientName && lookup.patientDob);

    if (!hasLookup) {
      return res.status(400).json({
        error: "One of executionCaseId, patientScreeningId, or (patientName + patientDob) is required",
      });
    }

    const packet = await getPatientPacket(lookup);
    return res.json(packet);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
}

export function registerPatientPacketRoutes(app: Express) {
  // GET /api/patient-packet
  // Query params: executionCaseId | patientScreeningId | (patientName + patientDob)
  app.get("/api/patient-packet", handlePatientPacket);

  // GET /api/scheduler-portal/patient-packet
  // Convenience alias for scheduler portal callers; identical contract.
  app.get("/api/scheduler-portal/patient-packet", handlePatientPacket);

  // GET /api/technician-liaison/patient-packet
  // Convenience alias for technician liaison portal callers; identical contract.
  app.get("/api/technician-liaison/patient-packet", handlePatientPacket);
}
