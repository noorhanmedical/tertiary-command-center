// DEMO MOCK DATA — Mission Control.
//
// Replace with API-backed query when an endpoint is available. Likely
// shape:
//   GET /api/mission-control/snapshot
//     → { lanes, alerts, sections, kpis?, queueCounts? }
//
// Until then, all values below are static demo content sized for the
// PR #294 enterprise-tile review.

import {
  ClipboardList,
  PhoneCall,
  RefreshCw,
  FlaskConical,
  FileWarning,
  Activity,
  XCircle,
  Receipt,
  ShieldAlert,
  Users,
  Building2,
  Stethoscope,
  CalendarClock,
  DollarSign,
  Layers,
  TrendingUp,
  UserCog,
} from "lucide-react";
import type {
  MissionControlAlert,
  MissionControlLaneRow,
  MissionControlQueueDef,
  MissionControlSection,
  QueueKey,
} from "./types";

export const MISSION_CONTROL_CLINICS = [
  "Northgate Cardiology",
  "Lakeside Internal Medicine",
  "Summit Family Care",
  "Harbor Neurology",
  "Cedar Valley Primary",
] as const;

export const MISSION_CONTROL_SERVICES = [
  "BrainWave",
  "VitalWave",
  "Ultrasound",
  "EKG",
  "PGX",
  "CGX",
] as const;

export const MISSION_CONTROL_QUEUE_DEFS: MissionControlQueueDef[] = [
  { key: "prescreen", label: "Prescreen", Icon: ClipboardList, trend: 6, tone: "bg-slate-100 text-slate-700" },
  { key: "ready-to-call", label: "Ready to Call", Icon: PhoneCall, trend: 12, tone: "bg-blue-100 text-blue-700" },
  { key: "follow-up", label: "Follow-up", Icon: RefreshCw, trend: -4, tone: "bg-indigo-100 text-indigo-700" },
  { key: "callbacks", label: "Callbacks", Icon: PhoneCall, trend: 3, tone: "bg-violet-100 text-violet-700" },
  { key: "pending-ancillary", label: "Pending Ancillary", Icon: FlaskConical, trend: -8, tone: "bg-amber-100 text-amber-700" },
  { key: "no-report", label: "No Report", Icon: FileWarning, trend: 9, tone: "bg-rose-100 text-rose-700" },
  { key: "re-eligible", label: "Re-Eligible", Icon: Activity, trend: 5, tone: "bg-teal-100 text-teal-700" },
  { key: "declined", label: "Declined", Icon: XCircle, trend: -2, tone: "bg-slate-100 text-slate-600" },
  { key: "billing-ready", label: "Billing Ready", Icon: Receipt, trend: 15, tone: "bg-emerald-100 text-emerald-700" },
  { key: "blocked", label: "Blocked / Needs Admin Review", Icon: ShieldAlert, trend: 7, tone: "bg-red-100 text-red-700" },
];

export const MISSION_CONTROL_QUEUE_LABEL: Record<QueueKey, string> =
  Object.fromEntries(
    MISSION_CONTROL_QUEUE_DEFS.map((q) => [q.key, q.label]),
  ) as Record<QueueKey, string>;

function mkTimeline(base: string): { time: string; event: string }[] {
  return [
    { time: "08:12", event: "Entered execution pipeline" },
    { time: "09:40", event: base },
    { time: "11:05", event: "Owner assigned" },
    { time: "13:22", event: "Status synced from canonical spine" },
  ];
}

const C = MISSION_CONTROL_CLINICS;
const QL = MISSION_CONTROL_QUEUE_LABEL;

export const MISSION_CONTROL_LANES: MissionControlLaneRow[] = [
  {
    id: "L-1001", patient: "Eleanor Whitfield", patientId: "PT-48213", clinic: C[0], service: "BrainWave", ancillary: "Cognitive Panel",
    lane: "ready-to-call", laneLabel: QL["ready-to-call"], status: "Ready", owner: "M. Alvarez", team: "Engagement",
    lastAction: "Eligibility confirmed", nextAction: "Outreach call", blocker: null, dueDate: "2025-06-12", priority: "High",
    timeline: mkTimeline("Eligibility confirmed"), documents: ["Insurance card", "Screening form"], callResult: "—",
    imagingStatus: "N/A", billingReadiness: "Not started",
  },
  {
    id: "L-1002", patient: "Marcus Bell", patientId: "PT-48114", clinic: C[1], service: "Ultrasound", ancillary: "Carotid Duplex",
    lane: "pending-ancillary", laneLabel: QL["pending-ancillary"], status: "In Progress", owner: "R. Cho", team: "Imaging",
    lastAction: "Scheduled imaging", nextAction: "Technician dispatch", blocker: null, dueDate: "2025-06-13", priority: "Medium",
    timeline: mkTimeline("Scheduled imaging"), documents: ["Order", "Consent"], callResult: "Reached — agreed",
    imagingStatus: "Scheduled", billingReadiness: "Awaiting report",
  },
  {
    id: "L-1003", patient: "Priya Nair", patientId: "PT-47991", clinic: C[3], service: "BrainWave", ancillary: "Neuro Screen",
    lane: "no-report", laneLabel: QL["no-report"], status: "Blocked", owner: "S. Patel", team: "Imaging",
    lastAction: "Study performed", nextAction: "Chase report upload", blocker: "Report not uploaded 48h", dueDate: "2025-06-10", priority: "Urgent",
    timeline: mkTimeline("Study performed"), documents: ["Order"], callResult: "Reached — agreed",
    imagingStatus: "Performed · no report", billingReadiness: "Blocked",
  },
  {
    id: "L-1004", patient: "Devon Ramirez", patientId: "PT-47820", clinic: C[2], service: "VitalWave", ancillary: "Autonomic Test",
    lane: "billing-ready", laneLabel: QL["billing-ready"], status: "Ready", owner: "J. Kim", team: "Billing",
    lastAction: "Report finalized", nextAction: "Submit claim", blocker: null, dueDate: "2025-06-11", priority: "High",
    timeline: mkTimeline("Report finalized"), documents: ["Report", "Signed note", "Insurance card"], callResult: "Reached — agreed",
    imagingStatus: "N/A", billingReadiness: "Ready",
  },
  {
    id: "L-1005", patient: "Hannah Schultz", patientId: "PT-47765", clinic: C[4], service: "EKG", ancillary: "Resting EKG",
    lane: "follow-up", laneLabel: QL["follow-up"], status: "Watch", owner: "M. Alvarez", team: "Engagement",
    lastAction: "Voicemail left", nextAction: "Retry outreach", blocker: null, dueDate: "2025-06-14", priority: "Low",
    timeline: mkTimeline("Voicemail left"), documents: ["Screening form"], callResult: "No answer",
    imagingStatus: "N/A", billingReadiness: "Not started",
  },
  {
    id: "L-1006", patient: "Oliver Grant", patientId: "PT-47640", clinic: C[0], service: "PGX", ancillary: "Pharmacogenomics",
    lane: "blocked", laneLabel: QL["blocked"], status: "Blocked", owner: "Admin Desk", team: "Admin Review",
    lastAction: "Flagged duplicate", nextAction: "Admin review", blocker: "Possible duplicate record", dueDate: "2025-06-09", priority: "Urgent",
    timeline: mkTimeline("Flagged duplicate"), documents: ["Insurance card"], callResult: "—",
    imagingStatus: "N/A", billingReadiness: "Blocked",
  },
  {
    id: "L-1007", patient: "Sofia Mendez", patientId: "PT-47588", clinic: C[1], service: "Ultrasound", ancillary: "Echocardiogram TTE",
    lane: "callbacks", laneLabel: QL["callbacks"], status: "In Progress", owner: "R. Cho", team: "Engagement",
    lastAction: "Callback requested", nextAction: "Call back 2pm", blocker: null, dueDate: "2025-06-12", priority: "Medium",
    timeline: mkTimeline("Callback requested"), documents: ["Screening form"], callResult: "Requested callback",
    imagingStatus: "N/A", billingReadiness: "Not started",
  },
  {
    id: "L-1008", patient: "Aiden Brooks", patientId: "PT-47512", clinic: C[2], service: "CGX", ancillary: "Carrier Genomics",
    lane: "declined", laneLabel: QL["declined"], status: "Complete", owner: "M. Alvarez", team: "Engagement",
    lastAction: "Patient declined", nextAction: "Archive", blocker: null, dueDate: "2025-06-08", priority: "Low",
    timeline: mkTimeline("Patient declined"), documents: [], callResult: "Declined",
    imagingStatus: "N/A", billingReadiness: "N/A",
  },
  {
    id: "L-1009", patient: "Grace Liu", patientId: "PT-47480", clinic: C[3], service: "BrainWave", ancillary: "Cognitive Panel",
    lane: "prescreen", laneLabel: QL["prescreen"], status: "Watch", owner: "Intake Bot", team: "Intake",
    lastAction: "Imported from EMR", nextAction: "Run prescreen", blocker: null, dueDate: "2025-06-15", priority: "Low",
    timeline: mkTimeline("Imported from EMR"), documents: ["EMR export"], callResult: "—",
    imagingStatus: "N/A", billingReadiness: "Not started",
  },
  {
    id: "L-1010", patient: "Nathan Cole", patientId: "PT-47399", clinic: C[4], service: "VitalWave", ancillary: "Autonomic Test",
    lane: "re-eligible", laneLabel: QL["re-eligible"], status: "Ready", owner: "J. Kim", team: "Engagement",
    lastAction: "Re-eligibility met", nextAction: "Re-engage outreach", blocker: null, dueDate: "2025-06-16", priority: "Medium",
    timeline: mkTimeline("Re-eligibility met"), documents: ["Screening form"], callResult: "—",
    imagingStatus: "N/A", billingReadiness: "Not started",
  },
  {
    id: "L-1011", patient: "Isabella Ford", patientId: "PT-47301", clinic: C[0], service: "Ultrasound", ancillary: "Renal Artery Doppler",
    lane: "pending-ancillary", laneLabel: QL["pending-ancillary"], status: "In Progress", owner: "S. Patel", team: "Imaging",
    lastAction: "Coverage confirmed", nextAction: "Technician in field", blocker: null, dueDate: "2025-06-13", priority: "Medium",
    timeline: mkTimeline("Coverage confirmed"), documents: ["Order", "Consent"], callResult: "Reached — agreed",
    imagingStatus: "In field", billingReadiness: "Awaiting report",
  },
  {
    id: "L-1012", patient: "Liam Hayes", patientId: "PT-47255", clinic: C[1], service: "BrainWave", ancillary: "Neuro Screen",
    lane: "billing-ready", laneLabel: QL["billing-ready"], status: "Ready", owner: "J. Kim", team: "Billing",
    lastAction: "Note signed", nextAction: "Submit claim", blocker: null, dueDate: "2025-06-11", priority: "High",
    timeline: mkTimeline("Note signed"), documents: ["Report", "Signed note"], callResult: "Reached — agreed",
    imagingStatus: "N/A", billingReadiness: "Ready",
  },
  {
    id: "L-1013", patient: "Mia Torres", patientId: "PT-47190", clinic: C[2], service: "EKG", ancillary: "Resting EKG",
    lane: "no-report", laneLabel: QL["no-report"], status: "Blocked", owner: "S. Patel", team: "Imaging",
    lastAction: "Study performed", nextAction: "Chase report", blocker: "QC review pending", dueDate: "2025-06-10", priority: "High",
    timeline: mkTimeline("Study performed"), documents: ["Order"], callResult: "Reached — agreed",
    imagingStatus: "Performed · QC pending", billingReadiness: "Blocked",
  },
  {
    id: "L-1014", patient: "Ethan Park", patientId: "PT-47122", clinic: C[3], service: "Ultrasound", ancillary: "AAA Duplex",
    lane: "ready-to-call", laneLabel: QL["ready-to-call"], status: "Ready", owner: "M. Alvarez", team: "Engagement",
    lastAction: "Eligibility confirmed", nextAction: "Outreach call", blocker: null, dueDate: "2025-06-12", priority: "Medium",
    timeline: mkTimeline("Eligibility confirmed"), documents: ["Screening form"], callResult: "—",
    imagingStatus: "N/A", billingReadiness: "Not started",
  },
  {
    id: "L-1015", patient: "Ava Robinson", patientId: "PT-47045", clinic: C[4], service: "VitalWave", ancillary: "Autonomic Test",
    lane: "follow-up", laneLabel: QL["follow-up"], status: "Watch", owner: "R. Cho", team: "Engagement",
    lastAction: "Awaiting paperwork", nextAction: "Follow up", blocker: null, dueDate: "2025-06-14", priority: "Low",
    timeline: mkTimeline("Awaiting paperwork"), documents: ["Screening form"], callResult: "Reached — pending docs",
    imagingStatus: "N/A", billingReadiness: "Not started",
  },
  {
    id: "L-1016", patient: "Noah Bennett", patientId: "PT-46980", clinic: C[0], service: "Ultrasound", ancillary: "LE Arterial Doppler",
    lane: "pending-ancillary", laneLabel: QL["pending-ancillary"], status: "In Progress", owner: "S. Patel", team: "Imaging",
    lastAction: "Technician dispatched", nextAction: "Upload report", blocker: null, dueDate: "2025-06-13", priority: "Medium",
    timeline: mkTimeline("Technician dispatched"), documents: ["Order", "Consent"], callResult: "Reached — agreed",
    imagingStatus: "In field", billingReadiness: "Awaiting report",
  },
  {
    id: "L-1017", patient: "Chloe Adams", patientId: "PT-46901", clinic: C[1], service: "PGX", ancillary: "Pharmacogenomics",
    lane: "blocked", laneLabel: QL["blocked"], status: "Blocked", owner: "Admin Desk", team: "Admin Review",
    lastAction: "Prior auth needed", nextAction: "Admin review", blocker: "Prior authorization missing", dueDate: "2025-06-09", priority: "Urgent",
    timeline: mkTimeline("Prior auth needed"), documents: ["Insurance card"], callResult: "Reached — agreed",
    imagingStatus: "N/A", billingReadiness: "Blocked",
  },
  {
    id: "L-1018", patient: "Lucas Reed", patientId: "PT-46844", clinic: C[2], service: "BrainWave", ancillary: "Cognitive Panel",
    lane: "callbacks", laneLabel: QL["callbacks"], status: "In Progress", owner: "M. Alvarez", team: "Engagement",
    lastAction: "Callback scheduled", nextAction: "Call back", blocker: null, dueDate: "2025-06-12", priority: "Low",
    timeline: mkTimeline("Callback scheduled"), documents: [], callResult: "Requested callback",
    imagingStatus: "N/A", billingReadiness: "Not started",
  },
  {
    id: "L-1019", patient: "Zoe Carter", patientId: "PT-46790", clinic: C[3], service: "Ultrasound", ancillary: "LE Venous Duplex",
    lane: "billing-ready", laneLabel: QL["billing-ready"], status: "Ready", owner: "J. Kim", team: "Billing",
    lastAction: "Report uploaded", nextAction: "Submit claim", blocker: null, dueDate: "2025-06-11", priority: "High",
    timeline: mkTimeline("Report uploaded"), documents: ["Report", "Signed note", "Insurance card"], callResult: "Reached — agreed",
    imagingStatus: "Complete", billingReadiness: "Ready",
  },
  {
    id: "L-1020", patient: "Mason Wright", patientId: "PT-46711", clinic: C[4], service: "CGX", ancillary: "Carrier Genomics",
    lane: "prescreen", laneLabel: QL["prescreen"], status: "Watch", owner: "Intake Bot", team: "Intake",
    lastAction: "Imported from EMR", nextAction: "Run prescreen", blocker: null, dueDate: "2025-06-15", priority: "Low",
    timeline: mkTimeline("Imported from EMR"), documents: ["EMR export"], callResult: "—",
    imagingStatus: "N/A", billingReadiness: "Not started",
  },
  {
    id: "L-1021", patient: "Layla Foster", patientId: "PT-46655", clinic: C[0], service: "EKG", ancillary: "Resting EKG",
    lane: "re-eligible", laneLabel: QL["re-eligible"], status: "Ready", owner: "R. Cho", team: "Engagement",
    lastAction: "Re-eligibility met", nextAction: "Re-engage", blocker: null, dueDate: "2025-06-16", priority: "Medium",
    timeline: mkTimeline("Re-eligibility met"), documents: ["Screening form"], callResult: "—",
    imagingStatus: "N/A", billingReadiness: "Not started",
  },
  {
    id: "L-1022", patient: "Henry Coleman", patientId: "PT-46588", clinic: C[1], service: "VitalWave", ancillary: "Autonomic Test",
    lane: "no-report", laneLabel: QL["no-report"], status: "Blocked", owner: "S. Patel", team: "Imaging",
    lastAction: "Study performed", nextAction: "Chase report", blocker: "Report not uploaded", dueDate: "2025-06-10", priority: "High",
    timeline: mkTimeline("Study performed"), documents: ["Order"], callResult: "Reached — agreed",
    imagingStatus: "Performed · no report", billingReadiness: "Blocked",
  },
  {
    id: "L-1023", patient: "Scarlett Hughes", patientId: "PT-46500", clinic: C[2], service: "BrainWave", ancillary: "Neuro Screen",
    lane: "ready-to-call", laneLabel: QL["ready-to-call"], status: "Ready", owner: "M. Alvarez", team: "Engagement",
    lastAction: "Eligibility confirmed", nextAction: "Outreach call", blocker: null, dueDate: "2025-06-12", priority: "Medium",
    timeline: mkTimeline("Eligibility confirmed"), documents: ["Screening form"], callResult: "—",
    imagingStatus: "N/A", billingReadiness: "Not started",
  },
  {
    id: "L-1024", patient: "Jack Morgan", patientId: "PT-46432", clinic: C[3], service: "Ultrasound", ancillary: "Carotid Duplex",
    lane: "follow-up", laneLabel: QL["follow-up"], status: "Watch", owner: "R. Cho", team: "Engagement",
    lastAction: "Left message", nextAction: "Retry outreach", blocker: null, dueDate: "2025-06-14", priority: "Low",
    timeline: mkTimeline("Left message"), documents: ["Screening form"], callResult: "No answer",
    imagingStatus: "N/A", billingReadiness: "Not started",
  },
  {
    id: "L-1025", patient: "Lily Simmons", patientId: "PT-46377", clinic: C[4], service: "PGX", ancillary: "Pharmacogenomics",
    lane: "declined", laneLabel: QL["declined"], status: "Complete", owner: "M. Alvarez", team: "Engagement",
    lastAction: "Patient declined", nextAction: "Archive", blocker: null, dueDate: "2025-06-08", priority: "Low",
    timeline: mkTimeline("Patient declined"), documents: [], callResult: "Declined",
    imagingStatus: "N/A", billingReadiness: "N/A",
  },
];

export const MISSION_CONTROL_ALERTS: MissionControlAlert[] = [
  { id: "A-1", title: "Urgent scheduling issue", detail: "Northgate Cardiology double-booked imaging slot at 2:00 PM.", clinic: C[0], severity: "Critical", Icon: CalendarClock },
  { id: "A-2", title: "Missing report", detail: "Priya Nair — neuro study performed 48h ago, no report on file.", clinic: C[3], severity: "High", Icon: FileWarning },
  { id: "A-3", title: "Billing blocker", detail: "Oliver Grant flagged as possible duplicate before claim submit.", clinic: C[0], severity: "High", Icon: Receipt },
  { id: "A-4", title: "No-show", detail: "Henry Coleman missed VitalWave appointment this morning.", clinic: C[1], severity: "Medium", Icon: XCircle },
  { id: "A-5", title: "Failed outreach", detail: "5 callbacks unanswered for 3+ days at Summit Family Care.", clinic: C[2], severity: "Medium", Icon: PhoneCall },
  { id: "A-6", title: "Imaging coverage gap", detail: "No technician assigned for Harbor Neurology Thursday window.", clinic: C[3], severity: "High", Icon: Stethoscope },
  { id: "A-7", title: "Prior authorization issue", detail: "Chloe Adams PGX order awaiting payer authorization.", clinic: C[1], severity: "Medium", Icon: ShieldAlert },
  { id: "A-8", title: "Clinic onboarding blocker", detail: "Cedar Valley Primary EMR credentials not yet provisioned.", clinic: C[4], severity: "Low", Icon: Building2 },
];

export const MISSION_CONTROL_SECTIONS: MissionControlSection[] = [
  {
    id: "ancillary-ops", title: "Ancillary Ops", Icon: FlaskConical,
    metrics: [{ label: "Active", value: "62" }, { label: "Pending", value: "14" }, { label: "Blocked", value: "5" }],
    rows: [
      { label: "BrainWave studies in motion", value: "23", status: "In Progress" },
      { label: "VitalWave awaiting report", value: "8", status: "Watch" },
      { label: "Ultrasound coverage gaps", value: "2", status: "Blocked" },
    ],
  },
  {
    id: "calls-outreach", title: "Calls / Outreach", Icon: PhoneCall,
    metrics: [{ label: "Made today", value: "184" }, { label: "Reached", value: "97" }, { label: "Callbacks", value: "21" }],
    rows: [
      { label: "Ready-to-call queue", value: "42", status: "Ready" },
      { label: "Follow-up queue", value: "18", status: "Watch" },
      { label: "Failed (3+ days)", value: "6", status: "Blocked" },
    ],
  },
  {
    id: "clinic-operations", title: "Clinic Operations", Icon: Building2,
    metrics: [{ label: "Active clinics", value: "5" }, { label: "At capacity", value: "1" }, { label: "Issues", value: "3" }],
    rows: [
      { label: "Northgate Cardiology", value: "Nominal", status: "Ready" },
      { label: "Harbor Neurology", value: "Coverage gap", status: "Blocked" },
      { label: "Cedar Valley Primary", value: "Onboarding", status: "Watch" },
    ],
  },
  {
    id: "patient-services", title: "Patient Services", Icon: Users,
    metrics: [{ label: "In pipeline", value: "318" }, { label: "Scheduled", value: "146" }, { label: "Complete", value: "204" }],
    rows: [
      { label: "Prescreen backlog", value: "27", status: "Watch" },
      { label: "Re-eligible patients", value: "11", status: "Ready" },
      { label: "Declined this week", value: "9", status: "Complete" },
    ],
  },
  {
    id: "finance-revenue", title: "Finance / Revenue", Icon: DollarSign,
    metrics: [{ label: "Billing ready", value: "31" }, { label: "Submitted", value: "118" }, { label: "Paid", value: "$248K" }],
    rows: [
      { label: "Claims ready to submit", value: "31", status: "Ready" },
      { label: "Denied / rework", value: "7", status: "Blocked" },
      { label: "AR > 60 days", value: "$42K", status: "Watch" },
    ],
  },
  {
    id: "operations", title: "Operations", Icon: Layers,
    metrics: [{ label: "Tasks open", value: "76" }, { label: "Overdue", value: "12" }, { label: "SLA met", value: "94%" }],
    rows: [
      { label: "Document handoffs", value: "On track", status: "Ready" },
      { label: "Overdue tasks", value: "12", status: "Blocked" },
      { label: "Automation health", value: "Healthy", status: "Complete" },
    ],
  },
  {
    id: "scheduling-triage", title: "Scheduling Triage", Icon: CalendarClock,
    metrics: [{ label: "To schedule", value: "44" }, { label: "Confirmed", value: "146" }, { label: "Conflicts", value: "3" }],
    rows: [
      { label: "Awaiting scheduling", value: "44", status: "Watch" },
      { label: "Double-bookings", value: "3", status: "Blocked" },
      { label: "Confirmed today", value: "38", status: "Ready" },
    ],
  },
  {
    id: "clinic-success", title: "Clinic Success", Icon: TrendingUp,
    metrics: [{ label: "Avg NPS", value: "72" }, { label: "Active QBRs", value: "4" }, { label: "At risk", value: "1" }],
    rows: [
      { label: "Northgate Cardiology", value: "Healthy", status: "Ready" },
      { label: "Lakeside Internal Med", value: "Healthy", status: "Ready" },
      { label: "Cedar Valley Primary", value: "At risk", status: "Watch" },
    ],
  },
  {
    id: "rvu-tracking", title: "RVU Tracking", Icon: Activity,
    metrics: [{ label: "RVUs MTD", value: "1,284" }, { label: "Target", value: "1,500" }, { label: "Pace", value: "86%" }],
    rows: [
      { label: "BrainWave RVUs", value: "512", status: "In Progress" },
      { label: "Ultrasound RVUs", value: "438", status: "In Progress" },
      { label: "VitalWave RVUs", value: "334", status: "In Progress" },
    ],
  },
  {
    id: "team-metrics", title: "Team Metrics", Icon: UserCog,
    metrics: [{ label: "Agents online", value: "18" }, { label: "Utilization", value: "81%" }, { label: "Avg handle", value: "6m" }],
    rows: [
      { label: "Engagement team", value: "On target", status: "Ready" },
      { label: "Imaging technicians", value: "1 short", status: "Watch" },
      { label: "Billing team", value: "On target", status: "Ready" },
    ],
  },
];

