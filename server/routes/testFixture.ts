import type { Express } from "express";
import { storage } from "../storage";
import { db } from "../db";
import {
  screeningBatches,
  patientScreenings,
  billingRecords,
  generatedNotes,
  uploadedDocuments,
  documentBlobs,
  outboxItems,
} from "@shared/schema";
import { and, eq, ilike, inArray, or } from "drizzle-orm";
import { saveBlob, deleteTestBlobs } from "../services/blobStore";
import { enqueueDriveFile, enqueueSheetSync, deleteTestOutboxItems, drainOutbox } from "../services/outbox";

// Canonical TestGuy identity — must match script/seedTestGuyFlow.ts and
// script/reconcileTestGuy.ts so every generator points at the same patient
// row. Drift here causes the patient packet lookup to resolve a stale row
// with no canonical spine attached.
const TEST_PATIENT_NAME = "TestGuy Robot";
const TEST_PATIENT_DOB = "01/01/1950";
const TEST_FACILITY = "Test Facility";
const TEST_INSURANCE = "Straight Medicare";
const TEST_PATIENT_AGE = 76;
const TEST_MRN = "TEST-ROBOT-001";
const TEST_BATCH_NAME = "TestGuy Robot — End-to-End Verification";

const TEST_PDF_BYTES = Buffer.from(
  "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n",
  "utf-8",
);

function requireAdmin(req: any, res: any, next: any) {
  if (!req.session?.userId) return res.status(401).json({ message: "Not authenticated" });
  if (req.session?.role !== "admin") return res.status(403).json({ message: "Admin only" });
  return next();
}

export function registerTestFixtureRoutes(app: Express) {
  app.post("/api/admin/test-fixture/run", requireAdmin, async (req, res) => {
    try {
      const { autoUpload } = (req.body ?? {}) as { autoUpload?: boolean };
      const facility = TEST_FACILITY;

      // 1) Cleanup prior run so this is idempotent.
      await runCleanup();

      // 2) Create batch
      const today = new Date().toISOString().slice(0, 10);
      const batch = await storage.createScreeningBatch({
        name: TEST_BATCH_NAME,
        clinicianName: "Dr. Robot (TEST)",
        patientCount: 1,
        status: "completed",
        facility,
        scheduleDate: today,
        isTest: true,
      });

      // 3) Create patient — canonical identity (matches seedTestGuyFlow + reconcileTestGuy)
      const patient = await storage.createPatientScreening({
        batchId: batch.id,
        time: "9:00 AM",
        name: TEST_PATIENT_NAME,
        age: TEST_PATIENT_AGE,
        gender: "M",
        dob: TEST_PATIENT_DOB,
        phoneNumber: "555-0100",
        insurance: TEST_INSURANCE,
        facility,
        diagnoses: "HTN, T2DM, hyperlipidemia",
        history: "Smoker x40 years, family hx CAD",
        medications: "Metformin, atorvastatin, lisinopril",
        previousTests: "None",
        previousTestsDate: null,
        noPreviousTests: true,
        notes: "Test fixture patient - safe to delete via admin cleanup.",
        qualifyingTests: ["BrainWave", "VitalWave", "Bilateral Carotid Duplex (93880)"],
        reasoning: {
          BrainWave: { clinician_understanding: "TEST", patient_talking_points: "TEST" },
          VitalWave: { clinician_understanding: "TEST", patient_talking_points: "TEST" },
        },
        cooldownTests: [],
        status: "completed",
        appointmentStatus: "pending",
        patientType: "visit",
        isTest: true,
      });

      // 4) Create billing records
      const tests = patient.qualifyingTests || [];
      const billingIds: number[] = [];
      for (const test of tests) {
        const r = await storage.createBillingRecord({
          patientId: patient.id,
          batchId: batch.id,
          service: test,
          facility,
          dateOfService: today,
          patientName: patient.name,
          dob: patient.dob,
          mrn: TEST_MRN,
          clinician: batch.clinicianName,
          insuranceInfo: patient.insurance,
          billingStatus: "Not Billed",
          paidStatus: "Unpaid",
          isTest: true,
        });
        billingIds.push(r.id);
      }

      // 5) Create generated notes (one Order Note per qualifying test)
      const notesIn = tests.map((service) => ({
        patientId: patient.id,
        batchId: batch.id,
        facility,
        scheduleDate: today,
        patientName: patient.name,
        service,
        docKind: "order_note",
        title: `${service} Order Note`,
        sections: [
          { heading: "Patient", body: `${patient.name} (TEST FIXTURE)` },
          { heading: "Order", body: `Order ${service} for clinical evaluation.` },
          { heading: "Indication", body: "Test fixture - automated verification only." },
        ],
        isTest: true,
      }));
      const notes = await storage.saveGeneratedNotes(notesIn as any);

      // 6) Save a sample uploaded document (PDF) into the blob store + uploaded_documents row
      const ud = await storage.saveUploadedDocument({
        facility,
        patientName: patient.name,
        ancillaryType: "BrainWave",
        docType: "screening_form",
        driveFileId: null,
        driveWebViewLink: null,
        isTest: true,
      });
      const udBlob = await saveBlob({
        ownerType: "uploaded_document",
        ownerId: ud.id,
        filename: `${patient.name} - BrainWave Screening Form (TEST).pdf`,
        contentType: "application/pdf",
        buffer: TEST_PDF_BYTES,
        isTest: true,
      });

      // 7) Save each generated note as a blob (text), enqueue Drive uploads
      const enqueued: any[] = [];
      for (const note of notes) {
        const sections = (note.sections as { heading: string; body: string }[]) || [];
        const content = sections.map((s) => `${s.heading}\n${s.body}`).join("\n\n");
        const buf = Buffer.from(content, "utf-8");
        const blob = await saveBlob({
          ownerType: "generated_note",
          ownerId: note.id,
          filename: `${note.patientName} - ${note.title}.txt`,
          contentType: "text/plain",
          buffer: buf,
          isTest: true,
        });
        const item = await enqueueDriveFile({
          blobId: blob.id,
          facility,
          patientName: patient.name,
          ancillaryType: serviceToAncillary(note.service),
          docKind: "order_note",
          filename: `${note.patientName} - ${note.title}`,
          isTest: true,
        });
        enqueued.push(item);
      }
      const udItem = await enqueueDriveFile({
        blobId: udBlob.id,
        facility,
        patientName: patient.name,
        ancillaryType: "BrainWave",
        docKind: "screening_form",
        filename: udBlob.filename,
        isTest: true,
      });
      enqueued.push(udItem);

      // 8) Enqueue sheet syncs (coalesced)
      const sheetBilling = await enqueueSheetSync("sheet_billing", true);
      const sheetPatients = await enqueueSheetSync("sheet_patients", true);

      // 9) Optional auto-upload — restricted to test items only.
      let drainResult: import("../services/outbox").DrainResult | null = null;
      if (autoUpload) {
        drainResult = await drainOutbox({ isTest: true });
      }

      res.json({
        success: true,
        batch,
        patient,
        billingIds,
        noteIds: notes.map((n) => n.id),
        uploadedDocumentId: ud.id,
        enqueuedItems: enqueued,
        sheetBillingItem: sheetBilling,
        sheetPatientsItem: sheetPatients,
        drainResult,
        message: `TestGuy Robot fixture ready. ${enqueued.length} Drive items + 2 Sheet syncs enqueued.${autoUpload ? " Auto-upload completed." : " Click 'Upload All' in the Outbox to verify Drive/Sheets."}`,
      });
    } catch (e: any) {
      console.error("Test fixture run error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/admin/test-fixture/cleanup", requireAdmin, async (_req, res) => {
    try {
      const result = await runCleanup();
      res.json({ success: true, ...result });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
}

function serviceToAncillary(service: string): string {
  if (service === "BrainWave") return "BrainWave";
  if (service === "VitalWave") return "VitalWave";
  return "Ultrasound";
}

async function runCleanup() {
  // Strict isTest=true cleanup, atomic via transaction. No name-based deletes.
  return await db.transaction(async (tx) => {
    const removedOutbox = (await tx.delete(outboxItems)
      .where(eq(outboxItems.isTest, true))
      .returning({ id: outboxItems.id })).length;

    const blobRows = await tx.select().from(documentBlobs).where(eq(documentBlobs.isTest, true));
    if (blobRows.length > 0) {
      const fs = await import("node:fs/promises");
      for (const r of blobRows) {
        try { await fs.unlink(r.storagePath); } catch (err: any) {
          console.error(`[cleanup] unlink test blob ${r.id}:`, err.message);
        }
      }
      await tx.delete(documentBlobs).where(eq(documentBlobs.isTest, true));
    }
    const removedBlobs = blobRows.length;

    const removedNotes = (await tx.delete(generatedNotes)
      .where(eq(generatedNotes.isTest, true))
      .returning({ id: generatedNotes.id })).length;

    const removedBilling = (await tx.delete(billingRecords)
      .where(eq(billingRecords.isTest, true))
      .returning({ id: billingRecords.id })).length;

    const removedUploadedDocs = (await tx.delete(uploadedDocuments)
      .where(eq(uploadedDocuments.isTest, true))
      .returning({ id: uploadedDocuments.id })).length;

    const removedPatients = (await tx.delete(patientScreenings)
      .where(eq(patientScreenings.isTest, true))
      .returning({ id: patientScreenings.id })).length;

    const removedBatches = (await tx.delete(screeningBatches)
      .where(eq(screeningBatches.isTest, true))
      .returning({ id: screeningBatches.id })).length;

    return {
      removedBatches,
      removedPatients,
      removedNotes,
      removedBilling,
      removedUploadedDocs,
      removedBlobs,
      removedOutbox,
    };
  });
}
