// Mission Control — executive operations command center (MONITORING ONLY).
//
// CRITICAL BOUNDARY: Qualification does NOT happen here (that lives in
// Plexus IQ / Admin Review). Mission Control only MONITORS live operations
// after patients/services have entered execution. There are no qualify or
// approve actions on this surface — only observe, triage routing, and
// hand-off (send to Engagement / Scheduler / Billing).

import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  Radar,
  Users,
  PhoneCall,
  CalendarClock,
  FlaskConical,
  FileWarning,
  Receipt,
  DollarSign,
  ShieldAlert,
  TriangleAlert,
  ArrowUpRight,
  ArrowDownRight,
  Search,
  ChevronRight,
  Activity,
  Stethoscope,
  ClipboardList,
  RefreshCw,
  XCircle,
  CheckCircle2,
  CircleDashed,
  Send,
  UserCog,
  FileText,
  Layers,
  Building2,
  AlertTriangle,
  TrendingUp,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

/* ───────────────────────── Types ───────────────────────── */

type LaneStatus = "Watch" | "Blocked" | "Ready" | "In Progress" | "Complete";
type Priority = "Urgent" | "High" | "Medium" | "Low";
type Severity = "Critical" | "High" | "Medium" | "Low";

type QueueKey =
  | "prescreen"
  | "ready-to-call"
  | "follow-up"
  | "callbacks"
  | "pending-ancillary"
  | "no-report"
  | "re-eligible"
  | "declined"
  | "billing-ready"
  | "blocked";

interface LaneRow {
  id: string;
  patient: string;
  patientId: string;
  clinic: string;
  service: string;
  ancillary: string;
  lane: QueueKey;
  laneLabel: string;
  status: LaneStatus;
  owner: string;
  team: string;
  lastAction: string;
  nextAction: string;
  blocker: string | null;
  dueDate: string;
  priority: Priority;
  timeline: { time: string; event: string }[];
  documents: string[];
  callResult: string;
  imagingStatus: string;
  billingReadiness: string;
}

interface QueueTile {
  key: QueueKey;
  label: string;
  Icon: typeof Users;
  count: number;
  trend: number; // percent, signed
  tone: string; // tailwind classes for the icon chip
}

interface AlertItem {
  id: string;
  title: string;
  detail: string;
  clinic: string;
  severity: Severity;
  Icon: typeof TriangleAlert;
}

interface SectionMetric {
  label: string;
  value: string;
}

interface MiniRow {
  label: string;
  value: string;
  status: LaneStatus;
}

interface OpsSection {
  id: string;
  title: string;
  Icon: typeof Activity;
  metrics: SectionMetric[];
  rows: MiniRow[];
}

/* ───────────────────────── Style maps ───────────────────────── */

const statusStyles: Record<LaneStatus, string> = {
  Watch: "rounded-md bg-sky-50 text-sky-700 border border-sky-200 px-2 py-0.5 text-xs font-medium",
  Blocked: "rounded-md bg-red-50 text-red-700 border border-red-200 px-2 py-0.5 text-xs font-medium",
  Ready: "rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 text-xs font-medium",
  "In Progress": "rounded-md bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 text-xs font-medium",
  Complete: "rounded-md bg-slate-100 text-slate-600 border border-slate-200 px-2 py-0.5 text-xs font-medium",
};

const priorityStyles: Record<Priority, string> = {
  Urgent: "rounded-md bg-red-50 text-red-700 border border-red-200 px-2 py-0.5 text-xs font-medium",
  High: "rounded-md bg-orange-50 text-orange-700 border border-orange-200 px-2 py-0.5 text-xs font-medium",
  Medium: "rounded-md bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 text-xs font-medium",
  Low: "rounded-md bg-slate-100 text-slate-600 border border-slate-200 px-2 py-0.5 text-xs font-medium",
};

const severityStyles: Record<Severity, string> = {
  Critical: "rounded-md bg-red-50 text-red-700 border border-red-200 px-2 py-0.5 text-xs font-medium",
  High: "rounded-md bg-orange-50 text-orange-700 border border-orange-200 px-2 py-0.5 text-xs font-medium",
  Medium: "rounded-md bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 text-xs font-medium",
  Low: "rounded-md bg-sky-50 text-sky-700 border border-sky-200 px-2 py-0.5 text-xs font-medium",
};

const severityCardTone: Record<Severity, string> = {
  Critical: "border-red-200 bg-red-50/60",
  High: "border-orange-200 bg-orange-50/60",
  Medium: "border-amber-200 bg-amber-50/60",
  Low: "border-sky-200 bg-sky-50/60",
};

/* ───────────────────────── DEMO MOCK DATA ───────────────────────── */

const CLINICS = [
  "Northgate Cardiology",
  "Lakeside Internal Medicine",
  "Summit Family Care",
  "Harbor Neurology",
  "Cedar Valley Primary",
] as const;

const SERVICES = ["BrainWave", "VitalWave", "Ultrasound", "EKG", "PGX", "CGX"] as const;

const queueDefs: { key: QueueKey; label: string; Icon: typeof Users; trend: number; tone: string }[] = [
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

const queueLabel: Record<QueueKey, string> = Object.fromEntries(
  queueDefs.map((q) => [q.key, q.label]),
) as Record<QueueKey, string>;

function mkTimeline(base: string): { time: string; event: string }[] {
  return [
    { time: "08:12", event: "Entered execution pipeline" },
    { time: "09:40", event: base },
    { time: "11:05", event: "Owner assigned" },
    { time: "13:22", event: "Status synced from canonical spine" },
  ];
}

const LANES: LaneRow[] = [
  {
    id: "L-1001", patient: "Eleanor Whitfield", patientId: "PT-48213", clinic: CLINICS[0], service: "BrainWave", ancillary: "Cognitive Panel",
    lane: "ready-to-call", laneLabel: queueLabel["ready-to-call"], status: "Ready", owner: "M. Alvarez", team: "Engagement",
    lastAction: "Eligibility confirmed", nextAction: "Outreach call", blocker: null, dueDate: "2025-06-12", priority: "High",
    timeline: mkTimeline("Eligibility confirmed"), documents: ["Insurance card", "Screening form"], callResult: "—",
    imagingStatus: "N/A", billingReadiness: "Not started",
  },
  {
    id: "L-1002", patient: "Marcus Bell", patientId: "PT-48114", clinic: CLINICS[1], service: "Ultrasound", ancillary: "Carotid Duplex",
    lane: "pending-ancillary", laneLabel: queueLabel["pending-ancillary"], status: "In Progress", owner: "R. Cho", team: "Imaging",
    lastAction: "Scheduled imaging", nextAction: "Technician dispatch", blocker: null, dueDate: "2025-06-13", priority: "Medium",
    timeline: mkTimeline("Scheduled imaging"), documents: ["Order", "Consent"], callResult: "Reached — agreed",
    imagingStatus: "Scheduled", billingReadiness: "Awaiting report",
  },
  {
    id: "L-1003", patient: "Priya Nair", patientId: "PT-47991", clinic: CLINICS[3], service: "BrainWave", ancillary: "Neuro Screen",
    lane: "no-report", laneLabel: queueLabel["no-report"], status: "Blocked", owner: "S. Patel", team: "Imaging",
    lastAction: "Study performed", nextAction: "Chase report upload", blocker: "Report not uploaded 48h", dueDate: "2025-06-10", priority: "Urgent",
    timeline: mkTimeline("Study performed"), documents: ["Order"], callResult: "Reached — agreed",
    imagingStatus: "Performed · no report", billingReadiness: "Blocked",
  },
  {
    id: "L-1004", patient: "Devon Ramirez", patientId: "PT-47820", clinic: CLINICS[2], service: "VitalWave", ancillary: "Autonomic Test",
    lane: "billing-ready", laneLabel: queueLabel["billing-ready"], status: "Ready", owner: "J. Kim", team: "Billing",
    lastAction: "Report finalized", nextAction: "Submit claim", blocker: null, dueDate: "2025-06-11", priority: "High",
    timeline: mkTimeline("Report finalized"), documents: ["Report", "Signed note", "Insurance card"], callResult: "Reached — agreed",
    imagingStatus: "N/A", billingReadiness: "Ready",
  },
  {
    id: "L-1005", patient: "Hannah Schultz", patientId: "PT-47765", clinic: CLINICS[4], service: "EKG", ancillary: "Resting EKG",
    lane: "follow-up", laneLabel: queueLabel["follow-up"], status: "Watch", owner: "M. Alvarez", team: "Engagement",
    lastAction: "Voicemail left", nextAction: "Retry outreach", blocker: null, dueDate: "2025-06-14", priority: "Low",
    timeline: mkTimeline("Voicemail left"), documents: ["Screening form"], callResult: "No answer",
    imagingStatus: "N/A", billingReadiness: "Not started",
  },
  {
    id: "L-1006", patient: "Oliver Grant", patientId: "PT-47640", clinic: CLINICS[0], service: "PGX", ancillary: "Pharmacogenomics",
    lane: "blocked", laneLabel: queueLabel["blocked"], status: "Blocked", owner: "Admin Desk", team: "Admin Review",
    lastAction: "Flagged duplicate", nextAction: "Admin review", blocker: "Possible duplicate record", dueDate: "2025-06-09", priority: "Urgent",
    timeline: mkTimeline("Flagged duplicate"), documents: ["Insurance card"], callResult: "—",
    imagingStatus: "N/A", billingReadiness: "Blocked",
  },
  {
    id: "L-1007", patient: "Sofia Mendez", patientId: "PT-47588", clinic: CLINICS[1], service: "Ultrasound", ancillary: "Echocardiogram TTE",
    lane: "callbacks", laneLabel: queueLabel["callbacks"], status: "In Progress", owner: "R. Cho", team: "Engagement",
    lastAction: "Callback requested", nextAction: "Call back 2pm", blocker: null, dueDate: "2025-06-12", priority: "Medium",
    timeline: mkTimeline("Callback requested"), documents: ["Screening form"], callResult: "Requested callback",
    imagingStatus: "N/A", billingReadiness: "Not started",
  },
  {
    id: "L-1008", patient: "Aiden Brooks", patientId: "PT-47512", clinic: CLINICS[2], service: "CGX", ancillary: "Carrier Genomics",
    lane: "declined", laneLabel: queueLabel["declined"], status: "Complete", owner: "M. Alvarez", team: "Engagement",
    lastAction: "Patient declined", nextAction: "Archive", blocker: null, dueDate: "2025-06-08", priority: "Low",
    timeline: mkTimeline("Patient declined"), documents: [], callResult: "Declined",
    imagingStatus: "N/A", billingReadiness: "N/A",
  },
  {
    id: "L-1009", patient: "Grace Liu", patientId: "PT-47480", clinic: CLINICS[3], service: "BrainWave", ancillary: "Cognitive Panel",
    lane: "prescreen", laneLabel: queueLabel["prescreen"], status: "Watch", owner: "Intake Bot", team: "Intake",
    lastAction: "Imported from EMR", nextAction: "Run prescreen", blocker: null, dueDate: "2025-06-15", priority: "Low",
    timeline: mkTimeline("Imported from EMR"), documents: ["EMR export"], callResult: "—",
    imagingStatus: "N/A", billingReadiness: "Not started",
  },
  {
    id: "L-1010", patient: "Nathan Cole", patientId: "PT-47399", clinic: CLINICS[4], service: "VitalWave", ancillary: "Autonomic Test",
    lane: "re-eligible", laneLabel: queueLabel["re-eligible"], status: "Ready", owner: "J. Kim", team: "Engagement",
    lastAction: "Re-eligibility met", nextAction: "Re-engage outreach", blocker: null, dueDate: "2025-06-16", priority: "Medium",
    timeline: mkTimeline("Re-eligibility met"), documents: ["Screening form"], callResult: "—",
    imagingStatus: "N/A", billingReadiness: "Not started",
  },
  {
    id: "L-1011", patient: "Isabella Ford", patientId: "PT-47301", clinic: CLINICS[0], service: "Ultrasound", ancillary: "Renal Artery Doppler",
    lane: "pending-ancillary", laneLabel: queueLabel["pending-ancillary"], status: "In Progress", owner: "S. Patel", team: "Imaging",
    lastAction: "Coverage confirmed", nextAction: "Technician in field", blocker: null, dueDate: "2025-06-13", priority: "Medium",
    timeline: mkTimeline("Coverage confirmed"), documents: ["Order", "Consent"], callResult: "Reached — agreed",
    imagingStatus: "In field", billingReadiness: "Awaiting report",
  },
  {
    id: "L-1012", patient: "Liam Hayes", patientId: "PT-47255", clinic: CLINICS[1], service: "BrainWave", ancillary: "Neuro Screen",
    lane: "billing-ready", laneLabel: queueLabel["billing-ready"], status: "Ready", owner: "J. Kim", team: "Billing",
    lastAction: "Note signed", nextAction: "Submit claim", blocker: null, dueDate: "2025-06-11", priority: "High",
    timeline: mkTimeline("Note signed"), documents: ["Report", "Signed note"], callResult: "Reached — agreed",
    imagingStatus: "N/A", billingReadiness: "Ready",
  },
  {
    id: "L-1013", patient: "Mia Torres", patientId: "PT-47190", clinic: CLINICS[2], service: "EKG", ancillary: "Resting EKG",
    lane: "no-report", laneLabel: queueLabel["no-report"], status: "Blocked", owner: "S. Patel", team: "Imaging",
    lastAction: "Study performed", nextAction: "Chase report", blocker: "QC review pending", dueDate: "2025-06-10", priority: "High",
    timeline: mkTimeline("Study performed"), documents: ["Order"], callResult: "Reached — agreed",
    imagingStatus: "Performed · QC pending", billingReadiness: "Blocked",
  },
  {
    id: "L-1014", patient: "Ethan Park", patientId: "PT-47122", clinic: CLINICS[3], service: "Ultrasound", ancillary: "AAA Duplex",
    lane: "ready-to-call", laneLabel: queueLabel["ready-to-call"], status: "Ready", owner: "M. Alvarez", team: "Engagement",
    lastAction: "Eligibility confirmed", nextAction: "Outreach call", blocker: null, dueDate: "2025-06-12", priority: "Medium",
    timeline: mkTimeline("Eligibility confirmed"), documents: ["Screening form"], callResult: "—",
    imagingStatus: "N/A", billingReadiness: "Not started",
  },
  {
    id: "L-1015", patient: "Ava Robinson", patientId: "PT-47045", clinic: CLINICS[4], service: "VitalWave", ancillary: "Autonomic Test",
    lane: "follow-up", laneLabel: queueLabel["follow-up"], status: "Watch", owner: "R. Cho", team: "Engagement",
    lastAction: "Awaiting paperwork", nextAction: "Follow up", blocker: null, dueDate: "2025-06-14", priority: "Low",
    timeline: mkTimeline("Awaiting paperwork"), documents: ["Screening form"], callResult: "Reached — pending docs",
    imagingStatus: "N/A", billingReadiness: "Not started",
  },
  {
    id: "L-1016", patient: "Noah Bennett", patientId: "PT-46980", clinic: CLINICS[0], service: "Ultrasound", ancillary: "LE Arterial Doppler",
    lane: "pending-ancillary", laneLabel: queueLabel["pending-ancillary"], status: "In Progress", owner: "S. Patel", team: "Imaging",
    lastAction: "Technician dispatched", nextAction: "Upload report", blocker: null, dueDate: "2025-06-13", priority: "Medium",
    timeline: mkTimeline("Technician dispatched"), documents: ["Order", "Consent"], callResult: "Reached — agreed",
    imagingStatus: "In field", billingReadiness: "Awaiting report",
  },
  {
    id: "L-1017", patient: "Chloe Adams", patientId: "PT-46901", clinic: CLINICS[1], service: "PGX", ancillary: "Pharmacogenomics",
    lane: "blocked", laneLabel: queueLabel["blocked"], status: "Blocked", owner: "Admin Desk", team: "Admin Review",
    lastAction: "Prior auth needed", nextAction: "Admin review", blocker: "Prior authorization missing", dueDate: "2025-06-09", priority: "Urgent",
    timeline: mkTimeline("Prior auth needed"), documents: ["Insurance card"], callResult: "Reached — agreed",
    imagingStatus: "N/A", billingReadiness: "Blocked",
  },
  {
    id: "L-1018", patient: "Lucas Reed", patientId: "PT-46844", clinic: CLINICS[2], service: "BrainWave", ancillary: "Cognitive Panel",
    lane: "callbacks", laneLabel: queueLabel["callbacks"], status: "In Progress", owner: "M. Alvarez", team: "Engagement",
    lastAction: "Callback scheduled", nextAction: "Call back", blocker: null, dueDate: "2025-06-12", priority: "Low",
    timeline: mkTimeline("Callback scheduled"), documents: [], callResult: "Requested callback",
    imagingStatus: "N/A", billingReadiness: "Not started",
  },
  {
    id: "L-1019", patient: "Zoe Carter", patientId: "PT-46790", clinic: CLINICS[3], service: "Ultrasound", ancillary: "LE Venous Duplex",
    lane: "billing-ready", laneLabel: queueLabel["billing-ready"], status: "Ready", owner: "J. Kim", team: "Billing",
    lastAction: "Report uploaded", nextAction: "Submit claim", blocker: null, dueDate: "2025-06-11", priority: "High",
    timeline: mkTimeline("Report uploaded"), documents: ["Report", "Signed note", "Insurance card"], callResult: "Reached — agreed",
    imagingStatus: "Complete", billingReadiness: "Ready",
  },
  {
    id: "L-1020", patient: "Mason Wright", patientId: "PT-46711", clinic: CLINICS[4], service: "CGX", ancillary: "Carrier Genomics",
    lane: "prescreen", laneLabel: queueLabel["prescreen"], status: "Watch", owner: "Intake Bot", team: "Intake",
    lastAction: "Imported from EMR", nextAction: "Run prescreen", blocker: null, dueDate: "2025-06-15", priority: "Low",
    timeline: mkTimeline("Imported from EMR"), documents: ["EMR export"], callResult: "—",
    imagingStatus: "N/A", billingReadiness: "Not started",
  },
  {
    id: "L-1021", patient: "Layla Foster", patientId: "PT-46655", clinic: CLINICS[0], service: "EKG", ancillary: "Resting EKG",
    lane: "re-eligible", laneLabel: queueLabel["re-eligible"], status: "Ready", owner: "R. Cho", team: "Engagement",
    lastAction: "Re-eligibility met", nextAction: "Re-engage", blocker: null, dueDate: "2025-06-16", priority: "Medium",
    timeline: mkTimeline("Re-eligibility met"), documents: ["Screening form"], callResult: "—",
    imagingStatus: "N/A", billingReadiness: "Not started",
  },
  {
    id: "L-1022", patient: "Henry Coleman", patientId: "PT-46588", clinic: CLINICS[1], service: "VitalWave", ancillary: "Autonomic Test",
    lane: "no-report", laneLabel: queueLabel["no-report"], status: "Blocked", owner: "S. Patel", team: "Imaging",
    lastAction: "Study performed", nextAction: "Chase report", blocker: "Report not uploaded", dueDate: "2025-06-10", priority: "High",
    timeline: mkTimeline("Study performed"), documents: ["Order"], callResult: "Reached — agreed",
    imagingStatus: "Performed · no report", billingReadiness: "Blocked",
  },
  {
    id: "L-1023", patient: "Scarlett Hughes", patientId: "PT-46500", clinic: CLINICS[2], service: "BrainWave", ancillary: "Neuro Screen",
    lane: "ready-to-call", laneLabel: queueLabel["ready-to-call"], status: "Ready", owner: "M. Alvarez", team: "Engagement",
    lastAction: "Eligibility confirmed", nextAction: "Outreach call", blocker: null, dueDate: "2025-06-12", priority: "Medium",
    timeline: mkTimeline("Eligibility confirmed"), documents: ["Screening form"], callResult: "—",
    imagingStatus: "N/A", billingReadiness: "Not started",
  },
  {
    id: "L-1024", patient: "Jack Morgan", patientId: "PT-46432", clinic: CLINICS[3], service: "Ultrasound", ancillary: "Carotid Duplex",
    lane: "follow-up", laneLabel: queueLabel["follow-up"], status: "Watch", owner: "R. Cho", team: "Engagement",
    lastAction: "Left message", nextAction: "Retry outreach", blocker: null, dueDate: "2025-06-14", priority: "Low",
    timeline: mkTimeline("Left message"), documents: ["Screening form"], callResult: "No answer",
    imagingStatus: "N/A", billingReadiness: "Not started",
  },
  {
    id: "L-1025", patient: "Lily Simmons", patientId: "PT-46377", clinic: CLINICS[4], service: "PGX", ancillary: "Pharmacogenomics",
    lane: "declined", laneLabel: queueLabel["declined"], status: "Complete", owner: "M. Alvarez", team: "Engagement",
    lastAction: "Patient declined", nextAction: "Archive", blocker: null, dueDate: "2025-06-08", priority: "Low",
    timeline: mkTimeline("Patient declined"), documents: [], callResult: "Declined",
    imagingStatus: "N/A", billingReadiness: "N/A",
  },
];

const ALERTS: AlertItem[] = [
  { id: "A-1", title: "Urgent scheduling issue", detail: "Northgate Cardiology double-booked imaging slot at 2:00 PM.", clinic: CLINICS[0], severity: "Critical", Icon: CalendarClock },
  { id: "A-2", title: "Missing report", detail: "Priya Nair — neuro study performed 48h ago, no report on file.", clinic: CLINICS[3], severity: "High", Icon: FileWarning },
  { id: "A-3", title: "Billing blocker", detail: "Oliver Grant flagged as possible duplicate before claim submit.", clinic: CLINICS[0], severity: "High", Icon: Receipt },
  { id: "A-4", title: "No-show", detail: "Henry Coleman missed VitalWave appointment this morning.", clinic: CLINICS[1], severity: "Medium", Icon: XCircle },
  { id: "A-5", title: "Failed outreach", detail: "5 callbacks unanswered for 3+ days at Summit Family Care.", clinic: CLINICS[2], severity: "Medium", Icon: PhoneCall },
  { id: "A-6", title: "Imaging coverage gap", detail: "No technician assigned for Harbor Neurology Thursday window.", clinic: CLINICS[3], severity: "High", Icon: Stethoscope },
  { id: "A-7", title: "Prior authorization issue", detail: "Chloe Adams PGX order awaiting payer authorization.", clinic: CLINICS[1], severity: "Medium", Icon: ShieldAlert },
  { id: "A-8", title: "Clinic onboarding blocker", detail: "Cedar Valley Primary EMR credentials not yet provisioned.", clinic: CLINICS[4], severity: "Low", Icon: Building2 },
];

const OPS_SECTIONS: OpsSection[] = [
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

/* ───────────────────────── Helpers ───────────────────────── */

function fmtMoney(n: number): string {
  return `$${n.toLocaleString("en-US")}`;
}

/* ───────────────────────── Component ───────────────────────── */

export default function MissionControlPage() {
  const { toast } = useToast();

  // Simulated view state to demonstrate loading / empty / error / success.
  const [view, setView] = useState<"success" | "loading" | "empty" | "error">("success");

  const [search, setSearch] = useState("");
  const [clinicFilter, setClinicFilter] = useState<string>("all");
  const [serviceFilter, setServiceFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [dueFilter, setDueFilter] = useState<string>("all");
  const [activeQueue, setActiveQueue] = useState<QueueKey | "all">("all");

  const [selected, setSelected] = useState<LaneRow | null>(null);

  const baseLanes = view === "empty" ? [] : LANES;

  // Queue tile counts derive from the lane data.
  const queueTiles: QueueTile[] = useMemo(() => {
    return queueDefs.map((q) => ({
      key: q.key,
      label: q.label,
      Icon: q.Icon,
      trend: q.trend,
      tone: q.tone,
      count: baseLanes.filter((l) => l.lane === q.key).length,
    }));
  }, [baseLanes]);

  // Executive KPIs derive from lanes + mock revenue figures.
  const kpis = useMemo(() => {
    const readyToCall = baseLanes.filter((l) => l.lane === "ready-to-call").length;
    const ancillaryPending = baseLanes.filter((l) => l.lane === "pending-ancillary").length;
    const reportsMissing = baseLanes.filter((l) => l.lane === "no-report").length;
    const billingReady = baseLanes.filter((l) => l.lane === "billing-ready").length;
    const blocked = baseLanes.filter((l) => l.status === "Blocked").length;
    const scheduled = baseLanes.filter((l) => l.imagingStatus === "Scheduled" || l.imagingStatus === "In field").length;
    return [
      { label: "Active Clinics", value: String(CLINICS.length), Icon: Building2, tone: "bg-slate-100 text-slate-700" },
      { label: "In Pipeline", value: String(baseLanes.length), Icon: Users, tone: "bg-indigo-100 text-indigo-700" },
      { label: "Ready to Call", value: String(readyToCall), Icon: PhoneCall, tone: "bg-blue-100 text-blue-700" },
      { label: "Scheduled", value: String(scheduled), Icon: CalendarClock, tone: "bg-violet-100 text-violet-700" },
      { label: "Ancillary Pending", value: String(ancillaryPending), Icon: FlaskConical, tone: "bg-amber-100 text-amber-700" },
      { label: "Reports Missing", value: String(reportsMissing), Icon: FileWarning, tone: "bg-rose-100 text-rose-700" },
      { label: "Billing Ready", value: String(billingReady), Icon: Receipt, tone: "bg-emerald-100 text-emerald-700" },
      { label: "Paid Revenue", value: fmtMoney(248000), Icon: DollarSign, tone: "bg-emerald-100 text-emerald-700" },
      { label: "Blocked Items", value: String(blocked), Icon: ShieldAlert, tone: "bg-red-100 text-red-700" },
      { label: "Urgent Alerts", value: String(ALERTS.filter((a) => a.severity === "Critical" || a.severity === "High").length), Icon: TriangleAlert, tone: "bg-orange-100 text-orange-700" },
    ];
  }, [baseLanes]);

  const filteredLanes = useMemo(() => {
    const q = search.trim().toLowerCase();
    return baseLanes.filter((l) => {
      if (activeQueue !== "all" && l.lane !== activeQueue) return false;
      if (clinicFilter !== "all" && l.clinic !== clinicFilter) return false;
      if (serviceFilter !== "all" && l.service !== serviceFilter) return false;
      if (statusFilter !== "all" && l.status !== statusFilter) return false;
      if (priorityFilter !== "all" && l.priority !== priorityFilter) return false;
      if (dueFilter !== "all") {
        const due = new Date(l.dueDate).getTime();
        const today = new Date("2025-06-11").getTime();
        if (dueFilter === "overdue" && !(due < today)) return false;
        if (dueFilter === "today" && new Date(l.dueDate).toDateString() !== new Date("2025-06-11").toDateString()) return false;
        if (dueFilter === "upcoming" && !(due > today)) return false;
      }
      if (q && !(`${l.patient} ${l.patientId} ${l.clinic} ${l.service} ${l.ancillary}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [baseLanes, activeQueue, clinicFilter, serviceFilter, statusFilter, priorityFilter, dueFilter, search]);

  const resetFilters = () => {
    setSearch("");
    setClinicFilter("all");
    setServiceFilter("all");
    setStatusFilter("all");
    setPriorityFilter("all");
    setDueFilter("all");
    setActiveQueue("all");
  };

  const fireAction = (title: string, description: string) => toast({ title, description });

  return (
    <div className="flex flex-col h-full">
      <header className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-slate-200 px-6 py-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-indigo-100 text-indigo-700">
              <Radar className="w-5 h-5" strokeWidth={1.75} />
            </span>
            <div>
              <h1 className="text-xl font-semibold text-slate-900" data-testid="text-mission-control-title">
                Mission Control
              </h1>
              <p className="text-sm text-slate-500">Executive operations command center</p>
            </div>
          </div>
          {/* Demo state switcher (monitoring only — not a workflow action). */}
          <div className="w-44">
            <Select value={view} onValueChange={(v) => setView(v as typeof view)}>
              <SelectTrigger data-testid="select-demo-view" className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="success">Live data</SelectItem>
                <SelectItem value="loading">Loading state</SelectItem>
                <SelectItem value="empty">Empty state</SelectItem>
                <SelectItem value="error">Error state</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-auto bg-slate-50/40 px-6 py-6 space-y-6">
        {/* LOADING */}
        {view === "loading" && (
          <div className="space-y-6" data-testid="status-mission-control-loading">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
              {Array.from({ length: 10 }).map((_, i) => (
                <Skeleton key={i} className="h-24 rounded-xl" />
              ))}
            </div>
            <Skeleton className="h-64 rounded-xl" />
          </div>
        )}

        {/* ERROR */}
        {view === "error" && (
          <Card className="rounded-xl border-red-200 bg-red-50/60 p-10 text-center" data-testid="status-mission-control-error">
            <AlertTriangle className="w-8 h-8 text-red-500 mx-auto mb-3" />
            <div className="text-base font-semibold text-red-700">Couldn't load operations data</div>
            <p className="text-sm text-red-600/80 mt-1">A monitoring feed is temporarily unavailable. Please refresh to try again.</p>
            <Button variant="outline" className="mt-4" onClick={() => setView("success")} data-testid="button-retry">
              <RefreshCw className="w-4 h-4 mr-2" /> Retry
            </Button>
          </Card>
        )}

        {(view === "success" || view === "empty") && (
          <>
            {/* 1. Executive KPI header */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4" data-testid="mission-control-kpis">
              {kpis.map((k) => (
                <Card key={k.label} className="rounded-xl border-slate-200 p-4 flex items-center gap-3" data-testid={`kpi-${k.label.toLowerCase().replace(/\s+/g, "-")}`}>
                  <span className={`inline-flex items-center justify-center w-10 h-10 rounded-lg shrink-0 ${k.tone}`}>
                    <k.Icon className="w-5 h-5" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-xl font-bold tabular-nums text-slate-900 truncate">{k.value}</div>
                    <div className="text-[11px] text-slate-500 mt-0.5 truncate">{k.label}</div>
                  </div>
                </Card>
              ))}
            </div>

            {/* 2. Operational queue tiles */}
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Operational Queues</h2>
                {activeQueue !== "all" && (
                  <Button variant="ghost" size="sm" onClick={() => setActiveQueue("all")} data-testid="button-clear-queue">
                    Clear queue filter
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4" data-testid="mission-control-queues">
                {queueTiles.map((t) => {
                  const isActive = activeQueue === t.key;
                  const up = t.trend >= 0;
                  return (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => setActiveQueue(isActive ? "all" : t.key)}
                      className={`text-left rounded-xl border p-4 transition-colors hover-elevate active-elevate-2 ${
                        isActive ? "border-indigo-300 bg-indigo-50/60 ring-1 ring-indigo-200" : "border-slate-200 bg-white"
                      }`}
                      data-testid={`queue-tile-${t.key}`}
                    >
                      <div className="flex items-center justify-between">
                        <span className={`inline-flex items-center justify-center w-8 h-8 rounded-lg ${t.tone}`}>
                          <t.Icon className="w-4 h-4" />
                        </span>
                        <span className={`inline-flex items-center gap-0.5 text-[11px] font-medium ${up ? "text-emerald-600" : "text-red-600"}`}>
                          {up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                          {Math.abs(t.trend)}%
                        </span>
                      </div>
                      <div className="text-2xl font-bold tabular-nums text-slate-900 mt-2" data-testid={`queue-count-${t.key}`}>{t.count}</div>
                      <div className="text-[11px] text-slate-500 mt-0.5 leading-tight">{t.label}</div>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* 7. Search & filters */}
            <Card className="rounded-xl border-slate-200 p-4" data-testid="mission-control-filters">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[220px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search patient, clinic, or service…"
                    className="pl-9 h-9"
                    data-testid="input-search-lanes"
                  />
                </div>
                <Select value={clinicFilter} onValueChange={setClinicFilter}>
                  <SelectTrigger className="h-9 w-[190px]" data-testid="select-filter-clinic"><SelectValue placeholder="Clinic" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All clinics</SelectItem>
                    {CLINICS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={serviceFilter} onValueChange={setServiceFilter}>
                  <SelectTrigger className="h-9 w-[150px]" data-testid="select-filter-service"><SelectValue placeholder="Service" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All services</SelectItem>
                    {SERVICES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="h-9 w-[140px]" data-testid="select-filter-status"><SelectValue placeholder="Status" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    {(["Watch", "Blocked", "Ready", "In Progress", "Complete"] as LaneStatus[]).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={priorityFilter} onValueChange={setPriorityFilter}>
                  <SelectTrigger className="h-9 w-[140px]" data-testid="select-filter-priority"><SelectValue placeholder="Priority" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All priorities</SelectItem>
                    {(["Urgent", "High", "Medium", "Low"] as Priority[]).map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={dueFilter} onValueChange={setDueFilter}>
                  <SelectTrigger className="h-9 w-[150px]" data-testid="select-filter-due"><SelectValue placeholder="Due date" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Any due date</SelectItem>
                    <SelectItem value="overdue">Overdue</SelectItem>
                    <SelectItem value="today">Due today</SelectItem>
                    <SelectItem value="upcoming">Upcoming</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="outline" size="sm" className="h-9" onClick={resetFilters} data-testid="button-reset-filters">
                  Reset
                </Button>
              </div>
            </Card>

            {/* 3. Operational lanes table */}
            <Card className="rounded-xl border-slate-200 overflow-hidden" data-testid="mission-control-lanes">
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-slate-500" />
                  <span className="text-sm font-semibold text-slate-700">Operational Lanes</span>
                  {activeQueue !== "all" && (
                    <span className="rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200 px-2 py-0.5 text-xs font-medium">
                      {queueLabel[activeQueue]}
                    </span>
                  )}
                </div>
                <span className="text-xs text-slate-500 tabular-nums" data-testid="text-lane-count">{filteredLanes.length} lanes</span>
              </div>

              {filteredLanes.length === 0 ? (
                <div className="py-16 text-center" data-testid="status-lanes-empty">
                  <CircleDashed className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                  <p className="text-sm text-slate-500">No lanes match the current filters.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Patient</TableHead>
                        <TableHead>Clinic</TableHead>
                        <TableHead>Service / Ancillary</TableHead>
                        <TableHead>Lane</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Owner</TableHead>
                        <TableHead>Last action</TableHead>
                        <TableHead>Next action</TableHead>
                        <TableHead>Blocker</TableHead>
                        <TableHead>Due</TableHead>
                        <TableHead>Priority</TableHead>
                        <TableHead className="w-8" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredLanes.map((l) => (
                        <TableRow
                          key={l.id}
                          className="cursor-pointer"
                          onClick={() => setSelected(l)}
                          data-testid={`lane-row-${l.id}`}
                        >
                          <TableCell>
                            <div className="font-medium text-slate-800">{l.patient}</div>
                            <div className="text-[11px] text-slate-400 tabular-nums">{l.patientId}</div>
                          </TableCell>
                          <TableCell className="text-slate-600">{l.clinic}</TableCell>
                          <TableCell>
                            <div className="text-slate-700">{l.service}</div>
                            <div className="text-[11px] text-slate-400">{l.ancillary}</div>
                          </TableCell>
                          <TableCell className="text-slate-600 text-xs">{l.laneLabel}</TableCell>
                          <TableCell><span className={statusStyles[l.status]}>{l.status}</span></TableCell>
                          <TableCell className="text-slate-600 text-xs">{l.owner}</TableCell>
                          <TableCell className="text-slate-500 text-xs">{l.lastAction}</TableCell>
                          <TableCell className="text-slate-700 text-xs">{l.nextAction}</TableCell>
                          <TableCell className="text-xs">
                            {l.blocker ? <span className="text-red-600">{l.blocker}</span> : <span className="text-slate-300">—</span>}
                          </TableCell>
                          <TableCell className="text-slate-500 text-xs tabular-nums">{l.dueDate}</TableCell>
                          <TableCell><span className={priorityStyles[l.priority]}>{l.priority}</span></TableCell>
                          <TableCell><ChevronRight className="w-4 h-4 text-slate-300" /></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </Card>

            {/* 5. Alerts section */}
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Active Alerts</h2>
              {ALERTS.length === 0 ? (
                <Card className="rounded-xl border-slate-200 p-8 text-center text-sm text-slate-500" data-testid="status-alerts-empty">
                  No active alerts.
                </Card>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" data-testid="mission-control-alerts">
                  {ALERTS.map((a) => (
                    <Card key={a.id} className={`rounded-xl border p-4 ${severityCardTone[a.severity]}`} data-testid={`alert-${a.id}`}>
                      <div className="flex items-start justify-between gap-2">
                        <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-white/70 text-slate-700 shrink-0">
                          <a.Icon className="w-4 h-4" />
                        </span>
                        <span className={severityStyles[a.severity]}>{a.severity}</span>
                      </div>
                      <div className="mt-2 text-sm font-semibold text-slate-800">{a.title}</div>
                      <p className="text-xs text-slate-600 mt-1">{a.detail}</p>
                      <div className="text-[11px] text-slate-400 mt-2">{a.clinic}</div>
                    </Card>
                  ))}
                </div>
              )}
            </section>

            {/* 6. Expandable ops sections */}
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Operations Detail</h2>
              <Card className="rounded-xl border-slate-200 px-4 py-2" data-testid="mission-control-sections">
                <Accordion type="multiple" className="w-full">
                  {OPS_SECTIONS.map((s) => (
                    <AccordionItem key={s.id} value={s.id} data-testid={`section-${s.id}`}>
                      <AccordionTrigger className="hover:no-underline">
                        <div className="flex items-center gap-2 flex-1 mr-3">
                          <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-slate-100 text-slate-600 shrink-0">
                            <s.Icon className="w-4 h-4" />
                          </span>
                          <span className="text-sm font-medium text-slate-800">{s.title}</span>
                          <div className="ml-auto hidden sm:flex items-center gap-3">
                            {s.metrics.map((m) => (
                              <span key={m.label} className="text-[11px] text-slate-500">
                                {m.label} <span className="font-semibold text-slate-800 tabular-nums">{m.value}</span>
                              </span>
                            ))}
                          </div>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="overflow-x-auto pb-2">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Metric</TableHead>
                                <TableHead>Value</TableHead>
                                <TableHead>Status</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {s.rows.map((r) => (
                                <TableRow key={r.label} data-testid={`section-row-${s.id}-${r.label.toLowerCase().replace(/\s+/g, "-")}`}>
                                  <TableCell className="text-slate-700">{r.label}</TableCell>
                                  <TableCell className="text-slate-800 tabular-nums">{r.value}</TableCell>
                                  <TableCell><span className={statusStyles[r.status]}>{r.status}</span></TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </Card>
            </section>
          </>
        )}
      </main>

      {/* 4. Lane Workbench (right Sheet) */}
      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle data-testid="text-workbench-patient">{selected.patient}</SheetTitle>
                <SheetDescription>
                  {selected.patientId} · {selected.clinic}
                </SheetDescription>
              </SheetHeader>

              <div className="mt-4 space-y-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={statusStyles[selected.status]}>{selected.status}</span>
                  <span className={priorityStyles[selected.priority]}>{selected.priority}</span>
                  <span className="rounded-md bg-slate-100 text-slate-600 border border-slate-200 px-2 py-0.5 text-xs font-medium">{selected.laneLabel}</span>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <Field label="Service" value={selected.service} />
                  <Field label="Ancillary" value={selected.ancillary} />
                  <Field label="Owner" value={selected.owner} />
                  <Field label="Responsible team" value={selected.team} />
                  <Field label="Imaging / report" value={selected.imagingStatus} />
                  <Field label="Billing readiness" value={selected.billingReadiness} />
                  <Field label="Call result" value={selected.callResult} />
                  <Field label="Due date" value={selected.dueDate} />
                </div>

                <div>
                  <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Current blocker</div>
                  <p className="text-sm text-slate-700">{selected.blocker ?? "None — lane is clear."}</p>
                </div>

                <div>
                  <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Next required action</div>
                  <p className="text-sm text-slate-700">{selected.nextAction}</p>
                </div>

                <div>
                  <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Timeline</div>
                  <ol className="space-y-2">
                    {selected.timeline.map((t, i) => (
                      <li key={i} className="flex gap-3 text-sm" data-testid={`timeline-${selected.id}-${i}`}>
                        <span className="text-xs text-slate-400 tabular-nums w-12 shrink-0">{t.time}</span>
                        <span className="text-slate-700">{t.event}</span>
                      </li>
                    ))}
                  </ol>
                </div>

                <div>
                  <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Related documents</div>
                  {selected.documents.length === 0 ? (
                    <p className="text-sm text-slate-400">No documents on file.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {selected.documents.map((d) => (
                        <span key={d} className="inline-flex items-center gap-1 rounded-md bg-slate-100 text-slate-600 border border-slate-200 px-2 py-0.5 text-xs">
                          <FileText className="w-3 h-3" /> {d}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <Separator />

                {/* Monitoring / triage actions — no qualify/approve here. */}
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" size="sm" onClick={() => fireAction("Marked Ready", `${selected.patient} flagged ready in ${selected.laneLabel}.`)} data-testid="button-mark-ready">
                    <CheckCircle2 className="w-4 h-4 mr-1.5" /> Mark Ready
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => fireAction("Marked Blocked", `${selected.patient} flagged blocked for review.`)} data-testid="button-mark-blocked">
                    <ShieldAlert className="w-4 h-4 mr-1.5" /> Mark Blocked
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => fireAction("Assign Owner", `Owner reassignment requested for ${selected.patient}.`)} data-testid="button-assign-owner">
                    <UserCog className="w-4 h-4 mr-1.5" /> Assign Owner
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => fireAction("Sent to Engagement", `${selected.patient} routed to Engagement Center.`)} data-testid="button-send-engagement">
                    <Send className="w-4 h-4 mr-1.5" /> To Engagement
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => fireAction("Sent to Scheduler", `${selected.patient} routed to Scheduler.`)} data-testid="button-send-scheduler">
                    <CalendarClock className="w-4 h-4 mr-1.5" /> To Scheduler
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => fireAction("Sent to Billing", `${selected.patient} routed to Billing.`)} data-testid="button-send-billing">
                    <Receipt className="w-4 h-4 mr-1.5" /> To Billing
                  </Button>
                  <Button variant="outline" size="sm" className="col-span-2" onClick={() => fireAction("Documents", `Opening document package for ${selected.patient}.`)} data-testid="button-view-documents">
                    <FileText className="w-4 h-4 mr-1.5" /> View Documents
                  </Button>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">{label}</div>
      <div className="text-sm text-slate-800 mt-0.5">{value}</div>
    </div>
  );
}
