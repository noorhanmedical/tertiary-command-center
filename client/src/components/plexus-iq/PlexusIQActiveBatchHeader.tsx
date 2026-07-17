import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Clock, Layers, Users, X } from "lucide-react";
import type { PatientScreening, ScreeningBatch } from "@shared/schema";
import type { CalendarSummaryRow } from "@/components/plexus-iq/PlexusIQCalendar";
import { formatDateHeader, formatTime12 } from "@/lib/format";
import {
  batchSourceLabel,
  deriveBatchFlowStatus,
  resolveBatchSource,
  useActiveBatchId,
} from "@/lib/plexusIqBatchSession";

type BatchWithPatients = ScreeningBatch & { patients?: PatientScreening[] };

// Persistent strip shown above the workspace whenever a BatchFlow session
// has an active batch. Surfaces the active batch's created time, patient
// count, source, and qualification status so an operator always knows
// which isolated batch their imports + qualification target.
export function PlexusIQActiveBatchHeader({
  batches,
  summary,
  batchDetails,
  runningBatchIds,
  onChangeBatch,
  onViewBatch,
}: {
  batches: ScreeningBatch[];
  summary: CalendarSummaryRow[];
  batchDetails: Record<number, BatchWithPatients>;
  runningBatchIds: Set<number>;
  onChangeBatch: () => void;
  onViewBatch: (batchId: number, facility: string) => void;
}) {
  const { activeBatchId, clearActive } = useActiveBatchId();

  const batch = useMemo(
    () => batches.find((b) => b.id === activeBatchId) ?? null,
    [batches, activeBatchId],
  );

  const patientCount = useMemo(() => {
    if (!batch) return 0;
    return summary.find((s) => s.id === batch.id)?.patientCount ?? batch.patientCount ?? 0;
  }, [batch, summary]);

  if (activeBatchId == null || !batch) return null;

  const patients = batchDetails[batch.id]?.patients;
  const source = resolveBatchSource(batch.id, patients);
  const status = deriveBatchFlowStatus(patients, {
    isRunning: runningBatchIds.has(batch.id),
  });

  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-indigo-100 bg-indigo-50/70 px-4 py-2.5"
      data-testid="plexus-iq-active-batch-header"
    >
      <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-indigo-700">
        <Layers className="h-3.5 w-3.5" />
        Active batch
      </span>
      <button
        type="button"
        className="truncate text-sm font-semibold text-slate-900 hover:underline"
        onClick={() => onViewBatch(batch.id, batch.facility ?? "")}
        data-testid="button-active-batch-view"
      >
        {batch.facility ?? "Unassigned clinic"}
        {batch.scheduleDate ? ` • ${formatDateHeader(batch.scheduleDate)}` : ""}
      </button>
      <span className="inline-flex items-center gap-1 text-xs text-slate-600">
        <Clock className="h-3 w-3" />
        {formatTime12(batch.createdAt)}
      </span>
      <span className="inline-flex items-center gap-1 text-xs text-slate-600">
        <Users className="h-3 w-3" />
        {patientCount} patient{patientCount === 1 ? "" : "s"}
      </span>
      <span className="text-xs text-slate-600">{batchSourceLabel(source)}</span>
      <Badge
        variant="outline"
        className={`text-[10px] font-semibold ${status.pillClass}`}
        data-testid="active-batch-status"
      >
        {status.label}
      </Badge>
      <div className="ml-auto flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs text-indigo-700 hover:bg-indigo-100"
          onClick={onChangeBatch}
          data-testid="button-active-batch-change"
        >
          Change batch
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-slate-500 hover:bg-indigo-100"
          onClick={() => clearActive()}
          data-testid="button-active-batch-clear"
          title="Clear active batch"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
