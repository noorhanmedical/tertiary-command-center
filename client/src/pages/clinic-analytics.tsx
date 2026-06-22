// Clinic Analytics — due diligence, opportunity scoring, and ancillary
// revenue analytics to help owners decide whether a clinic is valuable.
//
// Self-contained demo page driven by realistic inline mock data. A clinic
// selector switches the entire dataset. Filter chips actually filter their
// tables via useMemo.

import { useMemo, useState } from "react";
import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
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
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  BarChart3,
  Building2,
  TrendingUp,
  TrendingDown,
  Minus,
  Users,
  HeartPulse,
  Stethoscope,
  Brain,
  Activity,
  ShieldCheck,
  Sparkles,
  FileBarChart,
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  Pill,
  ClipboardList,
  CreditCard,
  Calculator,
  Phone,
  MapPin,
} from "lucide-react";
import type {
  ClinicAnalyticsCptCategory as CptCategory,
  ClinicAnalyticsIcdCategory as IcdCategory,
  ClinicAnalyticsMedicationCategory as MedicationCategory,
  ClinicAnalyticsRecommendation as Recommendation,
  ClinicAnalyticsRiskLevel as RiskLevel,
  ClinicAnalyticsTrend as Trend,
  ClinicProfile,
} from "@/lib/enterprise-demo/types";
// TODO API: replace these demo imports with a TanStack Query call to
// `/api/clinic-analytics/profiles` when the backend ships.
import {
  CLINIC_ANALYTICS_PROFILES as CLINICS,
} from "@/lib/enterprise-demo/clinicAnalyticsDemoData";

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function fmtMoney(v: number): string {
  return `$${v.toLocaleString("en-US")}`;
}

const recommendationStyles: Record<Recommendation, string> = {
  Approve: "rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 text-xs font-medium",
  "Approve with caution": "rounded-md bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 text-xs font-medium",
  "Needs remediation": "rounded-md bg-orange-50 text-orange-700 border border-orange-200 px-2 py-0.5 text-xs font-medium",
  "Do not onboard": "rounded-md bg-red-50 text-red-700 border border-red-200 px-2 py-0.5 text-xs font-medium",
};

const riskStyles: Record<RiskLevel, string> = {
  Low: "rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 text-xs font-medium",
  Moderate: "rounded-md bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 text-xs font-medium",
  Elevated: "rounded-md bg-orange-50 text-orange-700 border border-orange-200 px-2 py-0.5 text-xs font-medium",
  High: "rounded-md bg-red-50 text-red-700 border border-red-200 px-2 py-0.5 text-xs font-medium",
};

const statusStyles: Record<ClinicProfile["status"], string> = {
  Active: "rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 text-xs font-medium",
  "In Review": "rounded-md bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 text-xs font-medium",
  Prospect: "rounded-md bg-slate-100 text-slate-600 border border-slate-200 px-2 py-0.5 text-xs font-medium",
};

function TrendIcon({ trend }: { trend: Trend }) {
  if (trend === "up") return <TrendingUp className="w-3.5 h-3.5 text-emerald-600 inline" />;
  if (trend === "down") return <TrendingDown className="w-3.5 h-3.5 text-red-600 inline" />;
  return <Minus className="w-3.5 h-3.5 text-slate-400 inline" />;
}

function SectionTitle({ icon: Icon, title, hint }: { icon: typeof BarChart3; title: string; hint?: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-slate-100 text-slate-600">
        <Icon className="w-4 h-4" />
      </span>
      <div>
        <div className="font-semibold text-slate-800 text-sm">{title}</div>
        {hint && <div className="text-[11px] text-slate-500">{hint}</div>}
      </div>
    </div>
  );
}

function FilterChips<T extends string>({
  options,
  active,
  onChange,
  testIdPrefix,
}: {
  options: T[];
  active: T;
  onChange: (v: T) => void;
  testIdPrefix: string;
}) {
  return (
    <div className="flex flex-wrap gap-2 mb-3">
      {options.map((opt) => (
        <Button
          key={opt}
          size="sm"
          variant={active === opt ? "default" : "outline"}
          onClick={() => onChange(opt)}
          data-testid={`chip-${testIdPrefix}-${opt.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
        >
          {opt}
        </Button>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────

type ViewState = "success" | "loading" | "empty" | "error";

export default function ClinicAnalyticsPage() {
  const { toast } = useToast();
  const [view] = useState<ViewState>("success");
  const [selectedId, setSelectedId] = useState<string>(CLINICS[0].id);

  const [medFilter, setMedFilter] = useState<"All" | MedicationCategory>("All");
  const [icdFilter, setIcdFilter] = useState<"All" | IcdCategory>("All");
  const [cptFilter, setCptFilter] = useState<"All" | CptCategory>("All");

  const clinic = useMemo(
    () => CLINICS.find((c) => c.id === selectedId) ?? CLINICS[0],
    [selectedId],
  );

  const meds = useMemo(
    () => (medFilter === "All" ? clinic.medications : clinic.medications.filter((m) => m.category === medFilter)),
    [clinic, medFilter],
  );
  const icd = useMemo(
    () => (icdFilter === "All" ? clinic.icdCodes : clinic.icdCodes.filter((i) => i.category === icdFilter)),
    [clinic, icdFilter],
  );
  const cpt = useMemo(
    () => (cptFilter === "All" ? clinic.cptCodes : clinic.cptCodes.filter((c) => c.category === cptFilter)),
    [clinic, cptFilter],
  );

  return (
    <div className="flex flex-col h-full">
      <header className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-slate-200 px-6 py-4">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/15 to-teal-500/15 text-emerald-700">
            <BarChart3 className="w-5 h-5" strokeWidth={1.75} />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-slate-900" data-testid="text-clinic-analytics-title">
              Clinic Analytics
            </h1>
            <p className="text-sm text-slate-500">Due diligence &amp; ancillary revenue opportunity</p>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-auto bg-slate-50/40 px-6 py-6 space-y-6">
        {view === "loading" && (
          <div className="space-y-4" data-testid="status-clinic-analytics-loading">
            <Skeleton className="h-10 w-72" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-28 rounded-xl" />
              ))}
            </div>
            <Skeleton className="h-64 rounded-xl" />
          </div>
        )}

        {view === "empty" && (
          <Card className="p-10 text-center rounded-xl border-slate-200" data-testid="status-clinic-analytics-empty">
            <Building2 className="w-8 h-8 mx-auto text-slate-300" />
            <div className="mt-3 text-sm font-medium text-slate-700">No clinic selected</div>
            <div className="text-xs text-slate-500 mt-1">Choose a clinic to view its due-diligence profile.</div>
          </Card>
        )}

        {view === "error" && (
          <div
            className="py-12 text-center text-red-600 text-sm rounded-xl border border-red-200 bg-red-50"
            data-testid="status-clinic-analytics-error"
          >
            Couldn&apos;t load clinic analytics. Please refresh to try again.
          </div>
        )}

        {view === "success" && (
          <>
            {/* 1. Clinic Selector */}
            <Card className="p-4 rounded-xl border-slate-200" data-testid="card-clinic-selector">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Clinic</span>
                  <Select value={selectedId} onValueChange={setSelectedId}>
                    <SelectTrigger className="w-72" data-testid="select-clinic">
                      <SelectValue placeholder="Select a clinic" />
                    </SelectTrigger>
                    <SelectContent>
                      {CLINICS.map((c) => (
                        <SelectItem key={c.id} value={c.id} data-testid={`option-clinic-${c.id}`}>
                          {c.name} — {c.location}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className={statusStyles[clinic.status]} data-testid="badge-clinic-status">{clinic.status}</span>
                </div>
                <div className="flex items-center gap-4 text-xs text-slate-500 flex-wrap">
                  <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{clinic.location}</span>
                  <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />{clinic.mainContact}</span>
                  <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" />{clinic.phone}</span>
                  <span>EMR: {clinic.emr}</span>
                  <span>Go-live: {clinic.goLiveDate}</span>
                </div>
              </div>
            </Card>

            {/* 2. Clinic Profile Top Card */}
            <Card className="p-5 rounded-xl border-slate-200" data-testid="card-clinic-profile">
              <div className="flex items-start justify-between gap-6 flex-wrap">
                <div className="space-y-1">
                  <div className="text-lg font-semibold text-slate-900" data-testid="text-clinic-name">{clinic.name}</div>
                  <div className="text-sm text-slate-500">{clinic.specialty}</div>
                  <div className="flex flex-wrap gap-2 pt-2">
                    {clinic.activeAncillaryServices.map((svc) => (
                      <Badge key={svc} variant="secondary" data-testid={`badge-active-ancillary-${svc.toLowerCase()}`}>{svc}</Badge>
                    ))}
                  </div>
                </div>
                <div className="text-right min-w-[180px]">
                  <div className="text-xs text-slate-500 uppercase tracking-wide">Opportunity Score</div>
                  <div className="text-4xl font-bold text-emerald-700 tabular-nums" data-testid="text-opportunity-score">{clinic.opportunityScore}</div>
                  <Progress value={clinic.opportunityScore} className="h-2 mt-2" />
                </div>
              </div>
              <Separator className="my-4" />
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
                {[
                  { label: "Providers", value: clinic.providers },
                  { label: "Exam Rooms", value: clinic.examRooms },
                  { label: "Daily Volume", value: clinic.dailyVolume },
                  { label: "Total Patients", value: clinic.totalPatients.toLocaleString() },
                  { label: "Ancillary Services", value: clinic.activeAncillaryServices.length },
                  { label: "Staff", value: clinic.capacity.staffCount },
                ].map((kpi) => (
                  <div key={kpi.label} data-testid={`kpi-profile-${kpi.label.toLowerCase().replace(/\s+/g, "-")}`}>
                    <div className="text-2xl font-bold text-slate-900 tabular-nums">{kpi.value}</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">{kpi.label}</div>
                  </div>
                ))}
              </div>
            </Card>

            {/* 3 & 4. Payor Mix + Financial Health */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="p-5 rounded-xl border-slate-200" data-testid="card-payor-mix">
                <SectionTitle icon={CreditCard} title="Payor Mix" hint="Coverage breakdown & ancillary value" />
                <div className="space-y-2.5">
                  {[
                    { label: "Medicare", value: clinic.payorMix.medicare, color: "bg-blue-500" },
                    { label: "PPO", value: clinic.payorMix.ppo, color: "bg-emerald-500" },
                    { label: "Commercial", value: clinic.payorMix.commercial, color: "bg-violet-500" },
                    { label: "Medicaid", value: clinic.payorMix.medicaid, color: "bg-amber-500" },
                    { label: "Cash / Self-pay", value: clinic.payorMix.cash, color: "bg-slate-400" },
                  ].map((p) => (
                    <div key={p.label} data-testid={`payor-${p.label.toLowerCase().replace(/[^a-z]+/g, "-")}`}>
                      <div className="flex items-center justify-between text-xs text-slate-600 mb-1">
                        <span>{p.label}</span>
                        <span className="tabular-nums font-medium">{p.value}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                        <div className={`h-full ${p.color}`} style={{ width: `${p.value}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex items-center gap-2">
                  {clinic.payorMix.highValueAncillary ? (
                    <span className="rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 text-xs font-medium">High-value ancillary mix</span>
                  ) : (
                    <span className="rounded-md bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 text-xs font-medium">Limited ancillary value</span>
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-2">{clinic.payorMix.riskNotes}</p>
              </Card>

              <Card className="p-5 rounded-xl border-slate-200" data-testid="card-financial-health">
                <SectionTitle icon={TrendingUp} title="Financial Health" hint="Revenue, AR & billing readiness" />
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { label: "Monthly Revenue", value: fmtMoney(clinic.financial.monthlyRevenue) },
                    { label: "Ancillary Opportunity", value: fmtMoney(clinic.financial.ancillaryOpportunity) },
                    { label: "AR Days", value: `${clinic.financial.arDays}` },
                    { label: "Collection Rate", value: `${clinic.financial.collectionRate}%` },
                    { label: "Denial Rate", value: `${clinic.financial.denialRate}%` },
                    { label: "Billing Readiness", value: `${clinic.financial.billingReadinessScore}/100` },
                  ].map((f) => (
                    <div key={f.label} data-testid={`fin-${f.label.toLowerCase().replace(/\s+/g, "-")}`}>
                      <div className="text-xl font-bold text-slate-900 tabular-nums">{f.value}</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">{f.label}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex items-center gap-2">
                  <span className="text-xs text-slate-500">Financial risk</span>
                  <span className={riskStyles[clinic.financial.financialRisk]} data-testid="badge-financial-risk">{clinic.financial.financialRisk}</span>
                </div>
              </Card>
            </div>

            {/* 5, 6, 7. Demographics + Capacity + Team */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <Card className="p-5 rounded-xl border-slate-200" data-testid="card-demographics">
                <SectionTitle icon={Users} title="Patient Demographics" />
                <div className="grid grid-cols-2 gap-3">
                  <Kpi label="Total Patients" value={clinic.demographics.totalPatients.toLocaleString()} />
                  <Kpi label="Average Age" value={`${clinic.demographics.averageAge}`} />
                  <Kpi label="Medicare-Eligible" value={`${clinic.demographics.medicareEligiblePct}%`} />
                  <Kpi label="Chronic Disease" value={`${clinic.demographics.chronicDiseasePct}%`} />
                  <Kpi label="High-Risk Patients" value={clinic.demographics.highRiskCount.toLocaleString()} />
                </div>
                <div className="mt-3">
                  <div className="text-[11px] text-slate-500 mb-1">Common diagnoses</div>
                  <div className="flex flex-wrap gap-1.5">
                    {clinic.demographics.commonDiagnoses.map((d) => (
                      <Badge key={d} variant="outline">{d}</Badge>
                    ))}
                  </div>
                </div>
              </Card>

              <Card className="p-5 rounded-xl border-slate-200" data-testid="card-capacity">
                <SectionTitle icon={Stethoscope} title="Clinic Capacity" />
                <div className="grid grid-cols-2 gap-3">
                  <Kpi label="Providers" value={`${clinic.capacity.providers}`} />
                  <Kpi label="Exam Rooms" value={`${clinic.capacity.examRooms}`} />
                  <Kpi label="Daily Visits" value={`${clinic.capacity.dailyVolume}`} />
                  <Kpi label="Staff" value={`${clinic.capacity.staffCount}`} />
                </div>
                <div className="mt-3">
                  <div className="flex items-center justify-between text-xs text-slate-600 mb-1">
                    <span>Ancillary capacity</span>
                    <span className="tabular-nums font-medium">{clinic.capacity.ancillaryCapacityScore}/100</span>
                  </div>
                  <Progress value={clinic.capacity.ancillaryCapacityScore} className="h-2" />
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <SupportBadge icon={Brain} label="BrainWave" ok={clinic.capacity.supports.brainWave} />
                  <SupportBadge icon={Activity} label="VitalWave" ok={clinic.capacity.supports.vitalWave} />
                  <SupportBadge icon={HeartPulse} label="Ultrasound" ok={clinic.capacity.supports.ultrasound} />
                </div>
                <div className="mt-3 text-xs text-slate-500">
                  Implementation complexity: <span className="font-medium text-slate-700">{clinic.capacity.implementationComplexity}</span>
                </div>
              </Card>

              <Card className="p-5 rounded-xl border-slate-200" data-testid="card-team-assessment">
                <SectionTitle icon={ClipboardList} title="Team Assessment" />
                <div className="grid grid-cols-2 gap-3">
                  <Kpi label="Total Staff" value={`${clinic.team.totalStaff}`} />
                  <Kpi label="Medical Assistants" value={`${clinic.team.medicalAssistants}`} />
                  <Kpi label="Turnover Rate" value={`${clinic.team.turnoverRate}%`} />
                  <Kpi label="Op. Maturity" value={`${clinic.team.operationalMaturityScore}/100`} />
                </div>
                <Separator className="my-3" />
                <div className="space-y-1 text-xs text-slate-600">
                  <div>Office manager: <span className="font-medium text-slate-800">{clinic.team.officeManager}</span></div>
                  <div>Billing contact: <span className="font-medium text-slate-800">{clinic.team.billingContact}</span></div>
                  <div>Training need score: <span className="font-medium text-slate-800">{clinic.team.trainingNeedScore}/4</span></div>
                </div>
              </Card>
            </div>

            {/* 8. Creditworthiness & Risk */}
            <Card className="p-5 rounded-xl border-slate-200" data-testid="card-creditworthiness">
              <div className="flex items-start justify-between gap-6 flex-wrap">
                <div>
                  <SectionTitle icon={ShieldCheck} title="Creditworthiness & Risk" />
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <RiskItem label="Operational" level={clinic.credit.operationalRisk} />
                    <RiskItem label="Financial" level={clinic.credit.financialRisk} />
                    <RiskItem label="Compliance" level={clinic.credit.complianceRisk} />
                    <RiskItem label="Staffing" level={clinic.credit.staffingRisk} />
                  </div>
                </div>
                <div className="text-right min-w-[200px]">
                  <div className="text-xs text-slate-500 uppercase tracking-wide">Creditworthiness</div>
                  <div className="text-4xl font-bold text-slate-900 tabular-nums" data-testid="text-credit-score">{clinic.credit.score}<span className="text-base text-slate-400">/100</span></div>
                  <div className="mt-2">
                    <span className={recommendationStyles[clinic.credit.recommendation]} data-testid="badge-recommendation">{clinic.credit.recommendation}</span>
                  </div>
                </div>
              </div>
            </Card>

            {/* 9. AI Due Diligence Summary */}
            <Card className="p-5 rounded-xl border-slate-200 bg-gradient-to-br from-violet-50/60 to-white" data-testid="card-ai-summary">
              <SectionTitle icon={Sparkles} title="AI Due Diligence Summary" hint="Generated insight from clinic profile" />
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <AiList icon={CheckCircle2} tone="text-emerald-600" title="Strengths" items={clinic.ai.strengths} />
                <AiList icon={AlertTriangle} tone="text-amber-600" title="Concerns" items={clinic.ai.concerns} />
                <AiList icon={TrendingUp} tone="text-blue-600" title="Revenue Opportunities" items={clinic.ai.revenueOpportunities} />
                <AiList icon={Stethoscope} tone="text-teal-600" title="Suggested Ancillaries" items={clinic.ai.suggestedAncillaries} />
                <AiList icon={AlertTriangle} tone="text-orange-600" title="Implementation Risks" items={clinic.ai.implementationRisks} />
                <div className="rounded-lg bg-white border border-slate-200 p-3">
                  <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Final Recommendation</div>
                  <p className="text-sm text-slate-700">{clinic.ai.finalRecommendation}</p>
                </div>
              </div>
            </Card>

            {/* 10. Medications & Drug Classes */}
            <Card className="p-5 rounded-xl border-slate-200" data-testid="card-medications">
              <SectionTitle icon={Pill} title="Medications & Drug Classes" hint="Prescribing signal for ancillary relevance" />
              <FilterChips
                testIdPrefix="med"
                active={medFilter}
                onChange={setMedFilter}
                options={["All", "Antihypertensives", "Antidiabetics", "Neurological", "Pain Management", "Psychiatric", "Cardiovascular"]}
              />
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Medication</TableHead>
                      <TableHead>Drug Class</TableHead>
                      <TableHead className="text-right">Monthly Scripts</TableHead>
                      <TableHead>Trend</TableHead>
                      <TableHead>Ancillary Relevance</TableHead>
                      <TableHead>Revenue Signal</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {meds.map((m) => (
                      <TableRow key={m.id} data-testid={`row-medication-${m.id}`}>
                        <TableCell className="font-medium text-slate-800">{m.name}</TableCell>
                        <TableCell className="text-slate-600">{m.drugClass}</TableCell>
                        <TableCell className="text-right tabular-nums">{m.monthlyScripts}</TableCell>
                        <TableCell><TrendIcon trend={m.trend} /></TableCell>
                        <TableCell className="text-slate-600">{m.ancillaryRelevance}</TableCell>
                        <TableCell>
                          <Badge variant={m.revenueSignal === "High" ? "default" : "secondary"}>{m.revenueSignal}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                    {meds.length === 0 && (
                      <TableRow><TableCell colSpan={6} className="text-center text-slate-400 py-6">No medications in this category.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </Card>

            {/* 11. ICD-10 Catalog */}
            <Card className="p-5 rounded-xl border-slate-200" data-testid="card-icd">
              <SectionTitle icon={ClipboardList} title="ICD-10 Code Catalog" hint="Diagnoses driving qualifying ancillaries" />
              <FilterChips
                testIdPrefix="icd"
                active={icdFilter}
                onChange={setIcdFilter}
                options={["All", "Neurological", "Cardiovascular", "Metabolic", "Mental Health"]}
              />
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ICD Code</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Frequency</TableHead>
                      <TableHead className="text-right">Revenue Opp.</TableHead>
                      <TableHead>Qualifying Ancillaries</TableHead>
                      <TableHead>Trend</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {icd.map((i) => (
                      <TableRow key={i.id} data-testid={`row-icd-${i.id}`}>
                        <TableCell className="font-medium text-slate-800">{i.code}</TableCell>
                        <TableCell className="text-slate-600">{i.description}</TableCell>
                        <TableCell><Badge variant="outline">{i.category}</Badge></TableCell>
                        <TableCell className="text-right tabular-nums">{i.frequency}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtMoney(i.revenueOpportunity)}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {i.qualifyingAncillaries.map((a) => (
                              <Badge key={a} variant="secondary">{a}</Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell><TrendIcon trend={i.trend} /></TableCell>
                      </TableRow>
                    ))}
                    {icd.length === 0 && (
                      <TableRow><TableCell colSpan={7} className="text-center text-slate-400 py-6">No ICD codes in this category.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </Card>

            {/* 12. CPT Database */}
            <Card className="p-5 rounded-xl border-slate-200" data-testid="card-cpt">
              <SectionTitle icon={CreditCard} title="CPT Code Database" hint="Billable procedures by ancillary service" />
              <FilterChips
                testIdPrefix="cpt"
                active={cptFilter}
                onChange={setCptFilter}
                options={["All", "BrainWave", "VitalWave", "Ultrasound", "EKG", "PGX/CGX"]}
              />
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>CPT</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Service</TableHead>
                      <TableHead className="text-right">Fee</TableHead>
                      <TableHead className="text-right">Freq / mo</TableHead>
                      <TableHead className="text-right">Total Revenue</TableHead>
                      <TableHead className="text-right">Payer Acc.</TableHead>
                      <TableHead>Related Ancillary</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cpt.map((c) => (
                      <TableRow key={c.id} data-testid={`row-cpt-${c.id}`}>
                        <TableCell className="font-medium text-slate-800">{c.code}</TableCell>
                        <TableCell className="text-slate-600">{c.description}</TableCell>
                        <TableCell><Badge variant="outline">{c.service}</Badge></TableCell>
                        <TableCell className="text-right tabular-nums">{fmtMoney(c.fee)}</TableCell>
                        <TableCell className="text-right tabular-nums">{c.monthlyFrequency}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtMoney(c.fee * c.monthlyFrequency)}</TableCell>
                        <TableCell className="text-right tabular-nums">{c.payerAcceptance}%</TableCell>
                        <TableCell className="text-slate-600">{c.relatedAncillary}</TableCell>
                      </TableRow>
                    ))}
                    {cpt.length === 0 && (
                      <TableRow><TableCell colSpan={8} className="text-center text-slate-400 py-6">No CPT codes for this service.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </Card>

            {/* 13. Revenue Calculations */}
            <Card className="p-5 rounded-xl border-slate-200" data-testid="card-revenue-calc">
              <SectionTitle icon={Calculator} title="Revenue Calculations" hint="Estimated annual ancillary opportunity" />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <RevenueTile label="Medication Impact" value={fmtMoney(clinic.revenue.medicationImpact)} />
                <RevenueTile label="ICD Impact" value={fmtMoney(clinic.revenue.icdImpact)} />
                <RevenueTile label="CPT Impact" value={fmtMoney(clinic.revenue.cptImpact)} />
                <RevenueTile label="Total Opportunity" value={fmtMoney(clinic.revenue.totalOpportunity)} highlight />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3" data-testid="tile-plexus-share">
                  <div className="text-[11px] text-emerald-600 uppercase tracking-wide">Estimated Plexus Share ({clinic.revenue.plexusSharePct}%)</div>
                  <div className="text-xl font-bold text-emerald-700 tabular-nums">{fmtMoney(Math.round(clinic.revenue.totalOpportunity * clinic.revenue.plexusSharePct / 100))}</div>
                </div>
                <div className="rounded-lg bg-blue-50 border border-blue-200 p-3" data-testid="tile-clinic-share">
                  <div className="text-[11px] text-blue-600 uppercase tracking-wide">Estimated Clinic Share ({clinic.revenue.clinicSharePct}%)</div>
                  <div className="text-xl font-bold text-blue-700 tabular-nums">{fmtMoney(Math.round(clinic.revenue.totalOpportunity * clinic.revenue.clinicSharePct / 100))}</div>
                </div>
              </div>
            </Card>

            {/* 14. Navigation */}
            <Card className="p-5 rounded-xl border-slate-200" data-testid="card-navigation">
              <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-3">Actions</div>
              <div className="flex flex-wrap gap-2">
                <Link href="/clinic-onboarding">
                  <Button variant="default" data-testid="button-send-to-onboarding">
                    Send to Clinic Onboarding <ArrowRight className="w-4 h-4 ml-1" />
                  </Button>
                </Link>
                <Link href="/billing">
                  <Button variant="outline" data-testid="button-view-billing">View Billing</Button>
                </Link>
                <Link href="/patient-directory">
                  <Button variant="outline" data-testid="button-view-patient-database">View Patient Database</Button>
                </Link>
                <Link href="/team-ops">
                  <Button variant="outline" data-testid="button-view-team-ops">View Team Ops</Button>
                </Link>
                <Button
                  variant="secondary"
                  data-testid="button-export-clinic-report"
                  onClick={() => toast({ title: "Export started", description: `Clinic report for ${clinic.name} is being generated.` })}
                >
                  <FileBarChart className="w-4 h-4 mr-1" /> Export Clinic Report
                </Button>
              </div>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Small presentational helpers
// ─────────────────────────────────────────────────────────────────────────

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div data-testid={`kpi-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
      <div className="text-lg font-bold text-slate-900 tabular-nums">{value}</div>
      <div className="text-[11px] text-slate-500 mt-0.5">{label}</div>
    </div>
  );
}

function SupportBadge({ icon: Icon, label, ok }: { icon: typeof Brain; label: string; ok: boolean }) {
  return (
    <span
      className={
        ok
          ? "inline-flex items-center gap-1 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 text-xs font-medium"
          : "inline-flex items-center gap-1 rounded-md bg-slate-100 text-slate-400 border border-slate-200 px-2 py-0.5 text-xs font-medium"
      }
      data-testid={`support-${label.toLowerCase()}`}
    >
      <Icon className="w-3 h-3" /> {label}
    </span>
  );
}

function RiskItem({ label, level }: { label: string; level: RiskLevel }) {
  return (
    <div data-testid={`risk-${label.toLowerCase()}`}>
      <div className="text-[11px] text-slate-500 mb-1">{label} Risk</div>
      <span className={riskStyles[level]}>{level}</span>
    </div>
  );
}

function AiList({ icon: Icon, tone, title, items }: { icon: typeof CheckCircle2; tone: string; title: string; items: string[] }) {
  return (
    <div className="rounded-lg bg-white border border-slate-200 p-3" data-testid={`ai-${title.toLowerCase().replace(/\s+/g, "-")}`}>
      <div className="flex items-center gap-1.5 mb-2">
        <Icon className={`w-4 h-4 ${tone}`} />
        <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">{title}</span>
      </div>
      <ul className="space-y-1">
        {items.map((it, idx) => (
          <li key={idx} className="text-sm text-slate-700 flex gap-1.5">
            <span className="text-slate-300">•</span>
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RevenueTile({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div
      className={
        highlight
          ? "rounded-lg bg-slate-900 text-white p-4"
          : "rounded-lg bg-slate-50 border border-slate-200 p-4"
      }
      data-testid={`revenue-tile-${label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <div className={`text-2xl font-bold tabular-nums ${highlight ? "text-white" : "text-slate-900"}`}>{value}</div>
      <div className={`text-[11px] mt-0.5 ${highlight ? "text-slate-300" : "text-slate-500"}`}>{label}</div>
    </div>
  );
}
