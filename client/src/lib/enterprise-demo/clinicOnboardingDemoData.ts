// DEMO MOCK DATA — Clinic Onboarding.
//
// Replace with API-backed queries when endpoints are available. Likely
// shape:
//   GET /api/clinic-onboarding/clinics                 → OnboardingClinic[]
//   GET /api/clinic-onboarding/sections                → OnboardingSection[]
//   GET /api/clinic-onboarding/checklist?clinicId=…    → OnboardingChecklistItem[]
//   POST /api/clinic-onboarding/checklist/:itemId      → update status / note / etc.
//
// `buildChecklist` is deterministic per `clinicSeed`, so the demo
// surface stays stable across renders without backend storage.

import type {
  OnboardingChecklistItem,
  OnboardingClinic,
  OnboardingSection,
  OnboardingStatus,
} from "./types";

export const ONBOARDING_MATURITY_LABELS: Record<number, string> = {
  0: "Not Present",
  1: "Ad Hoc",
  2: "Consistent",
  3: "Optimized",
};

export const ONBOARDING_OWNERS = [
  "A. Reyes",
  "M. Coleman",
  "S. Nguyen",
  "T. Okafor",
  "L. Bianchi",
  "Plexus Impl. Team",
];

export const ONBOARDING_SALES_SECTIONS = new Set<number>([1, 4, 11]);

export const ONBOARDING_SECTION_DEFS: OnboardingSection[] = [
  { id: 1, name: "Ownership & Governance", phase: "Sales", items: ["Ownership structure", "Decision makers", "Operating agreement", "Admin contacts", "Escalation pathway", "Reporting expectations"] },
  { id: 2, name: "Systems & Logins", phase: "Implementation", items: ["EMR credentials", "Clearinghouse logins", "Fax portal access", "Email accounts", "Shared drive access", "Password vault entries"] },
  { id: 3, name: "Scheduling & Access", phase: "Implementation", items: ["Scheduling templates", "Appointment types", "Provider calendars", "Block scheduling rules", "Online booking", "Access hours"] },
  { id: 4, name: "Insurance & Payor Mix", phase: "Sales", items: ["Payor contracts", "Eligibility workflow", "Fee schedules", "Out-of-network policy", "Payor mix profile", "Verification process"] },
  { id: 5, name: "Front Desk & Check-In", phase: "Implementation", items: ["Check-in workflow", "Co-pay collection", "Intake forms", "Patient registration", "Insurance card scanning", "Wait-time process"] },
  { id: 6, name: "Documents & Faxes", phase: "Implementation", items: ["Fax routing", "Document indexing", "Record retention", "Release of information", "e-Signature setup", "Inbound triage"] },
  { id: 7, name: "Referrals", phase: "Implementation", items: ["Referral intake", "Referral tracking", "Outbound referrals", "Specialist network", "Referral SLAs", "Loop closure"] },
  { id: 8, name: "Prior Authorizations", phase: "Implementation", items: ["Auth workflow", "Payer requirements", "Auth tracking board", "Denial handling", "Peer-to-peer process", "Turnaround targets"] },
  { id: 9, name: "Medical Assistants", phase: "Implementation", items: ["MA roster", "Rooming workflow", "Vitals capture", "Standing orders", "Scope of duties", "Training status"] },
  { id: 10, name: "Providers", phase: "Implementation", items: ["Provider roster", "Provider schedules", "Documentation habits", "Productivity targets", "Supervision agreements", "Onboarding packet"] },
  { id: 11, name: "Ancillary Services", phase: "Sales", items: ["BrainWave readiness", "VitalWave readiness", "Ultrasound readiness", "Imaging Central readiness", "Equipment placement", "Staff training"] },
  { id: 12, name: "Remote Teams", phase: "Implementation", items: ["Remote staff roster", "Access provisioning", "Communication cadence", "Task assignment", "Performance tracking", "Coverage hours"] },
  { id: 13, name: "Communication", phase: "Implementation", items: ["Phone tree", "Patient messaging", "Internal channels", "Escalation contacts", "After-hours coverage", "Notification settings"] },
  { id: 14, name: "EMR Administration", phase: "Implementation", items: ["User management", "Template library", "Order sets", "Interface mapping", "Reporting setup", "Backup configuration"] },
  { id: 15, name: "Automations", phase: "Implementation", items: ["Reminder automations", "Recall campaigns", "Task automations", "Intake automations", "Billing triggers", "Workflow rules"] },
  { id: 16, name: "Inventory & Equipment", phase: "Implementation", items: ["Equipment inventory", "Supply par levels", "Vendor list", "Maintenance log", "Calibration schedule", "Reorder workflow"] },
  { id: 17, name: "Billing & Clearinghouse", phase: "Implementation", items: ["Clearinghouse setup", "Charge capture", "Claim scrubbing", "Payment posting", "Denial workflow", "AR follow-up"] },
  { id: 18, name: "Credentialing", phase: "Implementation", items: ["Provider credentialing", "Payer enrollment", "CAQH profiles", "Revalidation tracking", "License monitoring", "NPI registry"] },
  { id: 19, name: "HR & Training", phase: "Implementation", items: ["Staff onboarding", "Training curriculum", "Competency checks", "Policy acknowledgments", "Performance reviews", "PTO policy"] },
  { id: 20, name: "Infection Control & OSHA", phase: "Implementation", items: ["OSHA plan", "PPE supply", "Sharps disposal", "Exposure control", "Sterilization process", "Safety training"] },
  { id: 21, name: "Emergency & Downtime", phase: "Implementation", items: ["Downtime procedures", "Emergency contacts", "Backup systems", "Crash cart check", "Evacuation plan", "Incident reporting"] },
  { id: 22, name: "Telehealth & Virtual Care", phase: "Implementation", items: ["Telehealth platform", "Virtual workflow", "Consent process", "Tech support", "Billing rules", "Patient instructions"] },
  { id: 23, name: "Patient Experience & Access", phase: "Implementation", items: ["Satisfaction surveys", "Complaint workflow", "Wait-time monitoring", "Accessibility", "Language services", "Portal adoption"] },
  { id: 24, name: "Clinical Quality & Care Management", phase: "Implementation", items: ["Quality measures", "Care gap tracking", "Chronic care management", "Population health", "Outcome tracking", "Care plans"] },
  { id: 25, name: "Compliance & Risk", phase: "Implementation", items: ["HIPAA compliance", "Risk assessment", "BAAs on file", "Audit log review", "Incident response", "Policy library"] },
];

export const ONBOARDING_CLINICS: OnboardingClinic[] = [
  { id: "northstar", name: "Northstar Family Medicine", location: "Austin, TX", status: "Implementation", ownerContact: "Dr. Helen Park", goLiveTarget: "2026-02-15", phase: "Implementation", maturityScore: 2.3, blockers: 3, seed: 7 },
  { id: "cascade", name: "Cascade Internal Medicine", location: "Portland, OR", status: "Kickoff", ownerContact: "Dr. Omar Haddad", goLiveTarget: "2026-03-01", phase: "Sales", maturityScore: 1.4, blockers: 6, seed: 19 },
  { id: "harbor", name: "Harbor Point Cardiology", location: "San Diego, CA", status: "Pre-Go-Live", ownerContact: "Dr. Lisa Chen", goLiveTarget: "2026-01-20", phase: "Implementation", maturityScore: 2.8, blockers: 1, seed: 31 },
  { id: "summit", name: "Summit Primary Care", location: "Denver, CO", status: "Onboarding", ownerContact: "Dr. Ray Mitchell", goLiveTarget: "2026-02-28", phase: "Implementation", maturityScore: 2.0, blockers: 4, seed: 43 },
];

const STATUSES: OnboardingStatus[] = ["Not Started", "In Progress", "Completed"];

function pseudo(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

// Builds a deterministic 150-item checklist (25 sections × 6 items) for a
// given clinic seed. Deterministic so the demo stays stable across
// renders without server storage.
export function buildOnboardingChecklist(clinicSeed: number): OnboardingChecklistItem[] {
  const items: OnboardingChecklistItem[] = [];
  let globalIndex = 0;
  for (const section of ONBOARDING_SECTION_DEFS) {
    section.items.forEach((label, i) => {
      globalIndex += 1;
      const base = clinicSeed * 53 + globalIndex * 7;
      const r1 = pseudo(base);
      const r2 = pseudo(base + 1.3);
      const r3 = pseudo(base + 2.7);
      const status = STATUSES[Math.floor(r1 * 3)];
      let maturityScore: 0 | 1 | 2 | 3;
      if (status === "Completed") {
        maturityScore = (Math.floor(r2 * 2) + 2) as 2 | 3;
      } else if (status === "In Progress") {
        maturityScore = (Math.floor(r2 * 2) + 1) as 1 | 2;
      } else {
        maturityScore = Math.floor(r2 * 2) as 0 | 1;
      }
      const blocked = status !== "Completed" && r3 < 0.16;
      const dueOffset = (globalIndex % 28) + 1;
      items.push({
        id: `${section.id}-${i}`,
        sectionId: section.id,
        label,
        status,
        maturity: { score: maturityScore, label: ONBOARDING_MATURITY_LABELS[maturityScore] },
        phase: ONBOARDING_SALES_SECTIONS.has(section.id) ? "Sales" : "Implementation",
        owner: ONBOARDING_OWNERS[Math.floor(pseudo(base + 3.9) * ONBOARDING_OWNERS.length)],
        dueDate: `2026-02-${String(dueOffset).padStart(2, "0")}`,
        notes:
          status === "Completed"
            ? "Verified & signed off."
            : status === "In Progress"
              ? "Awaiting clinic confirmation."
              : "Not yet started.",
        blocked,
        lastUpdated: `2026-01-${String((globalIndex % 27) + 1).padStart(2, "0")}`,
      });
    });
  }
  return items;
}
