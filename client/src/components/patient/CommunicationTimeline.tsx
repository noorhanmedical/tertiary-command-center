// CommunicationTimeline — Phase 2 PR 2.8.
//
// Read-only timeline of patient communications: calls (from
// call_result_logged), emails + marketing sends (from document_sent
// with metadata.communication_kind). Reads from canonical
// /api/patient-journey-events keyed by patientScreeningId.

import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Loader2, Phone, Mail, Megaphone, FileText } from "lucide-react";

type JourneyRow = {
  id: number;
  eventType: string;
  eventSource: string;
  summary: string | null;
  createdAt: string;
  metadata: Record<string, unknown> | null;
};

type Props = { patientScreeningId: number };

function iconFor(eventType: string, kind: string | undefined) {
  if (eventType === "call_result_logged") return Phone;
  if (kind === "email") return Mail;
  if (kind === "marketing_material") return Megaphone;
  return FileText;
}

function fmt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export function CommunicationTimeline({ patientScreeningId }: Props) {
  const { data: rows = [], isLoading, isError } = useQuery<JourneyRow[]>({
    queryKey: ["communication-timeline", patientScreeningId],
    queryFn: async () => {
      const res = await fetch(
        `/api/patient-journey-events?patientScreeningId=${patientScreeningId}&limit=100`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const all = (await res.json()) as JourneyRow[];
      return all.filter(
        (r) =>
          r.eventType === "call_result_logged" ||
          (r.eventType === "document_sent" &&
            r.metadata != null &&
            typeof (r.metadata as Record<string, unknown>).communication_kind === "string"),
      );
    },
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <Card className="p-3 bg-white" data-testid="communication-timeline-loading">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading timeline…
        </div>
      </Card>
    );
  }
  if (isError || rows.length === 0) return null;

  return (
    <Card className="p-3 bg-white" data-testid="communication-timeline">
      <div className="mb-2 text-sm font-semibold text-slate-900">Communication timeline</div>
      <ul className="space-y-2">
        {rows.map((r) => {
          const meta = (r.metadata ?? {}) as Record<string, unknown>;
          const kind = meta.communication_kind as string | undefined;
          const Icon = iconFor(r.eventType, kind);
          return (
            <li
              key={r.id}
              className="flex items-start gap-2 text-[12px] text-slate-800"
              data-testid={`communication-timeline-row-${r.id}`}
            >
              <Icon className="h-3.5 w-3.5 shrink-0 mt-0.5 text-slate-500" />
              <div className="min-w-0">
                <div>{r.summary ?? r.eventType}</div>
                <div className="text-[10px] text-slate-500">
                  {fmt(r.createdAt)}
                  {meta.recipient ? ` · to ${String(meta.recipient)}` : ""}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
