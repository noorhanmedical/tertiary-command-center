// Slice F — deterministic canonical Procedure Note body renderer.
//
// Pure (no DB, no AI). A real procedure record — NOT a fake progress note.
// Rules enforced here:
//   • Claims a component occurred ONLY when its evidence says performed.
//   • Uses the approved full BrainWave/VitalWave paragraph ONLY when every
//     expected component was performed; otherwise builds a modular paragraph
//     from the actual components.
//   • Date of Service comes from real procedure evidence (completed_at) — never
//     generation time.
//   • References the EXACT signed Order Note (id + signature metadata); it does
//     NOT embed or regenerate the Order Note body.
//   • Contains NO ICD-10 or CPT codes.

import {
  allExpectedComponentsPerformed,
  type ProcedureComponents,
} from "@shared/schema/procedureComponents";

export const PROCEDURE_NOTE_GENERATOR_VERSION = "procedure_note_body_v1";

const APPROVED_BRAINWAVE =
  "The patient tolerated all procedures well. Neuropsychological testing was performed including assessment of memory, attention, and executive function. EEG/ECG testing was completed with 21-channel cap placement and lead positioning. VEP and AEP studies were conducted to assess visual and auditory evoked potentials. All testing equipment functioned properly and adequate signal quality was maintained throughout. Patient remained stable during all procedures with no adverse events. Results will be interpreted by the reviewing physician and communicated to the ordering clinician. The BrainWave testing was completed successfully.";

const APPROVED_VITALWAVE =
  "The patient tolerated all procedures well. Autonomic nervous system testing was performed including assessment of parasympathetic and sympathetic function with tilt table evaluation. Blood pressure and heart rate responses were monitored throughout position changes. Arterial physiologic studies of extremities were completed using segmental pressure measurements and waveform analysis at multiple levels. Rhythm electrocardiography was performed with continuous monitoring and interpretation. All testing equipment functioned properly and adequate signal quality was maintained throughout. Patient remained stable during all procedures with no adverse events. Results will be interpreted by the reviewing physician and communicated to the ordering clinician. The VitalWave testing was completed successfully and the patient was discharged in stable condition.";

const CLOSING =
  "All testing equipment functioned properly and adequate signal quality was maintained throughout. Patient remained stable during all procedures with no adverse events. Results will be interpreted by the reviewing physician and communicated to the ordering clinician.";

export type ProcedureNoteAssociatedOrder = {
  orderNoteId: number;
  orderDate?: string | null;
  signedAt?: string | null;
  orderingClinicianName?: string | null;
  status: string; // expected "signed"
};

export type ProcedureNoteRenderInput = {
  service: string;
  serviceLabel: string;
  patient: { name: string; dob?: string | null; mrn?: string | null; plexusId?: string | null; clinicName?: string | null };
  orderingClinician: { name: string; npi?: string | null };
  dateOfService: string | null; // procedure_events.completed_at (ISO) — never now()
  components: ProcedureComponents | null;
  procedureStatus: string;
  immediateComplications?: string | null;
  associatedOrder: ProcedureNoteAssociatedOrder | null;
};

export type ProcedureNoteSection = { heading: string; body: string };
export type RenderedProcedureNote = { sections: ProcedureNoteSection[]; text: string; associatedOrderNoteId: number | null };

function brainWaveModular(c: ProcedureComponents): string {
  if (c.service !== "brainwave") return "";
  const k = c.components;
  const parts: string[] = ["The patient tolerated all procedures well."];
  if (k.neuropsychologicalTesting.performed) parts.push("Neuropsychological testing was performed including assessment of memory, attention, and executive function.");
  if (k.eeg.performed) parts.push(`EEG testing was completed with ${k.eeg.channelCount ?? 21}-channel cap placement.`);
  if (k.ecg.performed) parts.push("ECG lead positioning and testing was completed.");
  if (k.vep.performed) parts.push("VEP studies were conducted to assess visual evoked potentials.");
  if (k.aep.performed) parts.push("AEP studies were conducted to assess auditory evoked potentials.");
  parts.push(CLOSING);
  parts.push("The BrainWave testing was completed.");
  return parts.join(" ");
}

function vitalWaveModular(c: ProcedureComponents): string {
  if (c.service !== "vitalwave") return "";
  const k = c.components;
  const parts: string[] = ["The patient tolerated all procedures well."];
  if (k.autonomicTesting.performed) parts.push("Autonomic nervous system testing was performed including assessment of parasympathetic and sympathetic function.");
  if (k.tiltTable.performed) parts.push("Tilt table evaluation was performed.");
  if (k.bloodPressureHeartRateMonitoring.performed) parts.push("Blood pressure and heart rate responses were monitored throughout position changes.");
  if (k.segmentalPressures.performed) parts.push("Arterial physiologic studies of extremities were completed using segmental pressure measurements at multiple levels.");
  if (k.waveformAnalysis.performed) parts.push("Waveform analysis was completed at multiple levels.");
  if (k.rhythmEcg.performed) parts.push("Rhythm electrocardiography was performed with continuous monitoring and interpretation.");
  parts.push(CLOSING);
  parts.push("The VitalWave testing was completed.");
  return parts.join(" ");
}

function procedureDetails(components: ProcedureComponents | null): string {
  if (!components) return "Procedure component detail was not recorded for this service episode.";
  if (allExpectedComponentsPerformed(components)) {
    return components.service === "brainwave" ? APPROVED_BRAINWAVE : APPROVED_VITALWAVE;
  }
  return components.service === "brainwave" ? brainWaveModular(components) : vitalWaveModular(components);
}

export function renderProcedureNoteBody(input: ProcedureNoteRenderInput): RenderedProcedureNote {
  const sections: ProcedureNoteSection[] = [];

  const info: string[] = [`Patient: ${input.patient.name}`];
  if (input.patient.dob) info.push(`DOB: ${input.patient.dob}`);
  if (input.patient.mrn) info.push(`MRN: ${input.patient.mrn}`);
  if (input.patient.plexusId) info.push(`Plexus ID: ${input.patient.plexusId}`);
  if (input.patient.clinicName) info.push(`Clinic: ${input.patient.clinicName}`);
  info.push(`Date of Service: ${input.dateOfService ?? "—"}`);
  info.push(`Ordering Clinician: ${input.orderingClinician.name}`);
  if (input.orderingClinician.npi) info.push(`NPI: ${input.orderingClinician.npi}`);
  sections.push({ heading: "PATIENT INFORMATION", body: info.join("\n") });

  sections.push({ heading: "PROCEDURE", body: input.serviceLabel });

  sections.push({
    heading: "INDICATION",
    body:
      `${serviceShort(input.service)} testing was performed pursuant to the associated signed physician order. ` +
      `The complete patient-specific clinical indication and medical-necessity documentation are contained in the associated Order Note.`,
  });

  sections.push({ heading: "PROCEDURE DETAILS", body: procedureDetails(input.components) });

  const statusLines: string[] = [
    `Status: ${input.procedureStatus === "complete" ? "Completed" : input.procedureStatus}`,
    `Date Completed: ${input.dateOfService ?? "—"}`,
    `Immediate Complications: ${input.immediateComplications?.trim() || "None reported"}`,
    `Diagnostic Interpretation: Maintained separately in the associated diagnostic report.`,
  ];
  sections.push({ heading: "PROCEDURE STATUS", body: statusLines.join("\n") });

  const ao = input.associatedOrder;
  const aoLines: string[] = ao
    ? [
        ao.status === "signed" ? "\u2713 Signed Order Note on File" : `Order Note status: ${ao.status}`,
        `Order: ${input.serviceLabel}`,
        `Ordering Clinician: ${ao.orderingClinicianName ?? input.orderingClinician.name}`,
        `Order Date: ${ao.orderDate ?? "—"}`,
        `Signed: ${ao.signedAt ?? "—"}`,
        `[View Order Note \u25be] (Order Note #${ao.orderNoteId})`,
      ]
    : ["No signed Order Note is associated with this procedure."];
  sections.push({ heading: "ASSOCIATED ORDER", body: aoLines.join("\n") });

  const text = sections.map((s) => `${s.heading}\n${"-".repeat(s.heading.length)}\n${s.body}`).join("\n\n");
  return { sections, text, associatedOrderNoteId: ao?.orderNoteId ?? null };
}

function serviceShort(service: string): string {
  const s = (service || "").toLowerCase();
  if (s.includes("brain")) return "BrainWave";
  if (s.includes("vital")) return "VitalWave";
  return service;
}
