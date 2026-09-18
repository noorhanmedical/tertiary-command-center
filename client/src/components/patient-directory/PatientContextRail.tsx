import { ChevronLeft, ChevronRight, User, ShieldCheck, Stethoscope, Sparkles } from "lucide-react";
import type { EmrChart } from "@/types/emr";
import { normalizeInsuranceDisplay } from "./insuranceDisplay";

/**
 * PatientContextRail — the compact right-side context panel for the EHR patient
 * workspace. It surfaces a focused SUBSET of the chart (patient identity,
 * normalized insurance, active problems, current qualifying tests, Plexus IQ
 * status) so it complements the center content/document without duplicating the
 * full chart. Read-only; derives entirely from the already-loaded `chart`.
 *
 * Desktop-only (xl+) and collapsible: on laptop/narrow widths the caller hides
 * it so the document is never squeezed.
 */
export function PatientContextRail({
  chart,
  collapsed,
  onToggle,
}: {
  chart: EmrChart;
  collapsed: boolean;
  onToggle: () => void;
}) {
  if (collapsed) {
    return (
      <div
        className="hidden xl:flex flex-col items-center shrink-0 pt-3"
        style={{ width: "40px", background: "#F7F9FC", borderLeft: "1px solid #E2E8F0" }}
        data-testid="patient-context-rail-collapsed"
      >
        <button
          onClick={onToggle}
          title="Show patient context"
          className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-slate-200/60"
          data-testid="button-context-expand"
        >
          <ChevronLeft className="w-4 h-4" style={{ color: "#667085" }} />
        </button>
      </div>
    );
  }

  const d = chart.demographics;
  const ins = normalizeInsuranceDisplay(chart.insurance.primary);
  const diagnoses = (chart.diagnoses ?? []).filter((x) => x.description || x.icd10).slice(0, 6);
  const tests = chart.plexusIq?.qualifyingTests ?? [];
  const iqStatus = chart.plexusIq?.adminApprovalStatus || chart.plexusIq?.iqStatus || null;

  return (
    <aside
      className="hidden xl:flex flex-col shrink-0 overflow-y-auto"
      style={{ width: "320px", background: "#F7F9FC", borderLeft: "1px solid #E2E8F0" }}
      data-testid="patient-context-rail"
    >
      <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
        <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#98A2B3" }}>
          Context
        </span>
        <button
          onClick={onToggle}
          title="Hide patient context"
          className="w-6 h-6 rounded-md flex items-center justify-center hover:bg-slate-200/60"
          data-testid="button-context-collapse"
        >
          <ChevronRight className="w-4 h-4" style={{ color: "#667085" }} />
        </button>
      </div>

      <div className="px-3 pb-6 space-y-3">
        {/* Patient */}
        <ContextCard icon={<User className="w-3.5 h-3.5" />} title="Patient">
          <div className="text-[13px] font-semibold text-slate-800">{d.name || "—"}</div>
          <div className="mt-0.5 text-[11px] text-slate-500 leading-relaxed">
            {[d.mrn ? `MRN ${d.mrn}` : null, d.dob ? `${d.dob}${d.age != null ? ` (${d.age})` : ""}` : null, d.gender, d.clinic]
              .filter(Boolean)
              .join(" · ") || "—"}
          </div>
        </ContextCard>

        {/* Insurance */}
        <ContextCard icon={<ShieldCheck className="w-3.5 h-3.5" />} title="Insurance">
          <div className="text-[12px] text-slate-700">{ins.summaryLine}</div>
          {ins.memberId && (
            <div className="mt-0.5 text-[11px] text-slate-500">Member {ins.memberId}</div>
          )}
        </ContextCard>

        {/* Clinical context */}
        <ContextCard icon={<Stethoscope className="w-3.5 h-3.5" />} title="Active Problems">
          {diagnoses.length === 0 ? (
            <div className="text-[11px] text-slate-400">None recorded.</div>
          ) : (
            <div className="flex flex-wrap gap-1">
              {diagnoses.map((dx, i) => (
                <span key={i} className="inline-flex items-center rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700">
                  {dx.icd10 ? `${dx.icd10} · ` : ""}{dx.description || "—"}
                </span>
              ))}
            </div>
          )}
        </ContextCard>

        {/* Plexus IQ */}
        <ContextCard icon={<Sparkles className="w-3.5 h-3.5" />} title="Plexus IQ">
          {iqStatus && (
            <div className="mb-1.5">
              <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                {String(iqStatus).replace(/_/g, " ")}
              </span>
            </div>
          )}
          {tests.length === 0 ? (
            <div className="text-[11px] text-slate-400">No current qualifying tests.</div>
          ) : (
            <div className="flex flex-wrap gap-1">
              {tests.map((t, i) => (
                <span key={i} className="inline-flex items-center rounded-md bg-[#E8EEF8] px-1.5 py-0.5 text-[11px] text-[#263B63]">
                  {t.testName}{t.approvalRequired ? " *" : ""}
                </span>
              ))}
            </div>
          )}
        </ContextCard>
      </div>
    </aside>
  );
}

function ContextCard({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200/70 shadow-sm">
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        <span className="text-slate-400">{icon}</span>
        {title}
      </div>
      {children}
    </div>
  );
}
