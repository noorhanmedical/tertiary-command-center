// Order Note standard — canonical per-service configuration.
//
// Defines, per ancillary service: the physician-facing service label used in
// the Order Note, and the CANONICAL ORDERED COMPONENTS (the standard protocol
// Plexus performs for that service). OpenAI may justify ONLY components listed
// here as ordered — it must never infer components from the umbrella name.
//
// This is deterministic config (no AI, no ICD/CPT). Ordered components are the
// canonical protocol because Plexus performs the full standard protocol per
// service; there is no reliable per-case ordered-component selection today.
// If/when a case-specific ordered-component selection is persisted, the bundle
// assembler can override these defaults with the actual selection.

export type OrderedComponent = {
  key: string;
  label: string;
  // Deterministic clinical purpose — NOT a result or presumption. Guides the
  // model on what clinical question the component helps evaluate.
  clinicalPurpose: string;
};

export type OrderNoteServiceConfig = {
  // canonical serviceType key match (lowercased substring test order matters)
  serviceLabel: string;
  orderedComponents: OrderedComponent[];
  // Prerequisite / required-evidence declaration. Screening, labs, and imaging
  // are EVIDENCE INPUTS, not universal prerequisites. A service only REQUIRES a
  // structured A0 screening artifact when it explicitly declares it here. This
  // is deliberately NOT inferred from the service name. Default: no artifact is
  // required, so missing optional evidence never blocks order-note generation.
  requiredEvidence?: {
    // When true, a completed structured (A0) screening MUST exist before the
    // deterministic/AI order-note body can be SIGNED. This is an ORDER-NOTE
    // prerequisite. Consumed by orderNoteRequiresStructuredScreening().
    structuredScreening?: boolean;
    // When true, an exact CURRENT SIGNED Order Note (and validated component
    // evidence) MUST exist before the canonical Procedure Note can be
    // generated. This is a PROCEDURE prerequisite — a SEPARATE concept from
    // structuredScreening. Consumed by procedureRequiresSignedOrderNote().
    signedOrderNoteForProcedure?: boolean;
  };
};

// Ordered, most-specific-first so "stress echocardiogram" is matched before the
// generic echocardiogram entry, and "lower extremity venous" before a bare
// "lower extremity" would be (there is no bare entry, but order is preserved).
const SERVICE_MATCHERS: Array<{ test: (s: string) => boolean; config: OrderNoteServiceConfig }> = [
  {
    test: (s) => s.includes("brain") || s.includes("brainwave"),
    config: {
      serviceLabel: "BrainWave – Comprehensive Assessment",
      // BrainWave is a structured-screening (A0) service: the completed
      // questionnaire is a true clinical prerequisite for signing its Order
      // Note, and its Procedure Note requires an exact signed Order Note +
      // validated component evidence. Both declared explicitly here (never
      // inferred from the service name).
      requiredEvidence: { structuredScreening: true, signedOrderNoteForProcedure: true },
      orderedComponents: [
        { key: "neuropsychologicalTesting", label: "Neuropsychological testing", clinicalPurpose: "objective assessment of memory, attention, processing, and executive function" },
        { key: "eeg", label: "EEG acquisition", clinicalPurpose: "objective recording of cerebral electrical activity" },
        { key: "digitalEegAnalysis", label: "Digital EEG analysis", clinicalPurpose: "quantitative analysis supplementing review of the recorded EEG" },
        { key: "rhythmEcg", label: "Rhythm ECG", clinicalPurpose: "concurrent cardiac rhythm information during the testing encounter" },
        { key: "vep", label: "Visual evoked-potential (VEP) testing", clinicalPurpose: "objective assessment of conduction through the visual sensory pathway" },
        { key: "aep", label: "Auditory evoked-potential (AEP) testing", clinicalPurpose: "objective assessment of conduction through the auditory sensory pathway" },
      ],
    },
  },
  {
    test: (s) => s.includes("vital") || s.includes("vitalwave"),
    config: {
      serviceLabel: "VitalWave – Comprehensive Autonomic & Vascular Assessment",
      // VitalWave is a structured-screening (A0) service: the completed
      // questionnaire is a true clinical prerequisite for signing its Order
      // Note, and its Procedure Note requires an exact signed Order Note +
      // validated component evidence. Both declared explicitly here (never
      // inferred from the service name).
      requiredEvidence: { structuredScreening: true, signedOrderNoteForProcedure: true },
      orderedComponents: [
        { key: "autonomicTesting", label: "Autonomic nervous system testing (parasympathetic & sympathetic)", clinicalPurpose: "objective assessment of autonomic cardiovascular regulation" },
        { key: "tiltTable", label: "Tilt-table / positional evaluation", clinicalPurpose: "assessment of physiologic responses to positional change" },
        { key: "bloodPressureHeartRateMonitoring", label: "Blood-pressure and heart-rate response monitoring", clinicalPurpose: "monitoring of hemodynamic responses across position changes" },
        { key: "segmentalPressures", label: "Segmental pressure measurements", clinicalPurpose: "objective characterization of peripheral arterial circulation" },
        { key: "waveformAnalysis", label: "Arterial waveform analysis", clinicalPurpose: "characterization of arterial physiologic waveforms at multiple levels" },
        { key: "rhythmEcg", label: "Rhythm ECG", clinicalPurpose: "concurrent cardiac rhythm information during the physiologic assessment" },
      ],
    },
  },
  {
    test: (s) => s.includes("stress echo"),
    config: {
      serviceLabel: "Stress Echocardiogram",
      orderedComponents: [
        { key: "restingEcho", label: "Resting transthoracic echocardiographic imaging", clinicalPurpose: "baseline assessment of cardiac structure and function" },
        { key: "stressImaging", label: "Stress echocardiographic imaging", clinicalPurpose: "assessment of cardiac function under stress" },
        { key: "ecgMonitoring", label: "Continuous ECG monitoring", clinicalPurpose: "rhythm and ischemic monitoring during stress" },
      ],
    },
  },
  {
    test: (s) => s.includes("echo") || s.includes("tte"),
    config: {
      serviceLabel: "Complete Transthoracic Echocardiogram",
      orderedComponents: [
        { key: "twoDImaging", label: "Two-dimensional transthoracic imaging", clinicalPurpose: "evaluation of cardiac anatomy, chamber dimensions, and ventricular function" },
        { key: "spectralDoppler", label: "Spectral Doppler assessment", clinicalPurpose: "assessment of intracardiac blood flow and valvular hemodynamics" },
        { key: "colorFlowDoppler", label: "Color-flow Doppler imaging", clinicalPurpose: "characterization of blood-flow patterns and potential valvular abnormalities" },
      ],
    },
  },
  {
    test: (s) => s.includes("carotid"),
    config: {
      serviceLabel: "Bilateral Carotid Duplex",
      orderedComponents: [
        { key: "grayscaleImaging", label: "Grayscale duplex imaging of the carotid arteries", clinicalPurpose: "evaluation of the carotid vessel walls and lumen" },
        { key: "dopplerVelocities", label: "Spectral Doppler velocity measurements", clinicalPurpose: "objective assessment for hemodynamically significant stenosis" },
        { key: "colorFlow", label: "Color-flow Doppler", clinicalPurpose: "characterization of carotid blood-flow patterns" },
      ],
    },
  },
  {
    test: (s) => s.includes("renal"),
    config: {
      serviceLabel: "Renal Artery Duplex",
      orderedComponents: [
        { key: "renalGrayscale", label: "Grayscale imaging of the renal arteries and kidneys", clinicalPurpose: "evaluation of renal vascular anatomy" },
        { key: "renalDoppler", label: "Spectral Doppler velocity assessment", clinicalPurpose: "objective assessment for renal artery stenosis" },
        { key: "renalColorFlow", label: "Color-flow Doppler", clinicalPurpose: "characterization of renal arterial flow" },
      ],
    },
  },
  {
    test: (s) => s.includes("lower extremity arterial") || (s.includes("arterial") && s.includes("doppler")),
    config: {
      serviceLabel: "Lower Extremity Arterial Duplex",
      orderedComponents: [
        { key: "segmentalPressures", label: "Segmental pressure measurements", clinicalPurpose: "objective characterization of lower-extremity arterial perfusion at multiple levels" },
        { key: "waveformAnalysis", label: "Arterial waveform analysis", clinicalPurpose: "characterization of arterial physiologic waveforms" },
        { key: "dopplerDuplex", label: "Duplex Doppler imaging", clinicalPurpose: "assessment for arterial stenosis or occlusion" },
      ],
    },
  },
  {
    test: (s) => s.includes("lower extremity venous") || (s.includes("venous") && s.includes("duplex")),
    config: {
      serviceLabel: "Lower Extremity Venous Duplex",
      orderedComponents: [
        { key: "venousCompression", label: "Compression duplex imaging", clinicalPurpose: "assessment for deep venous thrombosis" },
        { key: "venousDoppler", label: "Venous Doppler with augmentation", clinicalPurpose: "assessment of venous flow and valvular competence" },
        { key: "colorFlow", label: "Color-flow Doppler", clinicalPurpose: "characterization of venous flow patterns" },
      ],
    },
  },
];

const GENERIC_CONFIG = (serviceType: string): OrderNoteServiceConfig => ({
  serviceLabel: serviceType,
  orderedComponents: [
    { key: "study", label: `${serviceType} study`, clinicalPurpose: "objective diagnostic evaluation per the approved protocol" },
  ],
});

/** Resolve the canonical Order Note configuration for a service. */
export function orderNoteServiceConfig(serviceType: string): OrderNoteServiceConfig {
  const s = (serviceType || "").toLowerCase();
  for (const m of SERVICE_MATCHERS) {
    if (m.test(s)) return m.config;
  }
  return GENERIC_CONFIG(serviceType);
}

/** The service label alone (deterministic; used by the renderer's ORDER/PLAN). */
export function orderNoteServiceLabel(serviceType: string): string {
  return orderNoteServiceConfig(serviceType).serviceLabel;
}

/**
 * Whether this service REQUIRES a completed structured (A0) screening as a true
 * prerequisite for order-note signing. Config-driven only — never inferred from
 * the service name. Defaults to false (screening is optional evidence).
 */
export function orderNoteRequiresStructuredScreening(serviceType: string): boolean {
  return orderNoteServiceConfig(serviceType).requiredEvidence?.structuredScreening === true;
}

/**
 * Whether this service REQUIRES an exact CURRENT SIGNED Order Note (and
 * validated component evidence) as a prerequisite for generating its canonical
 * Procedure Note. Config-driven only — never inferred from the service name.
 * This is a SEPARATE concept from the structured-screening requirement.
 * Defaults to false (no signed-order gate unless the service declares one).
 */
export function procedureRequiresSignedOrderNote(serviceType: string): boolean {
  return orderNoteServiceConfig(serviceType).requiredEvidence?.signedOrderNoteForProcedure === true;
}
