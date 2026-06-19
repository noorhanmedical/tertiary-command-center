// Plexus IQ — Operating Canvas design prototype.
//
// STANDALONE prototype for visual / product review. NOT production.
//   - All data is mocked in-file. No backend calls. No React Query.
//   - Does not import from production hooks/services. Imports are
//     only React + lucide-react icons + tailwind utility classes.
//   - Reads `docs/architecture/PLATFORM_OPERATING_MODEL.md` as the
//     operating rulebook:
//       * Patient is the spine.
//       * Selected facility/date/batch is the working context.
//       * Parsed/completed are statuses, not destinations.
//       * Admin Review and Engagement are different workflow stages.
//       * Packets must be live outputs from current saved state.
//       * No fake completion, no silent drops.
//
// VISUAL CONTRACT (per the brief):
//   - No rounded edges anywhere. Square edges only.
//   - Black section headers (#0B0B0F, white uppercase 11px / 0.14em).
//   - No cards, no pill buttons, no dashboard tiles, no soft glows.
//   - Inter / system-ui font.
//   - Grid: 260 / 420-520 / 720+ (Date · List · Review).
//   - Review is the work surface, not a sidebar.
//
// INTERACTIONS that work in this prototype (all on local state):
//   - Expand/collapse date groups.
//   - Select batch, select patient.
//   - Expand/collapse per-ancillary sections.
//   - Switch Source / History / ICD / Engagement tabs.
//   - Attach a Source row to an ancillary (DX/HX/RX/Prior Testing/ICD).
//   - Attached source becomes "Changed · Regeneration Required".
//   - Pending Regeneration queue updates live.
//   - Admin Approve disables when queue is non-empty OR a cooldown
//     blocker is unresolved OR Packet QA blockers exist.
//   - Regenerate all clears the queue and re-enables Admin Approve.
//   - Packet button opens a mock "blocked" summary when blockers exist.
//   - Prior tests inside cooldown remove the corresponding ancillary
//     from the actionable list and surface it in the top alert.
//   - Carotid cooldown only blocks the carotid subtype, not all
//     ultrasound.

import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Upload,
  Sparkles,
  RotateCw,
  FileBarChart,
  FileText,
  Trash2,
  Search,
  X,
  AlertTriangle,
  RefreshCcw,
  ExternalLink,
  Check,
} from "lucide-react";

// ────────────────────────────────────────────────────────────────────
// Mock domain types — purely local to this prototype.

type Ancillary = "BrainWave" | "VitalWave" | "Ultrasound";
type UltrasoundSubtype =
  | "Carotid"
  | "Arterial LE"
  | "Arterial UE"
  | "Venous LE"
  | "Venous UE"
  | "Renal"
  | "Thyroid"
  | "Abdominal"
  | "Echo TTE";

type StatusLabel =
  | "Parsed"
  | "Pending Qualification"
  | "Qualification Running"
  | "Ready for Review"
  | "Admin Approved"
  | "Sent to Engagement"
  | "Engagement Approved"
  | "Distributed"
  | "Failed / Needs Fix";

type EngagementState =
  | "Not Sent"
  | "Sent to Engagement"
  | "Pending Manual Approval"
  | "Assigned"
  | "Distributed"
  | "Completed";

type Evidence = {
  id: string;
  kind: "DX" | "HX" | "RX" | "ICD" | "Prior Testing" | "Notes";
  text: string;
};

type ActionableAncillary = {
  id: string;
  ancillary: Ancillary;
  subtype?: UltrasoundSubtype;
  /** Which evidence ids are attached to this ancillary today. */
  attachedEvidenceIds: string[];
  qualifyingFactors: string[];
  clinicianUnderstanding: string;
  patientTalkingPoints: string;
  icd10Codes: string[];
  /** ISO timestamp the reasoning was last regenerated. */
  reasoningRegeneratedAt: string;
  packetQa: { kind: "ready" | "warnings" | "blockers"; messages?: string[] };
};

type PriorTesting = {
  id: string;
  ancillary: Ancillary;
  subtype?: UltrasoundSubtype;
  datePerformed: string;
  result?: string;
  /** "within" → block; "outside" → context only; "needs_verification" → soft block */
  cooldownStatus: "within" | "outside" | "needs_verification";
  repeatAllowedAfter?: string;
  action?: string;
};

type MockPatient = {
  id: number;
  name: string;
  dob: string;
  phone: string;
  insurance: string;
  status: StatusLabel;
  /** Source records — the patient's clinical evidence pool. */
  source: {
    DX: Evidence[];
    HX: Evidence[];
    RX: Evidence[];
    ICD: Evidence[];
    Notes: Evidence[];
  };
  priorTesting: PriorTesting[];
  ancillaries: ActionableAncillary[];
  engagement: { state: EngagementState; assignedTo?: string; note?: string };
  /** Pre-staged regeneration-queue rows for scenarios that should
   *  open the canvas already blocked. */
  initialPendingRegen?: PendingRegenItem[];
  /** Override the "ready" packet QA verdict for the simulated stale-
   *  source scenarios. */
  initialPacketBlocked?: { reason: string }[];
};

type MockBatch = {
  id: number;
  time: string;
  facility: string;
  patientCount: number;
  batchStatusLabel: StatusLabel;
  patients: MockPatient[];
};

type MockDateGroup = {
  /** YYYY-MM-DD */
  date: string;
  label: string;
  batches: MockBatch[];
};

type PendingRegenItem = {
  id: string;
  patientId: number;
  ancillaryId: string;
  ancillary: Ancillary;
  subtype?: UltrasoundSubtype;
  change: string;
  blockingApproval: boolean;
};

// ────────────────────────────────────────────────────────────────────
// Mock data. 10 scenarios spread across two facilities + three dates.

const MOCK: MockDateGroup[] = [
  {
    date: "2026-06-19",
    label: "Fri, Jun 19, 2026",
    batches: [
      {
        id: 1042,
        time: "10:42 AM",
        facility: "Taylor Family Practice",
        patientCount: 162,
        batchStatusLabel: "Ready for Review",
        patients: buildBatchPatients("taylor-1042-am", "Taylor Family Practice"),
      },
      {
        id: 1015,
        time: "8:15 AM",
        facility: "Taylor Family Practice",
        patientCount: 41,
        batchStatusLabel: "Pending Qualification",
        patients: buildPendingPatients("taylor-815-am"),
      },
    ],
  },
  {
    date: "2026-06-18",
    label: "Thu, Jun 18, 2026",
    batches: [
      {
        id: 1029,
        time: "3:08 PM",
        facility: "Northwest Primary",
        patientCount: 22,
        batchStatusLabel: "Ready for Review",
        patients: buildSecondaryPatients("nw-308pm"),
      },
    ],
  },
  {
    date: "2026-06-17",
    label: "Wed, Jun 17, 2026",
    batches: [
      {
        id: 1006,
        time: "2:00 PM",
        facility: "Northwest Primary",
        patientCount: 7,
        batchStatusLabel: "Distributed",
        patients: [],
      },
    ],
  },
];

function buildBatchPatients(_prefix: string, facility: string): MockPatient[] {
  const NOW = "2026-06-19T10:42:00Z";
  const patients: MockPatient[] = [
    // 1. BrainWave eligible, no cooldown, clean — ready to print.
    {
      id: 101,
      name: "Adler, Marian",
      dob: "1948-03-12",
      phone: "(206) 555-0101",
      insurance: "Medicare",
      status: "Ready for Review",
      source: {
        DX: [
          { id: "dx-101-a", kind: "DX", text: "Mild cognitive impairment" },
          { id: "dx-101-b", kind: "DX", text: "Type 2 diabetes mellitus" },
        ],
        HX: [
          { id: "hx-101-a", kind: "HX", text: "Family history of dementia" },
          { id: "hx-101-b", kind: "HX", text: "Recent memory complaints" },
        ],
        RX: [
          { id: "rx-101-a", kind: "RX", text: "Metformin 500mg BID" },
          { id: "rx-101-b", kind: "RX", text: "Donepezil 5mg QD" },
        ],
        ICD: [{ id: "icd-101-a", kind: "ICD", text: "R41.3 — Memory loss" }],
        Notes: [],
      },
      priorTesting: [],
      ancillaries: [
        {
          id: "anc-101-bw",
          ancillary: "BrainWave",
          attachedEvidenceIds: ["dx-101-a", "hx-101-a", "hx-101-b"],
          qualifyingFactors: ["Cognitive complaints", "Family history of dementia"],
          clinicianUnderstanding:
            "Patient reports recent memory complaints with a family history of dementia. BrainWave is indicated to evaluate cortical activity and early markers.",
          patientTalkingPoints:
            "We'd like to use a quick painless brain-activity scan to see what's behind the memory changes.",
          icd10Codes: ["R41.3"],
          reasoningRegeneratedAt: NOW,
          packetQa: { kind: "ready" },
        },
      ],
      engagement: { state: "Not Sent" },
    },
    // 2. VitalWave stale because RX was edited after qualification.
    {
      id: 102,
      name: "Bevan, Theodore",
      dob: "1952-07-30",
      phone: "(206) 555-0102",
      insurance: "Medicare",
      status: "Ready for Review",
      source: {
        DX: [
          { id: "dx-102-a", kind: "DX", text: "Hypertension" },
          { id: "dx-102-b", kind: "DX", text: "Type 2 diabetes mellitus" },
        ],
        HX: [
          { id: "hx-102-a", kind: "HX", text: "Lightheadedness with position change" },
        ],
        RX: [
          { id: "rx-102-a", kind: "RX", text: "Lisinopril 20mg QD" },
          { id: "rx-102-b", kind: "RX", text: "Aspirin 81mg QD — ADDED" },
        ],
        ICD: [],
        Notes: [],
      },
      priorTesting: [],
      ancillaries: [
        {
          id: "anc-102-vw",
          ancillary: "VitalWave",
          attachedEvidenceIds: ["dx-102-a", "dx-102-b", "hx-102-a"],
          qualifyingFactors: ["HTN", "Diabetes", "Positional lightheadedness"],
          clinicianUnderstanding:
            "Patient reports positional lightheadedness with multiple cardiometabolic risk factors. VitalWave assesses autonomic + vascular response.",
          patientTalkingPoints:
            "This test looks at how your blood pressure adjusts when you change position — explains the lightheadedness.",
          icd10Codes: ["I10", "E11.9"],
          reasoningRegeneratedAt: "2026-06-19T09:30:00Z",
          packetQa: { kind: "warnings", messages: ["talking points slightly thin"] },
        },
      ],
      engagement: { state: "Not Sent" },
      initialPendingRegen: [
        {
          id: "regen-102-rx",
          patientId: 102,
          ancillaryId: "anc-102-vw",
          ancillary: "VitalWave",
          change: "RX added: Aspirin 81mg",
          blockingApproval: true,
        },
      ],
      initialPacketBlocked: [
        {
          reason: "VitalWave reasoning is stale (RX added after qualification).",
        },
      ],
    },
    // 3. Prior BrainWave within cooldown → BrainWave hidden from
    //    actionable, surfaced in Prior Testing alert.
    {
      id: 103,
      name: "Castellano, Rosa",
      dob: "1955-11-04",
      phone: "(206) 555-0103",
      insurance: "Medicare",
      status: "Ready for Review",
      source: {
        DX: [{ id: "dx-103-a", kind: "DX", text: "Mild cognitive impairment" }],
        HX: [{ id: "hx-103-a", kind: "HX", text: "Family history of dementia" }],
        RX: [{ id: "rx-103-a", kind: "RX", text: "Donepezil 5mg QD" }],
        ICD: [],
        Notes: [],
      },
      priorTesting: [
        {
          id: "pt-103-bw",
          ancillary: "BrainWave",
          datePerformed: "2026-03-12",
          result: "Mild cortical slowing",
          cooldownStatus: "within",
          repeatAllowedAfter: "2027-03-12",
          action: "Not reviewable until 2027-03-12",
        },
      ],
      ancillaries: [],
      engagement: { state: "Not Sent" },
    },
    // 4. Prior carotid ultrasound within cooldown → carotid blocked,
    //    other ultrasound subtypes still actionable.
    {
      id: 104,
      name: "DiAngelo, Marcus",
      dob: "1949-02-21",
      phone: "(206) 555-0104",
      insurance: "Medicare",
      status: "Ready for Review",
      source: {
        DX: [
          { id: "dx-104-a", kind: "DX", text: "Peripheral arterial disease" },
          { id: "dx-104-b", kind: "DX", text: "Carotid bruit on exam" },
        ],
        HX: [{ id: "hx-104-a", kind: "HX", text: "Lower extremity claudication" }],
        RX: [{ id: "rx-104-a", kind: "RX", text: "Clopidogrel 75mg QD" }],
        ICD: [],
        Notes: [],
      },
      priorTesting: [
        {
          id: "pt-104-car",
          ancillary: "Ultrasound",
          subtype: "Carotid",
          datePerformed: "2026-05-01",
          result: "<50% stenosis bilateral",
          cooldownStatus: "needs_verification",
          repeatAllowedAfter: "2026-11-01",
          action: "Needs verification — repeat allowed after 11/01/2026",
        },
      ],
      ancillaries: [
        {
          id: "anc-104-le",
          ancillary: "Ultrasound",
          subtype: "Arterial LE",
          attachedEvidenceIds: ["dx-104-a", "hx-104-a"],
          qualifyingFactors: ["PAD", "Lower extremity claudication"],
          clinicianUnderstanding:
            "Patient reports calf claudication with documented PAD. Lower-extremity arterial duplex assesses segmental flow.",
          patientTalkingPoints:
            "This ultrasound checks blood flow in your leg arteries — to confirm what's causing the leg pain when you walk.",
          icd10Codes: ["I73.9"],
          reasoningRegeneratedAt: NOW,
          packetQa: { kind: "ready" },
        },
      ],
      engagement: { state: "Not Sent" },
    },
    // 5. Multiple DX/HX/RX rows ready to attach.
    {
      id: 105,
      name: "Eldridge, Diana",
      dob: "1947-08-14",
      phone: "(206) 555-0105",
      insurance: "PPO",
      status: "Ready for Review",
      source: {
        DX: [
          { id: "dx-105-a", kind: "DX", text: "Atrial fibrillation" },
          { id: "dx-105-b", kind: "DX", text: "Chronic heart failure (mild)" },
        ],
        HX: [
          { id: "hx-105-a", kind: "HX", text: "Palpitations on exertion" },
          { id: "hx-105-b", kind: "HX", text: "Dyspnea, NYHA class II" },
        ],
        RX: [
          { id: "rx-105-a", kind: "RX", text: "Apixaban 5mg BID" },
          { id: "rx-105-b", kind: "RX", text: "Metoprolol succinate 50mg QD" },
        ],
        ICD: [],
        Notes: [
          {
            id: "note-105-a",
            kind: "Notes",
            text: "Reviewer note: confirm if cardiology workup is in scope.",
          },
        ],
      },
      priorTesting: [],
      ancillaries: [
        {
          id: "anc-105-vw",
          ancillary: "VitalWave",
          attachedEvidenceIds: ["dx-105-a", "hx-105-a"],
          qualifyingFactors: ["AFib", "Palpitations"],
          clinicianUnderstanding:
            "Patient reports palpitations on exertion in the setting of known AFib. VitalWave assesses heart rhythm + autonomic response.",
          patientTalkingPoints:
            "We'd like a short non-invasive recording to see how the heart rhythm reacts under typical daily stress.",
          icd10Codes: ["I48.91"],
          reasoningRegeneratedAt: NOW,
          packetQa: { kind: "ready" },
        },
        {
          id: "anc-105-echo",
          ancillary: "Ultrasound",
          subtype: "Echo TTE",
          attachedEvidenceIds: ["dx-105-b", "hx-105-b"],
          qualifyingFactors: ["NYHA II", "CHF history"],
          clinicianUnderstanding:
            "Mild heart failure with exertional dyspnea — echo evaluates LV function + valve integrity.",
          patientTalkingPoints:
            "This heart ultrasound shows us how strongly the heart is pumping and whether the valves are working normally.",
          icd10Codes: ["I50.9"],
          reasoningRegeneratedAt: NOW,
          packetQa: { kind: "ready" },
        },
      ],
      engagement: { state: "Not Sent" },
    },
    // 6. Engagement: pending manual approval, assigned to Sarah.
    {
      id: 106,
      name: "Faruq, Aaliyah",
      dob: "1953-09-28",
      phone: "(206) 555-0106",
      insurance: "Medicare",
      status: "Admin Approved",
      source: {
        DX: [{ id: "dx-106-a", kind: "DX", text: "Type 2 diabetes mellitus" }],
        HX: [{ id: "hx-106-a", kind: "HX", text: "Peripheral neuropathy" }],
        RX: [{ id: "rx-106-a", kind: "RX", text: "Metformin 1000mg BID" }],
        ICD: [],
        Notes: [],
      },
      priorTesting: [],
      ancillaries: [
        {
          id: "anc-106-le",
          ancillary: "Ultrasound",
          subtype: "Arterial LE",
          attachedEvidenceIds: ["dx-106-a", "hx-106-a"],
          qualifyingFactors: ["Diabetes", "Peripheral neuropathy"],
          clinicianUnderstanding: "Diabetic with peripheral neuropathy — lower-extremity duplex evaluates flow.",
          patientTalkingPoints: "This ultrasound checks circulation in your legs.",
          icd10Codes: ["E11.9", "G62.9"],
          reasoningRegeneratedAt: NOW,
          packetQa: { kind: "ready" },
        },
      ],
      engagement: {
        state: "Pending Manual Approval",
        assignedTo: "Sarah Lee",
        note: "Routed via Scheduler Settings · awaiting engagement-center approval",
      },
    },
    // 9. Completed patient whose packet is blocked because source
    //    edit occurred after qualification.
    {
      id: 107,
      name: "Grover, Henrietta",
      dob: "1944-06-02",
      phone: "(206) 555-0107",
      insurance: "Medicare",
      status: "Admin Approved",
      source: {
        DX: [
          { id: "dx-107-a", kind: "DX", text: "Hypertension" },
          { id: "dx-107-b", kind: "DX", text: "Hyperlipidemia" },
        ],
        HX: [
          { id: "hx-107-a", kind: "HX", text: "TIA episode 6mo ago" },
        ],
        RX: [
          { id: "rx-107-a", kind: "RX", text: "Lisinopril 10mg QD" },
          { id: "rx-107-b", kind: "RX", text: "Atorvastatin 40mg QHS" },
        ],
        ICD: [],
        Notes: [
          {
            id: "note-107-a",
            kind: "Notes",
            text: "Reviewer edited DX after qualification finished — needs regen before packet print.",
          },
        ],
      },
      priorTesting: [],
      ancillaries: [
        {
          id: "anc-107-car",
          ancillary: "Ultrasound",
          subtype: "Carotid",
          attachedEvidenceIds: ["dx-107-a", "hx-107-a"],
          qualifyingFactors: ["HTN", "Prior TIA"],
          clinicianUnderstanding:
            "Patient had a TIA six months ago with HTN; carotid duplex evaluates plaque + stenosis.",
          patientTalkingPoints:
            "This neck-vessel ultrasound makes sure the arteries to the brain are open and clear.",
          icd10Codes: ["I10", "Z86.73"],
          reasoningRegeneratedAt: "2026-06-18T08:00:00Z",
          packetQa: { kind: "warnings", messages: ["regenerated yesterday"] },
        },
      ],
      engagement: { state: "Sent to Engagement", assignedTo: "Carlos Ortiz" },
      initialPendingRegen: [
        {
          id: "regen-107-dx",
          patientId: 107,
          ancillaryId: "anc-107-car",
          ancillary: "Ultrasound",
          subtype: "Carotid",
          change: "DX added: Hyperlipidemia",
          blockingApproval: false,
        },
      ],
      initialPacketBlocked: [
        {
          reason:
            "Carotid Ultrasound reasoning is stale (DX edited after qualification).",
        },
      ],
    },
    // 10. Ready for packet print, no blockers.
    {
      id: 108,
      name: "Hadley, Owen",
      dob: "1950-12-19",
      phone: "(206) 555-0108",
      insurance: "PPO",
      status: "Admin Approved",
      source: {
        DX: [{ id: "dx-108-a", kind: "DX", text: "Bilateral leg swelling" }],
        HX: [{ id: "hx-108-a", kind: "HX", text: "DVT 2yr ago, left calf" }],
        RX: [],
        ICD: [],
        Notes: [],
      },
      priorTesting: [],
      ancillaries: [
        {
          id: "anc-108-ven",
          ancillary: "Ultrasound",
          subtype: "Venous LE",
          attachedEvidenceIds: ["dx-108-a", "hx-108-a"],
          qualifyingFactors: ["Prior DVT", "Bilateral leg swelling"],
          clinicianUnderstanding:
            "Patient has bilateral leg swelling with documented prior DVT. Venous duplex screens for recurrent thrombus.",
          patientTalkingPoints:
            "This leg-vein ultrasound checks for any clot or chronic vein damage explaining the swelling.",
          icd10Codes: ["R60.0", "I82.40"],
          reasoningRegeneratedAt: NOW,
          packetQa: { kind: "ready" },
        },
      ],
      engagement: { state: "Distributed", assignedTo: "Sarah Lee" },
    },
    // 7. Admin Approve blocked due to multiple pending regens.
    {
      id: 109,
      name: "Ingersol, Beatrice",
      dob: "1946-04-08",
      phone: "(206) 555-0109",
      insurance: "Medicare",
      status: "Ready for Review",
      source: {
        DX: [
          { id: "dx-109-a", kind: "DX", text: "Hypertension" },
          { id: "dx-109-b", kind: "DX", text: "Memory complaints" },
        ],
        HX: [
          { id: "hx-109-a", kind: "HX", text: "Recent falls" },
          { id: "hx-109-b", kind: "HX", text: "Family history of stroke" },
        ],
        RX: [
          { id: "rx-109-a", kind: "RX", text: "Amlodipine 5mg QD" },
          { id: "rx-109-b", kind: "RX", text: "Memantine 10mg BID" },
        ],
        ICD: [],
        Notes: [],
      },
      priorTesting: [],
      ancillaries: [
        {
          id: "anc-109-bw",
          ancillary: "BrainWave",
          attachedEvidenceIds: ["dx-109-b"],
          qualifyingFactors: ["Memory complaints"],
          clinicianUnderstanding: "Memory complaints — BrainWave assesses cortical activity.",
          patientTalkingPoints: "A short brain-activity scan to look at memory function.",
          icd10Codes: ["R41.3"],
          reasoningRegeneratedAt: "2026-06-19T08:00:00Z",
          packetQa: { kind: "warnings", messages: ["new HX not regenerated"] },
        },
        {
          id: "anc-109-vw",
          ancillary: "VitalWave",
          attachedEvidenceIds: ["dx-109-a"],
          qualifyingFactors: ["HTN"],
          clinicianUnderstanding: "Hypertension with recent falls — VitalWave assesses autonomic + vascular.",
          patientTalkingPoints: "This test sees how blood pressure adjusts to position changes.",
          icd10Codes: ["I10"],
          reasoningRegeneratedAt: "2026-06-19T08:00:00Z",
          packetQa: { kind: "warnings", messages: ["new RX not regenerated"] },
        },
      ],
      engagement: { state: "Not Sent" },
      initialPendingRegen: [
        {
          id: "regen-109-bw-hx",
          patientId: 109,
          ancillaryId: "anc-109-bw",
          ancillary: "BrainWave",
          change: "HX added: Family history of stroke",
          blockingApproval: true,
        },
        {
          id: "regen-109-vw-rx",
          patientId: 109,
          ancillaryId: "anc-109-vw",
          ancillary: "VitalWave",
          change: "RX added: Memantine",
          blockingApproval: true,
        },
      ],
      initialPacketBlocked: [
        {
          reason: "BrainWave has unregenerated HX edit (Family history of stroke).",
        },
        { reason: "VitalWave has unregenerated RX edit (Memantine)." },
      ],
    },
  ];
  void facility; // suppress unused param warning
  return patients;
}

function buildPendingPatients(_prefix: string): MockPatient[] {
  return [
    {
      id: 201,
      name: "Junot, Eleanor",
      dob: "1958-01-22",
      phone: "(206) 555-0201",
      insurance: "PPO",
      status: "Pending Qualification",
      source: {
        DX: [{ id: "dx-201-a", kind: "DX", text: "Type 2 diabetes mellitus" }],
        HX: [],
        RX: [{ id: "rx-201-a", kind: "RX", text: "Metformin 500mg BID" }],
        ICD: [],
        Notes: [],
      },
      priorTesting: [],
      ancillaries: [],
      engagement: { state: "Not Sent" },
    },
  ];
}

function buildSecondaryPatients(_prefix: string): MockPatient[] {
  return [
    {
      id: 301,
      name: "Kelvin, Marcus",
      dob: "1949-10-05",
      phone: "(503) 555-0301",
      insurance: "Medicare",
      status: "Ready for Review",
      source: {
        DX: [{ id: "dx-301-a", kind: "DX", text: "Hypertension" }],
        HX: [{ id: "hx-301-a", kind: "HX", text: "Dyspnea on exertion" }],
        RX: [{ id: "rx-301-a", kind: "RX", text: "Lisinopril 20mg QD" }],
        ICD: [],
        Notes: [],
      },
      priorTesting: [],
      ancillaries: [
        {
          id: "anc-301-vw",
          ancillary: "VitalWave",
          attachedEvidenceIds: ["dx-301-a", "hx-301-a"],
          qualifyingFactors: ["HTN", "Dyspnea on exertion"],
          clinicianUnderstanding: "HTN with dyspnea on exertion — VitalWave evaluates autonomic response.",
          patientTalkingPoints: "Quick test of how blood pressure adjusts under daily stress.",
          icd10Codes: ["I10"],
          reasoningRegeneratedAt: "2026-06-18T15:00:00Z",
          packetQa: { kind: "ready" },
        },
      ],
      engagement: { state: "Not Sent" },
    },
  ];
}

// ────────────────────────────────────────────────────────────────────
// Helpers / format / lookup

function formatBatchTimeLabel(time: string): string {
  return time;
}

function statusToStyle(s: StatusLabel | EngagementState): {
  bg: string;
  border: string;
  text: string;
} {
  switch (s) {
    case "Parsed":
      return { bg: "#FFFFFF", border: "#94A3B8", text: "#475569" };
    case "Pending Qualification":
      return { bg: "#FFF7ED", border: "#D97706", text: "#B45309" };
    case "Qualification Running":
      return { bg: "#EFF6FF", border: "#2563EB", text: "#1D4ED8" };
    case "Ready for Review":
      return { bg: "#FFFFFF", border: "#2563EB", text: "#1D4ED8" };
    case "Admin Approved":
      return { bg: "#FFFFFF", border: "#059669", text: "#047857" };
    case "Sent to Engagement":
      return { bg: "#FFFFFF", border: "#4F46E5", text: "#4338CA" };
    case "Engagement Approved":
    case "Pending Manual Approval":
      return { bg: "#FFFFFF", border: "#0284C7", text: "#0369A1" };
    case "Assigned":
      return { bg: "#FFFFFF", border: "#4F46E5", text: "#4338CA" };
    case "Distributed":
      return { bg: "#F0FDF4", border: "#059669", text: "#047857" };
    case "Completed":
      return { bg: "#F0FDF4", border: "#059669", text: "#047857" };
    case "Failed / Needs Fix":
      return { bg: "#FEF2F2", border: "#DC2626", text: "#B91C1C" };
    case "Not Sent":
    default:
      return { bg: "#FFFFFF", border: "#94A3B8", text: "#475569" };
  }
}

// ────────────────────────────────────────────────────────────────────
// Prototype root

export function PlexusIQOperatingCanvasPrototype(): JSX.Element {
  // Date / batch / patient selection — default to the newest date open,
  // newest batch selected, first patient selected.
  const [expandedDates, setExpandedDates] = useState<Set<string>>(
    () => new Set([MOCK[0].date]),
  );
  const [selectedBatchId, setSelectedBatchId] = useState<number>(1042);
  const [selectedPatientId, setSelectedPatientId] = useState<number>(101);

  // Per-patient mutable working state — attachments + pending regen.
  // We keep one entry per patient seeded from the mock; the operator's
  // staged changes are applied here.
  const [workingState, setWorkingState] = useState<
    Record<
      number,
      {
        attachments: Record<string, string[]>; // ancillaryId → evidenceIds
        pendingRegen: PendingRegenItem[];
        packetBlockers: string[];
      }
    >
  >(() => seedWorkingState());

  // List multi-select state.
  const [checkedIds, setCheckedIds] = useState<Set<number>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");

  // Review right-panel tabs.
  const [activeTab, setActiveTab] = useState<
    "SOURCE" | "HISTORY" | "ICD" | "ENGAGEMENT"
  >("SOURCE");

  // Per-ancillary expanded state. Default: all expanded so the
  // reviewer sees everything on first paint.
  const [expandedAncillaries, setExpandedAncillaries] = useState<Set<string>>(
    () => new Set(["__all-default__"]),
  );

  // Attach popover state — anchored to a source row.
  const [attachPopover, setAttachPopover] = useState<{
    evidenceId: string;
    open: boolean;
  } | null>(null);

  // Packet blocked dialog state.
  const [packetBlockedDialog, setPacketBlockedDialog] = useState<{
    mode: "plexus" | "clinician";
    reasons: string[];
  } | null>(null);

  // Mock notification toast.
  const [toast, setToast] = useState<string | null>(null);

  // ─── Derived data ──────────────────────────────────────────────
  const selectedBatch = useMemo<MockBatch | null>(() => {
    for (const g of MOCK) {
      for (const b of g.batches) {
        if (b.id === selectedBatchId) return b;
      }
    }
    return null;
  }, [selectedBatchId]);

  const selectedDate = useMemo<MockDateGroup | null>(() => {
    for (const g of MOCK) {
      for (const b of g.batches) {
        if (b.id === selectedBatchId) return g;
      }
    }
    return null;
  }, [selectedBatchId]);

  const patients = selectedBatch?.patients ?? [];
  const visiblePatients = useMemo<MockPatient[]>(() => {
    const q = searchQuery.trim().toLowerCase();
    if (q.length === 0) return patients;
    return patients.filter((p) =>
      [p.name, p.dob, p.insurance, p.status].some((s) =>
        s.toLowerCase().includes(q),
      ),
    );
  }, [patients, searchQuery]);

  const selectedPatient = useMemo<MockPatient | null>(() => {
    return patients.find((p) => p.id === selectedPatientId) ?? null;
  }, [patients, selectedPatientId]);

  const patientWorking = useMemo(() => {
    if (!selectedPatient) return null;
    return workingState[selectedPatient.id] ?? {
      attachments: {},
      pendingRegen: [],
      packetBlockers: [],
    };
  }, [workingState, selectedPatient]);

  // Ancillaries actually shown — filter out any whose required
  // subtype is "within cooldown" per the operator-model rule.
  const actionableAncillaries = useMemo<ActionableAncillary[]>(() => {
    if (!selectedPatient) return [];
    const blockedByCooldown = new Set<string>();
    for (const pt of selectedPatient.priorTesting) {
      if (pt.cooldownStatus === "within") {
        const key = pt.subtype
          ? `${pt.ancillary}::${pt.subtype}`
          : `${pt.ancillary}`;
        blockedByCooldown.add(key);
      }
    }
    return selectedPatient.ancillaries.filter((a) => {
      const key = a.subtype ? `${a.ancillary}::${a.subtype}` : a.ancillary;
      if (blockedByCooldown.has(key)) return false;
      if (a.ancillary !== "Ultrasound" && blockedByCooldown.has(a.ancillary))
        return false;
      return true;
    });
  }, [selectedPatient]);

  const pendingRegen = patientWorking?.pendingRegen ?? [];
  const packetBlockers = patientWorking?.packetBlockers ?? [];
  const approveBlocked = pendingRegen.length > 0 || packetBlockers.length > 0;

  // ─── Mock interaction handlers ───────────────────────────────
  function toggleDate(dateKey: string): void {
    setExpandedDates((prev) => {
      const next = new Set(prev);
      if (next.has(dateKey)) next.delete(dateKey);
      else next.add(dateKey);
      return next;
    });
  }

  function pickBatch(id: number): void {
    setSelectedBatchId(id);
    const target = MOCK.flatMap((g) => g.batches).find((b) => b.id === id);
    setSelectedPatientId(target?.patients[0]?.id ?? -1);
    setCheckedIds(new Set());
  }

  function pickPatient(id: number): void {
    setSelectedPatientId(id);
  }

  function toggleAncillary(id: string): void {
    setExpandedAncillaries((prev) => {
      const next = new Set(prev);
      // First click on any toggle replaces the default-all state.
      if (next.has("__all-default__")) {
        next.delete("__all-default__");
        for (const a of actionableAncillaries) next.add(a.id);
      }
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function isAncillaryExpanded(id: string): boolean {
    return (
      expandedAncillaries.has("__all-default__") || expandedAncillaries.has(id)
    );
  }

  function openAttachPopover(evidenceId: string): void {
    setAttachPopover({ evidenceId, open: true });
  }

  function closeAttachPopover(): void {
    setAttachPopover(null);
  }

  function performAttach(
    evidenceId: string,
    targetAncillaryId: string,
    targetLabel: string,
  ): void {
    if (!selectedPatient) return;
    const patientId = selectedPatient.id;
    setWorkingState((prev) => {
      const cur = prev[patientId] ?? {
        attachments: {},
        pendingRegen: [],
        packetBlockers: [],
      };
      const existing = cur.attachments[targetAncillaryId] ?? [];
      if (existing.includes(evidenceId)) return prev;
      const evidence = findEvidence(selectedPatient, evidenceId);
      if (!evidence) return prev;
      const targetAnc = selectedPatient.ancillaries.find(
        (a) => a.id === targetAncillaryId,
      );
      const newRegen: PendingRegenItem = {
        id: `regen-${patientId}-${evidenceId}-${targetAncillaryId}`,
        patientId,
        ancillaryId: targetAncillaryId,
        ancillary: targetAnc?.ancillary ?? "BrainWave",
        subtype: targetAnc?.subtype,
        change: `${evidence.kind} attached: ${evidence.text}`,
        blockingApproval: true,
      };
      const nextBlockers = cur.packetBlockers.slice();
      const stableMsg = `${targetLabel} reasoning will be stale until regenerated.`;
      if (!nextBlockers.includes(stableMsg)) nextBlockers.push(stableMsg);
      return {
        ...prev,
        [patientId]: {
          attachments: {
            ...cur.attachments,
            [targetAncillaryId]: [...existing, evidenceId],
          },
          pendingRegen: [...cur.pendingRegen, newRegen],
          packetBlockers: nextBlockers,
        },
      };
    });
    setToast(`Attached to ${targetLabel}. Regeneration required.`);
    setAttachPopover(null);
    window.setTimeout(() => setToast(null), 1800);
  }

  function regenerateAll(): void {
    if (!selectedPatient) return;
    const patientId = selectedPatient.id;
    setWorkingState((prev) => ({
      ...prev,
      [patientId]: {
        ...(prev[patientId] ?? { attachments: {}, pendingRegen: [], packetBlockers: [] }),
        pendingRegen: [],
        packetBlockers: [],
      },
    }));
    setToast("Regenerated. Reasoning + packet QA refreshed.");
    window.setTimeout(() => setToast(null), 1800);
  }

  function regenerateOne(item: PendingRegenItem): void {
    if (!selectedPatient) return;
    const patientId = selectedPatient.id;
    setWorkingState((prev) => {
      const cur = prev[patientId] ?? {
        attachments: {},
        pendingRegen: [],
        packetBlockers: [],
      };
      const nextRegen = cur.pendingRegen.filter((r) => r.id !== item.id);
      // Drop packet blockers for the just-regenerated ancillary label.
      const stillBlocking = new Set(nextRegen.map((r) => r.ancillary));
      const nextBlockers = cur.packetBlockers.filter((m) =>
        Array.from(stillBlocking).some((a) => m.startsWith(a)),
      );
      return {
        ...prev,
        [patientId]: {
          ...cur,
          pendingRegen: nextRegen,
          packetBlockers: nextBlockers,
        },
      };
    });
    setToast(`Regenerated ${item.ancillary}${item.subtype ? ` · ${item.subtype}` : ""}.`);
    window.setTimeout(() => setToast(null), 1800);
  }

  function openPacket(mode: "plexus" | "clinician"): void {
    if (!selectedPatient) return;
    if (packetBlockers.length > 0) {
      setPacketBlockedDialog({ mode, reasons: packetBlockers });
      return;
    }
    setToast(
      `${mode === "plexus" ? "Plexus" : "Clinician"} packet preview opened (mock).`,
    );
    window.setTimeout(() => setToast(null), 1800);
  }

  function toggleChecked(id: number): void {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllVisible(): void {
    setCheckedIds(new Set(visiblePatients.map((p) => p.id)));
  }

  function clearSelection(): void {
    setCheckedIds(new Set());
  }

  function approve(): void {
    if (approveBlocked) return;
    setToast("Admin Approved. Routed to Engagement Center.");
    window.setTimeout(() => setToast(null), 1800);
  }

  // ─── Render ────────────────────────────────────────────────────
  const qualBatch = selectedBatch;
  const qualStripText = qualBatch
    ? qualBatch.batchStatusLabel === "Qualification Running"
      ? `Running · ${qualBatch.facility} · ${selectedDate?.label.split(",")[1]?.trim() ?? ""} · ${qualBatch.time} · 312/1000 complete · 41 skipped · 3 failed · ETA 8 min`
      : qualBatch.batchStatusLabel === "Pending Qualification"
        ? `Pending · ${qualBatch.facility} · ${qualBatch.time} · ${qualBatch.patientCount} parsed`
        : `Ready · ${qualBatch.patientCount} completed · ${qualBatch.patients.filter((p) => p.status === "Failed / Needs Fix").length} failed`
    : "No batch selected";

  return (
    <div
      className="flex h-screen w-full flex-col"
      style={{
        background: "#F3F4F6",
        fontFamily:
          'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        color: "#111827",
        WebkitFontSmoothing: "antialiased",
      }}
    >
      {/* ── Global app header strip ─────────────────────────────── */}
      <div
        className="flex h-[56px] shrink-0 items-center justify-between border-b"
        style={{ background: "#111217", color: "#FFFFFF", borderColor: "#0B0B0F" }}
      >
        <div className="flex items-center gap-3 px-5">
          <div className="text-[15px] font-bold tracking-tight">Plexus Clinical</div>
          <span style={{ color: "#475569" }}>·</span>
          <div className="text-[10px] uppercase tracking-[0.18em] text-slate-400">
            Post Acute Care Portal
          </div>
        </div>
        <div className="flex items-center gap-5 pr-5 text-[11px] uppercase tracking-[0.12em] text-slate-300">
          <button type="button" className="hover:text-white">Home</button>
          <button type="button" className="hover:text-white">Admin</button>
          <span className="text-slate-500">dr.imran@noorhan</span>
          <button type="button" className="hover:text-white">Logout</button>
        </div>
      </div>

      {/* ── Plexus IQ operating header (78px) ───────────────────── */}
      <header
        className="flex h-[78px] shrink-0 items-center justify-between border-b px-6"
        style={{ background: "#FFFFFF", borderColor: "#CBD5E1" }}
      >
        <div className="min-w-0">
          <div
            className="text-[10px] font-bold uppercase tracking-[0.18em]"
            style={{ color: "#667085" }}
          >
            Plexus IQ
          </div>
          <div className="mt-0.5 truncate text-[15px] font-bold" style={{ color: "#111827" }}>
            {selectedBatch?.facility ?? "Pick a batch"}
          </div>
          {selectedBatch && (
            <div className="mt-0.5 text-[12px]" style={{ color: "#475467" }}>
              {selectedDate?.label}
              <span className="mx-1.5" style={{ color: "#CBD5E1" }}>·</span>
              Batch {selectedBatch.time}
              <span className="mx-1.5" style={{ color: "#CBD5E1" }}>·</span>
              {selectedBatch.patientCount} patients
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <SquareButton onClick={() => setToast("Add Patient (mock)")}>
            <Plus className="h-3 w-3" /> Add Patient
          </SquareButton>
          <SquareButton onClick={() => setToast("Paste / Import (mock)")}>
            <Upload className="h-3 w-3" /> Paste / Import
          </SquareButton>
          <SquareButton onClick={() => setToast("Generate (mock)")} variant="black">
            <Sparkles className="h-3 w-3" /> Generate
          </SquareButton>
          <SquareButton onClick={() => setToast("Retry Failed (mock)")}>
            <RotateCw className="h-3 w-3" /> Retry Failed
          </SquareButton>
          <SquareButton onClick={() => openPacket("clinician")}>
            <FileText className="h-3 w-3" /> Clinician PDF
          </SquareButton>
          <SquareButton onClick={() => openPacket("plexus")}>
            <FileBarChart className="h-3 w-3" /> Plexus PDF
          </SquareButton>
        </div>
      </header>

      {/* ── Qualification slim strip (34px) ─────────────────────── */}
      <div
        className="flex h-[34px] shrink-0 items-stretch border-b"
        style={{ background: "#FFFFFF", borderColor: "#CBD5E1" }}
      >
        <div
          className="flex w-[190px] items-center px-3 text-[11px] font-bold uppercase tracking-[0.14em] text-white"
          style={{ background: "#0B0B0F" }}
        >
          Qualification
        </div>
        <div className="flex flex-1 items-center px-3 text-[12px]" style={{ color: "#475467" }}>
          {qualStripText}
        </div>
      </div>

      {/* ── Main grid: Date · List · Review ─────────────────────── */}
      <div
        className="grid min-h-0 flex-1"
        style={{
          gridTemplateColumns: "260px minmax(420px, 520px) minmax(720px, 1fr)",
        }}
      >
        {/* ── Left: Date panel ──────────────────────────────────── */}
        <aside
          className="flex min-h-0 flex-col border-r"
          style={{ background: "#FFFFFF", borderColor: "#111827" }}
        >
          <SectionHeader>Date</SectionHeader>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <ul>
              {MOCK.map((g) => {
                const expanded = expandedDates.has(g.date);
                return (
                  <li key={g.date} style={{ borderBottom: "1px solid #E2E8F0" }}>
                    <button
                      type="button"
                      onClick={() => toggleDate(g.date)}
                      className="flex h-[34px] w-full items-center gap-1.5 px-3 text-left text-[12px] font-semibold"
                      style={{ color: "#111827" }}
                    >
                      {expanded ? (
                        <ChevronDown className="h-3 w-3" style={{ color: "#475467" }} />
                      ) : (
                        <ChevronRight className="h-3 w-3" style={{ color: "#475467" }} />
                      )}
                      <span className="flex-1 truncate">{g.label}</span>
                      <span className="text-[10px] font-normal" style={{ color: "#667085" }}>
                        {g.batches.length} batch{g.batches.length === 1 ? "" : "es"}
                      </span>
                    </button>
                    {expanded && (
                      <ul style={{ background: "#F8FAFC" }}>
                        {g.batches.map((b) => {
                          const active = b.id === selectedBatchId;
                          const sty = statusToStyle(b.batchStatusLabel);
                          return (
                            <li key={b.id}>
                              <button
                                type="button"
                                onClick={() => pickBatch(b.id)}
                                className="flex h-[42px] w-full items-start gap-2 px-3 py-1 text-left text-[11px]"
                                style={{
                                  borderLeft: active
                                    ? "4px solid #111827"
                                    : "4px solid transparent",
                                  background: active ? "#E7EEF9" : "transparent",
                                }}
                              >
                                <span
                                  className="w-[56px] shrink-0 text-[12px] font-bold"
                                  style={{ color: "#111827" }}
                                >
                                  {formatBatchTimeLabel(b.time)}
                                </span>
                                <span className="flex flex-col">
                                  <span className="text-[11px]" style={{ color: "#475467" }}>
                                    {b.patientCount} patient{b.patientCount === 1 ? "" : "s"}
                                  </span>
                                  <span
                                    className="text-[10px] uppercase tracking-[0.08em]"
                                    style={{ color: sty.text }}
                                  >
                                    {b.batchStatusLabel}
                                  </span>
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </aside>

        {/* ── Middle: List panel ───────────────────────────────── */}
        <section
          className="flex min-h-0 flex-col border-r"
          style={{ background: "#FFFFFF", borderColor: "#111827" }}
        >
          <SectionHeader>List</SectionHeader>
          <div
            className="flex h-[36px] shrink-0 items-center justify-between border-b px-3 text-[11px]"
            style={{ background: "#F8FAFC", borderColor: "#CBD5E1" }}
          >
            <div className="flex items-center gap-3">
              <LinkButton onClick={selectAllVisible} disabled={visiblePatients.length === 0}>
                Select all visible
              </LinkButton>
              <LinkButton onClick={clearSelection} disabled={checkedIds.size === 0}>
                Clear
              </LinkButton>
              <LinkButton
                onClick={() => {
                  if (checkedIds.size === 0) return;
                  if (
                    window.confirm(
                      `Delete ${checkedIds.size} patient${checkedIds.size === 1 ? "" : "s"} (mock)?`,
                    )
                  ) {
                    setToast(`Deleted ${checkedIds.size} (mock)`);
                    setCheckedIds(new Set());
                    window.setTimeout(() => setToast(null), 1800);
                  }
                }}
                disabled={checkedIds.size === 0}
                tone="rose"
              >
                Delete selected ({checkedIds.size})
              </LinkButton>
            </div>
            <div
              className="flex items-center gap-1.5 border px-2"
              style={{ borderColor: "#CBD5E1", width: 180, height: 24 }}
            >
              <Search className="h-3 w-3" style={{ color: "#667085" }} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search"
                className="w-full bg-transparent text-[11px] focus:outline-none"
                style={{ color: "#111827" }}
              />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {visiblePatients.length === 0 ? (
              <div className="px-3 py-6 text-center text-[12px] italic" style={{ color: "#667085" }}>
                {patients.length === 0
                  ? "Pick a batch on the left."
                  : "No patients match the search."}
              </div>
            ) : (
              <table className="w-full border-collapse text-[13px]">
                <thead
                  className="sticky top-0 z-10"
                  style={{ background: "#F1F5F9", borderBottom: "1px solid #CBD5E1" }}
                >
                  <tr
                    className="text-[11px] font-bold uppercase tracking-[0.08em]"
                    style={{ color: "#475467" }}
                  >
                    <th className="w-[32px] px-2" style={{ height: 32, textAlign: "left" }}>
                      <input
                        type="checkbox"
                        checked={
                          checkedIds.size > 0 && checkedIds.size === visiblePatients.length
                        }
                        onChange={() =>
                          checkedIds.size === visiblePatients.length
                            ? clearSelection()
                            : selectAllVisible()
                        }
                      />
                    </th>
                    <th className="px-2 text-left" style={{ height: 32 }}>
                      Name
                    </th>
                    <th className="px-2 text-left" style={{ width: 95, height: 32 }}>
                      DOB
                    </th>
                    <th className="px-2 text-left" style={{ width: 170, height: 32 }}>
                      Insurance
                    </th>
                    <th className="px-2 text-left" style={{ width: 150, height: 32 }}>
                      Status
                    </th>
                    <th className="w-[32px] px-2" style={{ height: 32 }} />
                  </tr>
                </thead>
                <tbody>
                  {visiblePatients.map((p) => {
                    const active = p.id === selectedPatientId;
                    const checked = checkedIds.has(p.id);
                    return (
                      <tr
                        key={p.id}
                        onClick={() => pickPatient(p.id)}
                        className="cursor-pointer"
                        style={{
                          height: 38,
                          borderBottom: "1px solid #E2E8F0",
                          borderLeft: active ? "4px solid #111827" : "4px solid transparent",
                          background: active
                            ? "#E7EEF9"
                            : checked
                              ? "#F1F5F9"
                              : "transparent",
                          transition: "background 80ms linear",
                        }}
                      >
                        <td
                          className="px-2"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleChecked(p.id);
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleChecked(p.id)}
                          />
                        </td>
                        <td className="px-2">
                          <div className="font-semibold" style={{ color: "#111827" }}>
                            {p.name}
                          </div>
                          {p.engagement.state !== "Not Sent" && (
                            <div className="text-[11px]" style={{ color: "#475467" }}>
                              {engagementOneLiner(p.engagement)}
                            </div>
                          )}
                        </td>
                        <td className="px-2 text-[12px]" style={{ color: "#475467" }}>
                          {p.dob}
                        </td>
                        <td className="px-2 text-[12px]" style={{ color: "#475467" }}>
                          {p.insurance}
                        </td>
                        <td className="px-2">
                          <SquareStatusBadge label={p.status} />
                        </td>
                        <td
                          className="px-2"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              if (
                                window.confirm(`Delete patient "${p.name}" (mock)?`)
                              ) {
                                setToast(`Deleted "${p.name}" (mock)`);
                                window.setTimeout(() => setToast(null), 1800);
                              }
                            }}
                            className="inline-flex h-5 w-5 items-center justify-center"
                            style={{ color: "#667085" }}
                            aria-label={`Delete ${p.name}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>

        {/* ── Right: Review workspace ──────────────────────────── */}
        <aside
          className="flex min-h-0 flex-col"
          style={{ background: "#FFFFFF" }}
        >
          <SectionHeader>Review</SectionHeader>
          {selectedPatient ? (
            <ReviewWorkspace
              patient={selectedPatient}
              selectedBatchTime={selectedBatch?.time ?? ""}
              selectedDateLabel={selectedDate?.label ?? ""}
              actionableAncillaries={actionableAncillaries}
              isAncillaryExpanded={isAncillaryExpanded}
              toggleAncillary={toggleAncillary}
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              attachPopover={attachPopover}
              openAttachPopover={openAttachPopover}
              closeAttachPopover={closeAttachPopover}
              performAttach={performAttach}
              regenerateOne={regenerateOne}
              regenerateAll={regenerateAll}
              pendingRegen={pendingRegen}
              packetBlockers={packetBlockers}
              approveBlocked={approveBlocked}
              onApprove={approve}
              onOpenPacket={openPacket}
            />
          ) : (
            <div
              className="px-4 py-8 text-center text-[12px] italic"
              style={{ color: "#667085" }}
            >
              Pick a patient from the List.
            </div>
          )}
        </aside>
      </div>

      {/* ── Packet blocked dialog (mock) ────────────────────────── */}
      {packetBlockedDialog && (
        <ModalOverlay onClose={() => setPacketBlockedDialog(null)}>
          <div
            className="w-[520px] border bg-white"
            style={{ borderColor: "#111827" }}
          >
            <div
              className="flex h-[32px] items-center justify-between px-3 text-[11px] font-bold uppercase tracking-[0.14em] text-white"
              style={{ background: "#0B0B0F" }}
            >
              <span>
                {packetBlockedDialog.mode === "plexus" ? "Plexus" : "Clinician"} Packet
                — Blocked
              </span>
              <button
                type="button"
                onClick={() => setPacketBlockedDialog(null)}
                className="text-white"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-4 py-4">
              <div className="mb-2 text-[12px]" style={{ color: "#475467" }}>
                Packet QA Gate rejected this print. Resolve every blocker, then
                regenerate before retrying.
              </div>
              <ul className="space-y-1.5">
                {packetBlockedDialog.reasons.map((r, i) => (
                  <li
                    key={i}
                    className="border-l-2 pl-2 text-[12px]"
                    style={{ color: "#B91C1C", borderColor: "#DC2626" }}
                  >
                    {r}
                  </li>
                ))}
              </ul>
            </div>
            <div
              className="flex items-center justify-end gap-1.5 border-t px-4 py-2"
              style={{ background: "#F8FAFC", borderColor: "#CBD5E1" }}
            >
              <SquareButton onClick={() => setPacketBlockedDialog(null)}>
                Close
              </SquareButton>
              <SquareButton
                variant="black"
                onClick={() => {
                  setPacketBlockedDialog(null);
                  regenerateAll();
                }}
              >
                <RefreshCcw className="h-3 w-3" /> Regenerate all
              </SquareButton>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* ── Toast (mock) ─────────────────────────────────────────── */}
      {toast && (
        <div
          className="fixed bottom-4 left-1/2 -translate-x-1/2 border px-3 py-1.5 text-[12px] text-white"
          style={{ background: "#0B0B0F", borderColor: "#111827" }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Review workspace — large work surface (55% / 45% internal split).

function ReviewWorkspace({
  patient,
  selectedBatchTime,
  selectedDateLabel,
  actionableAncillaries,
  isAncillaryExpanded,
  toggleAncillary,
  activeTab,
  setActiveTab,
  attachPopover,
  openAttachPopover,
  closeAttachPopover,
  performAttach,
  regenerateOne,
  regenerateAll,
  pendingRegen,
  packetBlockers,
  approveBlocked,
  onApprove,
  onOpenPacket,
}: {
  patient: MockPatient;
  selectedBatchTime: string;
  selectedDateLabel: string;
  actionableAncillaries: ActionableAncillary[];
  isAncillaryExpanded: (id: string) => boolean;
  toggleAncillary: (id: string) => void;
  activeTab: "SOURCE" | "HISTORY" | "ICD" | "ENGAGEMENT";
  setActiveTab: (t: "SOURCE" | "HISTORY" | "ICD" | "ENGAGEMENT") => void;
  attachPopover: { evidenceId: string; open: boolean } | null;
  openAttachPopover: (evidenceId: string) => void;
  closeAttachPopover: () => void;
  performAttach: (
    evidenceId: string,
    targetAncillaryId: string,
    targetLabel: string,
  ) => void;
  regenerateOne: (item: PendingRegenItem) => void;
  regenerateAll: () => void;
  pendingRegen: PendingRegenItem[];
  packetBlockers: string[];
  approveBlocked: boolean;
  onApprove: () => void;
  onOpenPacket: (mode: "plexus" | "clinician") => void;
}): JSX.Element {
  const statusSty = statusToStyle(patient.status);
  const engagementOne = engagementOneLiner(patient.engagement);
  const hasPriorTesting = patient.priorTesting.length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Patient banner (74px) */}
      <div
        className="grid h-[74px] shrink-0 grid-cols-[1fr_auto] items-center gap-3 border-b px-4"
        style={{ background: "#F8FAFC", borderColor: "#CBD5E1" }}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="truncate text-[15px] font-bold" style={{ color: "#111827" }}>
              {patient.name}
            </div>
            <SquareStatusBadge label={patient.status} />
          </div>
          <div className="text-[12px]" style={{ color: "#475467" }}>
            DOB {patient.dob}
            <span className="mx-1.5" style={{ color: "#CBD5E1" }}>·</span>
            {patient.phone}
            <span className="mx-1.5" style={{ color: "#CBD5E1" }}>·</span>
            {patient.insurance}
            <span className="mx-1.5" style={{ color: "#CBD5E1" }}>·</span>
            {selectedDateLabel}
            <span className="mx-1.5" style={{ color: "#CBD5E1" }}>·</span>
            Batch {selectedBatchTime}
          </div>
          <div className="text-[11px]" style={{ color: "#475467" }}>
            <span style={{ color: "#667085" }}>Engagement:</span>{" "}
            <span style={{ color: statusSty.text }}>{engagementOne}</span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <SquareStatusBadge label={patient.status} />
          <div className="flex items-center gap-1.5">
            <PacketQaChipFromBlockers blockers={packetBlockers} />
            <span
              className="border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em]"
              style={{ borderColor: "#94A3B8", color: "#475569" }}
            >
              admin: {patient.status === "Admin Approved" ? "approved" : "pending"}
            </span>
          </div>
        </div>
      </div>

      {/* Prior Testing / Cooldown alert — only when something exists. */}
      {hasPriorTesting && (
        <div
          className="shrink-0 border-b"
          style={{ borderColor: "#CBD5E1", background: "#FFFFFF" }}
        >
          <div
            className="flex h-[28px] items-center px-3 text-[10px] font-bold uppercase tracking-[0.14em] text-white"
            style={{ background: "#0B0B0F" }}
          >
            Prior Testing / Cooldown
          </div>
          <ul>
            {patient.priorTesting.map((pt) => (
              <li
                key={pt.id}
                className="grid items-center gap-3 border-b px-3 py-2 text-[12px]"
                style={{
                  borderColor: "#E2E8F0",
                  gridTemplateColumns: "1fr 110px 1fr 130px 1fr",
                  background:
                    pt.cooldownStatus === "within"
                      ? "#FEF2F2"
                      : pt.cooldownStatus === "needs_verification"
                        ? "#FFFBEB"
                        : "#FFFFFF",
                }}
              >
                <span className="font-semibold" style={{ color: "#111827" }}>
                  {pt.ancillary}
                  {pt.subtype ? ` · ${pt.subtype}` : ""}
                </span>
                <span style={{ color: "#475467" }}>Done {pt.datePerformed}</span>
                <span style={{ color: "#475467" }}>{pt.result ?? "—"}</span>
                <span
                  className="border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em]"
                  style={{
                    borderColor:
                      pt.cooldownStatus === "within"
                        ? "#DC2626"
                        : pt.cooldownStatus === "needs_verification"
                          ? "#D97706"
                          : "#94A3B8",
                    color:
                      pt.cooldownStatus === "within"
                        ? "#B91C1C"
                        : pt.cooldownStatus === "needs_verification"
                          ? "#B45309"
                          : "#475569",
                    background:
                      pt.cooldownStatus === "within"
                        ? "#FEF2F2"
                        : pt.cooldownStatus === "needs_verification"
                          ? "#FFFBEB"
                          : "#FFFFFF",
                    width: "fit-content",
                  }}
                >
                  {pt.cooldownStatus === "within"
                    ? "Within cooldown"
                    : pt.cooldownStatus === "needs_verification"
                      ? "Needs verification"
                      : "Outside cooldown"}
                </span>
                <span style={{ color: "#475467" }}>{pt.action ?? ""}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Body — 55% / 45% internal split. */}
      <div
        className="grid min-h-0 flex-1"
        style={{
          gridTemplateColumns: "55% 45%",
          borderTop: hasPriorTesting ? undefined : "0px",
        }}
      >
        {/* Left review panel: Ancillaries + Pending regen queue. */}
        <div
          className="flex min-h-0 flex-col border-r"
          style={{ borderColor: "#CBD5E1" }}
        >
          <div
            className="flex h-[28px] items-center px-3 text-[10px] font-bold uppercase tracking-[0.14em] text-white"
            style={{ background: "#0B0B0F" }}
          >
            Ancillaries
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {actionableAncillaries.length === 0 ? (
              <div
                className="px-4 py-6 text-[12px] italic"
                style={{ color: "#667085" }}
              >
                No actionable ancillaries. Any qualifying tests for this patient
                are either in cooldown or have not been generated yet — see the
                Prior Testing / Cooldown alert above.
              </div>
            ) : (
              actionableAncillaries.map((a) => {
                const expanded = isAncillaryExpanded(a.id);
                const ancStaleHere = pendingRegen.some(
                  (r) => r.ancillaryId === a.id,
                );
                return (
                  <div
                    key={a.id}
                    style={{ borderBottom: "1px solid #E2E8F0" }}
                  >
                    <button
                      type="button"
                      onClick={() => toggleAncillary(a.id)}
                      className="flex h-[38px] w-full items-center gap-2 px-3 text-left"
                      style={{
                        background: expanded ? "#F1F5F9" : "#FFFFFF",
                      }}
                    >
                      {expanded ? (
                        <ChevronDown className="h-3 w-3" style={{ color: "#475467" }} />
                      ) : (
                        <ChevronRight className="h-3 w-3" style={{ color: "#475467" }} />
                      )}
                      <span
                        className="flex-1 text-[13px] font-bold"
                        style={{ color: "#111827" }}
                      >
                        {a.ancillary}
                        {a.subtype ? ` · ${a.subtype}` : ""}
                      </span>
                      {ancStaleHere ? (
                        <SquareStatusBadge label="Regeneration Required" />
                      ) : (
                        <PacketQaChipFromKind kind={a.packetQa.kind} />
                      )}
                    </button>
                    {expanded && (
                      <div className="px-4 py-3" style={{ background: "#FFFFFF" }}>
                        <AncillaryEvidenceBlock patient={patient} ancillary={a} />
                        <div className="mt-3">
                          <SubHeader>Qualifying factors</SubHeader>
                          {a.qualifyingFactors.length === 0 ? (
                            <Muted>none</Muted>
                          ) : (
                            <ul className="mt-1 flex flex-wrap gap-1">
                              {a.qualifyingFactors.map((f, i) => (
                                <li
                                  key={i}
                                  className="border px-1.5 py-0.5 text-[11px]"
                                  style={{ borderColor: "#CBD5E1", color: "#111827" }}
                                >
                                  {f}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                        <div className="mt-3">
                          <SubHeader>Clinician understanding</SubHeader>
                          <p className="mt-0.5 text-[12px]" style={{ color: "#111827" }}>
                            {a.clinicianUnderstanding}
                          </p>
                        </div>
                        <div className="mt-3">
                          <SubHeader>Patient talking points</SubHeader>
                          <p className="mt-0.5 text-[12px]" style={{ color: "#111827" }}>
                            {a.patientTalkingPoints}
                          </p>
                        </div>
                        <div className="mt-3">
                          <SubHeader>ICD-10</SubHeader>
                          <ul className="mt-1 flex flex-wrap gap-1">
                            {a.icd10Codes.map((c, i) => (
                              <li
                                key={i}
                                className="border px-1.5 py-0.5 text-[11px] font-mono"
                                style={{ borderColor: "#CBD5E1", color: "#475467" }}
                              >
                                {c}
                              </li>
                            ))}
                          </ul>
                        </div>
                        {a.packetQa.kind !== "ready" && (
                          <div className="mt-3">
                            <SubHeader>Packet QA</SubHeader>
                            <ul className="mt-0.5 space-y-0.5">
                              {(a.packetQa.messages ?? []).map((m, i) => (
                                <li
                                  key={i}
                                  className="text-[11px]"
                                  style={{
                                    color:
                                      a.packetQa.kind === "blockers"
                                        ? "#B91C1C"
                                        : "#B45309",
                                  }}
                                >
                                  • {m}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        <div className="mt-3 flex items-center justify-end gap-1.5">
                          <SquareButton
                            disabled={!ancStaleHere}
                            onClick={() => {
                              const item = pendingRegen.find(
                                (r) => r.ancillaryId === a.id,
                              );
                              if (item) regenerateOne(item);
                            }}
                          >
                            <RefreshCcw className="h-3 w-3" /> Regenerate this ancillary
                          </SquareButton>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Pending Regeneration Queue */}
          {pendingRegen.length > 0 && (
            <div className="shrink-0" style={{ borderTop: "1px solid #CBD5E1" }}>
              <div
                className="flex h-[28px] items-center justify-between px-3 text-[10px] font-bold uppercase tracking-[0.14em] text-white"
                style={{ background: "#0B0B0F" }}
              >
                <span>Pending Regeneration ({pendingRegen.length})</span>
                <SquareButton variant="black" onClick={regenerateAll}>
                  <RefreshCcw className="h-3 w-3" /> Regenerate all changes
                </SquareButton>
              </div>
              <ul>
                {pendingRegen.map((item) => (
                  <li
                    key={item.id}
                    className="grid items-center gap-3 border-b px-3 py-2 text-[12px]"
                    style={{
                      borderColor: "#E2E8F0",
                      gridTemplateColumns: "180px 1fr auto auto",
                      background: "#FFFFFF",
                    }}
                  >
                    <span className="font-semibold" style={{ color: "#111827" }}>
                      {item.ancillary}
                      {item.subtype ? ` · ${item.subtype}` : ""}
                    </span>
                    <span style={{ color: "#475467" }}>{item.change}</span>
                    <SquareStatusBadge label="Regeneration Required" />
                    <SquareButton onClick={() => regenerateOne(item)}>
                      <RefreshCcw className="h-3 w-3" /> Regenerate
                    </SquareButton>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Right source panel: tabs */}
        <div className="flex min-h-0 flex-col">
          <div
            className="flex h-[34px] items-stretch border-b"
            style={{ borderColor: "#CBD5E1" }}
          >
            {(["SOURCE", "HISTORY", "ICD", "ENGAGEMENT"] as const).map((t) => {
              const active = activeTab === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setActiveTab(t)}
                  className="flex flex-1 items-center justify-center text-[11px] font-bold uppercase tracking-[0.14em]"
                  style={{
                    background: active ? "#0B0B0F" : "#FFFFFF",
                    color: active ? "#FFFFFF" : "#475467",
                    borderRight: "1px solid #CBD5E1",
                  }}
                >
                  {t}
                </button>
              );
            })}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {activeTab === "SOURCE" && (
              <SourceTab
                patient={patient}
                actionableAncillaries={actionableAncillaries}
                attachPopover={attachPopover}
                openAttachPopover={openAttachPopover}
                closeAttachPopover={closeAttachPopover}
                performAttach={performAttach}
              />
            )}
            {activeTab === "HISTORY" && <HistoryTab patient={patient} />}
            {activeTab === "ICD" && <IcdTab patient={patient} />}
            {activeTab === "ENGAGEMENT" && (
              <EngagementTab patient={patient} />
            )}
          </div>
        </div>
      </div>

      {/* Footer — approval blocker + actions */}
      <div
        className="flex h-[48px] shrink-0 items-center justify-between border-t px-3"
        style={{ background: "#F8FAFC", borderColor: "#CBD5E1" }}
      >
        <div className="text-[11px]" style={{ color: "#475467" }}>
          {approveBlocked ? (
            <div className="flex items-center gap-1.5">
              <AlertTriangle className="h-3 w-3" style={{ color: "#B91C1C" }} />
              <span style={{ color: "#B91C1C" }}>
                Cannot approve:{" "}
                {[
                  ...pendingRegen.map(
                    (r) =>
                      `${r.ancillary}${r.subtype ? ` · ${r.subtype}` : ""} (${r.change})`,
                  ),
                  ...packetBlockers,
                ]
                  .slice(0, 2)
                  .join(" · ")}
                {pendingRegen.length + packetBlockers.length > 2 ? " · …" : ""}
              </span>
            </div>
          ) : (
            <span style={{ color: "#047857" }}>
              <Check className="mr-1 inline h-3 w-3" />
              No blockers. Ready to approve.
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <SquareButton onClick={() => onOpenPacket("clinician")}>
            <FileText className="h-3 w-3" /> Clinician PDF
          </SquareButton>
          <SquareButton onClick={() => onOpenPacket("plexus")}>
            <FileBarChart className="h-3 w-3" /> Plexus PDF
          </SquareButton>
          <SquareButton>Needs Info</SquareButton>
          <SquareButton>Reviewed</SquareButton>
          <SquareButton
            variant="black"
            disabled={approveBlocked}
            onClick={onApprove}
          >
            Admin Approve
          </SquareButton>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Ancillary evidence block — DX/HX/RX/ICD/Prior Testing/Notes grouped
// by source kind. Shows which evidence is attached to this ancillary.

function AncillaryEvidenceBlock({
  patient,
  ancillary,
}: {
  patient: MockPatient;
  ancillary: ActionableAncillary;
}): JSX.Element {
  const attached = ancillary.attachedEvidenceIds;
  const all: Evidence[] = [
    ...patient.source.DX,
    ...patient.source.HX,
    ...patient.source.RX,
    ...patient.source.ICD,
    ...patient.source.Notes,
  ];
  const used = all.filter((e) => attached.includes(e.id));
  const byKind = groupByKind(used);
  return (
    <div>
      <SubHeader>Attached evidence</SubHeader>
      {used.length === 0 ? (
        <Muted>none attached</Muted>
      ) : (
        <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-2">
          {(["DX", "HX", "RX", "ICD", "Prior Testing", "Notes"] as const).map(
            (k) => {
              const items = byKind[k] ?? [];
              if (items.length === 0) return null;
              return (
                <div key={k}>
                  <div
                    className="text-[10px] font-bold uppercase tracking-[0.14em]"
                    style={{ color: "#667085" }}
                  >
                    {k}
                  </div>
                  <ul className="mt-0.5 space-y-0.5">
                    {items.map((e) => (
                      <li key={e.id} className="text-[12px]" style={{ color: "#111827" }}>
                        • {e.text}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            },
          )}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Source tab — DX/HX/RX/Prior Testing/Notes/ICD with attach popover.

function SourceTab({
  patient,
  actionableAncillaries,
  attachPopover,
  openAttachPopover,
  closeAttachPopover,
  performAttach,
}: {
  patient: MockPatient;
  actionableAncillaries: ActionableAncillary[];
  attachPopover: { evidenceId: string; open: boolean } | null;
  openAttachPopover: (evidenceId: string) => void;
  closeAttachPopover: () => void;
  performAttach: (
    evidenceId: string,
    targetAncillaryId: string,
    targetLabel: string,
  ) => void;
}): JSX.Element {
  const sections: Array<{
    kind: Evidence["kind"];
    items: Evidence[];
  }> = [
    { kind: "DX", items: patient.source.DX },
    { kind: "HX", items: patient.source.HX },
    { kind: "RX", items: patient.source.RX },
    { kind: "Prior Testing", items: [] },
    { kind: "Notes", items: patient.source.Notes },
    { kind: "ICD", items: patient.source.ICD },
  ];

  return (
    <div>
      {sections.map((s) => (
        <SourceSection
          key={s.kind}
          kind={s.kind}
          items={s.items}
          actionableAncillaries={actionableAncillaries}
          patient={patient}
          attachPopover={attachPopover}
          openAttachPopover={openAttachPopover}
          closeAttachPopover={closeAttachPopover}
          performAttach={performAttach}
        />
      ))}
    </div>
  );
}

function SourceSection({
  kind,
  items,
  actionableAncillaries,
  patient,
  attachPopover,
  openAttachPopover,
  closeAttachPopover,
  performAttach,
}: {
  kind: Evidence["kind"];
  items: Evidence[];
  actionableAncillaries: ActionableAncillary[];
  patient: MockPatient;
  attachPopover: { evidenceId: string; open: boolean } | null;
  openAttachPopover: (evidenceId: string) => void;
  closeAttachPopover: () => void;
  performAttach: (
    evidenceId: string,
    targetAncillaryId: string,
    targetLabel: string,
  ) => void;
}): JSX.Element {
  return (
    <div style={{ borderBottom: "1px solid #E2E8F0" }}>
      <div
        className="flex h-[28px] items-center justify-between px-3 text-[10px] font-bold uppercase tracking-[0.14em]"
        style={{ background: "#F1F5F9", color: "#475467" }}
      >
        <span>{kind}</span>
        <span style={{ color: "#94A3B8" }}>{items.length}</span>
      </div>
      <ul>
        {items.length === 0 ? (
          <li className="px-3 py-2 text-[12px] italic" style={{ color: "#667085" }}>
            none
          </li>
        ) : (
          items.map((e) => {
            const attachedTo = patient.ancillaries
              .filter((a) => a.attachedEvidenceIds.includes(e.id))
              .map((a) => `${a.ancillary}${a.subtype ? ` · ${a.subtype}` : ""}`);
            const popoverOpen = attachPopover?.evidenceId === e.id;
            return (
              <li
                key={e.id}
                className="px-3 py-2"
                style={{ borderBottom: "1px solid #F1F5F9" }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="text-[12px]" style={{ color: "#111827" }}>
                    {e.text}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => openAttachPopover(e.id)}
                      className="border px-1.5 py-0.5 text-[10px] font-semibold"
                      style={{ borderColor: "#111827", color: "#111827" }}
                    >
                      Attach
                    </button>
                  </div>
                </div>
                {attachedTo.length > 0 && (
                  <div className="mt-0.5 text-[11px]" style={{ color: "#475467" }}>
                    Attached to: {attachedTo.join(", ")}
                  </div>
                )}
                {popoverOpen && (
                  <div
                    className="mt-1 border bg-white p-2"
                    style={{ borderColor: "#111827" }}
                  >
                    <div
                      className="mb-1 text-[10px] font-bold uppercase tracking-[0.14em]"
                      style={{ color: "#475467" }}
                    >
                      Attach to which ancillary?
                    </div>
                    {actionableAncillaries.length === 0 ? (
                      <div className="text-[11px] italic" style={{ color: "#667085" }}>
                        No actionable ancillaries. Add a qualifying test first.
                      </div>
                    ) : (
                      <ul className="space-y-1">
                        {actionableAncillaries.map((a) => {
                          const label = `${a.ancillary}${a.subtype ? ` · ${a.subtype}` : ""}`;
                          return (
                            <li key={a.id}>
                              <button
                                type="button"
                                onClick={() => performAttach(e.id, a.id, label)}
                                className="flex w-full items-center justify-between border px-2 py-1 text-[11px] font-semibold hover:bg-[#F3F4F6]"
                                style={{ borderColor: "#CBD5E1" }}
                              >
                                <span>{label}</span>
                                <span style={{ color: "#475467" }}>Attach</span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    <div className="mt-2 flex items-center justify-end gap-1.5">
                      <SquareButton onClick={closeAttachPopover}>Cancel</SquareButton>
                    </div>
                  </div>
                )}
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// History / ICD / Engagement tabs — minimal placeholders that are
// still real-feeling from the mock data.

function HistoryTab({ patient }: { patient: MockPatient }): JSX.Element {
  return (
    <div className="space-y-3 px-3 py-3 text-[12px]" style={{ color: "#111827" }}>
      <Block label="Diagnoses">
        {patient.source.DX.map((d) => d.text).join("; ") || "—"}
      </Block>
      <Block label="History">
        {patient.source.HX.map((h) => h.text).join("; ") || "—"}
      </Block>
      <Block label="Medications">
        {patient.source.RX.map((r) => r.text).join("; ") || "—"}
      </Block>
      <Block label="Prior testing">
        {patient.priorTesting.length === 0
          ? "—"
          : patient.priorTesting
              .map(
                (pt) =>
                  `${pt.ancillary}${pt.subtype ? ` · ${pt.subtype}` : ""} on ${pt.datePerformed}${pt.result ? ` — ${pt.result}` : ""}`,
              )
              .join("; ")}
      </Block>
      <Block label="Imported notes">
        {patient.source.Notes.length === 0
          ? "—"
          : patient.source.Notes.map((n) => n.text).join("; ")}
      </Block>
    </div>
  );
}

function IcdTab({ patient }: { patient: MockPatient }): JSX.Element {
  const allCodes: string[] = patient.ancillaries.flatMap((a) => a.icd10Codes);
  return (
    <div className="px-3 py-3 text-[12px]" style={{ color: "#111827" }}>
      <SubHeader>Selected ICD-10 codes</SubHeader>
      {allCodes.length === 0 ? (
        <Muted>none</Muted>
      ) : (
        <ul className="mt-1 flex flex-wrap gap-1">
          {Array.from(new Set(allCodes)).map((c) => (
            <li
              key={c}
              className="border px-1.5 py-0.5 font-mono text-[11px]"
              style={{ borderColor: "#CBD5E1", color: "#111827" }}
            >
              {c}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 text-[11px] italic" style={{ color: "#667085" }}>
        ICD search via OpenAI lookup — read-only in this prototype. Use{" "}
        <span style={{ color: "#111827", fontWeight: 600 }}>Open full Admin Review</span>{" "}
        to add codes.
      </div>
    </div>
  );
}

function EngagementTab({ patient }: { patient: MockPatient }): JSX.Element {
  const sty = statusToStyle(patient.engagement.state);
  return (
    <div className="px-3 py-3 text-[12px]" style={{ color: "#111827" }}>
      <SubHeader>Status</SubHeader>
      <div
        className="mt-1 inline-flex items-center border px-2 py-0.5 text-[11px] uppercase tracking-[0.12em]"
        style={{
          borderColor: sty.border,
          color: sty.text,
          background: sty.bg,
        }}
      >
        {patient.engagement.state}
      </div>
      {patient.engagement.assignedTo && (
        <div className="mt-2">
          <SubHeader>Assigned to</SubHeader>
          <div className="mt-0.5">{patient.engagement.assignedTo}</div>
        </div>
      )}
      {patient.engagement.note && (
        <div className="mt-2">
          <SubHeader>Note</SubHeader>
          <div className="mt-0.5 text-[12px]" style={{ color: "#475467" }}>
            {patient.engagement.note}
          </div>
        </div>
      )}
      <div className="mt-3 flex items-center gap-1.5">
        <SquareButton>
          <ExternalLink className="h-3 w-3" /> Open in Engagement Center
        </SquareButton>
      </div>
      <div className="mt-3 text-[11px] italic" style={{ color: "#667085" }}>
        Manual engagement approval / distribute route is owned by Engagement
        Center. Plexus IQ shows status read-only here.
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Shared sub-components

function SectionHeader({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div
      className="flex h-[32px] shrink-0 items-center px-3 text-[11px] font-bold uppercase tracking-[0.14em] text-white"
      style={{ background: "#0B0B0F" }}
    >
      {children}
    </div>
  );
}

function SubHeader({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div
      className="text-[10px] font-bold uppercase tracking-[0.14em]"
      style={{ color: "#667085" }}
    >
      {children}
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div
      className="mt-0.5 text-[11px] italic"
      style={{ color: "#98A2B3" }}
    >
      {children}
    </div>
  );
}

function Block({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div>
      <SubHeader>{label}</SubHeader>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

function SquareButton({
  children,
  onClick,
  disabled,
  variant,
  title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "black" | "default";
  title?: string;
}): JSX.Element {
  const black = variant === "black";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="inline-flex items-center justify-center gap-1 border text-[12px] font-semibold disabled:cursor-not-allowed"
      style={{
        height: 32,
        padding: "0 12px",
        background: black ? "#0B0B0F" : "#FFFFFF",
        color: black ? "#FFFFFF" : "#111827",
        borderColor: "#111827",
        opacity: disabled ? 0.38 : 1,
        transition: "background 120ms cubic-bezier(0.2, 0, 0, 1)",
      }}
    >
      {children}
    </button>
  );
}

function LinkButton({
  children,
  onClick,
  disabled,
  tone,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: "rose";
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="text-[11px] font-semibold underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:no-underline"
      style={{
        color: tone === "rose" ? "#B91C1C" : "#111827",
        opacity: disabled ? 0.38 : 1,
      }}
    >
      {children}
    </button>
  );
}

function SquareStatusBadge({
  label,
}: {
  label: StatusLabel | "Regeneration Required" | "Cooldown Blocked" | "Needs Verification";
}): JSX.Element {
  const sty =
    label === "Regeneration Required"
      ? { bg: "#FFF7ED", border: "#D97706", text: "#B45309" }
      : label === "Cooldown Blocked"
        ? { bg: "#FEF2F2", border: "#DC2626", text: "#B91C1C" }
        : label === "Needs Verification"
          ? { bg: "#FFFBEB", border: "#D97706", text: "#B45309" }
          : statusToStyle(label as StatusLabel);
  return (
    <span
      className="inline-flex items-center border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em]"
      style={{ background: sty.bg, borderColor: sty.border, color: sty.text }}
    >
      {label}
    </span>
  );
}

function PacketQaChipFromKind({
  kind,
}: {
  kind: "ready" | "warnings" | "blockers";
}): JSX.Element {
  const sty =
    kind === "ready"
      ? { bg: "#F0FDF4", border: "#059669", text: "#047857" }
      : kind === "warnings"
        ? { bg: "#FFFBEB", border: "#D97706", text: "#B45309" }
        : { bg: "#FEF2F2", border: "#DC2626", text: "#B91C1C" };
  return (
    <span
      className="inline-flex items-center border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em]"
      style={{ background: sty.bg, borderColor: sty.border, color: sty.text }}
    >
      QA: {kind}
    </span>
  );
}

function PacketQaChipFromBlockers({
  blockers,
}: {
  blockers: string[];
}): JSX.Element {
  if (blockers.length > 0) return <PacketQaChipFromKind kind="blockers" />;
  return <PacketQaChipFromKind kind="ready" />;
}

function ModalOverlay({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}): JSX.Element {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(11, 11, 15, 0.5)" }}
      onClick={onClose}
    >
      <div onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Pure helpers

function findEvidence(patient: MockPatient, evidenceId: string): Evidence | null {
  for (const kind of ["DX", "HX", "RX", "ICD", "Notes"] as const) {
    const found = patient.source[kind].find((e) => e.id === evidenceId);
    if (found) return found;
  }
  return null;
}

function groupByKind(items: Evidence[]): Partial<Record<Evidence["kind"], Evidence[]>> {
  const out: Partial<Record<Evidence["kind"], Evidence[]>> = {};
  for (const e of items) {
    const cur = out[e.kind] ?? [];
    cur.push(e);
    out[e.kind] = cur;
  }
  return out;
}

function engagementOneLiner(e: MockPatient["engagement"]): string {
  if (e.state === "Not Sent") return "Not sent";
  if (e.assignedTo) return `${e.state} · ${e.assignedTo}`;
  return e.state;
}

function seedWorkingState(): Record<
  number,
  { attachments: Record<string, string[]>; pendingRegen: PendingRegenItem[]; packetBlockers: string[] }
> {
  const out: Record<
    number,
    { attachments: Record<string, string[]>; pendingRegen: PendingRegenItem[]; packetBlockers: string[] }
  > = {};
  for (const g of MOCK) {
    for (const b of g.batches) {
      for (const p of b.patients) {
        const attachments: Record<string, string[]> = {};
        for (const a of p.ancillaries) {
          attachments[a.id] = [...a.attachedEvidenceIds];
        }
        out[p.id] = {
          attachments,
          pendingRegen: [...(p.initialPendingRegen ?? [])],
          packetBlockers: (p.initialPacketBlocked ?? []).map((b) => b.reason),
        };
      }
    }
  }
  return out;
}

export default PlexusIQOperatingCanvasPrototype;
