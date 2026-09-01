// Plexus IQ — Operating Canvas design prototype (v2 — premium iOS).
//
// STANDALONE prototype for visual / product review. NOT production.
//   - All data is mocked in-file. No backend calls. No React Query.
//   - Reads `docs/architecture/PLATFORM_OPERATING_MODEL.md` as the
//     operating rulebook: patient is the spine, packets are live
//     outputs, no fake completion, no silent drops.
//
// VISUAL LANGUAGE (per the v2 brief):
//   - Premium iOS / macOS feel — NOT a black enterprise prison.
//   - Background #F5F7FB. White cards. Rounded radii (18 / 16 / 14 / 10).
//   - Subtle shadows. Calm blue/indigo accents. Inter font.
//   - Admin Review opens as an absolute-positioned overlay sheet over
//     the List + Right area; Date stays visible and clickable.
//   - No centered modal, no full-page backdrop, no skinny sidebar.
//   - No production AdminReviewDialog is used.

import { useEffect, useMemo, useRef, useState } from "react";
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
  Eye,
} from "lucide-react";

// ────────────────────────────────────────────────────────────────────
// Design tokens — kept inline so every value the brief lists is
// reachable in one read.

const COLOR = {
  pageBg: "#F5F7FB",
  surface: "#FFFFFF",
  surfaceGlass: "rgba(255,255,255,0.94)",
  surfaceMuted: "#F8FAFC",
  surfaceSelected: "#EFF6FF",
  border: "#E2E8F0",
  borderStrong: "#CBD5E1",
  textPrimary: "#0F172A",
  textSecondary: "#475569",
  textMuted: "#64748B",
  blue: "#2563EB",
  blueDark: "#1D4ED8",
  indigo: "#4F46E5",
  green: "#059669",
  amber: "#D97706",
  red: "#DC2626",
  softRed: "#FEF2F2",
  softAmber: "#FFFBEB",
  softOrange: "#FFF7ED",
  softBlue: "#EFF6FF",
  shadowColor: "rgba(15, 23, 42, 0.12)",
} as const;

const SHADOW = {
  card: "0 8px 24px rgba(15,23,42,0.06)",
  cardSm: "0 4px 14px rgba(15,23,42,0.04)",
  overlay: "0 24px 80px rgba(15,23,42,0.18)",
  control: "0 1px 4px rgba(15,23,42,0.10)",
} as const;

const RADIUS = {
  card: 18,
  inner: 16,
  innerSm: 14,
  button: 10,
  overlay: 24,
  chip: 999,
} as const;

const FONT_FAMILY =
  'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

// ────────────────────────────────────────────────────────────────────
// Mock domain types — local to this prototype.

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
  attachedEvidenceIds: string[];
  qualifyingFactors: string[];
  clinicianUnderstanding: string;
  patientTalkingPoints: string;
  icd10Codes: string[];
  reasoningRegeneratedAt: string;
  packetQa: { kind: "ready" | "warnings" | "blockers"; messages?: string[] };
};

type PriorTesting = {
  id: string;
  ancillary: Ancillary;
  subtype?: UltrasoundSubtype;
  datePerformed: string;
  result?: string;
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
  initialPendingRegen?: PendingRegenItem[];
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
// Mock data. 10 scenarios across two facilities + three dates.
// (Same patients as v1 + a new Failed/Needs Fix scenario.)

const NOW_ISO = "2026-06-19T10:42:00Z";

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
        patients: buildBatchPatients(),
      },
      {
        id: 1015,
        time: "8:15 AM",
        facility: "Taylor Family Practice",
        patientCount: 41,
        batchStatusLabel: "Pending Qualification",
        patients: buildPendingPatients(),
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
        patients: buildSecondaryPatients(),
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

function buildBatchPatients(): MockPatient[] {
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
          reasoningRegeneratedAt: NOW_ISO,
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
        HX: [{ id: "hx-102-a", kind: "HX", text: "Lightheadedness with position change" }],
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
        { reason: "VitalWave reasoning is stale (RX added after qualification)." },
      ],
    },
    // 3. Prior BrainWave within cooldown → BrainWave hidden.
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
    // 4. Carotid US needs-verification → carotid blocked, Arterial LE actionable.
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
          reasoningRegeneratedAt: NOW_ISO,
          packetQa: { kind: "ready" },
        },
      ],
      engagement: { state: "Not Sent" },
    },
    // 5. Multiple DX/HX/RX ready to attach.
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
          reasoningRegeneratedAt: NOW_ISO,
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
          reasoningRegeneratedAt: NOW_ISO,
          packetQa: { kind: "ready" },
        },
      ],
      engagement: { state: "Not Sent" },
    },
    // 6. Engagement: Pending Manual Approval · Sarah Lee.
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
          reasoningRegeneratedAt: NOW_ISO,
          packetQa: { kind: "ready" },
        },
      ],
      engagement: {
        state: "Pending Manual Approval",
        assignedTo: "Sarah Lee",
        note: "Routed via Scheduler Settings · awaiting engagement-center approval",
      },
    },
    // 7. Stale packet — Admin Approved + DX edit post-qualification.
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
        HX: [{ id: "hx-107-a", kind: "HX", text: "TIA episode 6mo ago" }],
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
        { reason: "Carotid Ultrasound reasoning is stale (DX edited after qualification)." },
      ],
    },
    // 8. Distributed, clean packet.
    {
      id: 108,
      name: "Hadley, Owen",
      dob: "1950-12-19",
      phone: "(206) 555-0108",
      insurance: "PPO",
      status: "Distributed",
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
          reasoningRegeneratedAt: NOW_ISO,
          packetQa: { kind: "ready" },
        },
      ],
      engagement: { state: "Distributed", assignedTo: "Sarah Lee" },
    },
    // 9. Multiple pending regens — Admin Approve blocked.
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
        { reason: "BrainWave has unregenerated HX edit (Family history of stroke)." },
        { reason: "VitalWave has unregenerated RX edit (Memantine)." },
      ],
    },
    // 10. Failed / Needs Fix — packet hard-blocked.
    {
      id: 110,
      name: "Jorgensen, Peter",
      dob: "1958-05-20",
      phone: "(206) 555-0110",
      insurance: "Medicare",
      status: "Failed / Needs Fix",
      source: {
        DX: [],
        HX: [],
        RX: [{ id: "rx-110-a", kind: "RX", text: "Lisinopril 10mg QD" }],
        ICD: [],
        Notes: [
          {
            id: "note-110-a",
            kind: "Notes",
            text: "Intake row had no Dx / Hx — AI pre-check flagged missing clinical info.",
          },
        ],
      },
      priorTesting: [],
      ancillaries: [],
      engagement: { state: "Not Sent" },
      initialPacketBlocked: [
        { reason: "Patient is in Failed / Needs Fix — no qualifying tests available." },
        { reason: "Missing clinical info (Dx / Hx) — qualification cannot proceed." },
      ],
    },
  ];
  return patients;
}

function buildPendingPatients(): MockPatient[] {
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

function buildSecondaryPatients(): MockPatient[] {
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
// Tone helpers — status → soft pill colors that match the iOS palette.

function statusTone(s: StatusLabel | EngagementState): {
  bg: string;
  border: string;
  text: string;
} {
  switch (s) {
    case "Parsed":
      return { bg: "#FFFFFF", border: "#CBD5E1", text: "#475569" };
    case "Pending Qualification":
      return { bg: COLOR.softOrange, border: "#FED7AA", text: "#B45309" };
    case "Qualification Running":
      return { bg: "#EFF6FF", border: "#BFDBFE", text: COLOR.blueDark };
    case "Ready for Review":
      return { bg: "#EFF6FF", border: "#BFDBFE", text: COLOR.blueDark };
    case "Admin Approved":
      return { bg: "#ECFDF5", border: "#A7F3D0", text: "#047857" };
    case "Sent to Engagement":
      return { bg: "#EEF2FF", border: "#C7D2FE", text: "#4338CA" };
    case "Engagement Approved":
    case "Pending Manual Approval":
      return { bg: "#F0F9FF", border: "#BAE6FD", text: "#0369A1" };
    case "Assigned":
      return { bg: "#EEF2FF", border: "#C7D2FE", text: "#4338CA" };
    case "Distributed":
      return { bg: "#ECFDF5", border: "#A7F3D0", text: "#047857" };
    case "Completed":
      return { bg: "#ECFDF5", border: "#A7F3D0", text: "#047857" };
    case "Failed / Needs Fix":
      return { bg: COLOR.softRed, border: "#FCA5A5", text: "#B91C1C" };
    case "Not Sent":
    default:
      return { bg: "#FFFFFF", border: "#CBD5E1", text: "#64748B" };
  }
}

function packetQaTone(kind: "ready" | "warnings" | "blockers"): {
  bg: string;
  border: string;
  text: string;
} {
  if (kind === "ready") return { bg: "#ECFDF5", border: "#A7F3D0", text: "#047857" };
  if (kind === "warnings") return { bg: COLOR.softAmber, border: "#FDE68A", text: "#B45309" };
  return { bg: COLOR.softRed, border: "#FCA5A5", text: "#B91C1C" };
}

function formatDateShort(d: string): string {
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

// ────────────────────────────────────────────────────────────────────
// Animation styles (injected once at the top of the prototype).

const ANIMATION_STYLES = `
  @keyframes review-overlay-enter {
    from { opacity: 0; transform: translateX(24px) scale(0.985); }
    to   { opacity: 1; transform: translateX(0)    scale(1); }
  }
  @keyframes review-overlay-exit {
    from { opacity: 1; transform: translateX(0)    scale(1); }
    to   { opacity: 0; transform: translateX(16px) scale(0.99); }
  }
  .review-overlay-enter {
    animation: review-overlay-enter 180ms cubic-bezier(0.2, 0, 0, 1) both;
  }
  .review-overlay-exit {
    animation: review-overlay-exit 120ms cubic-bezier(0.2, 0, 0, 1) both;
  }
  @keyframes mini-sheet-enter {
    from { opacity: 0; transform: scale(0.97); }
    to   { opacity: 1; transform: scale(1); }
  }
  .mini-sheet-enter { animation: mini-sheet-enter 140ms cubic-bezier(0.2, 0, 0, 1) both; }
  @keyframes toast-enter {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .toast-enter { animation: toast-enter 140ms cubic-bezier(0.2, 0, 0, 1) both; }
  .px-iq-base { font-family: ${FONT_FAMILY}; color: ${COLOR.textPrimary}; -webkit-font-smoothing: antialiased; }
  .px-iq-row-trans { transition: background 120ms cubic-bezier(0.2, 0, 0, 1); }
`;

// ────────────────────────────────────────────────────────────────────
// Prototype root

export function PlexusIQOperatingCanvasPrototype(): JSX.Element {
  // Selection state
  const [expandedDates, setExpandedDates] = useState<Set<string>>(
    () => new Set([MOCK[0].date]),
  );
  const [selectedBatchId, setSelectedBatchId] = useState<number>(1042);
  const [selectedPatientId, setSelectedPatientId] = useState<number>(101);
  const [checkedIds, setCheckedIds] = useState<Set<number>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");

  // Overlay state — open + leaving phase for exit animation.
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [overlayLeaving, setOverlayLeaving] = useState(false);

  // Overlay sub-state
  const [activeTab, setActiveTab] = useState<
    "Source" | "History" | "ICD" | "Engagement"
  >("Source");
  const [expandedAncillaries, setExpandedAncillaries] = useState<Set<string>>(
    () => new Set(["__all-default__"]),
  );
  const [attachPopover, setAttachPopover] = useState<{ evidenceId: string } | null>(
    null,
  );
  const [packetBlockedSheet, setPacketBlockedSheet] = useState<{
    mode: "plexus" | "clinician";
    reasons: string[];
  } | null>(null);

  // Per-patient working state (attachments + queue + blockers).
  const [workingState, setWorkingState] = useState<
    Record<
      number,
      {
        attachments: Record<string, string[]>;
        pendingRegen: PendingRegenItem[];
        packetBlockers: string[];
      }
    >
  >(() => seedWorkingState());

  const [toast, setToast] = useState<string | null>(null);

  // ─── Derived ──────────────────────────────────────────────
  const selectedBatch = useMemo<MockBatch | null>(() => {
    for (const g of MOCK) for (const b of g.batches) if (b.id === selectedBatchId) return b;
    return null;
  }, [selectedBatchId]);

  const selectedDate = useMemo<MockDateGroup | null>(() => {
    for (const g of MOCK) for (const b of g.batches) if (b.id === selectedBatchId) return g;
    return null;
  }, [selectedBatchId]);

  const patients = selectedBatch?.patients ?? [];

  const visiblePatients = useMemo<MockPatient[]>(() => {
    const q = searchQuery.trim().toLowerCase();
    if (q.length === 0) return patients;
    return patients.filter((p) =>
      [p.name, p.dob, p.insurance, p.status].some((s) => s.toLowerCase().includes(q)),
    );
  }, [patients, searchQuery]);

  const selectedPatient = useMemo<MockPatient | null>(
    () => patients.find((p) => p.id === selectedPatientId) ?? null,
    [patients, selectedPatientId],
  );

  const patientWorking = useMemo(() => {
    if (!selectedPatient) return null;
    return (
      workingState[selectedPatient.id] ?? {
        attachments: {},
        pendingRegen: [],
        packetBlockers: [],
      }
    );
  }, [workingState, selectedPatient]);

  // Actionable ancillaries — drop anything blocked by cooldown.
  const actionableAncillaries = useMemo<ActionableAncillary[]>(() => {
    if (!selectedPatient) return [];
    const blockedByCooldown = new Set<string>();
    for (const pt of selectedPatient.priorTesting) {
      if (pt.cooldownStatus === "within") {
        const key = pt.subtype ? `${pt.ancillary}::${pt.subtype}` : `${pt.ancillary}`;
        blockedByCooldown.add(key);
      }
    }
    return selectedPatient.ancillaries.filter((a) => {
      const key = a.subtype ? `${a.ancillary}::${a.subtype}` : a.ancillary;
      if (blockedByCooldown.has(key)) return false;
      if (a.ancillary !== "Ultrasound" && blockedByCooldown.has(a.ancillary)) return false;
      return true;
    });
  }, [selectedPatient]);

  const pendingRegen = patientWorking?.pendingRegen ?? [];
  const packetBlockers = patientWorking?.packetBlockers ?? [];
  const hasCooldownIssue = useMemo(() => {
    if (!selectedPatient) return false;
    return selectedPatient.priorTesting.some(
      (pt) => pt.cooldownStatus === "within" || pt.cooldownStatus === "needs_verification",
    );
  }, [selectedPatient]);
  const approveBlocked =
    pendingRegen.length > 0 ||
    packetBlockers.length > 0 ||
    selectedPatient?.status === "Failed / Needs Fix";

  // Metric counts for the top metric strip — derived live.
  const metrics = useMemo(() => {
    const all = patients;
    return {
      ready: all.filter((p) => p.status === "Ready for Review").length,
      missing: all.filter(
        (p) => p.status === "Failed / Needs Fix" || p.status === "Parsed",
      ).length,
      parsed: all.filter((p) => p.status === "Parsed" || p.status === "Pending Qualification").length,
      adminReviewPending: all.filter((p) => p.status === "Ready for Review").length,
      sent: all.filter(
        (p) =>
          p.engagement.state !== "Not Sent" ||
          p.status === "Sent to Engagement" ||
          p.status === "Distributed",
      ).length,
      total: all.length,
    };
  }, [patients]);

  // ─── Handlers ─────────────────────────────────────────────
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

  function openOverlayForPatient(id: number): void {
    setSelectedPatientId(id);
    if (!overlayOpen) {
      setOverlayLeaving(false);
      setOverlayOpen(true);
    }
  }

  function closeOverlay(): void {
    if (!overlayOpen) return;
    setOverlayLeaving(true);
    window.setTimeout(() => {
      setOverlayOpen(false);
      setOverlayLeaving(false);
    }, 120);
  }

  function toggleAncillary(id: string): void {
    setExpandedAncillaries((prev) => {
      const next = new Set(prev);
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
    return expandedAncillaries.has("__all-default__") || expandedAncillaries.has(id);
  }

  function openAttachPopover(evidenceId: string): void {
    setAttachPopover({ evidenceId });
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
      const targetAnc = selectedPatient.ancillaries.find((a) => a.id === targetAncillaryId);
      const newRegen: PendingRegenItem = {
        id: `regen-${patientId}-${evidenceId}-${targetAncillaryId}-${Date.now()}`,
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
    showToast(`Attached to ${targetLabel}. Regeneration required.`);
    setAttachPopover(null);
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
    showToast("Regenerated. Reasoning + packet QA refreshed.");
    setPacketBlockedSheet(null);
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
      const stillBlocking = new Set(nextRegen.map((r) => r.ancillary));
      const nextBlockers = cur.packetBlockers.filter((m) =>
        Array.from(stillBlocking).some((a) => m.startsWith(a)),
      );
      return {
        ...prev,
        [patientId]: { ...cur, pendingRegen: nextRegen, packetBlockers: nextBlockers },
      };
    });
    showToast(`Regenerated ${item.ancillary}${item.subtype ? ` · ${item.subtype}` : ""}.`);
  }

  function openPacket(mode: "plexus" | "clinician"): void {
    if (!selectedPatient) return;
    if (packetBlockers.length > 0 || selectedPatient.status === "Failed / Needs Fix") {
      const reasons =
        packetBlockers.length > 0
          ? packetBlockers
          : ["Patient is in Failed / Needs Fix — no qualifying tests available."];
      setPacketBlockedSheet({ mode, reasons });
      return;
    }
    showToast(
      `${mode === "plexus" ? "Plexus" : "Clinician"} PDF preview ready (mock).`,
    );
  }

  function approve(): void {
    if (approveBlocked) return;
    showToast("Admin Approved. Routed via existing commit / scheduler path.");
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

  function deleteSelected(): void {
    if (checkedIds.size === 0) return;
    const ok = window.confirm(
      `Delete ${checkedIds.size} patient${checkedIds.size === 1 ? "" : "s"} (mock)?`,
    );
    if (!ok) return;
    setCheckedIds(new Set());
    showToast(`Deleted ${checkedIds.size} patient(s) (mock).`);
  }

  // ─── Toast helper ──────────────────────────────────────────
  const toastTimerRef = useRef<number | null>(null);
  function showToast(msg: string): void {
    setToast(msg);
    if (toastTimerRef.current != null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 1800);
  }
  useEffect(() => {
    return () => {
      if (toastTimerRef.current != null) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  // ─── Render ───────────────────────────────────────────────
  const qualBatch = selectedBatch;
  const qualStripText = qualBatch
    ? qualBatch.batchStatusLabel === "Qualification Running"
      ? `Running · ${qualBatch.facility} · ${selectedDate?.label.split(",")[1]?.trim() ?? ""} · ${qualBatch.time} · 312/1000 complete · 41 skipped · 3 failed · ETA 8m`
      : qualBatch.batchStatusLabel === "Pending Qualification"
        ? `Pending · ${qualBatch.facility} · ${qualBatch.time} · ${qualBatch.patientCount} parsed`
        : `Ready · ${qualBatch.facility} · ${qualBatch.time} · ${qualBatch.patientCount} patients`
    : "No batch selected";

  const qualStatusDotColor =
    qualBatch?.batchStatusLabel === "Qualification Running"
      ? COLOR.blue
      : qualBatch?.batchStatusLabel === "Pending Qualification"
        ? COLOR.amber
        : COLOR.green;

  return (
    <div
      className="px-iq-base"
      style={{
        background: COLOR.pageBg,
        minHeight: "100vh",
        padding: 24,
        overflowX: "hidden",
      }}
    >
      <style>{ANIMATION_STYLES}</style>

      {/* ── Top header card ─────────────────────────────────── */}
      <div
        style={{
          background: COLOR.surface,
          borderRadius: RADIUS.card,
          border: `1px solid ${COLOR.border}`,
          boxShadow: SHADOW.card,
          padding: "16px 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: COLOR.textPrimary,
              letterSpacing: "-0.01em",
            }}
          >
            Plexus IQ
          </div>
          <div
            style={{
              marginTop: 2,
              fontSize: 12,
              color: COLOR.textSecondary,
            }}
          >
            {selectedBatch
              ? `${selectedBatch.facility} · ${selectedDate?.label} · Batch ${selectedBatch.time} · ${selectedBatch.patientCount} patients`
              : "Pick a batch on the left to start working"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <PillButton onClick={() => showToast("Add Patient (mock)")} variant="secondary">
            <Plus size={14} /> Add Patient
          </PillButton>
          <PillButton onClick={() => showToast("Paste / Import (mock)")} variant="secondary">
            <Upload size={14} /> Paste / Import
          </PillButton>
          <PillButton onClick={() => showToast("Generate (mock)")} variant="primary">
            <Sparkles size={14} /> Generate
          </PillButton>
          <PillButton onClick={() => showToast("Retry Failed (mock)")} variant="secondary">
            <RotateCw size={14} /> Retry Failed
          </PillButton>
          <PillButton onClick={() => openPacket("clinician")} variant="secondary">
            <FileText size={14} /> Clinician Atlas
          </PillButton>
          <PillButton onClick={() => openPacket("plexus")} variant="secondary">
            <FileBarChart size={14} /> Plexus Atlas
          </PillButton>
        </div>
      </div>

      {/* ── Metric strip ────────────────────────────────────── */}
      <div
        style={{
          marginTop: 16,
          display: "grid",
          gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
          gap: 12,
        }}
      >
        <MetricCard label="Ready" value={metrics.ready} accent={COLOR.green} />
        <MetricCard label="Missing Info" value={metrics.missing} accent={COLOR.red} />
        <MetricCard label="Parsed" value={metrics.parsed} accent={COLOR.amber} />
        <MetricCard
          label="Admin Review Pending"
          value={metrics.adminReviewPending}
          accent={COLOR.blue}
        />
        <MetricCard label="Sent to Engagement" value={metrics.sent} accent={COLOR.indigo} />
        <MetricCard label="All Patients" value={metrics.total} accent={COLOR.textMuted} />
      </div>

      {/* ── Qualification rail ──────────────────────────────── */}
      <div
        style={{
          marginTop: 16,
          background: COLOR.surface,
          borderRadius: RADIUS.innerSm,
          border: `1px solid ${COLOR.border}`,
          boxShadow: SHADOW.cardSm,
          height: 36,
          padding: "0 14px",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: 999,
            background: qualStatusDotColor,
            boxShadow: SHADOW.control,
          }}
        />
        <span style={{ fontSize: 12, color: COLOR.textSecondary, flex: 1 }}>
          {qualStripText}
        </span>
        {patients.filter((p) => p.status === "Failed / Needs Fix").length > 0 && (
          <button
            type="button"
            onClick={() => showToast("Retry Failed (mock)")}
            style={{
              height: 26,
              padding: "0 10px",
              borderRadius: RADIUS.button,
              border: `1px solid ${COLOR.borderStrong}`,
              background: COLOR.surface,
              color: COLOR.textSecondary,
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Retry Failed
          </button>
        )}
      </div>

      {/* ── Main work area (relative parent for overlay) ─────── */}
      <div
        style={{
          position: "relative",
          marginTop: 16,
          display: "grid",
          gridTemplateColumns: "260px minmax(520px, 1fr) minmax(360px, 460px)",
          gap: 16,
          minHeight: "calc(100vh - 280px)",
        }}
      >
        {/* ── Date panel ──────────────────────────────────────── */}
        <aside
          style={{
            background: COLOR.surface,
            borderRadius: RADIUS.card,
            border: `1px solid ${COLOR.border}`,
            boxShadow: SHADOW.card,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
          }}
        >
          <PanelHeader title="Date" />
          <div style={{ overflowY: "auto", minHeight: 0, flex: 1 }}>
            <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
              {MOCK.map((g) => {
                const expanded = expandedDates.has(g.date);
                return (
                  <li key={g.date} style={{ borderBottom: `1px solid ${COLOR.border}` }}>
                    <button
                      type="button"
                      onClick={() => toggleDate(g.date)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        width: "100%",
                        height: 36,
                        padding: "0 14px",
                        background: "transparent",
                        border: "none",
                        cursor: "pointer",
                        color: COLOR.textPrimary,
                        fontSize: 13,
                        fontWeight: 600,
                        textAlign: "left",
                      }}
                    >
                      {expanded ? (
                        <ChevronDown size={14} color={COLOR.textMuted} />
                      ) : (
                        <ChevronRight size={14} color={COLOR.textMuted} />
                      )}
                      <span style={{ flex: 1 }}>{g.label}</span>
                      <span style={{ fontSize: 11, fontWeight: 500, color: COLOR.textMuted }}>
                        {g.batches.length}
                      </span>
                    </button>
                    {expanded && (
                      <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                        {g.batches.map((b) => {
                          const active = b.id === selectedBatchId;
                          const tone = statusTone(b.batchStatusLabel);
                          return (
                            <li key={b.id}>
                              <button
                                type="button"
                                onClick={() => pickBatch(b.id)}
                                className="px-iq-row-trans"
                                style={{
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: 2,
                                  width: "100%",
                                  padding: "8px 14px 8px 18px",
                                  background: active ? COLOR.surfaceSelected : "transparent",
                                  borderLeft: `3px solid ${active ? COLOR.blue : "transparent"}`,
                                  border: "none",
                                  cursor: "pointer",
                                  textAlign: "left",
                                }}
                              >
                                <span
                                  style={{
                                    fontSize: 13,
                                    fontWeight: 700,
                                    color: COLOR.textPrimary,
                                  }}
                                >
                                  {b.time}
                                </span>
                                <span style={{ fontSize: 11, color: COLOR.textSecondary }}>
                                  {b.patientCount} patient{b.patientCount === 1 ? "" : "s"}
                                </span>
                                <span
                                  style={{
                                    marginTop: 2,
                                    alignSelf: "flex-start",
                                    fontSize: 10,
                                    fontWeight: 600,
                                    letterSpacing: "0.05em",
                                    textTransform: "uppercase",
                                    color: tone.text,
                                  }}
                                >
                                  {b.batchStatusLabel}
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

        {/* ── List panel ──────────────────────────────────────── */}
        <section
          style={{
            background: COLOR.surface,
            borderRadius: RADIUS.card,
            border: `1px solid ${COLOR.border}`,
            boxShadow: SHADOW.card,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
          }}
        >
          <PanelHeader
            title="Patients"
            subtitle={
              selectedBatch
                ? `${selectedBatch.facility} · ${selectedDate?.label.split(",")[1]?.trim() ?? ""} · ${selectedBatch.time}`
                : undefined
            }
          />
          {/* Sub-toolbar */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: "8px 14px",
              borderBottom: `1px solid ${COLOR.border}`,
              background: COLOR.surfaceMuted,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <LinkButton
                onClick={selectAllVisible}
                disabled={visiblePatients.length === 0}
              >
                Select all visible
              </LinkButton>
              <LinkButton onClick={clearSelection} disabled={checkedIds.size === 0}>
                Clear
              </LinkButton>
              <LinkButton
                onClick={deleteSelected}
                disabled={checkedIds.size === 0}
                tone="rose"
              >
                Delete selected{checkedIds.size > 0 ? ` (${checkedIds.size})` : ""}
              </LinkButton>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "0 10px",
                width: 220,
                height: 30,
                background: COLOR.surface,
                border: `1px solid ${COLOR.border}`,
                borderRadius: RADIUS.button,
                boxShadow: SHADOW.control,
              }}
            >
              <Search size={12} color={COLOR.textMuted} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search"
                style={{
                  flex: 1,
                  border: "none",
                  outline: "none",
                  background: "transparent",
                  fontSize: 12,
                  color: COLOR.textPrimary,
                  fontFamily: FONT_FAMILY,
                }}
              />
            </div>
          </div>
          {/* List rows */}
          <div style={{ overflowY: "auto", minHeight: 0, flex: 1 }}>
            {visiblePatients.length === 0 ? (
              <EmptyState>
                {patients.length === 0
                  ? "Pick a batch on the left."
                  : "No patients match the search."}
              </EmptyState>
            ) : (
              <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                {visiblePatients.map((p) => {
                  const active = p.id === selectedPatientId;
                  const checked = checkedIds.has(p.id);
                  const tone = statusTone(p.status);
                  const eng = p.engagement;
                  return (
                    <li
                      key={p.id}
                      onClick={() => pickPatient(p.id)}
                      className="px-iq-row-trans"
                      style={{
                        display: "grid",
                        gridTemplateColumns:
                          "32px 1fr 100px 160px auto auto 80px 32px",
                        alignItems: "center",
                        columnGap: 10,
                        height: 52,
                        padding: "0 14px",
                        background: active ? COLOR.surfaceSelected : "transparent",
                        borderLeft: `3px solid ${active ? COLOR.blue : "transparent"}`,
                        borderBottom: `1px solid ${COLOR.border}`,
                        cursor: "pointer",
                      }}
                      onMouseEnter={(e) => {
                        if (!active) (e.currentTarget as HTMLElement).style.background = COLOR.surfaceMuted;
                      }}
                      onMouseLeave={(e) => {
                        if (!active) (e.currentTarget as HTMLElement).style.background = "transparent";
                      }}
                    >
                      <div onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleChecked(p.id)}
                          aria-label={`Select ${p.name}`}
                        />
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: 600,
                            color: COLOR.textPrimary,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {p.name}
                        </div>
                        {eng.state !== "Not Sent" && (
                          <div
                            style={{
                              fontSize: 11,
                              color: COLOR.textSecondary,
                              marginTop: 1,
                            }}
                          >
                            {engagementOneLiner(eng)}
                          </div>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: COLOR.textSecondary }}>{p.dob}</div>
                      <div style={{ fontSize: 12, color: COLOR.textSecondary }}>{p.insurance}</div>
                      <div>
                        <Chip
                          bg={tone.bg}
                          border={tone.border}
                          text={tone.text}
                          label={p.status}
                        />
                      </div>
                      <div>
                        {eng.state !== "Not Sent" ? (
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 600,
                              color: statusTone(eng.state).text,
                            }}
                          >
                            {eng.state}
                          </span>
                        ) : (
                          <span style={{ fontSize: 11, color: COLOR.textMuted }}>—</span>
                        )}
                      </div>
                      <div onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => openOverlayForPatient(p.id)}
                          style={{
                            height: 30,
                            padding: "0 12px",
                            background: COLOR.blue,
                            color: "#FFFFFF",
                            border: "none",
                            borderRadius: RADIUS.button,
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: "pointer",
                            boxShadow: SHADOW.control,
                            fontFamily: FONT_FAMILY,
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                          }}
                          onMouseEnter={(e) => {
                            (e.currentTarget as HTMLElement).style.background = COLOR.blueDark;
                          }}
                          onMouseLeave={(e) => {
                            (e.currentTarget as HTMLElement).style.background = COLOR.blue;
                          }}
                        >
                          <Eye size={12} /> Review
                        </button>
                      </div>
                      <div onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm(`Delete "${p.name}" (mock)?`)) {
                              showToast(`Deleted "${p.name}" (mock).`);
                            }
                          }}
                          aria-label={`Delete ${p.name}`}
                          style={{
                            width: 24,
                            height: 24,
                            border: "none",
                            background: "transparent",
                            color: COLOR.textMuted,
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        {/* ── Right context card ──────────────────────────────── */}
        <aside
          style={{
            background: COLOR.surface,
            borderRadius: RADIUS.card,
            border: `1px solid ${COLOR.border}`,
            boxShadow: SHADOW.card,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
          }}
        >
          <PanelHeader title="Selected Patient" />
          {selectedPatient ? (
            <SelectedPatientCard
              patient={selectedPatient}
              packetBlockers={packetBlockers}
              pendingRegen={pendingRegen}
              onReview={() => openOverlayForPatient(selectedPatient.id)}
            />
          ) : (
            <EmptyState>No patient selected.</EmptyState>
          )}
        </aside>

        {/* ── Admin Review overlay (absolute over List + Right) ─ */}
        {overlayOpen && selectedPatient && (
          <div
            className={overlayLeaving ? "review-overlay-exit" : "review-overlay-enter"}
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              width: "clamp(860px, 68vw, 1180px)",
              height: "100%",
              maxHeight: "calc(100vh - 280px)",
              background: COLOR.surfaceGlass,
              backdropFilter: "blur(18px)",
              WebkitBackdropFilter: "blur(18px)",
              border: `1px solid rgba(226,232,240,0.9)`,
              borderRadius: RADIUS.overlay,
              boxShadow: SHADOW.overlay,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              zIndex: 20,
            }}
          >
            <AdminReviewOverlay
              patient={selectedPatient}
              selectedBatch={selectedBatch}
              selectedDate={selectedDate}
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
              hasCooldownIssue={hasCooldownIssue}
              approveBlocked={approveBlocked}
              onApprove={approve}
              onOpenPacket={openPacket}
              onClose={closeOverlay}
              packetBlockedSheet={packetBlockedSheet}
              dismissPacketBlockedSheet={() => setPacketBlockedSheet(null)}
            />
          </div>
        )}
      </div>

      {/* ── Toast ────────────────────────────────────────────── */}
      {toast && (
        <div
          className="toast-enter"
          style={{
            position: "fixed",
            left: "50%",
            bottom: 24,
            transform: "translateX(-50%)",
            background: "rgba(15, 23, 42, 0.92)",
            color: "#FFFFFF",
            padding: "10px 16px",
            borderRadius: RADIUS.button,
            fontSize: 12,
            fontWeight: 600,
            boxShadow: SHADOW.overlay,
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            zIndex: 60,
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Admin Review overlay — premium iOS sheet rendered over List + Right.

function AdminReviewOverlay({
  patient,
  selectedBatch,
  selectedDate,
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
  hasCooldownIssue,
  approveBlocked,
  onApprove,
  onOpenPacket,
  onClose,
  packetBlockedSheet,
  dismissPacketBlockedSheet,
}: {
  patient: MockPatient;
  selectedBatch: MockBatch | null;
  selectedDate: MockDateGroup | null;
  actionableAncillaries: ActionableAncillary[];
  isAncillaryExpanded: (id: string) => boolean;
  toggleAncillary: (id: string) => void;
  activeTab: "Source" | "History" | "ICD" | "Engagement";
  setActiveTab: (t: "Source" | "History" | "ICD" | "Engagement") => void;
  attachPopover: { evidenceId: string } | null;
  openAttachPopover: (evidenceId: string) => void;
  closeAttachPopover: () => void;
  performAttach: (evidenceId: string, targetId: string, label: string) => void;
  regenerateOne: (item: PendingRegenItem) => void;
  regenerateAll: () => void;
  pendingRegen: PendingRegenItem[];
  packetBlockers: string[];
  hasCooldownIssue: boolean;
  approveBlocked: boolean;
  onApprove: () => void;
  onOpenPacket: (mode: "plexus" | "clinician") => void;
  onClose: () => void;
  packetBlockedSheet: { mode: "plexus" | "clinician"; reasons: string[] } | null;
  dismissPacketBlockedSheet: () => void;
}): JSX.Element {
  const statusT = statusTone(patient.status);
  const packetT = packetQaTone(packetBlockers.length > 0 ? "blockers" : "ready");
  const engT = statusTone(patient.engagement.state);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", position: "relative" }}>
      {/* Overlay header (72px) */}
      <div
        style={{
          height: 72,
          padding: "0 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.98), rgba(248,250,252,0.94))",
          borderBottom: `1px solid ${COLOR.border}`,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: COLOR.textMuted,
            }}
          >
            Admin Review
          </div>
          <div style={{ marginTop: 2, display: "flex", alignItems: "baseline", gap: 10 }}>
            <span
              style={{
                fontSize: 20,
                fontWeight: 700,
                color: COLOR.textPrimary,
                letterSpacing: "-0.01em",
              }}
            >
              {patient.name}
            </span>
            <span style={{ fontSize: 12, color: COLOR.textSecondary }}>
              DOB {patient.dob} · {patient.insurance} · {patient.phone}
            </span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Chip bg={statusT.bg} border={statusT.border} text={statusT.text} label={patient.status} />
          <Chip bg={packetT.bg} border={packetT.border} text={packetT.text} label={`Packet ${packetBlockers.length > 0 ? "blocked" : "ready"}`} />
          <Chip bg={engT.bg} border={engT.border} text={engT.text} label={patient.engagement.state} />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 32,
              height: 32,
              borderRadius: 999,
              background: COLOR.surfaceMuted,
              color: "#334155",
              border: "none",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "background 120ms cubic-bezier(0.2, 0, 0, 1)",
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = COLOR.border)}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = COLOR.surfaceMuted)}
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Patient context strip (52px) */}
      <div
        style={{
          height: 52,
          padding: "0 20px",
          display: "flex",
          alignItems: "center",
          gap: 18,
          background: COLOR.surfaceMuted,
          borderBottom: `1px solid ${COLOR.border}`,
        }}
      >
        <ContextCell label="Facility" value={patient.ancillaries[0] ? selectedBatch?.facility ?? "—" : selectedBatch?.facility ?? "—"} />
        <ContextCell label="Date" value={selectedDate?.label ?? "—"} />
        <ContextCell label="Batch" value={selectedBatch?.time ?? "—"} />
        <ContextCell label="Workflow" value={patient.status} />
        <ContextCell
          label="Engagement"
          value={
            patient.engagement.assignedTo
              ? `${patient.engagement.state} · ${patient.engagement.assignedTo}`
              : patient.engagement.state
          }
        />
      </div>

      {/* Body — 54% / 46% */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "grid",
          gridTemplateColumns: "54% 46%",
        }}
      >
        {/* Left: Ancillary review */}
        <div
          style={{
            minHeight: 0,
            overflowY: "auto",
            padding: 12,
            borderRight: `1px solid ${COLOR.border}`,
          }}
        >
          {patient.priorTesting.length > 0 && (
            <PriorTestingCard priorTesting={patient.priorTesting} />
          )}
          {actionableAncillaries.length === 0 ? (
            <EmptyState>
              No actionable ancillaries. Any qualifying tests for this patient
              are either in cooldown (see above) or were never generated.
            </EmptyState>
          ) : (
            actionableAncillaries.map((a) => (
              <AncillaryCard
                key={a.id}
                ancillary={a}
                patient={patient}
                expanded={isAncillaryExpanded(a.id)}
                onToggle={() => toggleAncillary(a.id)}
                stale={pendingRegen.some((r) => r.ancillaryId === a.id)}
                onRegenerate={() => {
                  const item = pendingRegen.find((r) => r.ancillaryId === a.id);
                  if (item) regenerateOne(item);
                }}
              />
            ))
          )}
          {pendingRegen.length > 0 && (
            <PendingRegenCard
              items={pendingRegen}
              onRegenerateOne={regenerateOne}
              onRegenerateAll={regenerateAll}
            />
          )}
        </div>

        {/* Right: Source / History / ICD / Engagement */}
        <div style={{ minHeight: 0, display: "flex", flexDirection: "column" }}>
          <div style={{ padding: 12, paddingBottom: 8 }}>
            <SegmentedControl
              value={activeTab}
              onChange={setActiveTab}
              options={["Source", "History", "ICD", "Engagement"]}
            />
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 12px 12px" }}>
            {activeTab === "Source" && (
              <SourceTab
                patient={patient}
                actionableAncillaries={actionableAncillaries}
                attachPopover={attachPopover}
                openAttachPopover={openAttachPopover}
                closeAttachPopover={closeAttachPopover}
                performAttach={performAttach}
              />
            )}
            {activeTab === "History" && <HistoryTab patient={patient} />}
            {activeTab === "ICD" && <IcdTab patient={patient} />}
            {activeTab === "Engagement" && <EngagementTab patient={patient} />}
          </div>
        </div>
      </div>

      {/* Footer (64px) */}
      <div
        style={{
          height: 64,
          padding: "0 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          background: "rgba(248,250,252,0.96)",
          borderTop: `1px solid ${COLOR.border}`,
        }}
      >
        <div style={{ fontSize: 12, color: COLOR.textSecondary }}>
          {approveBlocked ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#B91C1C" }}>
              <AlertTriangle size={12} />
              {buildBlockerLine(pendingRegen, packetBlockers, hasCooldownIssue, patient.status)}
            </span>
          ) : (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#047857" }}>
              <Check size={12} /> No blockers · ready to approve
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <FooterButton tone="ghost" onClick={() => onOpenPacket("clinician")}>
            <FileText size={12} /> Clinician Atlas
          </FooterButton>
          <FooterButton tone="ghost" onClick={() => onOpenPacket("plexus")}>
            <FileBarChart size={12} /> Plexus Atlas
          </FooterButton>
          <FooterButton tone="secondary">Needs Info</FooterButton>
          <FooterButton tone="outline-blue">Reviewed</FooterButton>
          <FooterButton tone="primary" disabled={approveBlocked} onClick={onApprove}>
            Admin Approve
          </FooterButton>
        </div>
      </div>

      {/* Packet Blocked mini sheet — centered within overlay only */}
      {packetBlockedSheet && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(15, 23, 42, 0.04)",
            zIndex: 30,
          }}
          onClick={dismissPacketBlockedSheet}
        >
          <div
            className="mini-sheet-enter"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 480,
              background: COLOR.surface,
              borderRadius: RADIUS.card,
              border: `1px solid ${COLOR.border}`,
              boxShadow: SHADOW.overlay,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "16px 20px 12px",
                borderBottom: `1px solid ${COLOR.border}`,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <AlertTriangle size={16} color="#B91C1C" />
                <span
                  style={{
                    fontSize: 15,
                    fontWeight: 700,
                    color: COLOR.textPrimary,
                  }}
                >
                  Packet Blocked
                </span>
              </div>
              <div style={{ marginTop: 4, fontSize: 12, color: COLOR.textSecondary }}>
                Cannot generate {packetBlockedSheet.mode === "plexus" ? "Plexus" : "Clinician"} PDF until blockers are resolved.
              </div>
            </div>
            <ul style={{ margin: 0, padding: "12px 20px", listStyle: "none" }}>
              {packetBlockedSheet.reasons.map((r, i) => (
                <li
                  key={i}
                  style={{
                    fontSize: 12,
                    color: "#B91C1C",
                    borderLeft: "2px solid #DC2626",
                    paddingLeft: 10,
                    marginBottom: 8,
                  }}
                >
                  {r}
                </li>
              ))}
            </ul>
            <div
              style={{
                padding: "10px 20px",
                background: COLOR.surfaceMuted,
                borderTop: `1px solid ${COLOR.border}`,
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
              }}
            >
              <FooterButton tone="ghost" onClick={dismissPacketBlockedSheet}>
                Close
              </FooterButton>
              {pendingRegen.length > 0 && (
                <FooterButton tone="primary" onClick={regenerateAll}>
                  <RefreshCcw size={12} /> Regenerate all
                </FooterButton>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Prior Testing / Cooldown card.

function PriorTestingCard({
  priorTesting,
}: {
  priorTesting: PriorTesting[];
}): JSX.Element {
  const hasBlocked = priorTesting.some((pt) => pt.cooldownStatus === "within");
  return (
    <div
      style={{
        background: hasBlocked ? COLOR.softRed : COLOR.softAmber,
        border: `1px solid ${hasBlocked ? "#FCA5A5" : "#FDE68A"}`,
        borderRadius: RADIUS.inner,
        padding: 12,
        marginBottom: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <AlertTriangle size={14} color={hasBlocked ? "#B91C1C" : "#B45309"} />
        <span
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: hasBlocked ? "#7F1D1D" : "#7C2D12",
          }}
        >
          Prior Testing / Cooldown
        </span>
      </div>
      <ul style={{ margin: 0, marginTop: 8, padding: 0, listStyle: "none" }}>
        {priorTesting.map((pt) => (
          <li
            key={pt.id}
            style={{
              padding: "8px 0",
              borderTop: `1px solid rgba(0,0,0,0.06)`,
              display: "grid",
              gridTemplateColumns: "1fr 110px 1fr 130px",
              gap: 12,
              alignItems: "center",
              fontSize: 12,
            }}
          >
            <span style={{ color: COLOR.textPrimary, fontWeight: 600 }}>
              {pt.ancillary}
              {pt.subtype ? ` · ${pt.subtype}` : ""}
            </span>
            <span style={{ color: COLOR.textSecondary }}>Done {pt.datePerformed}</span>
            <span style={{ color: COLOR.textSecondary }}>{pt.result ?? "—"}</span>
            <Chip
              bg="#FFFFFF"
              border={pt.cooldownStatus === "within" ? "#DC2626" : "#D97706"}
              text={pt.cooldownStatus === "within" ? "#B91C1C" : "#B45309"}
              label={
                pt.cooldownStatus === "within"
                  ? "Within cooldown"
                  : pt.cooldownStatus === "needs_verification"
                    ? "Needs verification"
                    : "Outside cooldown"
              }
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Ancillary card.

function AncillaryCard({
  ancillary,
  patient,
  expanded,
  onToggle,
  stale,
  onRegenerate,
}: {
  ancillary: ActionableAncillary;
  patient: MockPatient;
  expanded: boolean;
  onToggle: () => void;
  stale: boolean;
  onRegenerate: () => void;
}): JSX.Element {
  const qaT = packetQaTone(stale ? "warnings" : ancillary.packetQa.kind);
  const label = stale ? "Regeneration Required" : `QA · ${ancillary.packetQa.kind}`;
  return (
    <div
      style={{
        background: COLOR.surface,
        border: `1px solid ${COLOR.border}`,
        borderTop: expanded ? `3px solid ${COLOR.blue}` : `1px solid ${COLOR.border}`,
        borderRadius: RADIUS.inner,
        boxShadow: SHADOW.cardSm,
        marginBottom: 12,
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: "100%",
          minHeight: 48,
          padding: 12,
          background: "transparent",
          border: "none",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 10,
          textAlign: "left",
        }}
      >
        {expanded ? (
          <ChevronDown size={14} color={COLOR.textMuted} />
        ) : (
          <ChevronRight size={14} color={COLOR.textMuted} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: COLOR.textPrimary,
            }}
          >
            {ancillary.ancillary}
            {ancillary.subtype ? ` · ${ancillary.subtype}` : ""}
          </div>
          <div style={{ fontSize: 12, color: COLOR.textMuted, marginTop: 2 }}>
            {ancillary.qualifyingFactors.slice(0, 2).join(" · ")}
          </div>
        </div>
        <Chip bg={qaT.bg} border={qaT.border} text={qaT.text} label={label} />
      </button>
      {expanded && (
        <div style={{ padding: "0 12px 12px" }}>
          <MicroLabel>Attached evidence</MicroLabel>
          <AttachedEvidenceList patient={patient} ancillary={ancillary} />
          <MicroLabel style={{ marginTop: 10 }}>Qualifying factors</MicroLabel>
          {ancillary.qualifyingFactors.length === 0 ? (
            <Muted>none</Muted>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
              {ancillary.qualifyingFactors.map((f, i) => (
                <span
                  key={i}
                  style={{
                    padding: "3px 8px",
                    background: COLOR.surfaceMuted,
                    border: `1px solid ${COLOR.border}`,
                    borderRadius: RADIUS.button,
                    fontSize: 11,
                    color: COLOR.textPrimary,
                  }}
                >
                  {f}
                </span>
              ))}
            </div>
          )}
          <MicroLabel style={{ marginTop: 10 }}>Clinician understanding</MicroLabel>
          <p style={{ marginTop: 4, fontSize: 13, color: COLOR.textPrimary, lineHeight: 1.5 }}>
            {ancillary.clinicianUnderstanding}
          </p>
          <MicroLabel style={{ marginTop: 10 }}>Patient talking points</MicroLabel>
          <p style={{ marginTop: 4, fontSize: 13, color: COLOR.textPrimary, lineHeight: 1.5 }}>
            {ancillary.patientTalkingPoints}
          </p>
          {ancillary.icd10Codes.length > 0 && (
            <>
              <MicroLabel style={{ marginTop: 10 }}>ICD-10</MicroLabel>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                {ancillary.icd10Codes.map((c, i) => (
                  <span
                    key={i}
                    style={{
                      padding: "3px 8px",
                      background: COLOR.surface,
                      border: `1px solid ${COLOR.border}`,
                      borderRadius: RADIUS.button,
                      fontSize: 11,
                      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                      color: COLOR.textSecondary,
                    }}
                  >
                    {c}
                  </span>
                ))}
              </div>
            </>
          )}
          {ancillary.packetQa.kind !== "ready" && (ancillary.packetQa.messages?.length ?? 0) > 0 && (
            <>
              <MicroLabel style={{ marginTop: 10 }}>Packet QA</MicroLabel>
              <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                {(ancillary.packetQa.messages ?? []).map((m, i) => (
                  <li
                    key={i}
                    style={{
                      fontSize: 12,
                      color: ancillary.packetQa.kind === "blockers" ? "#B91C1C" : "#B45309",
                      marginTop: 4,
                    }}
                  >
                    • {m}
                  </li>
                ))}
              </ul>
            </>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
            <button
              type="button"
              onClick={onRegenerate}
              disabled={!stale}
              style={{
                height: 30,
                padding: "0 12px",
                border: `1px solid ${stale ? COLOR.blue : COLOR.border}`,
                color: stale ? COLOR.blue : COLOR.textMuted,
                background: COLOR.surface,
                borderRadius: RADIUS.button,
                fontSize: 12,
                fontWeight: 600,
                cursor: stale ? "pointer" : "not-allowed",
                fontFamily: FONT_FAMILY,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <RefreshCcw size={12} /> Regenerate this ancillary
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function AttachedEvidenceList({
  patient,
  ancillary,
}: {
  patient: MockPatient;
  ancillary: ActionableAncillary;
}): JSX.Element {
  const all: Evidence[] = [
    ...patient.source.DX,
    ...patient.source.HX,
    ...patient.source.RX,
    ...patient.source.ICD,
    ...patient.source.Notes,
  ];
  const used = all.filter((e) => ancillary.attachedEvidenceIds.includes(e.id));
  if (used.length === 0) return <Muted>none attached</Muted>;
  const groups: Partial<Record<Evidence["kind"], Evidence[]>> = {};
  for (const e of used) {
    const cur = groups[e.kind] ?? [];
    cur.push(e);
    groups[e.kind] = cur;
  }
  const kinds: Evidence["kind"][] = ["DX", "HX", "RX", "ICD", "Notes"];
  return (
    <div style={{ marginTop: 6, display: "grid", gap: 6 }}>
      {kinds.map((k) => {
        const items = groups[k];
        if (!items || items.length === 0) return null;
        return (
          <div key={k}>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: COLOR.textMuted,
                marginRight: 6,
              }}
            >
              {k}
            </span>
            <span style={{ fontSize: 12, color: COLOR.textPrimary }}>
              {items.map((i) => i.text).join("; ")}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Pending Regen card.

function PendingRegenCard({
  items,
  onRegenerateOne,
  onRegenerateAll,
}: {
  items: PendingRegenItem[];
  onRegenerateOne: (item: PendingRegenItem) => void;
  onRegenerateAll: () => void;
}): JSX.Element {
  return (
    <div
      style={{
        background: COLOR.softOrange,
        border: "1px solid #FED7AA",
        borderRadius: RADIUS.innerSm,
        padding: 12,
        marginTop: 4,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <RefreshCcw size={14} color="#B45309" />
          <span style={{ fontSize: 13, fontWeight: 700, color: "#7C2D12" }}>
            Regeneration Required ({items.length})
          </span>
        </div>
        <button
          type="button"
          onClick={onRegenerateAll}
          style={{
            height: 28,
            padding: "0 10px",
            background: COLOR.blue,
            color: "#FFFFFF",
            border: "none",
            borderRadius: 9,
            fontSize: 11,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: FONT_FAMILY,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <RefreshCcw size={12} /> Regenerate All
        </button>
      </div>
      <ul style={{ margin: 0, marginTop: 8, padding: 0, listStyle: "none" }}>
        {items.map((item) => (
          <li
            key={item.id}
            style={{
              padding: "8px 0",
              borderTop: `1px solid rgba(180, 83, 9, 0.15)`,
              display: "grid",
              gridTemplateColumns: "160px 1fr auto",
              gap: 10,
              alignItems: "center",
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 600, color: COLOR.textPrimary }}>
              {item.ancillary}
              {item.subtype ? ` · ${item.subtype}` : ""}
            </span>
            <span style={{ fontSize: 12, color: "#7C2D12" }}>{item.change}</span>
            <button
              type="button"
              onClick={() => onRegenerateOne(item)}
              style={{
                height: 26,
                padding: "0 8px",
                border: `1px solid ${COLOR.blue}`,
                color: COLOR.blue,
                background: COLOR.surface,
                borderRadius: 9,
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: FONT_FAMILY,
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <RefreshCcw size={11} /> Regenerate
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Right column tabs

function SegmentedControl({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: "Source" | "History" | "ICD" | "Engagement") => void;
  options: ReadonlyArray<"Source" | "History" | "ICD" | "Engagement">;
}): JSX.Element {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${options.length}, 1fr)`,
        gap: 3,
        background: "#F1F5F9",
        borderRadius: 12,
        padding: 3,
      }}
    >
      {options.map((o) => {
        const active = value === o;
        return (
          <button
            key={o}
            type="button"
            onClick={() => onChange(o)}
            style={{
              height: 28,
              border: "none",
              borderRadius: 10,
              background: active ? COLOR.surface : "transparent",
              boxShadow: active ? SHADOW.control : "none",
              color: active ? COLOR.textPrimary : COLOR.textSecondary,
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: FONT_FAMILY,
              transition: "background 120ms cubic-bezier(0.2, 0, 0, 1)",
            }}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

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
  attachPopover: { evidenceId: string } | null;
  openAttachPopover: (id: string) => void;
  closeAttachPopover: () => void;
  performAttach: (id: string, targetId: string, label: string) => void;
}): JSX.Element {
  const sections: Array<{ kind: Evidence["kind"]; items: Evidence[] }> = [
    { kind: "DX", items: patient.source.DX },
    { kind: "HX", items: patient.source.HX },
    { kind: "RX", items: patient.source.RX },
    { kind: "Prior Testing", items: [] },
    { kind: "Notes", items: patient.source.Notes },
    { kind: "ICD", items: patient.source.ICD },
  ];
  return (
    <div style={{ display: "grid", gap: 10 }}>
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
  attachPopover: { evidenceId: string } | null;
  openAttachPopover: (id: string) => void;
  closeAttachPopover: () => void;
  performAttach: (id: string, targetId: string, label: string) => void;
}): JSX.Element {
  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 6,
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: COLOR.textMuted,
          }}
        >
          {kind}
        </span>
        <span style={{ fontSize: 11, color: COLOR.textMuted }}>{items.length}</span>
      </div>
      <div style={{ display: "grid", gap: 6 }}>
        {items.length === 0 ? (
          <Muted>none</Muted>
        ) : (
          items.map((e) => {
            const attachedTo = patient.ancillaries
              .filter((a) => a.attachedEvidenceIds.includes(e.id))
              .map((a) => `${a.ancillary}${a.subtype ? ` · ${a.subtype}` : ""}`);
            const popoverOpen = attachPopover?.evidenceId === e.id;
            return (
              <div
                key={e.id}
                style={{
                  background: COLOR.surface,
                  border: `1px solid ${COLOR.border}`,
                  borderRadius: 12,
                  padding: 10,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: 8,
                  }}
                >
                  <div style={{ fontSize: 12, color: COLOR.textPrimary, lineHeight: 1.4 }}>
                    {e.text}
                  </div>
                  <button
                    type="button"
                    onClick={() => openAttachPopover(e.id)}
                    style={{
                      height: 26,
                      padding: "0 10px",
                      border: `1px solid ${COLOR.blue}`,
                      color: COLOR.blue,
                      background: COLOR.surface,
                      borderRadius: 9,
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: "pointer",
                      fontFamily: FONT_FAMILY,
                    }}
                  >
                    Attach
                  </button>
                </div>
                {attachedTo.length > 0 && (
                  <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {attachedTo.map((a, i) => (
                      <span
                        key={i}
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          padding: "2px 8px",
                          background: "#EEF2FF",
                          border: "1px solid #C7D2FE",
                          color: "#4338CA",
                          borderRadius: 999,
                          textTransform: "uppercase",
                          letterSpacing: "0.04em",
                        }}
                      >
                        {a}
                      </span>
                    ))}
                  </div>
                )}
                {popoverOpen && (
                  <div
                    style={{
                      marginTop: 8,
                      background: COLOR.surface,
                      border: `1px solid ${COLOR.border}`,
                      borderRadius: 12,
                      boxShadow: SHADOW.overlay,
                      padding: 8,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        color: COLOR.textMuted,
                        marginBottom: 4,
                        padding: "0 4px",
                      }}
                    >
                      Attach to which ancillary?
                    </div>
                    {actionableAncillaries.length === 0 ? (
                      <div style={{ fontSize: 11, color: COLOR.textMuted, padding: "4px 8px" }}>
                        No actionable ancillaries.
                      </div>
                    ) : (
                      <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                        {actionableAncillaries.map((a) => {
                          const label = `${a.ancillary}${a.subtype ? ` · ${a.subtype}` : ""}`;
                          return (
                            <li key={a.id} style={{ marginTop: 4 }}>
                              <button
                                type="button"
                                onClick={() => performAttach(e.id, a.id, label)}
                                style={{
                                  width: "100%",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                  padding: "8px 10px",
                                  background: COLOR.surfaceMuted,
                                  border: `1px solid ${COLOR.border}`,
                                  borderRadius: 9,
                                  fontSize: 12,
                                  fontWeight: 600,
                                  color: COLOR.textPrimary,
                                  cursor: "pointer",
                                  fontFamily: FONT_FAMILY,
                                }}
                              >
                                <span>{label}</span>
                                <span style={{ color: COLOR.blue, fontWeight: 600 }}>Attach</span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
                      <button
                        type="button"
                        onClick={closeAttachPopover}
                        style={{
                          height: 26,
                          padding: "0 10px",
                          background: "transparent",
                          color: COLOR.textSecondary,
                          border: "none",
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: "pointer",
                          fontFamily: FONT_FAMILY,
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function HistoryTab({ patient }: { patient: MockPatient }): JSX.Element {
  const events: Array<{ when: string; what: string; kind: "import" | "edit" | "regen" | "engagement" }> = [
    { when: "2026-06-19 10:42", what: "Patient imported from clinical paste", kind: "import" },
    { when: "2026-06-19 10:46", what: "AI qualification completed", kind: "regen" },
  ];
  if (patient.initialPendingRegen && patient.initialPendingRegen.length > 0) {
    events.push({
      when: "2026-06-19 11:02",
      what: `Source edit applied — ${patient.initialPendingRegen[0].change}`,
      kind: "edit",
    });
  }
  if (patient.engagement.state !== "Not Sent") {
    events.push({
      when: "2026-06-19 11:12",
      what: `Engagement: ${patient.engagement.state}${patient.engagement.assignedTo ? ` · ${patient.engagement.assignedTo}` : ""}`,
      kind: "engagement",
    });
  }
  const dotColor = {
    import: COLOR.indigo,
    edit: COLOR.amber,
    regen: COLOR.green,
    engagement: COLOR.blue,
  } as const;
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <MicroLabel>Timeline</MicroLabel>
      <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
        {events.map((ev, i) => (
          <li
            key={i}
            style={{
              padding: "8px 12px",
              background: COLOR.surface,
              border: `1px solid ${COLOR.border}`,
              borderRadius: 12,
              marginBottom: 8,
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 999,
                background: dotColor[ev.kind],
              }}
            />
            <span style={{ fontSize: 11, color: COLOR.textMuted, width: 110 }}>{ev.when}</span>
            <span style={{ fontSize: 12, color: COLOR.textPrimary, flex: 1 }}>{ev.what}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function IcdTab({ patient }: { patient: MockPatient }): JSX.Element {
  const allCodes = patient.ancillaries.flatMap((a) => a.icd10Codes);
  const unique = Array.from(new Set(allCodes));
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <MicroLabel>Selected ICD-10 codes</MicroLabel>
      {unique.length === 0 ? (
        <Muted>none</Muted>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {unique.map((c) => (
            <span
              key={c}
              style={{
                padding: "4px 10px",
                background: COLOR.surface,
                border: `1px solid ${COLOR.border}`,
                borderRadius: 9,
                fontSize: 12,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                color: COLOR.textPrimary,
              }}
            >
              {c}
            </span>
          ))}
        </div>
      )}
      <div
        style={{
          marginTop: 6,
          fontSize: 11,
          color: COLOR.textMuted,
          padding: 10,
          background: COLOR.surfaceMuted,
          borderRadius: 12,
          border: `1px solid ${COLOR.border}`,
        }}
      >
        ICD search via OpenAI lookup — read-only in this prototype. Use{" "}
        <strong style={{ color: COLOR.textPrimary }}>Open full Admin Review</strong> to add codes.
      </div>
    </div>
  );
}

function EngagementTab({ patient }: { patient: MockPatient }): JSX.Element {
  const tone = statusTone(patient.engagement.state);
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <MicroLabel>Status</MicroLabel>
      <div>
        <Chip
          bg={tone.bg}
          border={tone.border}
          text={tone.text}
          label={patient.engagement.state}
        />
      </div>
      {patient.engagement.assignedTo && (
        <>
          <MicroLabel>Assigned to</MicroLabel>
          <div style={{ fontSize: 13, color: COLOR.textPrimary }}>
            {patient.engagement.assignedTo}
          </div>
        </>
      )}
      {patient.engagement.note && (
        <>
          <MicroLabel>Note</MicroLabel>
          <div style={{ fontSize: 12, color: COLOR.textSecondary }}>{patient.engagement.note}</div>
        </>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <FooterButton tone="ghost">
          <ExternalLink size={12} /> Open in Engagement Center
        </FooterButton>
      </div>
      <div
        style={{
          marginTop: 4,
          fontSize: 11,
          color: COLOR.textMuted,
          padding: 10,
          background: COLOR.surfaceMuted,
          borderRadius: 12,
          border: `1px solid ${COLOR.border}`,
        }}
      >
        Admin Approve = "Approved by Plexus IQ + auto-routed". Engagement Center owns the manual
        approval / distribute step. Plexus IQ does not fake those writes.
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Right context card — selected patient summary.

function SelectedPatientCard({
  patient,
  packetBlockers,
  pendingRegen,
  onReview,
}: {
  patient: MockPatient;
  packetBlockers: string[];
  pendingRegen: PendingRegenItem[];
  onReview: () => void;
}): JSX.Element {
  const statusT = statusTone(patient.status);
  const packetT = packetQaTone(packetBlockers.length > 0 ? "blockers" : "ready");
  const engT = statusTone(patient.engagement.state);
  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12, overflow: "auto" }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, color: COLOR.textPrimary }}>
          {patient.name}
        </div>
        <div style={{ marginTop: 2, fontSize: 12, color: COLOR.textSecondary }}>
          DOB {patient.dob} · {patient.insurance}
        </div>
        <div style={{ marginTop: 2, fontSize: 12, color: COLOR.textSecondary }}>
          {patient.phone}
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        <Chip bg={statusT.bg} border={statusT.border} text={statusT.text} label={patient.status} />
        <Chip bg={packetT.bg} border={packetT.border} text={packetT.text} label={packetBlockers.length > 0 ? "Packet blocked" : "Packet ready"} />
        <Chip bg={engT.bg} border={engT.border} text={engT.text} label={patient.engagement.state} />
      </div>
      {pendingRegen.length > 0 && (
        <div
          style={{
            background: COLOR.softOrange,
            border: "1px solid #FED7AA",
            borderRadius: RADIUS.innerSm,
            padding: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <RefreshCcw size={12} color="#B45309" />
            <span style={{ fontSize: 12, fontWeight: 700, color: "#7C2D12" }}>
              {pendingRegen.length} item{pendingRegen.length === 1 ? "" : "s"} need regenerate
            </span>
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={onReview}
        style={{
          height: 38,
          background: COLOR.blue,
          color: "#FFFFFF",
          border: "none",
          borderRadius: RADIUS.button,
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
          fontFamily: FONT_FAMILY,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          boxShadow: SHADOW.control,
        }}
        onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = COLOR.blueDark)}
        onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = COLOR.blue)}
      >
        <Eye size={14} /> Open Admin Review
      </button>
      <div
        style={{
          fontSize: 11,
          color: COLOR.textMuted,
          padding: 10,
          background: COLOR.surfaceMuted,
          borderRadius: 12,
          border: `1px solid ${COLOR.border}`,
        }}
      >
        Admin Review opens as a premium sheet over the patient list — your Date selection stays
        visible, and you can click another patient row to swap context without closing.
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Small UI helpers

function PanelHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}): JSX.Element {
  return (
    <div
      style={{
        padding: "12px 16px",
        borderBottom: `1px solid ${COLOR.border}`,
        background: COLOR.surface,
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 700, color: COLOR.textPrimary }}>{title}</div>
      {subtitle && (
        <div style={{ marginTop: 2, fontSize: 12, color: COLOR.textMuted }}>{subtitle}</div>
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: string;
}): JSX.Element {
  return (
    <div
      style={{
        height: 54,
        padding: "8px 14px",
        background: COLOR.surface,
        borderRadius: RADIUS.inner,
        border: `1px solid ${COLOR.border}`,
        boxShadow: SHADOW.cardSm,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        position: "relative",
      }}
    >
      <span
        style={{
          position: "absolute",
          left: 0,
          top: 8,
          bottom: 8,
          width: 3,
          background: accent,
          borderRadius: 0,
        }}
      />
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: COLOR.textMuted,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color: COLOR.textPrimary, lineHeight: 1.1, marginTop: 2 }}>
        {value}
      </div>
    </div>
  );
}

function ContextCell({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: COLOR.textMuted,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: COLOR.textPrimary,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function Chip({
  bg,
  border,
  text,
  label,
}: {
  bg: string;
  border: string;
  text: string;
  label: string;
}): JSX.Element {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        height: 22,
        padding: "0 10px",
        background: bg,
        border: `1px solid ${border}`,
        color: text,
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: 0,
      }}
    >
      {label}
    </span>
  );
}

function PillButton({
  children,
  onClick,
  variant,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant: "primary" | "secondary";
  disabled?: boolean;
}): JSX.Element {
  const styles =
    variant === "primary"
      ? {
          background: COLOR.blue,
          color: "#FFFFFF",
          border: `1px solid ${COLOR.blue}`,
        }
      : {
          background: COLOR.surface,
          color: COLOR.textPrimary,
          border: `1px solid ${COLOR.border}`,
        };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        height: 34,
        padding: "0 14px",
        borderRadius: RADIUS.button,
        fontSize: 12,
        fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontFamily: FONT_FAMILY,
        boxShadow: variant === "primary" ? SHADOW.control : "none",
        ...styles,
        transition: "background 120ms cubic-bezier(0.2, 0, 0, 1)",
      }}
      onMouseEnter={(e) => {
        if (disabled) return;
        if (variant === "primary") {
          (e.currentTarget as HTMLElement).style.background = COLOR.blueDark;
        } else {
          (e.currentTarget as HTMLElement).style.background = COLOR.surfaceMuted;
        }
      }}
      onMouseLeave={(e) => {
        if (disabled) return;
        if (variant === "primary") {
          (e.currentTarget as HTMLElement).style.background = COLOR.blue;
        } else {
          (e.currentTarget as HTMLElement).style.background = COLOR.surface;
        }
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
      style={{
        background: "transparent",
        border: "none",
        cursor: disabled ? "not-allowed" : "pointer",
        color: tone === "rose" ? COLOR.red : COLOR.textPrimary,
        fontSize: 12,
        fontWeight: 600,
        opacity: disabled ? 0.4 : 1,
        fontFamily: FONT_FAMILY,
        padding: 0,
        textDecoration: "underline",
        textUnderlineOffset: 3,
      }}
    >
      {children}
    </button>
  );
}

function FooterButton({
  children,
  onClick,
  tone,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  tone: "primary" | "secondary" | "ghost" | "outline-blue";
  disabled?: boolean;
}): JSX.Element {
  let bg: string = COLOR.surface;
  let color: string = COLOR.textPrimary;
  let border: string = COLOR.borderStrong;
  if (tone === "primary") {
    bg = disabled ? COLOR.borderStrong : COLOR.blue;
    color = disabled ? COLOR.textMuted : "#FFFFFF";
    border = "transparent";
  } else if (tone === "outline-blue") {
    bg = COLOR.surface;
    color = COLOR.blue;
    border = COLOR.blue;
  } else if (tone === "ghost") {
    bg = "transparent";
    color = COLOR.textSecondary;
    border = "transparent";
  } else {
    bg = COLOR.surface;
    color = "#334155";
    border = COLOR.borderStrong;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        height: 36,
        padding: "0 14px",
        background: bg,
        color,
        border: `1px solid ${border}`,
        borderRadius: RADIUS.button,
        fontSize: 12,
        fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
        fontFamily: FONT_FAMILY,
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        transition: "background 120ms cubic-bezier(0.2, 0, 0, 1)",
      }}
    >
      {children}
    </button>
  );
}

function EmptyState({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div
      style={{
        padding: "24px 16px",
        textAlign: "center",
        color: COLOR.textMuted,
        fontSize: 12,
        fontStyle: "italic",
      }}
    >
      {children}
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div style={{ fontSize: 12, color: COLOR.textMuted, fontStyle: "italic" }}>{children}</div>
  );
}

function MicroLabel({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}): JSX.Element {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: COLOR.textMuted,
        ...style,
      }}
    >
      {children}
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

function engagementOneLiner(e: MockPatient["engagement"]): string {
  if (e.state === "Not Sent") return "Not sent";
  if (e.assignedTo) return `${e.state} · ${e.assignedTo}`;
  return e.state;
}

function buildBlockerLine(
  pending: PendingRegenItem[],
  packetBlockers: string[],
  hasCooldownIssue: boolean,
  status: StatusLabel,
): string {
  const parts: string[] = [];
  if (status === "Failed / Needs Fix") parts.push("patient is Failed / Needs Fix");
  if (pending.length > 0) {
    parts.push(
      `${pending.length} regeneration item${pending.length === 1 ? "" : "s"} pending`,
    );
  }
  if (packetBlockers.length > 0) parts.push(`${packetBlockers.length} packet QA blocker(s)`);
  if (hasCooldownIssue) parts.push("prior-test cooldown unresolved");
  if (parts.length === 0) return "Cannot approve — see findings above.";
  return `Cannot approve — ${parts.join("; ")}.`;
}

function seedWorkingState(): Record<
  number,
  {
    attachments: Record<string, string[]>;
    pendingRegen: PendingRegenItem[];
    packetBlockers: string[];
  }
> {
  const out: Record<
    number,
    {
      attachments: Record<string, string[]>;
      pendingRegen: PendingRegenItem[];
      packetBlockers: string[];
    }
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

// Reference these so the formatter doesn't trim the import on tree-shaking
// passes that don't run during dev preview.
void formatDateShort;

export default PlexusIQOperatingCanvasPrototype;
