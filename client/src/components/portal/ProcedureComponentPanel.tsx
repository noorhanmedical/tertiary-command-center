// ACS Procedure execution + structured component capture.
//
// First-class ACS workflow module (not a hidden utility). It reads the CANONICAL
// procedure event (GET /api/procedure-events) and lets the specialist:
//   • see the procedure status (not started / in progress / complete),
//   • complete the procedure (POST /api/procedure-events/complete — canonical,
//     server-authorized, tenant-safe; generates the Procedure Note),
//   • for BrainWave / VitalWave, record the STRUCTURED components that were
//     actually performed (POST /api/procedure-events/:id/components), which
//     enriches the canonical Procedure Note and unblocks billing.
//
// It NEVER fabricates findings: only the components the user marks performed are
// recorded, and the note claims only performed components. No parallel procedure
// state — everything is the canonical procedure_events row + canonical routes.

import { useMemo, useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Activity, Check, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  listProcedureEventsApi,
  markProcedureCompleteApi,
  getProcedureComponentsApi,
  saveProcedureComponentsApi,
  type ProcedureEventDto,
  type ComponentEntry,
  type ProcedureComponentsPayload,
} from "@/lib/workflow/procedureEventsApi";

type Props = {
  executionCaseId: number | null;
  patientScreeningId: number | null;
  serviceKey: string | null;
  facilityId: string | number | null;
  patientName: string | null;
  onChanged?: () => void;
};

// Human-readable component sets keyed to the canonical schema field names.
const BRAINWAVE_FIELDS: Array<{ key: string; label: string; eeg?: boolean }> = [
  { key: "neuropsychologicalTesting", label: "Neuropsychological testing (memory / attention / executive)" },
  { key: "eeg", label: "EEG (21-channel cap)", eeg: true },
  { key: "ecg", label: "ECG" },
  { key: "vep", label: "VEP (visual evoked potentials)" },
  { key: "aep", label: "AEP (auditory evoked potentials)" },
];
const VITALWAVE_FIELDS: Array<{ key: string; label: string; eeg?: boolean }> = [
  { key: "autonomicTesting", label: "Autonomic testing (parasympathetic / sympathetic)" },
  { key: "tiltTable", label: "Tilt / positional testing" },
  { key: "bloodPressureHeartRateMonitoring", label: "Blood pressure / heart-rate monitoring" },
  { key: "segmentalPressures", label: "Arterial physiologic / segmental pressures" },
  { key: "waveformAnalysis", label: "Waveform analysis" },
  { key: "rhythmEcg", label: "Rhythm ECG" },
];

function serviceComponentKind(serviceType: string): "brainwave" | "vitalwave" | null {
  const s = (serviceType || "").toLowerCase();
  if (s.includes("brain")) return "brainwave";
  if (s.includes("vital")) return "vitalwave";
  return null;
}

const STATUS_LABEL: Record<string, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  paused: "Paused",
  complete: "Complete",
  cancelled: "Cancelled",
  no_show: "No-show",
  unable_to_complete: "Unable to complete",
};

export function ProcedureComponentPanel({
  executionCaseId,
  patientScreeningId,
  serviceKey,
  facilityId,
  patientName,
  onChanged,
}: Props) {
  const queryClient = useQueryClient();
  const service = serviceKey ?? "";
  const kind = serviceComponentKind(service);
  const [banner, setBanner] = useState<string | null>(null);

  const eventsKey = ["/api/procedure-events", executionCaseId, service] as const;
  const { data: events, isLoading: eventsLoading } = useQuery<ProcedureEventDto[]>({
    queryKey: eventsKey,
    queryFn: () =>
      listProcedureEventsApi({ executionCaseId, patientScreeningId, serviceType: service || null }),
    enabled: executionCaseId != null || patientScreeningId != null,
    staleTime: 10_000,
  });

  // The canonical event for THIS service (prefer an exact service match).
  const event = useMemo<ProcedureEventDto | null>(() => {
    const rows = events ?? [];
    const exact = rows.find((r) => (r.serviceType ?? "").toLowerCase() === service.toLowerCase());
    return exact ?? rows[0] ?? null;
  }, [events, service]);
  const isComplete = (event?.procedureStatus ?? "") === "complete";

  const completeMut = useMutation({
    mutationFn: () =>
      markProcedureCompleteApi({
        serviceType: service,
        executionCaseId: executionCaseId ?? null,
        patientScreeningId: patientScreeningId ?? null,
        facilityId: facilityId != null ? String(facilityId) : null,
        patientName: patientName ?? null,
      }),
    onSuccess: () => {
      setBanner(null);
      queryClient.invalidateQueries({ queryKey: eventsKey });
      onChanged?.();
    },
    onError: (e: Error) => setBanner(e.message || "Could not complete the procedure."),
  });

  if (executionCaseId == null && patientScreeningId == null) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
        This appointment isn't linked to a patient/case yet, so procedure execution
        can't be recorded. Open the EHR to resolve the linkage first.
      </div>
    );
  }

  return (
    <div data-testid="procedure-component-panel">
      {banner && (
        <div className="mb-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {banner}
        </div>
      )}

      {/* Procedure status */}
      <div className="mb-4 flex items-center gap-2">
        <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
          Procedure status
        </span>
        <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-[#243b64] ring-1 ring-slate-200" data-testid="procedure-status">
          {eventsLoading ? "Loading…" : STATUS_LABEL[event?.procedureStatus ?? ""] ?? (event ? event.procedureStatus : "Not started")}
        </span>
      </div>

      {!isComplete ? (
        <div className="space-y-3">
          <p className="text-xs leading-relaxed text-slate-500">
            Complete the procedure once it has been performed. This records the
            canonical completion instant and generates the Procedure Note for
            physician review. {kind ? "You can then record the structured components that were performed." : ""}
          </p>
          <Button
            type="button"
            size="sm"
            className="h-9 text-xs !bg-[#243b64] !text-white hover:!bg-[#1d3054]"
            disabled={completeMut.isPending}
            onClick={() => completeMut.mutate()}
            data-testid="procedure-complete-button"
          >
            {completeMut.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />}
            Mark Procedure Complete
          </Button>
        </div>
      ) : kind && event ? (
        <ComponentChecklist
          key={event.id}
          procedureEventId={event.id}
          kind={kind}
          onSavedBanner={setBanner}
          onChanged={() => {
            queryClient.invalidateQueries({ queryKey: eventsKey });
            onChanged?.();
          }}
        />
      ) : (
        <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-500" data-testid="procedure-no-components">
          <Check className="h-3.5 w-3.5 text-emerald-600" />
          Procedure complete. This service has no structured component checklist;
          the report and Procedure Note carry its documentation.
        </div>
      )}
    </div>
  );
}

// ── Structured component checklist (BrainWave / VitalWave) ───────────────────
function ComponentChecklist({
  procedureEventId,
  kind,
  onChanged,
  onSavedBanner,
}: {
  procedureEventId: number;
  kind: "brainwave" | "vitalwave";
  onChanged: () => void;
  onSavedBanner: (s: string | null) => void;
}) {
  const fields = kind === "brainwave" ? BRAINWAVE_FIELDS : VITALWAVE_FIELDS;
  const [state, setState] = useState<ProcedureComponentsPayload>({});

  const { data: loaded, isLoading } = useQuery({
    queryKey: ["/api/procedure-events", procedureEventId, "components"],
    queryFn: () => getProcedureComponentsApi(procedureEventId),
    staleTime: 5_000,
  });

  // Seed local state from persisted components once loaded.
  useEffect(() => {
    const persisted = loaded?.components?.components ?? null;
    const seed: ProcedureComponentsPayload = {};
    for (const f of fields) {
      const p = persisted?.[f.key];
      seed[f.key] = {
        performed: p?.performed ?? false,
        ...(f.eeg ? { channelCount: p?.channelCount ?? 21 } : {}),
      };
    }
    setState(seed);
  }, [loaded, kind]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveMut = useMutation({
    mutationFn: () => {
      // Only send the canonical fields for this service.
      const payload: ProcedureComponentsPayload = {};
      for (const f of fields) {
        const cur = state[f.key] ?? { performed: false };
        const entry: ComponentEntry = { performed: !!cur.performed };
        if (cur.performed) entry.completedAt = new Date().toISOString();
        if (f.eeg && cur.performed && typeof cur.channelCount === "number") entry.channelCount = cur.channelCount;
        payload[f.key] = entry;
      }
      return saveProcedureComponentsApi(procedureEventId, payload);
    },
    onSuccess: (r) => {
      onSavedBanner(null);
      onChanged();
    },
    onError: (e: Error) => onSavedBanner(e.message || "Could not save procedure components."),
  });

  const performedCount = fields.filter((f) => state[f.key]?.performed).length;

  function toggle(key: string) {
    setState((s) => ({ ...s, [key]: { ...(s[key] ?? { performed: false }), performed: !s[key]?.performed } }));
  }
  function setChannels(key: string, n: number) {
    setState((s) => ({ ...s, [key]: { ...(s[key] ?? { performed: true }), channelCount: n } }));
  }

  if (isLoading) {
    return <div className="text-xs text-slate-500"><Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" />Loading components…</div>;
  }

  return (
    <div data-testid="procedure-component-checklist">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#243b64]">
        <Activity className="h-3.5 w-3.5" /> Performed components — {kind === "brainwave" ? "BrainWave" : "VitalWave"}
        <span className="ml-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
          {performedCount}/{fields.length}
        </span>
      </div>
      <p className="mb-3 text-[11px] leading-relaxed text-slate-500">
        Record only the components actually performed. The Procedure Note claims
        exactly these — nothing is fabricated. Adverse events and interpretation
        remain the physician's on review.
      </p>

      <div className="space-y-1.5">
        {fields.map((f) => {
          const cur = state[f.key] ?? { performed: false };
          return (
            <div
              key={f.key}
              className="flex items-center justify-between gap-3 rounded-xl bg-white/70 px-3 py-2 ring-1 ring-slate-200"
            >
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={!!cur.performed}
                  onChange={() => toggle(f.key)}
                  className="h-4 w-4 shrink-0 rounded border-slate-300 text-[#243b64] focus:ring-[#243b64]"
                  data-testid={`procedure-component-${f.key}`}
                />
                <span className="truncate text-xs text-[#1e2f4d]">{f.label}</span>
              </label>
              {f.eeg && cur.performed && (
                <label className="flex shrink-0 items-center gap-1.5 text-[11px] text-slate-500">
                  Channels
                  <input
                    type="number"
                    min={1}
                    value={cur.channelCount ?? 21}
                    onChange={(e) => setChannels(f.key, parseInt(e.target.value, 10) || 21)}
                    className="w-16 rounded-md border border-slate-200 px-2 py-1 text-xs text-[#1e2f4d] focus:border-[#243b64] focus:outline-none"
                    data-testid="procedure-component-eeg-channels"
                  />
                </label>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button
          type="button"
          size="sm"
          className="h-9 text-xs !bg-[#243b64] !text-white hover:!bg-[#1d3054]"
          disabled={saveMut.isPending}
          onClick={() => saveMut.mutate()}
          data-testid="procedure-components-save"
        >
          {saveMut.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />}
          Save components
        </Button>
        {saveMut.isSuccess && !saveMut.isPending && (
          <span className="text-[11px] font-medium text-emerald-700" data-testid="procedure-components-saved">
            Saved — Procedure Note updated
          </span>
        )}
      </div>
    </div>
  );
}
