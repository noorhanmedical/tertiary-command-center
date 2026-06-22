import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Stethoscope, PenLine, FileText, BarChart3, DollarSign } from "lucide-react";
import { SignaturesTab } from "./SignaturesTab";
import { ReportsTab } from "./ReportsTab";
import { AncillaryMetricsTab } from "./AncillaryMetricsTab";
import { FinancialHealthTab } from "./FinancialHealthTab";

interface Summary {
  needsSignature: number;
  reportsPending: number;
  pendingAR: number;
}

const VALID_TABS = ["signatures", "reports", "metrics", "financial"];

export function PhysicianPortalShell() {
  const [location] = useLocation();
  const initial = (() => {
    const t = new URLSearchParams(location.split("?")[1] ?? "").get("tab");
    return t && VALID_TABS.includes(t) ? t : "signatures";
  })();
  const [tab, setTab] = useState(initial);

  useEffect(() => {
    const t = new URLSearchParams(location.split("?")[1] ?? "").get("tab");
    if (t && VALID_TABS.includes(t)) setTab(t);
  }, [location]);

  const { data: summary } = useQuery<Summary>({
    queryKey: ["/api/physician-portal/summary"],
    queryFn: async () => {
      const res = await fetch("/api/physician-portal/summary", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load summary");
      return res.json();
    },
  });

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="rounded-xl bg-primary/10 p-2.5">
          <Stethoscope className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-portal-title">Physician Owner Portal</h1>
          <p className="text-sm text-muted-foreground">Sign notes, review reports, and track ancillary performance &amp; revenue.</p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-6">
          <TabsTrigger value="signatures" data-testid="tab-signatures">
            <PenLine className="w-4 h-4 mr-2" /> Signatures
            {summary && summary.needsSignature > 0 && (
              <Badge variant="destructive" className="ml-2 tabular-nums">{summary.needsSignature}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="reports" data-testid="tab-reports">
            <FileText className="w-4 h-4 mr-2" /> Results / Reports
            {summary && summary.reportsPending > 0 && (
              <Badge variant="secondary" className="ml-2 tabular-nums">{summary.reportsPending}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="metrics" data-testid="tab-metrics">
            <BarChart3 className="w-4 h-4 mr-2" /> Ancillary Metrics
          </TabsTrigger>
          <TabsTrigger value="financial" data-testid="tab-financial">
            <DollarSign className="w-4 h-4 mr-2" /> Financial Health
          </TabsTrigger>
        </TabsList>

        <TabsContent value="signatures"><SignaturesTab /></TabsContent>
        <TabsContent value="reports"><ReportsTab /></TabsContent>
        <TabsContent value="metrics"><AncillaryMetricsTab /></TabsContent>
        <TabsContent value="financial"><FinancialHealthTab /></TabsContent>
      </Tabs>
    </div>
  );
}
