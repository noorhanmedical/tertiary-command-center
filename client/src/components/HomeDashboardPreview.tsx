// Winter / Alpine Home (spec redesign) — staged at /home-preview.
//
// Presentation-only redesign of the Home surface into the premium winter system:
// icy canvas + drifting snow, a page header, the six-KPI Practice Pulse panel,
// a dark Plexus IQ feature card, a frosted Global Clocks panel, a Today's Summary
// card, and three grouped shortcut sections (Clinical / Operations /
// Finance & Admin). The month calendar is intentionally not part of this layout.
//
// No routes, hrefs, module names, or data behavior change. All shortcut hrefs and
// data-testids are preserved; new tiles only point at routes that already exist
// (verified against GlobalNav's NAV_ITEMS). Winter styling tokens live under the
// `.winter-home` scope in index.css.
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  BarChart3,
  Clock,
  CreditCard,
  CheckSquare,
  ClipboardCheck,
  FileSignature,
  FileText,
  Landmark,
  Library,
  Phone,
  Radar,
  Receipt,
  ScanLine,
  Shield,
  Sparkles,
  Stethoscope,
  Upload,
  Users,
  Users2,
} from "lucide-react";
import { HomeLiveDashboardPreview } from "./HomeLiveDashboardPreview";
import { HomeWorldClocks } from "./HomeWorldClocks";
import { useHomeStats } from "@/hooks/api/home-stats";

// ── Public types (kept so home-preview.tsx's `type` import stays valid) ────────
type DayPatient = { id: number; batchId: number; name: string; time: string | null; ancillaries: string[] };
type ClinicMonthCell = { isoDate: string; patientCount: number; ancillaryCount: number; patients?: DayPatient[] };
type ClinicTab = {
  clinicKey: string;
  clinicLabel: string;
  scheduler: { id: string; name: string; initials: string } | null;
  weekDays: { isoDate: string; patientCount: number; ancillaryCount: number; ancillaryBreakdown: Record<string, number>; providerNames: string[] }[];
  monthCells: ClinicMonthCell[];
};
export type ScheduleDashboardResponse = {
  today: string;
  weekStart: string;
  previousWeekStart: string;
  nextWeekStart: string;
  clinicTabs: ClinicTab[];
};

interface HomeDashboardPreviewProps {
  batches: { id: number }[];
  dashboardData: ScheduleDashboardResponse | undefined;
  dashboardLoading: boolean;
  dashboardWeekOverride: string | null;
  setDashboardWeekOverride: (v: string | null) => void;
  dashboardClinicKey: string | null;
  setDashboardClinicKey: (v: string | null) => void;
  onOpenSidebar: () => void;
  onOpenSchedule: (batchId: number) => void;
}

// ── Shortcut tiles (§18) ───────────────────────────────────────────────────────
const TILE_ICON = "w-5 h-5 shrink-0";
const TILE_ICON_STYLE = { color: "var(--w-navy-light)" } as const;

type Shortcut = { href: string; label: string; icon: React.ReactNode; testId: string };

const CLINICAL_SHORTCUTS: Shortcut[] = [
  { href: "/mission-control", label: "Mission Control", testId: "tile-mission-control", icon: <Radar className={TILE_ICON} style={TILE_ICON_STYLE} strokeWidth={1.75} /> },
  { href: "/patient-directory", label: "Plexus EHR", testId: "tile-patient-directory", icon: <Users className={TILE_ICON} style={TILE_ICON_STYLE} strokeWidth={1.75} /> },
  { href: "/imaging-central", label: "Imaging Central", testId: "tile-imaging-central", icon: <ScanLine className={TILE_ICON} style={TILE_ICON_STYLE} strokeWidth={1.75} /> },
  { href: "/engagement-center", label: "Engagement Center", testId: "tile-engagement-center", icon: <Phone className={TILE_ICON} style={TILE_ICON_STYLE} strokeWidth={1.75} /> },
  { href: "/clinic-analytics", label: "Clinic Analytics", testId: "tile-clinic-analytics", icon: <BarChart3 className={TILE_ICON} style={TILE_ICON_STYLE} strokeWidth={1.75} /> },
  { href: "/team-ops", label: "Team Ops", testId: "tile-team-ops", icon: <Stethoscope className={TILE_ICON} style={TILE_ICON_STYLE} strokeWidth={1.75} /> },
];

const OPERATIONS_SHORTCUTS: Shortcut[] = [
  { href: "/ancillary-documents", label: "Ancillary Documents", testId: "tile-documents", icon: <FileText className={TILE_ICON} style={TILE_ICON_STYLE} strokeWidth={1.75} /> },
  { href: "/clinic-onboarding", label: "Clinic Onboarding", testId: "tile-clinic-onboarding", icon: <ClipboardCheck className={TILE_ICON} style={TILE_ICON_STYLE} strokeWidth={1.75} /> },
  { href: "/plexus-tasks", label: "Plexus Tasks", testId: "tile-plexus-tasks", icon: <CheckSquare className={TILE_ICON} style={TILE_ICON_STYLE} strokeWidth={1.75} /> },
  { href: "/document-library", label: "Document Library", testId: "tile-document-library", icon: <Library className={TILE_ICON} style={TILE_ICON_STYLE} strokeWidth={1.75} /> },
  { href: "/team-member-portals", label: "Team Portals", testId: "tile-team-member-portals", icon: <Users2 className={TILE_ICON} style={TILE_ICON_STYLE} strokeWidth={1.75} /> },
  { href: "/document-upload", label: "Document Upload", testId: "tile-document-upload", icon: <Upload className={TILE_ICON} style={TILE_ICON_STYLE} strokeWidth={1.75} /> },
];

const FINANCE_SHORTCUTS: Shortcut[] = [
  { href: "/billing", label: "Billing", testId: "tile-billing", icon: <CreditCard className={TILE_ICON} style={TILE_ICON_STYLE} strokeWidth={1.75} /> },
  { href: "/invoices", label: "Invoices", testId: "tile-invoices", icon: <Receipt className={TILE_ICON} style={TILE_ICON_STYLE} strokeWidth={1.75} /> },
  { href: "/plexus-bank", label: "Plexus Bank", testId: "tile-plexus-bank", icon: <Landmark className={TILE_ICON} style={TILE_ICON_STYLE} strokeWidth={1.75} /> },
  { href: "/admin/settings", label: "Admin", testId: "tile-admin", icon: <Shield className={TILE_ICON} style={TILE_ICON_STYLE} strokeWidth={1.75} /> },
];

function ShortcutTile({ href, icon, label, testId }: Shortcut) {
  return (
    <Link href={href}>
      <div
        className="winter-tile flex items-center gap-3 px-4 py-3.5 min-h-[58px] cursor-pointer"
        data-testid={testId}
      >
        {icon}
        <span
          className="text-[13px] font-medium leading-tight"
          style={{ color: "var(--w-text)" }}
        >
          {label}
        </span>
      </div>
    </Link>
  );
}

// Clinician Portal keeps its role gate + signature badge (§19 · Clinical).
function ClinicianPortalTile() {
  const { data: me } = useQuery<{ role?: string }>({ queryKey: ["/api/auth/me"] });
  const role = me?.role;
  const enabled = role === "admin" || role === "clinician";
  const { data: summary } = useQuery<{ needsSignature: number; reportsPending: number; pendingAR: number }>({
    queryKey: ["/api/physician-portal/summary"],
    enabled,
  });
  if (!enabled) return null;
  const needs = summary?.needsSignature ?? 0;
  return (
    <Link href="/clinician-portal">
      <div
        className="winter-tile flex items-center gap-3 px-4 py-3.5 min-h-[58px] cursor-pointer"
        data-testid="tile-clinician-portal"
      >
        <span className="relative shrink-0">
          <FileSignature className={TILE_ICON} style={TILE_ICON_STYLE} strokeWidth={1.75} />
          {needs > 0 && (
            <span
              className="absolute -top-1.5 -right-1.5 min-w-[16px] h-[16px] px-1 rounded-full text-white text-[10px] font-semibold flex items-center justify-center tabular-nums"
              style={{ background: "var(--w-blue)" }}
              data-testid="badge-clinician-needs-signature"
            >
              {needs}
            </span>
          )}
        </span>
        <span className="text-[13px] font-medium leading-tight" style={{ color: "var(--w-text)" }}>
          Clinician Portal
        </span>
      </div>
    </Link>
  );
}

function ShortcutGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="winter-panel-soft p-3.5">
      <div
        className="text-[10px] font-semibold uppercase tracking-[0.12em] px-1 pb-3"
        style={{ color: "var(--w-text-2)" }}
      >
        {label}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{children}</div>
    </div>
  );
}

// ── Plexus IQ dark feature card (§14) ─────────────────────────────────────────
function PlexusIqCard() {
  return (
    <Link href="/plexus-iq" data-testid="tile-plexus-iq" className="block h-full">
      <div className="winter-feature-dark group h-full p-6 md:p-7 flex flex-col sm:flex-row sm:items-center gap-5">
        <span className="w-12 h-12 rounded-xl bg-white/10 ring-1 ring-white/20 flex items-center justify-center shrink-0">
          <Sparkles className="w-6 h-6 text-white" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[22px] font-medium text-white leading-tight tracking-tight">
            Plexus IQ
          </div>
          <p className="mt-1 text-[13px] leading-5" style={{ color: "rgba(255,255,255,0.68)" }}>
            Build, qualify, and review schedules.
          </p>
        </div>
        <span
          className="inline-flex items-center gap-1.5 h-10 px-4 rounded-[10px] bg-white text-[13px] font-semibold self-start sm:self-center shrink-0 transition-colors group-hover:bg-[#F4F8FC]"
          style={{ color: "var(--w-text)" }}
        >
          Open Plexus IQ
          <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" strokeWidth={2} />
        </span>
      </div>
    </Link>
  );
}

// ── Today's Summary (§16) — real today-window values from useHomeStats ─────────
function TodaySummary() {
  const { data } = useHomeStats();
  const t = data?.windows.today;
  const rows: { label: string; value: number; key: string }[] = [
    { label: "Patients", value: t?.patients ?? 0, key: "patients" },
    { label: "Ancillaries", value: t?.ancillaries ?? 0, key: "ancillaries" },
    { label: "Calls", value: t?.callsPlanned ?? 0, key: "calls" },
  ];
  return (
    <div className="winter-panel-soft p-[18px]" data-testid="today-summary">
      <div
        className="text-[13px] font-semibold uppercase tracking-[0.08em] pb-3"
        style={{ color: "var(--w-text)" }}
      >
        Today's Summary
      </div>
      <div className="space-y-2">
        {rows.map((r) => (
          <div
            key={r.key}
            className="flex items-center justify-between rounded-[10px] px-3 h-[40px]"
            style={{ background: "#F7FAFD" }}
          >
            <span className="text-[13px]" style={{ color: "var(--w-text-2)" }}>
              {r.label}
            </span>
            <span
              className="text-[15px] font-semibold tabular-nums"
              style={{ color: "var(--w-blue)" }}
              data-testid={`today-summary-${r.key}`}
            >
              {r.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function HomeDashboardPreview({ batches, onOpenSidebar }: HomeDashboardPreviewProps) {
  return (
    <div className="winter-home winter-canvas flex flex-col h-full" data-testid="home-dashboard">
      <main className="relative z-[1] flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-[1600px] px-4 sm:px-6 lg:px-8 pt-7 pb-16">
          <div className="space-y-6">
            {/* Page header (§11) — sits directly on the icy canvas */}
            <div className="mt-2">
              <h1
                className="text-[34px] font-normal leading-[42px] tracking-tight"
                style={{ color: "var(--w-text)" }}
                data-testid="text-home-title"
              >
                Home
              </h1>
              <p className="mt-1 text-[13px] leading-5" style={{ color: "var(--w-text-muted)" }}>
                Taylor Family Practice
              </p>
            </div>

            {/* Priority 1 — Practice Pulse: largest frosted surface (§12) */}
            <HomeLiveDashboardPreview />

            {/* Priority 2 + 3 — Plexus IQ feature banner (~2/3) beside the
                compact Today's Summary (~1/3). Plexus IQ is the only dark card
                and reads as second only to Practice Pulse. */}
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-6 items-stretch">
              <PlexusIqCard />
              <TodaySummary />
            </div>

            {/* Priority 4 — Global Clocks: quiet full-width utility strip */}
            <div className="winter-panel-soft px-5 py-4" data-testid="home-world-clocks">
              <div className="flex items-center gap-2 pb-3">
                <Clock className="w-3.5 h-3.5" style={{ color: "var(--w-text-muted)" }} strokeWidth={2} />
                <span
                  className="text-[11px] font-semibold uppercase tracking-[0.12em]"
                  style={{ color: "var(--w-text-2)" }}
                >
                  Global Clocks
                </span>
              </div>
              <HomeWorldClocks variant="winter" />
            </div>

            {/* Priority 5 — Grouped shortcuts (§17–§19) */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
              <ShortcutGroup label="Clinical">
                <ClinicianPortalTile />
                {CLINICAL_SHORTCUTS.map((s) => (
                  <ShortcutTile key={s.href} {...s} />
                ))}
              </ShortcutGroup>
              <ShortcutGroup label="Operations">
                {OPERATIONS_SHORTCUTS.map((s) => (
                  <ShortcutTile key={s.href} {...s} />
                ))}
              </ShortcutGroup>
              <ShortcutGroup label="Finance & Admin">
                {FINANCE_SHORTCUTS.map((s) => (
                  <ShortcutTile key={s.href} {...s} />
                ))}
              </ShortcutGroup>
            </div>
          </div>

          {batches.length > 0 && (
            <div className="mt-8">
              <Button
                variant="outline"
                size="sm"
                onClick={onOpenSidebar}
                className="gap-2 text-sm bg-white/70 hover:bg-white/90"
                data-testid="button-view-history"
              >
                <Clock className="w-4 h-4" />
                Schedule History ({batches.length})
              </Button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
