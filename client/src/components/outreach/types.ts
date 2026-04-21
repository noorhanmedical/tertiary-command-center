import type { OutreachCall } from "@shared/schema";
import type { VALID_FACILITIES } from "@shared/plexus";

export type Facility = (typeof VALID_FACILITIES)[number];

export type PriorTestEntry = {
  testName: string;
  dateOfService: string;
  clinic: string | null;
  notes: string | null;
};

export type ReasoningEntry = {
  testName: string;
  text: string;
  pearls?: string[];
  qualifyingFactors?: string[];
};

export type OutreachCallItem = {
  id: string;
  patientId: number;
  patientName: string;
  facility: string;
  phoneNumber: string;
  email: string;
  insurance: string;
  qualifyingTests: string[];
  appointmentStatus: string;
  patientType: string;
  batchId: number;
  scheduleDate: string;
  time: string;
  providerName: string;
  notes: string | null;
  dob: string | null;
  age: number | null;
  gender: string | null;
  diagnoses: string | null;
  history: string | null;
  medications: string | null;
  previousTests: string | null;
  previousTestsDate: string | null;
  noPreviousTests: boolean;
  reasoning: ReasoningEntry[];
  priorTestHistory: PriorTestEntry[];
};

export type OutreachSchedulerCard = {
  id: string;
  name: string;
  facility: string;
  capacityPercent: number;
  totalPatients: number;
  touchedCount: number;
  scheduledCount: number;
  pendingCount: number;
  conversionRate: number;
  callList: OutreachCallItem[];
};

export type OutreachDashboard = {
  today: string;
  metrics: {
    schedulerCount: number;
    totalCalls: number;
    totalScheduled: number;
    totalPending: number;
    avgConversion: number;
  };
  schedulerCards: OutreachSchedulerCard[];
};

export type CallBucket =
  | "callback_due"
  | "never_called"
  | "no_answer"
  | "contacted"
  | "scheduled"
  | "declined";

export type SortedCallEntry = {
  item: OutreachCallItem;
  latest: OutreachCall | undefined;
  bucket: CallBucket;
};

export type AssignmentRow = {
  id: number;
  patientScreeningId: number;
  schedulerId: number;
  source: string;
  originalSchedulerId: number | null;
  reason: string | null;
};

export type ExpandedKind =
  | "currentCall"
  | "calendar"
  | "email"
  | "materials"
  | "tasks"
  | "messages";
export type PlayfieldTabKind = ExpandedKind | "thread";
export type PlayfieldTab = {
  id: string;
  kind: PlayfieldTabKind;
  patientId?: number;
  patientName?: string;
  label: string;
};
