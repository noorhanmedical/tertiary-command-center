// PUBLIC read-only Call List share page (Task 8).
//
// Reached via a tokenized URL: /shared-call-list/:token. The token itself is
// the credential (no login, no PIN). It resolves EXACTLY ONE frozen package
// snapshot from GET /api/shared-call-list/:token. Invalid / expired / revoked
// tokens all render the SAME "no longer available" state (the server returns a
// uniform 404). No PHI is in the URL; no navigation into any other patient,
// package, or live system is possible from here.
//
// This page renders the FROZEN snapshot only: roster summary, per-patient
// demographics + ancillaries + qualification summary + Clinician Atlas
// reasoning, and a Download Combined PDF button (streams the durable stored
// PDF from the server — never regenerated client-side here).

import { useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Loader2, FileText, ShieldAlert, Stethoscope } from "lucide-react";

type BoundedReasoning = {
  clinician_understanding?: string;
  qualifying_factors?: string[];
  confidence?: "high" | "medium" | "low";
  pearls?: string[];
};

type SharedMember = {
  patientName: string;
  dob: string | null;
  phone: string | null;
  demographics: {
    age?: number | null;
    gender?: string | null;
    insurance?: string | null;
    facility?: string | null;
    email?: string | null;
    time?: string | null;
  } | null;
  services: string[] | null;
  reasonForCall: string | null;
  cohortClassification: string | null;
  qualificationSummary: { qualifyingTests?: string[]; confidenceByTest?: Record<string, string> } | null;
  atlas: {
    qualifyingTests?: string[];
    reasoning?: Record<string, BoundedReasoning>;
    diagnoses?: string | null;
    history?: string | null;
    medications?: string | null;
  } | null;
};

type SharedPackage = {
  teamMemberName: string | null;
  facility: string | null;
  serviceDate: string | null;
  cohortLabel: string | null;
  patientCount: number;
  summaryMetrics: Record<string, unknown> | null;
  generationStatus: string | null;
  pdfAvailable: boolean;
  members: SharedMember[];
};

const STATUS_LABELS: Record<string, string> = {
  never_called: "Never Called",
  callback_due: "Callback Due",
  lvm: "LVM",
  no_answer: "No Answer",
  reached_not_scheduled: "Reached — Not Scheduled",
  other: "Other",
};

function Unavailable() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="max-w-sm text-center">
        <ShieldAlert className="w-12 h-12 text-slate-300 mx-auto mb-4" />
        <h1 className="text-lg font-semibold text-slate-900" data-testid="shared-call-list-unavailable">
          This link is no longer available
        </h1>
        <p className="text-sm text-slate-500 mt-2">
          The link may have expired, been revoked, or is invalid. Ask your
          manager to generate a fresh link.
        </p>
      </div>
    </div>
  );
}

export default function SharedCallListPage() {
  const [, params] = useRoute("/shared-call-list/:token");
  const token = params?.token ?? null;

  const { data, isLoading, isError } = useQuery<SharedPackage>({
    queryKey: ["/api/shared-call-list", token],
    queryFn: async () => {
      const res = await fetch(`/api/shared-call-list/${encodeURIComponent(token ?? "")}`);
      if (!res.ok) throw new Error("unavailable");
      return res.json();
    },
    enabled: !!token,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
      </div>
    );
  }
  if (isError || !data) return <Unavailable />;

  const dateLabel = data.serviceDate ?? "";

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-[#1a365d] text-white">
        <div className="max-w-4xl mx-auto px-6 py-5 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Stethoscope className="w-5 h-5 text-blue-200" />
              <p className="text-xs uppercase tracking-wider text-blue-200/80">Plexus Call List</p>
            </div>
            <h1 className="text-xl font-bold mt-1 truncate" data-testid="shared-call-list-title">
              {data.teamMemberName ?? "Call List"}
            </h1>
            <p className="text-sm text-blue-100/80">
              {[data.facility, dateLabel, data.cohortLabel].filter(Boolean).join(" · ")}
            </p>
          </div>
          {data.pdfAvailable && (
            <a
              href={`/api/shared-call-list/${encodeURIComponent(token ?? "")}/pdf`}
              className="shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-white/10 hover:bg-white/20 px-3 py-2 text-sm font-medium"
              data-testid="shared-call-list-download-pdf"
            >
              <FileText className="w-4 h-4" /> Download Combined PDF
            </a>
          )}
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-6 space-y-3">
        <div className="text-sm text-slate-600" data-testid="shared-call-list-total">
          {data.patientCount} patient{data.patientCount === 1 ? "" : "s"}
        </div>

        {data.members.map((m, i) => {
          const demo = m.demographics ?? {};
          const demoLine = [
            demo.age != null ? `${demo.age}yo` : "",
            demo.gender ?? "",
            demo.insurance ?? "",
          ]
            .filter(Boolean)
            .join(" · ");
          const reasonLabel = m.cohortClassification
            ? STATUS_LABELS[m.cohortClassification] ?? m.reasonForCall ?? ""
            : m.reasonForCall ?? "";
          const reasoning = m.atlas?.reasoning ?? {};
          return (
            <div
              key={i}
              className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
              data-testid={`shared-call-list-patient-${i}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold text-slate-900">{m.patientName}</div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {[m.dob ? `DOB: ${m.dob}` : "", m.phone ? `Phone: ${m.phone}` : "", demoLine]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                {reasonLabel && (
                  <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                    {reasonLabel}
                  </span>
                )}
              </div>

              {m.services && m.services.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {m.services.map((s, j) => (
                    <span
                      key={j}
                      className="rounded-md bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-800"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              )}

              {(m.atlas?.diagnoses || m.atlas?.history || m.atlas?.medications) && (
                <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-600 space-y-1">
                  {m.atlas?.diagnoses && <div><span className="font-semibold text-slate-500">Dx:</span> {m.atlas.diagnoses}</div>}
                  {m.atlas?.history && <div><span className="font-semibold text-slate-500">Hx:</span> {m.atlas.history}</div>}
                  {m.atlas?.medications && <div><span className="font-semibold text-slate-500">Rx:</span> {m.atlas.medications}</div>}
                </div>
              )}

              {Object.keys(reasoning).length > 0 && (
                <div className="mt-3 space-y-2">
                  {Object.entries(reasoning).map(([test, r]) => (
                    <div key={test} className="border-l-2 border-indigo-200 pl-3">
                      <div className="text-xs font-semibold text-slate-800">{test}</div>
                      {r.clinician_understanding && (
                        <p className="text-xs text-slate-600 mt-0.5">{r.clinician_understanding}</p>
                      )}
                      {r.qualifying_factors && r.qualifying_factors.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {r.qualifying_factors.map((f, k) => (
                            <span key={k} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                              {f}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </main>
    </div>
  );
}
