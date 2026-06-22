// Imaging Central — imaging EXECUTION center (ultrasound focus).
//
// Self-contained demo page for the imaging execution module. This is the
// operational console for getting imaging studies done: coverage, the
// technician roster, the live work queue, an action workbench, and the
// downstream readiness queue. Currently ULTRASOUND-ONLY by design.
//
// BOUNDARY: imaging execution only. No BrainWave / VitalWave / EKG / PGX /
// CGX here. "Technician" is a role label; "Ultrasound" is the study type.
// The module name is always "Imaging Central".

import { useMemo, useState } from "react";
import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import {
  ScanLine,
  Waves,
  MapPin,
  UserCog,
  Search,
  RefreshCw,
  AlertCircle,
  Upload,
  FileText,
  Binary,
  ClipboardCheck,
  CheckCircle2,
  UserX,
  CalendarClock,
  XCircle,
  Send,
  FolderOpen,
  Clock,
  Stethoscope,
  Phone,
  Activity,
  Wifi,
  WifiOff,
} from "lucide-react";

// DEMO MOCK DATA — types ----------------------------------------------------

type ImagingStatus =
  | "Assigned"
  | "In Field"
  | "Uploaded"
  | "Needs Review"
  | "Completed"
  | "No Show"
  | "Reschedule Needed"
  | "Cancelled";

type CoverageStatus = "Confirmed" | "Pending" | "Gap";
type YesNo = "Yes" | "No";

type UltrasoundType =
  | "Carotid Duplex"
  | "Echocardiogram TTE"
  | "Renal Artery Doppler"
  | "LE Arterial Doppler"
  | "AAA Duplex"
  | "LE Venous Duplex";

interface WorkQueueRow {
  id: string;
  patientName: string;
  patientMrn: string;
  patientDob: string;
  clinic: string;
  imagingType: "Ultrasound";
  ultrasoundType: UltrasoundType;
  technician: string;
  appointment: string; // ISO-ish display string
  appointmentIso: string; // YYYY-MM-DD for filtering
  coverage: CoverageStatus;
  status: ImagingStatus;
  uploadStatus: "Uploaded" | "Pending" | "Not Started";
  qcStatus: "Passed" | "In Review" | "Not Started" | "Flagged";
  procedureNoteStatus: "Complete" | "Draft" | "Not Started";
  billingReadiness: "Ready" | "Blocked" | "Pending";
  lastUpdated: string;
  nextAction: string;
  notes: string;
  timeline: { time: string; label: string }[];
}

interface CoverageRow {
  id: string;
  clinic: string;
  technician: string;
  imagingType: "Ultrasound";
  ultrasoundType: UltrasoundType;
  date: string;
  timeWindow: string;
  coverage: CoverageStatus;
  assignedCount: number;
  completedCount: number;
}

interface TechnicianRow {
  id: string;
  name: string;
  assignedClinics: string[];
  shift: string;
  phone: string;
  online: boolean;
  capacityToday: { booked: number; max: number };
  currentAssignment: string;
  completionRate: number;
}

// DEMO MOCK DATA — values ---------------------------------------------------

const CLINICS = [
  "Northgate Cardiology",
  "Lakeside Family Medicine",
  "Summit Vascular Institute",
  "Harbor Internal Medicine",
] as const;

const TECHNICIANS = [
  "Maria Alvarez, RVT",
  "Devon Carter, RDCS",
  "Priya Nair, RVT",
  "James Okafor, RDMS",
] as const;

const ULTRASOUND_TYPES: UltrasoundType[] = [
  "Carotid Duplex",
  "Echocardiogram TTE",
  "Renal Artery Doppler",
  "LE Arterial Doppler",
  "AAA Duplex",
  "LE Venous Duplex",
];

const ALL_STATUSES: ImagingStatus[] = [
  "Assigned",
  "In Field",
  "Uploaded",
  "Needs Review",
  "Completed",
  "No Show",
  "Reschedule Needed",
  "Cancelled",
];

const statusStyles: Record<ImagingStatus, string> = {
  Assigned:
    "rounded-md bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 text-xs font-medium",
  "In Field":
    "rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200 px-2 py-0.5 text-xs font-medium",
  Uploaded:
    "rounded-md bg-cyan-50 text-cyan-700 border border-cyan-200 px-2 py-0.5 text-xs font-medium",
  "Needs Review":
    "rounded-md bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 text-xs font-medium",
  Completed:
    "rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 text-xs font-medium",
  "No Show":
    "rounded-md bg-rose-50 text-rose-700 border border-rose-200 px-2 py-0.5 text-xs font-medium",
  "Reschedule Needed":
    "rounded-md bg-orange-50 text-orange-700 border border-orange-200 px-2 py-0.5 text-xs font-medium",
  Cancelled:
    "rounded-md bg-slate-100 text-slate-600 border border-slate-200 px-2 py-0.5 text-xs font-medium",
};

const coverageStyles: Record<CoverageStatus, string> = {
  Confirmed:
    "rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 text-xs font-medium",
  Pending:
    "rounded-md bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 text-xs font-medium",
  Gap: "rounded-md bg-rose-50 text-rose-700 border border-rose-200 px-2 py-0.5 text-xs font-medium",
};

function pill(text: string, tone: "green" | "amber" | "rose" | "slate" | "blue") {
  const map: Record<string, string> = {
    green: "bg-emerald-50 text-emerald-700 border-emerald-200",
    amber: "bg-amber-50 text-amber-700 border-amber-200",
    rose: "bg-rose-50 text-rose-700 border-rose-200",
    slate: "bg-slate-100 text-slate-600 border-slate-200",
    blue: "bg-blue-50 text-blue-700 border-blue-200",
  };
  return `rounded-md border px-2 py-0.5 text-xs font-medium ${map[tone]}`;
}

const WORK_QUEUE: WorkQueueRow[] = [
  {
    id: "IMG-1001",
    patientName: "Eleanor Whitfield",
    patientMrn: "MRN-48201",
    patientDob: "1948-03-12",
    clinic: "Northgate Cardiology",
    imagingType: "Ultrasound",
    ultrasoundType: "Carotid Duplex",
    technician: "Maria Alvarez, RVT",
    appointment: "Jun 10, 2025 · 8:30 AM",
    appointmentIso: "2025-06-10",
    coverage: "Confirmed",
    status: "Assigned",
    uploadStatus: "Not Started",
    qcStatus: "Not Started",
    procedureNoteStatus: "Not Started",
    billingReadiness: "Pending",
    lastUpdated: "12 min ago",
    nextAction: "Tech to begin study",
    notes: "Bilateral carotid; prior stenosis noted on left side.",
    timeline: [
      { time: "Jun 9 · 4:15 PM", label: "Assigned to Maria Alvarez" },
      { time: "Jun 9 · 4:10 PM", label: "Coverage confirmed at Northgate" },
    ],
  },
  {
    id: "IMG-1002",
    patientName: "Marcus Bell",
    patientMrn: "MRN-48244",
    patientDob: "1955-09-02",
    clinic: "Northgate Cardiology",
    imagingType: "Ultrasound",
    ultrasoundType: "Echocardiogram TTE",
    technician: "Devon Carter, RDCS",
    appointment: "Jun 10, 2025 · 9:15 AM",
    appointmentIso: "2025-06-10",
    coverage: "Confirmed",
    status: "In Field",
    uploadStatus: "Pending",
    qcStatus: "Not Started",
    procedureNoteStatus: "Not Started",
    billingReadiness: "Pending",
    lastUpdated: "4 min ago",
    nextAction: "Awaiting upload from field",
    notes: "Routine TTE; evaluate EF and valve function.",
    timeline: [
      { time: "Jun 10 · 9:18 AM", label: "Study in progress" },
      { time: "Jun 10 · 9:00 AM", label: "Tech checked in on site" },
    ],
  },
  {
    id: "IMG-1003",
    patientName: "Sofia Ramirez",
    patientMrn: "MRN-48310",
    patientDob: "1962-11-21",
    clinic: "Summit Vascular Institute",
    imagingType: "Ultrasound",
    ultrasoundType: "Renal Artery Doppler",
    technician: "Priya Nair, RVT",
    appointment: "Jun 10, 2025 · 10:00 AM",
    appointmentIso: "2025-06-10",
    coverage: "Confirmed",
    status: "Uploaded",
    uploadStatus: "Uploaded",
    qcStatus: "In Review",
    procedureNoteStatus: "Draft",
    billingReadiness: "Pending",
    lastUpdated: "26 min ago",
    nextAction: "QC review of uploaded images",
    notes: "Doppler for suspected renal artery stenosis.",
    timeline: [
      { time: "Jun 10 · 10:42 AM", label: "Images uploaded" },
      { time: "Jun 10 · 10:05 AM", label: "Study started" },
    ],
  },
  {
    id: "IMG-1004",
    patientName: "Harold Jennings",
    patientMrn: "MRN-48356",
    patientDob: "1944-01-30",
    clinic: "Summit Vascular Institute",
    imagingType: "Ultrasound",
    ultrasoundType: "AAA Duplex",
    technician: "Priya Nair, RVT",
    appointment: "Jun 10, 2025 · 11:30 AM",
    appointmentIso: "2025-06-10",
    coverage: "Confirmed",
    status: "Needs Review",
    uploadStatus: "Uploaded",
    qcStatus: "Flagged",
    procedureNoteStatus: "Draft",
    billingReadiness: "Blocked",
    lastUpdated: "1 hr ago",
    nextAction: "Re-image distal aorta — incomplete views",
    notes: "AAA surveillance; distal segment poorly visualized.",
    timeline: [
      { time: "Jun 10 · 11:55 AM", label: "QC flagged incomplete views" },
      { time: "Jun 10 · 11:48 AM", label: "Images uploaded" },
    ],
  },
  {
    id: "IMG-1005",
    patientName: "Grace Donovan",
    patientMrn: "MRN-48402",
    patientDob: "1951-07-14",
    clinic: "Lakeside Family Medicine",
    imagingType: "Ultrasound",
    ultrasoundType: "LE Venous Duplex",
    technician: "James Okafor, RDMS",
    appointment: "Jun 10, 2025 · 1:00 PM",
    appointmentIso: "2025-06-10",
    coverage: "Confirmed",
    status: "Completed",
    uploadStatus: "Uploaded",
    qcStatus: "Passed",
    procedureNoteStatus: "Complete",
    billingReadiness: "Ready",
    lastUpdated: "2 hr ago",
    nextAction: "Send to billing",
    notes: "Bilateral LE venous; no acute DVT identified.",
    timeline: [
      { time: "Jun 10 · 1:40 PM", label: "Procedure note completed" },
      { time: "Jun 10 · 1:25 PM", label: "QC passed" },
      { time: "Jun 10 · 1:05 PM", label: "Images uploaded" },
    ],
  },
  {
    id: "IMG-1006",
    patientName: "Theodore Pratt",
    patientMrn: "MRN-48455",
    patientDob: "1939-05-08",
    clinic: "Harbor Internal Medicine",
    imagingType: "Ultrasound",
    ultrasoundType: "LE Arterial Doppler",
    technician: "Maria Alvarez, RVT",
    appointment: "Jun 10, 2025 · 2:15 PM",
    appointmentIso: "2025-06-10",
    coverage: "Pending",
    status: "Assigned",
    uploadStatus: "Not Started",
    qcStatus: "Not Started",
    procedureNoteStatus: "Not Started",
    billingReadiness: "Pending",
    lastUpdated: "35 min ago",
    nextAction: "Confirm coverage at Harbor",
    notes: "Claudication workup; ABI ordered alongside.",
    timeline: [{ time: "Jun 10 · 8:00 AM", label: "Assigned, coverage pending" }],
  },
  {
    id: "IMG-1007",
    patientName: "Naomi Foster",
    patientMrn: "MRN-48511",
    patientDob: "1968-02-19",
    clinic: "Northgate Cardiology",
    imagingType: "Ultrasound",
    ultrasoundType: "Echocardiogram TTE",
    technician: "Devon Carter, RDCS",
    appointment: "Jun 11, 2025 · 8:45 AM",
    appointmentIso: "2025-06-11",
    coverage: "Confirmed",
    status: "Assigned",
    uploadStatus: "Not Started",
    qcStatus: "Not Started",
    procedureNoteStatus: "Not Started",
    billingReadiness: "Pending",
    lastUpdated: "3 hr ago",
    nextAction: "Tech to begin study",
    notes: "Follow-up TTE post medication change.",
    timeline: [{ time: "Jun 10 · 3:00 PM", label: "Assigned to Devon Carter" }],
  },
  {
    id: "IMG-1008",
    patientName: "Wallace Kim",
    patientMrn: "MRN-48560",
    patientDob: "1957-12-03",
    clinic: "Lakeside Family Medicine",
    imagingType: "Ultrasound",
    ultrasoundType: "Carotid Duplex",
    technician: "James Okafor, RDMS",
    appointment: "Jun 11, 2025 · 10:30 AM",
    appointmentIso: "2025-06-11",
    coverage: "Gap",
    status: "Reschedule Needed",
    uploadStatus: "Not Started",
    qcStatus: "Not Started",
    procedureNoteStatus: "Not Started",
    billingReadiness: "Blocked",
    lastUpdated: "5 hr ago",
    nextAction: "No tech coverage — reschedule",
    notes: "Coverage gap at Lakeside on the 11th.",
    timeline: [{ time: "Jun 10 · 1:00 PM", label: "Coverage gap detected" }],
  },
  {
    id: "IMG-1009",
    patientName: "Beatrice Holloway",
    patientMrn: "MRN-48612",
    patientDob: "1946-08-27",
    clinic: "Summit Vascular Institute",
    imagingType: "Ultrasound",
    ultrasoundType: "AAA Duplex",
    technician: "Priya Nair, RVT",
    appointment: "Jun 11, 2025 · 11:45 AM",
    appointmentIso: "2025-06-11",
    coverage: "Confirmed",
    status: "No Show",
    uploadStatus: "Not Started",
    qcStatus: "Not Started",
    procedureNoteStatus: "Not Started",
    billingReadiness: "Blocked",
    lastUpdated: "Yesterday",
    nextAction: "Outreach to rebook",
    notes: "Patient did not arrive; left voicemail.",
    timeline: [{ time: "Jun 11 · 12:05 PM", label: "Marked no show" }],
  },
  {
    id: "IMG-1010",
    patientName: "Curtis Vance",
    patientMrn: "MRN-48677",
    patientDob: "1953-04-16",
    clinic: "Harbor Internal Medicine",
    imagingType: "Ultrasound",
    ultrasoundType: "Renal Artery Doppler",
    technician: "Maria Alvarez, RVT",
    appointment: "Jun 11, 2025 · 1:30 PM",
    appointmentIso: "2025-06-11",
    coverage: "Confirmed",
    status: "Uploaded",
    uploadStatus: "Uploaded",
    qcStatus: "In Review",
    procedureNoteStatus: "Draft",
    billingReadiness: "Pending",
    lastUpdated: "20 min ago",
    nextAction: "QC review of uploaded images",
    notes: "Resistant hypertension workup.",
    timeline: [
      { time: "Jun 11 · 2:10 PM", label: "Images uploaded" },
      { time: "Jun 11 · 1:35 PM", label: "Study started" },
    ],
  },
  {
    id: "IMG-1011",
    patientName: "Lucille Barrett",
    patientMrn: "MRN-48720",
    patientDob: "1960-10-09",
    clinic: "Northgate Cardiology",
    imagingType: "Ultrasound",
    ultrasoundType: "LE Venous Duplex",
    technician: "Devon Carter, RDCS",
    appointment: "Jun 12, 2025 · 9:00 AM",
    appointmentIso: "2025-06-12",
    coverage: "Confirmed",
    status: "Completed",
    uploadStatus: "Uploaded",
    qcStatus: "Passed",
    procedureNoteStatus: "Complete",
    billingReadiness: "Ready",
    lastUpdated: "Yesterday",
    nextAction: "Send to billing",
    notes: "Bilateral LE venous; chronic venous insufficiency.",
    timeline: [
      { time: "Jun 12 · 9:50 AM", label: "Procedure note completed" },
      { time: "Jun 12 · 9:30 AM", label: "QC passed" },
    ],
  },
  {
    id: "IMG-1012",
    patientName: "Raymond Cho",
    patientMrn: "MRN-48788",
    patientDob: "1942-06-22",
    clinic: "Summit Vascular Institute",
    imagingType: "Ultrasound",
    ultrasoundType: "Carotid Duplex",
    technician: "Priya Nair, RVT",
    appointment: "Jun 12, 2025 · 10:15 AM",
    appointmentIso: "2025-06-12",
    coverage: "Confirmed",
    status: "In Field",
    uploadStatus: "Pending",
    qcStatus: "Not Started",
    procedureNoteStatus: "Not Started",
    billingReadiness: "Pending",
    lastUpdated: "8 min ago",
    nextAction: "Awaiting upload from field",
    notes: "Carotid surveillance post-endarterectomy.",
    timeline: [{ time: "Jun 12 · 10:20 AM", label: "Study in progress" }],
  },
  {
    id: "IMG-1013",
    patientName: "Patricia Nunez",
    patientMrn: "MRN-48833",
    patientDob: "1958-03-05",
    clinic: "Lakeside Family Medicine",
    imagingType: "Ultrasound",
    ultrasoundType: "Echocardiogram TTE",
    technician: "James Okafor, RDMS",
    appointment: "Jun 12, 2025 · 11:30 AM",
    appointmentIso: "2025-06-12",
    coverage: "Confirmed",
    status: "Needs Review",
    uploadStatus: "Uploaded",
    qcStatus: "Flagged",
    procedureNoteStatus: "Draft",
    billingReadiness: "Blocked",
    lastUpdated: "45 min ago",
    nextAction: "Re-acquire apical 4-chamber view",
    notes: "Limited acoustic windows; partial study.",
    timeline: [
      { time: "Jun 12 · 12:05 PM", label: "QC flagged limited views" },
      { time: "Jun 12 · 11:50 AM", label: "Images uploaded" },
    ],
  },
  {
    id: "IMG-1014",
    patientName: "Gerald Mathis",
    patientMrn: "MRN-48901",
    patientDob: "1949-09-18",
    clinic: "Harbor Internal Medicine",
    imagingType: "Ultrasound",
    ultrasoundType: "LE Arterial Doppler",
    technician: "Maria Alvarez, RVT",
    appointment: "Jun 13, 2025 · 8:30 AM",
    appointmentIso: "2025-06-13",
    coverage: "Pending",
    status: "Assigned",
    uploadStatus: "Not Started",
    qcStatus: "Not Started",
    procedureNoteStatus: "Not Started",
    billingReadiness: "Pending",
    lastUpdated: "1 hr ago",
    nextAction: "Confirm coverage at Harbor",
    notes: "Rest pain; rule out critical limb ischemia.",
    timeline: [{ time: "Jun 12 · 4:30 PM", label: "Assigned, coverage pending" }],
  },
  {
    id: "IMG-1015",
    patientName: "Yvonne Castillo",
    patientMrn: "MRN-48955",
    patientDob: "1965-12-29",
    clinic: "Northgate Cardiology",
    imagingType: "Ultrasound",
    ultrasoundType: "AAA Duplex",
    technician: "Devon Carter, RDCS",
    appointment: "Jun 13, 2025 · 10:00 AM",
    appointmentIso: "2025-06-13",
    coverage: "Confirmed",
    status: "Cancelled",
    uploadStatus: "Not Started",
    qcStatus: "Not Started",
    procedureNoteStatus: "Not Started",
    billingReadiness: "Pending",
    lastUpdated: "2 days ago",
    nextAction: "No action — cancelled by patient",
    notes: "Patient cancelled; will self-schedule later.",
    timeline: [{ time: "Jun 11 · 9:00 AM", label: "Cancelled by patient" }],
  },
  {
    id: "IMG-1016",
    patientName: "Frank Delgado",
    patientMrn: "MRN-49012",
    patientDob: "1950-02-11",
    clinic: "Summit Vascular Institute",
    imagingType: "Ultrasound",
    ultrasoundType: "LE Venous Duplex",
    technician: "Priya Nair, RVT",
    appointment: "Jun 13, 2025 · 1:15 PM",
    appointmentIso: "2025-06-13",
    coverage: "Confirmed",
    status: "Completed",
    uploadStatus: "Uploaded",
    qcStatus: "Passed",
    procedureNoteStatus: "Complete",
    billingReadiness: "Ready",
    lastUpdated: "3 hr ago",
    nextAction: "Send to billing",
    notes: "Acute DVT ruled out; compression advised.",
    timeline: [
      { time: "Jun 13 · 2:00 PM", label: "Procedure note completed" },
      { time: "Jun 13 · 1:45 PM", label: "QC passed" },
    ],
  },
];

const COVERAGE_ROWS: CoverageRow[] = [
  {
    id: "COV-1",
    clinic: "Northgate Cardiology",
    technician: "Maria Alvarez, RVT",
    imagingType: "Ultrasound",
    ultrasoundType: "Carotid Duplex",
    date: "Jun 10, 2025",
    timeWindow: "8:00 AM – 12:00 PM",
    coverage: "Confirmed",
    assignedCount: 4,
    completedCount: 1,
  },
  {
    id: "COV-2",
    clinic: "Summit Vascular Institute",
    technician: "Priya Nair, RVT",
    imagingType: "Ultrasound",
    ultrasoundType: "Renal Artery Doppler",
    date: "Jun 10, 2025",
    timeWindow: "9:00 AM – 2:00 PM",
    coverage: "Confirmed",
    assignedCount: 5,
    completedCount: 2,
  },
  {
    id: "COV-3",
    clinic: "Harbor Internal Medicine",
    technician: "Maria Alvarez, RVT",
    imagingType: "Ultrasound",
    ultrasoundType: "LE Arterial Doppler",
    date: "Jun 10, 2025",
    timeWindow: "1:00 PM – 4:00 PM",
    coverage: "Pending",
    assignedCount: 2,
    completedCount: 0,
  },
  {
    id: "COV-4",
    clinic: "Lakeside Family Medicine",
    technician: "James Okafor, RDMS",
    imagingType: "Ultrasound",
    ultrasoundType: "Carotid Duplex",
    date: "Jun 11, 2025",
    timeWindow: "10:00 AM – 1:00 PM",
    coverage: "Gap",
    assignedCount: 3,
    completedCount: 0,
  },
  {
    id: "COV-5",
    clinic: "Northgate Cardiology",
    technician: "Devon Carter, RDCS",
    imagingType: "Ultrasound",
    ultrasoundType: "Echocardiogram TTE",
    date: "Jun 11, 2025",
    timeWindow: "8:00 AM – 11:00 AM",
    coverage: "Confirmed",
    assignedCount: 4,
    completedCount: 3,
  },
];

const TECH_ROSTER: TechnicianRow[] = [
  {
    id: "TECH-1",
    name: "Maria Alvarez, RVT",
    assignedClinics: ["Northgate Cardiology", "Harbor Internal Medicine"],
    shift: "Mon–Fri · 7:30 AM–4:00 PM",
    phone: "(555) 204-8810 · x231",
    online: true,
    capacityToday: { booked: 6, max: 8 },
    currentAssignment: "Carotid Duplex · Northgate",
    completionRate: 96,
  },
  {
    id: "TECH-2",
    name: "Devon Carter, RDCS",
    assignedClinics: ["Northgate Cardiology", "Lakeside Family Medicine"],
    shift: "Mon–Fri · 8:00 AM–4:30 PM",
    phone: "(555) 204-8822 · x244",
    online: true,
    capacityToday: { booked: 5, max: 7 },
    currentAssignment: "Echocardiogram TTE · Northgate",
    completionRate: 94,
  },
  {
    id: "TECH-3",
    name: "Priya Nair, RVT",
    assignedClinics: ["Summit Vascular Institute"],
    shift: "Tue–Sat · 7:00 AM–3:30 PM",
    phone: "(555) 204-8835 · x258",
    online: true,
    capacityToday: { booked: 7, max: 8 },
    currentAssignment: "Renal Artery Doppler · Summit",
    completionRate: 98,
  },
  {
    id: "TECH-4",
    name: "James Okafor, RDMS",
    assignedClinics: ["Lakeside Family Medicine", "Harbor Internal Medicine"],
    shift: "Mon–Thu · 8:30 AM–5:00 PM",
    phone: "(555) 204-8849 · x266",
    online: false,
    capacityToday: { booked: 0, max: 6 },
    currentAssignment: "Off shift",
    completionRate: 91,
  },
];

// View state for demo of loading / empty / error.
type ViewState = "success" | "loading" | "empty" | "error";

export default function ImagingCentralPage() {
  const { toast } = useToast();

  const [view, setView] = useState<ViewState>("success");

  // Filters
  const [search, setSearch] = useState("");
  const [clinicFilter, setClinicFilter] = useState<string>("all");
  const [techFilter, setTechFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [imagingTypeFilter] = useState<string>("Ultrasound"); // ultrasound-only for now
  const [usTypeFilter, setUsTypeFilter] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<string>("all");

  // Workbench sheet
  const [activeRow, setActiveRow] = useState<WorkQueueRow | null>(null);

  const dates = useMemo(() => {
    return Array.from(new Set(WORK_QUEUE.map((r) => r.appointmentIso))).sort();
  }, []);

  const filteredQueue = useMemo(() => {
    if (view !== "success") return [];
    const q = search.trim().toLowerCase();
    return WORK_QUEUE.filter((r) => {
      if (q && !`${r.patientName} ${r.patientMrn}`.toLowerCase().includes(q)) return false;
      if (clinicFilter !== "all" && r.clinic !== clinicFilter) return false;
      if (techFilter !== "all" && r.technician !== techFilter) return false;
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (usTypeFilter !== "all" && r.ultrasoundType !== usTypeFilter) return false;
      if (dateFilter !== "all" && r.appointmentIso !== dateFilter) return false;
      return true;
    });
  }, [view, search, clinicFilter, techFilter, statusFilter, usTypeFilter, dateFilter]);

  // KPI band — derived from the full work queue.
  const kpis = useMemo(() => {
    const q = WORK_QUEUE;
    const count = (fn: (r: WorkQueueRow) => boolean) => q.filter(fn).length;
    return [
      { label: "Total Imaging Tasks", value: q.length, Icon: ScanLine, tone: "text-slate-900", bg: "bg-slate-100 text-slate-700" },
      { label: "Ultrasound Tasks", value: count((r) => r.imagingType === "Ultrasound"), Icon: Waves, tone: "text-cyan-700", bg: "bg-cyan-100 text-cyan-700" },
      { label: "Assigned", value: count((r) => r.status === "Assigned"), Icon: ClipboardCheck, tone: "text-blue-700", bg: "bg-blue-100 text-blue-700" },
      { label: "In Field", value: count((r) => r.status === "In Field"), Icon: Activity, tone: "text-indigo-700", bg: "bg-indigo-100 text-indigo-700" },
      { label: "Uploaded", value: count((r) => r.uploadStatus === "Uploaded"), Icon: Upload, tone: "text-cyan-700", bg: "bg-cyan-100 text-cyan-700" },
      { label: "Needs Review", value: count((r) => r.status === "Needs Review"), Icon: AlertCircle, tone: "text-amber-700", bg: "bg-amber-100 text-amber-700" },
      { label: "Completed", value: count((r) => r.status === "Completed"), Icon: CheckCircle2, tone: "text-emerald-700", bg: "bg-emerald-100 text-emerald-700" },
      { label: "Report Ready", value: count((r) => r.uploadStatus === "Uploaded" && r.qcStatus === "Passed"), Icon: FileText, tone: "text-teal-700", bg: "bg-teal-100 text-teal-700" },
      { label: "Procedure Ready", value: count((r) => r.procedureNoteStatus === "Complete"), Icon: Stethoscope, tone: "text-violet-700", bg: "bg-violet-100 text-violet-700" },
      { label: "Ready for Billing", value: count((r) => r.billingReadiness === "Ready"), Icon: Send, tone: "text-emerald-700", bg: "bg-emerald-100 text-emerald-700" },
      { label: "Coverage Confirmed", value: count((r) => r.coverage === "Confirmed"), Icon: MapPin, tone: "text-emerald-700", bg: "bg-emerald-100 text-emerald-700" },
    ];
  }, []);

  // Readiness queue rows derived from work queue.
  const readinessRows = useMemo(() => {
    return WORK_QUEUE.filter((r) => r.status !== "Cancelled").map((r) => {
      const reportUploaded: YesNo = r.uploadStatus === "Uploaded" ? "Yes" : "No";
      const procedureComplete: YesNo = r.procedureNoteStatus === "Complete" ? "Yes" : "No";
      const billingReady: YesNo = r.billingReadiness === "Ready" ? "Yes" : "No";
      let missing = "—";
      if (reportUploaded === "No") missing = "Report upload";
      else if (r.qcStatus !== "Passed") missing = "QC review";
      else if (procedureComplete === "No") missing = "Procedure note";
      else if (billingReady === "No") missing = "Billing handoff";
      return {
        id: r.id,
        patientName: r.patientName,
        clinic: r.clinic,
        study: r.ultrasoundType,
        imagingType: r.imagingType,
        reportUploaded,
        procedureComplete,
        billingReady,
        missing,
        nextAction: r.nextAction,
      };
    });
  }, []);

  const fireToast = (title: string, description?: string) =>
    toast({ title, description });

  const resetFilters = () => {
    setSearch("");
    setClinicFilter("all");
    setTechFilter("all");
    setStatusFilter("all");
    setUsTypeFilter("all");
    setDateFilter("all");
  };

  const workbenchActions: { label: string; Icon: typeof Upload; ultrasoundOnly?: boolean }[] = [
    { label: "Upload Imaging Report", Icon: Upload },
    { label: "Upload Ultrasound Report", Icon: Waves, ultrasoundOnly: true },
    { label: "Attach Report Metadata", Icon: FileText },
    { label: "Register Report Binary", Icon: Binary },
    { label: "QC Review", Icon: ClipboardCheck },
    { label: "Complete Procedure", Icon: CheckCircle2 },
    { label: "Mark No Show", Icon: UserX },
    { label: "Needs Reschedule", Icon: CalendarClock },
    { label: "Cancelled", Icon: XCircle },
    { label: "Send to Billing", Icon: Send },
    { label: "View Document Package", Icon: FolderOpen },
  ];

  return (
    <div className="flex flex-col h-full">
      <header className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-slate-200 px-6 py-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500/15 to-teal-500/15 text-cyan-700">
              <ScanLine className="w-5 h-5" strokeWidth={1.75} />
            </span>
            <div>
              <h1 className="text-xl font-semibold text-slate-900" data-testid="text-imaging-central-title">
                Imaging Central
              </h1>
              <p className="text-sm text-slate-500">Imaging execution · ultrasound focus</p>
            </div>
          </div>
          {/* Demo state switcher */}
          <div className="flex items-center gap-2">
            <Select value={view} onValueChange={(v) => setView(v as ViewState)}>
              <SelectTrigger className="w-[150px]" data-testid="select-view-state">
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
        {/* KPI HEADER BAND */}
        <section data-testid="imaging-kpi-band">
          {view === "loading" ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
              {Array.from({ length: 11 }).map((_, i) => (
                <Skeleton key={i} className="h-20 rounded-xl" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
              {kpis.map((k) => (
                <Card
                  key={k.label}
                  className="p-3 rounded-xl border-slate-200 flex items-center gap-3"
                  data-testid={`kpi-${k.label.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  <span className={`inline-flex items-center justify-center w-9 h-9 rounded-lg shrink-0 ${k.bg}`}>
                    <k.Icon className="w-4 h-4" />
                  </span>
                  <div className="min-w-0">
                    <div className={`text-xl font-bold tabular-nums ${k.tone}`}>{view === "empty" ? 0 : k.value}</div>
                    <div className="text-[11px] text-slate-500 leading-tight">{k.label}</div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>

        {view === "error" && (
          <Card
            className="rounded-xl border-rose-200 bg-rose-50 p-8 text-center"
            data-testid="status-imaging-error"
          >
            <AlertCircle className="w-8 h-8 text-rose-500 mx-auto mb-2" />
            <div className="text-sm font-medium text-rose-700">Couldn't load imaging operations data.</div>
            <div className="text-xs text-rose-600 mt-1">Please refresh to try again.</div>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => setView("success")}
              data-testid="button-retry"
            >
              <RefreshCw className="w-4 h-4 mr-2" /> Retry
            </Button>
          </Card>
        )}

        {view === "loading" && (
          <div className="space-y-4" data-testid="status-imaging-loading">
            <Skeleton className="h-40 rounded-xl" />
            <Skeleton className="h-64 rounded-xl" />
          </div>
        )}

        {(view === "success" || view === "empty") && (
          <>
            {/* GLOBAL IMAGING COVERAGE */}
            <Card className="rounded-xl border-slate-200" data-testid="section-coverage">
              <div className="px-5 pt-5 pb-3 flex items-center gap-2">
                <MapPin className="w-4 h-4 text-cyan-600" />
                <h2 className="text-sm font-semibold text-slate-900">Global Imaging Coverage</h2>
              </div>
              <Separator />
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Clinic</TableHead>
                      <TableHead>Technician</TableHead>
                      <TableHead>Imaging Type</TableHead>
                      <TableHead>Ultrasound Type</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Time Window</TableHead>
                      <TableHead>Coverage</TableHead>
                      <TableHead className="text-right">Assigned</TableHead>
                      <TableHead className="text-right">Completed</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {view === "empty" ? (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center text-sm text-slate-400 py-8">
                          No coverage scheduled.
                        </TableCell>
                      </TableRow>
                    ) : (
                      COVERAGE_ROWS.map((c) => (
                        <TableRow key={c.id} data-testid={`coverage-row-${c.id}`}>
                          <TableCell className="font-medium text-slate-800">{c.clinic}</TableCell>
                          <TableCell className="text-slate-600">{c.technician}</TableCell>
                          <TableCell className="text-slate-600">{c.imagingType}</TableCell>
                          <TableCell className="text-slate-600">{c.ultrasoundType}</TableCell>
                          <TableCell className="text-slate-600 whitespace-nowrap">{c.date}</TableCell>
                          <TableCell className="text-slate-600 whitespace-nowrap">{c.timeWindow}</TableCell>
                          <TableCell><span className={coverageStyles[c.coverage]}>{c.coverage}</span></TableCell>
                          <TableCell className="text-right tabular-nums text-slate-800">{c.assignedCount}</TableCell>
                          <TableCell className="text-right tabular-nums text-slate-800">{c.completedCount}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </Card>

            {/* TECHNICIAN ROSTER */}
            <section data-testid="section-roster">
              <div className="flex items-center gap-2 mb-3">
                <UserCog className="w-4 h-4 text-cyan-600" />
                <h2 className="text-sm font-semibold text-slate-900">Imaging Technician Roster</h2>
              </div>
              {view === "empty" ? (
                <Card className="rounded-xl border-slate-200 p-8 text-center text-sm text-slate-400">
                  No technicians on roster.
                </Card>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {TECH_ROSTER.map((t) => {
                    const pct = Math.round((t.capacityToday.booked / t.capacityToday.max) * 100);
                    return (
                      <Card key={t.id} className="rounded-xl border-slate-200 p-4 space-y-3" data-testid={`tech-card-${t.id}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-slate-900 truncate">{t.name}</div>
                            <div className="text-[11px] text-slate-500 mt-0.5">{t.shift}</div>
                          </div>
                          {t.online ? (
                            <span className={pill("Online", "green") + " inline-flex items-center gap-1 shrink-0"}>
                              <Wifi className="w-3 h-3" /> Online
                            </span>
                          ) : (
                            <span className={pill("Offline", "slate") + " inline-flex items-center gap-1 shrink-0"}>
                              <WifiOff className="w-3 h-3" /> Offline
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {t.assignedClinics.map((c) => (
                            <Badge key={c} variant="secondary" className="text-[10px]">{c}</Badge>
                          ))}
                        </div>
                        <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
                          <Phone className="w-3 h-3" /> {t.phone}
                        </div>
                        <div>
                          <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1">
                            <span>Capacity today</span>
                            <span className="tabular-nums">{t.capacityToday.booked}/{t.capacityToday.max}</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                            <div className="h-full rounded-full bg-cyan-500" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-slate-500">Current</span>
                          <span className="text-slate-700 font-medium truncate ml-2">{t.currentAssignment}</span>
                        </div>
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-slate-500">Completion rate</span>
                          <span className="text-emerald-700 font-semibold tabular-nums">{t.completionRate}%</span>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              )}
            </section>

            {/* FILTERS */}
            <Card className="rounded-xl border-slate-200 p-4" data-testid="section-filters">
              <div className="flex flex-wrap gap-2 items-center">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search patient or MRN…"
                    className="pl-8"
                    data-testid="input-search-patient"
                  />
                </div>

                <Select value={clinicFilter} onValueChange={setClinicFilter}>
                  <SelectTrigger className="w-[180px]" data-testid="select-clinic">
                    <SelectValue placeholder="Clinic" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All clinics</SelectItem>
                    {CLINICS.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={techFilter} onValueChange={setTechFilter}>
                  <SelectTrigger className="w-[170px]" data-testid="select-technician">
                    <SelectValue placeholder="Technician" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All technicians</SelectItem>
                    {TECHNICIANS.map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[160px]" data-testid="select-status">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    {ALL_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={imagingTypeFilter} disabled>
                  <SelectTrigger className="w-[150px]" data-testid="select-imaging-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Ultrasound">Ultrasound</SelectItem>
                  </SelectContent>
                </Select>

                <Select value={usTypeFilter} onValueChange={setUsTypeFilter}>
                  <SelectTrigger className="w-[190px]" data-testid="select-ultrasound-type">
                    <SelectValue placeholder="Ultrasound type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All ultrasound types</SelectItem>
                    {ULTRASOUND_TYPES.map((u) => (
                      <SelectItem key={u} value={u}>{u}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={dateFilter} onValueChange={setDateFilter}>
                  <SelectTrigger className="w-[150px]" data-testid="select-date">
                    <SelectValue placeholder="Date" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All dates</SelectItem>
                    {dates.map((d) => (
                      <SelectItem key={d} value={d}>{d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Button variant="outline" size="default" onClick={resetFilters} data-testid="button-reset-filters">
                  Reset
                </Button>
              </div>
            </Card>

            {/* IMAGING WORK QUEUE */}
            <Card className="rounded-xl border-slate-200" data-testid="section-work-queue">
              <div className="px-5 pt-5 pb-3 flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <ScanLine className="w-4 h-4 text-cyan-600" />
                  <h2 className="text-sm font-semibold text-slate-900">Imaging Work Queue</h2>
                </div>
                <span className="text-xs text-slate-500 tabular-nums" data-testid="text-queue-count">
                  {filteredQueue.length} of {WORK_QUEUE.length} studies
                </span>
              </div>
              <Separator />
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Patient</TableHead>
                      <TableHead>Clinic</TableHead>
                      <TableHead>Imaging Study</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Technician</TableHead>
                      <TableHead>Appointment</TableHead>
                      <TableHead>Coverage</TableHead>
                      <TableHead>Upload</TableHead>
                      <TableHead>QC</TableHead>
                      <TableHead>Proc. Note</TableHead>
                      <TableHead>Billing</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Last Updated</TableHead>
                      <TableHead>Next Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredQueue.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={14} className="text-center text-sm text-slate-400 py-10" data-testid="empty-work-queue">
                          No imaging studies match the current filters.
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredQueue.map((r) => (
                        <TableRow
                          key={r.id}
                          className="cursor-pointer hover:bg-slate-50"
                          onClick={() => setActiveRow(r)}
                          data-testid={`queue-row-${r.id}`}
                        >
                          <TableCell>
                            <div className="font-medium text-slate-800">{r.patientName}</div>
                            <div className="text-[11px] text-slate-500">{r.patientMrn}</div>
                          </TableCell>
                          <TableCell className="text-slate-600">{r.clinic}</TableCell>
                          <TableCell className="text-slate-600">{r.ultrasoundType}</TableCell>
                          <TableCell className="text-slate-600">{r.imagingType}</TableCell>
                          <TableCell className="text-slate-600">{r.technician}</TableCell>
                          <TableCell className="text-slate-600 whitespace-nowrap">{r.appointment}</TableCell>
                          <TableCell><span className={coverageStyles[r.coverage]}>{r.coverage}</span></TableCell>
                          <TableCell className="text-slate-600">{r.uploadStatus}</TableCell>
                          <TableCell className="text-slate-600">{r.qcStatus}</TableCell>
                          <TableCell className="text-slate-600">{r.procedureNoteStatus}</TableCell>
                          <TableCell>
                            <span
                              className={pill(
                                r.billingReadiness,
                                r.billingReadiness === "Ready" ? "green" : r.billingReadiness === "Blocked" ? "rose" : "amber",
                              )}
                            >
                              {r.billingReadiness}
                            </span>
                          </TableCell>
                          <TableCell><span className={statusStyles[r.status]}>{r.status}</span></TableCell>
                          <TableCell className="text-[11px] text-slate-500 whitespace-nowrap">{r.lastUpdated}</TableCell>
                          <TableCell className="text-[11px] text-slate-600 max-w-[180px]">{r.nextAction}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </Card>

            {/* IMAGING READINESS QUEUE */}
            <Card className="rounded-xl border-slate-200" data-testid="section-readiness">
              <div className="px-5 pt-5 pb-3 flex items-center gap-2">
                <ClipboardCheck className="w-4 h-4 text-cyan-600" />
                <h2 className="text-sm font-semibold text-slate-900">Imaging Readiness Queue</h2>
              </div>
              <Separator />
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Patient</TableHead>
                      <TableHead>Clinic</TableHead>
                      <TableHead>Study</TableHead>
                      <TableHead>Imaging Type</TableHead>
                      <TableHead>Report Uploaded</TableHead>
                      <TableHead>Procedure Complete</TableHead>
                      <TableHead>Billing Ready</TableHead>
                      <TableHead>Missing Item</TableHead>
                      <TableHead>Next Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {view === "empty" ? (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center text-sm text-slate-400 py-8">
                          No readiness items.
                        </TableCell>
                      </TableRow>
                    ) : (
                      readinessRows.map((r) => (
                        <TableRow key={r.id} data-testid={`readiness-row-${r.id}`}>
                          <TableCell className="font-medium text-slate-800">{r.patientName}</TableCell>
                          <TableCell className="text-slate-600">{r.clinic}</TableCell>
                          <TableCell className="text-slate-600">{r.study}</TableCell>
                          <TableCell className="text-slate-600">{r.imagingType}</TableCell>
                          <TableCell><span className={pill(r.reportUploaded, r.reportUploaded === "Yes" ? "green" : "rose")}>{r.reportUploaded}</span></TableCell>
                          <TableCell><span className={pill(r.procedureComplete, r.procedureComplete === "Yes" ? "green" : "rose")}>{r.procedureComplete}</span></TableCell>
                          <TableCell><span className={pill(r.billingReady, r.billingReady === "Yes" ? "green" : "rose")}>{r.billingReady}</span></TableCell>
                          <TableCell className="text-slate-600">{r.missing}</TableCell>
                          <TableCell className="text-[11px] text-slate-600 max-w-[180px]">{r.nextAction}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </Card>
          </>
        )}
      </main>

      {/* IMAGING ACTION WORKBENCH (right Sheet) */}
      <Sheet open={!!activeRow} onOpenChange={(o) => !o && setActiveRow(null)}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto" data-testid="sheet-workbench">
          {activeRow && (
            <>
              <SheetHeader>
                <SheetTitle data-testid="text-workbench-patient">{activeRow.patientName}</SheetTitle>
                <SheetDescription>
                  {activeRow.patientMrn} · DOB {activeRow.patientDob}
                </SheetDescription>
              </SheetHeader>

              <div className="mt-4 space-y-4">
                {/* Summary facts */}
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {[
                    ["Clinic", activeRow.clinic],
                    ["Study type", activeRow.ultrasoundType],
                    ["Imaging type", activeRow.imagingType],
                    ["Technician", activeRow.technician],
                    ["Scheduled", activeRow.appointment],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <div className="text-[11px] text-slate-500">{k}</div>
                      <div className="text-slate-800 font-medium">{v}</div>
                    </div>
                  ))}
                </div>

                <Separator />

                {/* Status chips */}
                <div className="flex flex-wrap gap-2">
                  <span className={statusStyles[activeRow.status]}>{activeRow.status}</span>
                  <span className={coverageStyles[activeRow.coverage]}>Coverage: {activeRow.coverage}</span>
                  <span className={pill(`Upload: ${activeRow.uploadStatus}`, activeRow.uploadStatus === "Uploaded" ? "green" : "amber")}>
                    Upload: {activeRow.uploadStatus}
                  </span>
                  <span className={pill(`QC: ${activeRow.qcStatus}`, activeRow.qcStatus === "Passed" ? "green" : activeRow.qcStatus === "Flagged" ? "rose" : "amber")}>
                    QC: {activeRow.qcStatus}
                  </span>
                  <span className={pill(`Proc: ${activeRow.procedureNoteStatus}`, activeRow.procedureNoteStatus === "Complete" ? "green" : "amber")}>
                    Proc: {activeRow.procedureNoteStatus}
                  </span>
                  <span className={pill(`Billing: ${activeRow.billingReadiness}`, activeRow.billingReadiness === "Ready" ? "green" : activeRow.billingReadiness === "Blocked" ? "rose" : "amber")}>
                    Billing: {activeRow.billingReadiness}
                  </span>
                </div>

                <Separator />

                {/* Notes */}
                <div>
                  <div className="text-[11px] text-slate-500 mb-1">Notes</div>
                  <p className="text-sm text-slate-700">{activeRow.notes}</p>
                </div>

                {/* Timeline */}
                <div>
                  <div className="text-[11px] text-slate-500 mb-2">Timeline</div>
                  <div className="space-y-2">
                    {activeRow.timeline.map((t, i) => (
                      <div key={i} className="flex items-start gap-2 text-sm" data-testid={`timeline-${activeRow.id}-${i}`}>
                        <Clock className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />
                        <div>
                          <div className="text-slate-700">{t.label}</div>
                          <div className="text-[11px] text-slate-400">{t.time}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <Separator />

                {/* Action buttons */}
                <div className="grid grid-cols-1 gap-2">
                  {workbenchActions
                    .filter((a) => !a.ultrasoundOnly || activeRow.imagingType === "Ultrasound")
                    .map((a) => (
                      <Button
                        key={a.label}
                        variant="outline"
                        size="default"
                        className="justify-start"
                        onClick={() =>
                          fireToast(a.label, `${a.label} for ${activeRow.patientName} (${activeRow.ultrasoundType}).`)
                        }
                        data-testid={`button-${a.label.toLowerCase().replace(/\s+/g, "-")}`}
                      >
                        <a.Icon className="w-4 h-4 mr-2" /> {a.label}
                      </Button>
                    ))}
                </div>

                <div className="pt-2">
                  <Link
                    href="/billing"
                    className="text-xs text-cyan-700 hover:underline"
                    data-testid="link-billing"
                  >
                    Open Billing →
                  </Link>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
