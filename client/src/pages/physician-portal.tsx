// Physician Portal — signatures + reports + ancillary metrics + finance.
//
// - Signatures    → live procedure_notes signature state machine
// - Reports       → live case_document_readiness rows (documentType='report')
// - Ancillary     → live per-service rollup over a scoped window
// - Finance       → intentionally disabled shell that links to canonical
//                   billing surfaces. See FinanceTabDisabled for the
//                   rationale — we do not surface derived KPIs as live
//                   numbers without an audited repo-layered service.

import { PageHeader } from "@/components/PageHeader";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { SignaturesTab } from "@/components/physician/SignaturesTab";
import { ReportsTab } from "@/components/physician/ReportsTab";
import { AncillaryMetricsTab } from "@/components/physician/AncillaryMetricsTab";
import { FinanceTabDisabled } from "@/components/physician/FinanceTabDisabled";

export default function PhysicianPortalPage() {
  return (
    <div className="flex h-full w-full flex-col">
      <PageHeader
        title="Physician Portal"
        subtitle="Signature worklist, reports, ancillary metrics"
      />
      <div className="flex-1 overflow-auto p-6">
        <Tabs defaultValue="signatures" className="w-full">
          <TabsList className="mb-4">
            <TabsTrigger value="signatures" data-testid="physician-tab-signatures">
              Signatures
            </TabsTrigger>
            <TabsTrigger value="reports" data-testid="physician-tab-reports">
              Reports
            </TabsTrigger>
            <TabsTrigger value="ancillary" data-testid="physician-tab-ancillary">
              Ancillary Metrics
            </TabsTrigger>
            <TabsTrigger value="finance" data-testid="physician-tab-finance">
              Finance
            </TabsTrigger>
          </TabsList>
          <TabsContent value="signatures">
            <SignaturesTab />
          </TabsContent>
          <TabsContent value="reports">
            <ReportsTab />
          </TabsContent>
          <TabsContent value="ancillary">
            <AncillaryMetricsTab />
          </TabsContent>
          <TabsContent value="finance">
            <FinanceTabDisabled />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
