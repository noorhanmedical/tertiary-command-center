import { ReactNode } from "react";
import { DollarSign, ClipboardList, PhoneCall, ArrowRight } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import { usePortal, type ActivePage } from "./portalContext";
import {
  FINANCE_KPIS, NOTES, ORDERS, ENGAGEMENT_KPIS,
} from "./mockData";

interface TileKpi { label: string; value: string }

function CommandTile({
  page, title, subtitle, icon, accent, kpis, extra,
}: {
  page: ActivePage;
  title: string;
  subtitle: string;
  icon: ReactNode;
  accent: string;
  kpis: TileKpi[];
  extra?: ReactNode;
}) {
  const { setActivePage } = usePortal();
  return (
    <button
      type="button"
      onClick={() => setActivePage(page)}
      className="group flex h-full flex-col rounded-[14px] border border-finance-border bg-white p-5 text-left shadow-[0_1px_3px_rgba(16,17,20,0.06)] transition-all hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(16,17,20,0.10)]"
      data-testid={`tile-${page}`}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-[12px]" style={{ backgroundColor: `${accent}1A`, color: accent }}>
            {icon}
          </div>
          <div>
            <h3 className="text-lg font-semibold text-finance-text">{title}</h3>
            <p className="text-sm text-finance-text-muted">{subtitle}</p>
          </div>
        </div>
        <ArrowRight className="h-5 w-5 text-finance-text-muted transition-transform group-hover:translate-x-1" />
      </div>

      <div className="mt-5 grid grid-cols-3 gap-x-4">
        {kpis.map((k) => (
          <div key={k.label}>
            <div className="text-xl font-semibold tabular-nums text-finance-text">{k.value}</div>
            <div className="mt-0.5 text-[11px] uppercase tracking-wide text-finance-text-muted">{k.label}</div>
          </div>
        ))}
      </div>

      {extra && <div className="mt-4 border-t border-finance-border pt-4">{extra}</div>}
    </button>
  );
}

export function DashboardHome() {
  const { signedToday } = usePortal();

  const notesNeedingSig = NOTES.filter((n) => n.status === "Needs Signature").length;
  const ordersPending = ORDERS.filter((o) => o.status === "Pending Review").length;

  const financeKpis: TileKpi[] = [
    { label: "Ancillary Rev MTD", value: formatCurrency(FINANCE_KPIS.ancillaryRevenueMtd.value) },
    { label: "Claims Paid", value: String(FINANCE_KPIS.claimsPaidMtd.value) },
    { label: "Pending Claims", value: String(FINANCE_KPIS.pendingSubmittedClaims.value) },
  ];

  const ordersKpis: TileKpi[] = [
    { label: "Needs Signature", value: String(notesNeedingSig) },
    { label: "Orders Pending", value: String(ordersPending) },
    { label: "Signed Today", value: String(signedToday) },
  ];

  const engagementKpis: TileKpi[] = [
    { label: "Active Calls", value: String(ENGAGEMENT_KPIS.activeCallList) },
    { label: "Calls Today", value: String(ENGAGEMENT_KPIS.callsCompletedToday) },
    { label: "Scheduled", value: String(ENGAGEMENT_KPIS.scheduledToday) },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-finance-text" data-testid="text-portal-title">Command Center</h1>
        <p className="text-sm text-finance-text-muted">Dr. J. Taylor · TFP — Humble · Pick a workspace to get started.</p>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <CommandTile
          page="finance"
          title="Finance"
          subtitle="Ancillary & practice financials"
          icon={<DollarSign className="h-5 w-5" />}
          accent="#7589B8"
          kpis={financeKpis}
        />
        <CommandTile
          page="orders-notes"
          title="Orders & Notes"
          subtitle="Sign, review & document"
          icon={<ClipboardList className="h-5 w-5" />}
          accent="#8B5CF6"
          kpis={ordersKpis}
        />
        <CommandTile
          page="engagement"
          title="Plexus Engagement"
          subtitle="Call list & outreach pipeline"
          icon={<PhoneCall className="h-5 w-5" />}
          accent="#2E9E6A"
          kpis={engagementKpis}
        />
      </div>
    </div>
  );
}
