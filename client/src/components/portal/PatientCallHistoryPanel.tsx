import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Loader2, PhoneCall } from "lucide-react";

// Phase 1 Segment E Batch 7 — flag-gated, read-only call-history
// section rendered inside the existing patient panel. Reads from
// the existing GET /api/portal/calls endpoint (Batch I) which is
// itself gated server-side by USE_PORTAL_CALL_HISTORY_READ.
//
// No writes. No new endpoint. Inert (returns null) when the flag is
// OFF. See:
//   docs/architecture/team-portal-panel-playground-protection-contract.md

type CallEnvelope = {
  id: number | string;
  patientScreeningId: number;
  outcome: string | null;
  notes: string | null;
  callbackAt: string | null;
  attemptNumber: number | null;
  durationSeconds: number | null;
  startedAt: string | null;
};

type CallHistoryResponse = {
  patientScreeningId: number;
  calls: CallEnvelope[];
};

const CALL_HISTORY_READ_ENABLED = (() => {
  const v = (import.meta as { env?: Record<string, unknown> }).env
    ?.VITE_USE_PATIENT_CALL_HISTORY_READ;
  return v === "1" || v === "true" || v === "yes";
})();

function formatStarted(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function formatDuration(seconds: number | null): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function PatientCallHistoryPanel({
  patientScreeningId,
}: {
  patientScreeningId: number;
}) {
  if (!CALL_HISTORY_READ_ENABLED) return null;
  const { data, isLoading, isError } = useQuery<CallHistoryResponse>({
    queryKey: ["portal-call-history", patientScreeningId],
    queryFn: async () => {
      const res = await fetch(`/api/portal/calls?patientScreeningId=${patientScreeningId}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`call-history fetch failed: ${res.status}`);
      return (await res.json()) as CallHistoryResponse;
    },
    refetchInterval: 60_000,
  });

  return (
    <Card className="p-4 bg-white" data-testid="patient-call-history-panel">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold text-slate-900">Call history</div>
        <PhoneCall className="h-4 w-4 text-slate-400" />
      </div>
      {isLoading ? (
        <div className="flex items-center text-xs text-slate-500" data-testid="patient-call-history-loading">
          <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
          Loading…
        </div>
      ) : isError ? (
        <div className="text-xs text-slate-400" data-testid="patient-call-history-empty">
          Call history unavailable.
        </div>
      ) : !data || data.calls.length === 0 ? (
        <div className="text-xs text-slate-400" data-testid="patient-call-history-empty">
          No call attempts logged yet.
        </div>
      ) : (
        <ul className="space-y-2" data-testid="patient-call-history-list">
          {data.calls.map((c) => {
            const duration = formatDuration(c.durationSeconds);
            return (
              <li
                key={String(c.id)}
                className="rounded-xl border border-slate-200 bg-slate-50/60 p-2.5"
                data-testid={`patient-call-history-row-${c.id}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[12px] font-medium text-slate-800">
                    {c.outcome ?? "—"}
                    {c.attemptNumber != null && (
                      <span className="ml-1.5 text-[11px] font-normal text-slate-500">
                        · attempt #{c.attemptNumber}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500">{formatStarted(c.startedAt)}</div>
                </div>
                {(duration || c.callbackAt) && (
                  <div className="mt-0.5 text-[11px] text-slate-500">
                    {duration ? <span>{duration}</span> : null}
                    {duration && c.callbackAt ? <span> · </span> : null}
                    {c.callbackAt ? <span>callback {formatStarted(c.callbackAt)}</span> : null}
                  </div>
                )}
                {c.notes ? (
                  <div className="mt-1 text-[12px] text-slate-700 whitespace-pre-wrap break-words">
                    {c.notes}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
