import { useQuery } from "@tanstack/react-query";
import type {
  Claim, PayerRow, Invoice, ARBucket, ARRow, FinanceKpis, MetricRow,
  ServiceLineRevenue, ProviderFinancial, PipelineStage, Order, EncounterNote,
  Qualification, CallTask, EngagementActivity, ScheduleItem, Escalation,
  EngagementKpis,
} from "./mockData";

export interface PortalFinance {
  kpis: FinanceKpis;
  revenueSummary: MetricRow[];
  serviceLineRevenue: ServiceLineRevenue[];
  claims: Claim[];
  paidClaims: Claim[];
  invoices: Invoice[];
  pipeline: PipelineStage[];
  practiceOverview: MetricRow[];
  arBuckets: ARBucket[];
  arRows: ARRow[];
  payerMix: PayerRow[];
  providerFinancials: ProviderFinancial[];
}

export interface PortalEngagement {
  kpis: EngagementKpis;
  callTasks: CallTask[];
  qualifications: Qualification[];
  activity: EngagementActivity[];
  schedule: ScheduleItem[];
  escalations: Escalation[];
  staff: string[];
}

export interface PortalData {
  finance: PortalFinance;
  orders: Order[];
  notes: EncounterNote[];
  engagement: PortalEngagement;
}

export function usePortalData() {
  return useQuery<PortalData>({ queryKey: ["/api/clinician-portal"] });
}
