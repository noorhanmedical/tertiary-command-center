import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

interface ServiceMetrics {
  serviceType: string;
  screened: number;
  qualified: number;
  contacted: number;
  scheduled: number;
  completed: number;
  reportsUploaded: number;
  signed: number;
  billingReady: number;
  conversionRates: Record<string, number>;
  bottleneckStage: string | null;
}

const STAGES: { key: keyof ServiceMetrics; label: string }[] = [
  { key: "screened", label: "Screened" },
  { key: "qualified", label: "Qualified" },
  { key: "contacted", label: "Contacted" },
  { key: "scheduled", label: "Scheduled" },
  { key: "completed", label: "Completed" },
  { key: "reportsUploaded", label: "Reports" },
  { key: "signed", label: "Signed" },
  { key: "billingReady", label: "Billing Ready" },
];

export function AncillaryMetricsTab() {
  const [clinic, setClinic] = useState("");
  const params = new URLSearchParams();
  if (clinic.trim()) params.set("clinic", clinic.trim());
  const qs = params.toString();

  const { data, isLoading } = useQuery<{ serviceTypes: ServiceMetrics[] }>({
    queryKey: ["/api/physician-portal/ancillary-metrics", clinic],
    queryFn: async () => {
      const res = await fetch(`/api/physician-portal/ancillary-metrics${qs ? `?${qs}` : ""}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load metrics");
      return res.json();
    },
  });

  const services = data?.serviceTypes ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Input
          placeholder="Filter by clinic…"
          value={clinic}
          onChange={(e) => setClinic(e.target.value)}
          className="w-[220px]"
          data-testid="input-metrics-clinic"
        />
      </div>

      {isLoading ? (
        <div className="text-center py-10 text-muted-foreground">Loading…</div>
      ) : services.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground" data-testid="text-metrics-empty">No ancillary activity yet.</div>
      ) : (
        <div className="grid gap-4">
          {services.map((s) => {
            const max = Math.max(s.screened, 1);
            return (
              <Card key={s.serviceType} className="p-5" data-testid={`card-metrics-${s.serviceType}`}>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold">{s.serviceType}</h3>
                  {s.bottleneckStage && (
                    <Badge variant="destructive" data-testid={`badge-bottleneck-${s.serviceType}`}>
                      Bottleneck: {STAGES.find((st) => st.key === s.bottleneckStage)?.label ?? s.bottleneckStage}
                    </Badge>
                  )}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
                  {STAGES.map((stage, idx) => {
                    const value = s[stage.key] as number;
                    const rate = idx > 0 ? s.conversionRates[stage.key as string] : null;
                    const isBottleneck = s.bottleneckStage === stage.key;
                    return (
                      <div
                        key={stage.key as string}
                        className={`rounded-lg border p-3 ${isBottleneck ? "border-red-400 bg-red-50 dark:bg-red-950/30" : "border-border"}`}
                        data-testid={`stage-${s.serviceType}-${stage.key as string}`}
                      >
                        <div className="text-2xl font-bold tabular-nums">{value}</div>
                        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{stage.label}</div>
                        {rate != null && (
                          <div className="text-[11px] text-muted-foreground mt-1">{rate}%</div>
                        )}
                        <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className={`h-full ${isBottleneck ? "bg-red-500" : "bg-primary"}`}
                            style={{ width: `${Math.min(100, (value / max) * 100)}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
