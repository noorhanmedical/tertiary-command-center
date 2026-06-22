import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { formatCurrency } from "@/lib/format";
import { ArrowRight, TrendingUp, TrendingDown } from "lucide-react";

interface PerService {
  serviceType: string;
  unitPrice: number;
  grossCount: number;
  readyCount: number;
  submittedCount: number;
  paidCount: number;
  deniedCount: number;
  estimatedGross: number;
  billingReady: number;
  submitted: number;
  paid: number;
  denied: number;
  pending: number;
}

interface FinancialHealth {
  overall: {
    totalBilled: number; totalPaid: number; pendingAR: number;
    deniedAmount: number; openDenials: number; invoiceCount: number;
    collectionRate: number; denialRate: number;
  };
  plexusContribution: {
    estimatedGross: number; billingReady: number; submitted: number;
    paid: number; denied: number; pending: number; perService: PerService[];
  };
  bottlenecks: { key: string; label: string; count: number; action: string }[];
}

function MetricCard({ label, value, accent, testId }: { label: string; value: string; accent?: string; testId: string }) {
  return (
    <Card className="p-4" data-testid={testId}>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold mt-1 tabular-nums ${accent ?? ""}`}>{value}</div>
    </Card>
  );
}

export function FinancialHealthTab() {
  const { data, isLoading } = useQuery<FinancialHealth>({
    queryKey: ["/api/physician-portal/financial-health"],
    queryFn: async () => {
      const res = await fetch("/api/physician-portal/financial-health", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load financial health");
      return res.json();
    },
  });

  if (isLoading) return <div className="text-center py-10 text-muted-foreground">Loading…</div>;
  if (!data) return <div className="text-center py-10 text-muted-foreground">No financial data.</div>;

  const { overall, plexusContribution: plexus, bottlenecks } = data;

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-sm font-semibold text-muted-foreground mb-3">Practice Overview</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <MetricCard label="Total Billed" value={formatCurrency(overall.totalBilled)} testId="metric-total-billed" />
          <MetricCard label="Total Paid" value={formatCurrency(overall.totalPaid)} accent="text-emerald-600" testId="metric-total-paid" />
          <MetricCard label="Pending A/R" value={formatCurrency(overall.pendingAR)} accent="text-amber-600" testId="metric-pending-ar" />
          <MetricCard label="Collection Rate" value={`${overall.collectionRate}%`} testId="metric-collection-rate" />
          <MetricCard label="Denial Rate" value={`${overall.denialRate}%`} accent="text-red-600" testId="metric-denial-rate" />
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
          <TrendingUp className="w-4 h-4" /> Plexus Ancillary Contribution
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
          <MetricCard label="Est. Gross" value={formatCurrency(plexus.estimatedGross)} testId="metric-plexus-gross" />
          <MetricCard label="Billing Ready" value={formatCurrency(plexus.billingReady)} testId="metric-plexus-ready" />
          <MetricCard label="Submitted" value={formatCurrency(plexus.submitted)} testId="metric-plexus-submitted" />
          <MetricCard label="Paid" value={formatCurrency(plexus.paid)} accent="text-emerald-600" testId="metric-plexus-paid" />
          <MetricCard label="Denied" value={formatCurrency(plexus.denied)} accent="text-red-600" testId="metric-plexus-denied" />
          <MetricCard label="Pending" value={formatCurrency(plexus.pending)} accent="text-amber-600" testId="metric-plexus-pending" />
        </div>
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Service</TableHead>
                <TableHead className="text-right">Unit Price</TableHead>
                <TableHead className="text-right">Est. Gross</TableHead>
                <TableHead className="text-right">Billing Ready</TableHead>
                <TableHead className="text-right">Submitted</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead className="text-right">Pending</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plexus.perService.map((s) => (
                <TableRow key={s.serviceType} data-testid={`row-plexus-${s.serviceType}`}>
                  <TableCell><Badge variant="outline">{s.serviceType}</Badge></TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrency(s.unitPrice)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrency(s.estimatedGross)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrency(s.billingReady)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrency(s.submitted)}</TableCell>
                  <TableCell className="text-right tabular-nums text-emerald-600">{formatCurrency(s.paid)}</TableCell>
                  <TableCell className="text-right tabular-nums text-amber-600">{formatCurrency(s.pending)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
          <TrendingDown className="w-4 h-4" /> Revenue Bottlenecks
        </h3>
        {bottlenecks.length === 0 ? (
          <Card className="p-4 text-sm text-muted-foreground" data-testid="text-no-bottlenecks">No active revenue bottlenecks.</Card>
        ) : (
          <div className="grid gap-2">
            {bottlenecks.map((b) => (
              <Card key={b.key} className="p-4 flex items-center justify-between" data-testid={`bottleneck-${b.key}`}>
                <div className="flex items-center gap-3">
                  <Badge variant="destructive" className="tabular-nums">{b.count}</Badge>
                  <span className="text-sm">{b.label}</span>
                </div>
                <Link href={`/physician-portal?tab=${b.action}`}>
                  <span className="text-sm text-primary inline-flex items-center gap-1 cursor-pointer hover:underline" data-testid={`link-bottleneck-${b.key}`}>
                    Resolve <ArrowRight className="w-3.5 h-3.5" />
                  </span>
                </Link>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
