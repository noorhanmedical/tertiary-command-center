// Admin Settings → API Integration Station — eClinicalWorks foundation.
//
// PHASE 1 SCOPE: this page renders the admin UI + scope/mapping/routing
// model + audit/error shells for the eClinicalWorks FHIR R4 integration.
// It does NOT yet talk to a backend. Every write action is disabled.
// Every list renders an empty state with an explicit "Backend endpoint
// pending" notice.
//
// Phase 2 (separate PR) will add:
//   - server tables (`integration_connections`, `integration_scopes`,
//     `integration_field_mappings`, `integration_clinic_mappings`,
//     `integration_provider_mappings`, `integration_patient_matches`,
//     `integration_sync_jobs`, `integration_sync_errors`,
//     `integration_audit_log`)
//   - credential vault wiring
//   - sync worker (advisory-locked)
//   - normalization pipeline
//
// SAFETY:
//   - No real client secret is ever rendered. The secret field shows a
//     masked vault reference once the backend stores it.
//   - No PHI is rendered. Demo seeds are intentionally empty lists.
//   - No localStorage for credentials.
//
// See `docs/architecture/ecw-fhir-r4-integration-foundation.md` for the
// full Phase 2 plan.

import { useMemo, useState } from "react";
import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Plug,
  ShieldCheck,
  ListChecks,
  Activity,
  Database,
  Search,
  ArrowLeft,
  ChevronRight,
  Cog,
  Building2,
  Users,
  UserCheck,
  CalendarClock,
  FlaskConical,
  FileText,
  CreditCard,
  ClipboardCheck,
  Send,
  AlertTriangle,
  ScrollText,
  Lock,
  Route as RouteIcon,
  Terminal,
  LockKeyhole,
  Layers,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { BackendPendingNotice } from "@/components/api-integrations/BackendPendingNotice";
import {
  IntegrationKpiCard,
  SectionShell,
} from "@/components/api-integrations/SectionShell";
import {
  ECW_RESOURCES,
  ECW_SCOPE_DEFINITIONS,
} from "@/lib/api-integrations/ecw/ecwScopes";
import {
  ECW_FIELD_MAPPINGS,
  getFieldMappingsForResource,
} from "@/lib/api-integrations/ecw/ecwFieldMappings";
import {
  ANCILLARY_ROUTING_DEFAULTS,
  BILLING_READINESS_CHECKLIST,
  DOCUMENT_ROUTING_DEFAULTS,
  PATIENT_MATCH_AUTO_THRESHOLD,
  PATIENT_MATCH_RULES,
  SERVICE_REQUEST_ROUTING_DEFAULTS,
} from "@/lib/api-integrations/ecw/ecwRoutingRules";
import {
  DEMO_AUDIT_LOG,
  DEMO_CLINIC_MAPPINGS,
  DEMO_COVERAGE_MAPPINGS,
  DEMO_PATIENT_IDENTITY_CANDIDATES,
  DEMO_PROVIDER_MAPPINGS,
  DEMO_SYNC_ERRORS,
  DEMO_SYNC_JOBS,
  EMPTY_CONNECTION_PROFILE,
  INITIAL_RESOURCE_COUNTS,
  INITIAL_SCOPE_RUNTIME_STATE,
} from "@/lib/api-integrations/ecw/ecwDemoData";
import type {
  EcwResourceType,
  IntegrationConnectionProfile,
} from "@/lib/api-integrations/ecw/ecwTypes";

// ─────────────────────────────────────────────────────────────────────────
// Section catalog — left rail nav
// ─────────────────────────────────────────────────────────────────────────

type SectionId =
  | "overview"
  | "connection"
  | "scopes"
  | "sync-controls"
  | "resource-counts"
  | "raw-viewer"
  | "field-mapping"
  | "clinic-mapping"
  | "provider-mapping"
  | "patient-identity"
  | "scheduling-mapping"
  | "orders-mapping"
  | "documents-mapping"
  | "insurance-mapping"
  | "billing-readiness"
  | "sync-jobs"
  | "error-center"
  | "audit-log"
  | "security"
  | "routing"
  | "test-console";

interface SectionNavGroup {
  label: string;
  items: { id: SectionId; label: string; Icon: typeof Plug }[];
}

const SECTION_NAV: SectionNavGroup[] = [
  {
    label: "Overview",
    items: [{ id: "overview", label: "API Integration Station", Icon: Layers }],
  },
  {
    label: "eClinicalWorks",
    items: [
      { id: "connection", label: "Connection Profile", Icon: Plug },
      { id: "scopes", label: "Scope Management", Icon: ShieldCheck },
      { id: "sync-controls", label: "Sync Controls", Icon: Activity },
      { id: "resource-counts", label: "Resource Counts", Icon: ListChecks },
      { id: "raw-viewer", label: "Raw FHIR Viewer", Icon: Database },
    ],
  },
  {
    label: "Mappings",
    items: [
      { id: "field-mapping", label: "Field Mapping", Icon: Cog },
      { id: "clinic-mapping", label: "Clinic / Facility", Icon: Building2 },
      { id: "provider-mapping", label: "Provider", Icon: Users },
      { id: "patient-identity", label: "Patient Identity", Icon: UserCheck },
      { id: "scheduling-mapping", label: "Scheduling", Icon: CalendarClock },
      { id: "orders-mapping", label: "Orders / Ancillary", Icon: FlaskConical },
      { id: "documents-mapping", label: "Documents & Reports", Icon: FileText },
      { id: "insurance-mapping", label: "Insurance / Coverage", Icon: CreditCard },
      { id: "billing-readiness", label: "Billing Readiness", Icon: ClipboardCheck },
    ],
  },
  {
    label: "Operations",
    items: [
      { id: "sync-jobs", label: "Sync Jobs", Icon: Send },
      { id: "error-center", label: "Error Center", Icon: AlertTriangle },
      { id: "audit-log", label: "Audit Log", Icon: ScrollText },
      { id: "security", label: "Security & Credentials", Icon: Lock },
      { id: "routing", label: "Downstream Routing", Icon: RouteIcon },
      { id: "test-console", label: "Test Console", Icon: Terminal },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────

export default function AdminApiIntegrationsPage() {
  const { toast } = useToast();
  const [active, setActive] = useState<SectionId>("overview");
  const [profile, setProfile] = useState<IntegrationConnectionProfile>(
    EMPTY_CONNECTION_PROFILE,
  );

  // Phase 1 helper: every backend-pending action funnels through this
  // so the toast copy is consistent and obvious.
  const pendingToast = (action: string) =>
    toast({
      title: "Backend endpoint pending",
      description: `${action} will be wired in Phase 2 (sync worker + credential vault).`,
    });

  // For displaying the current section title in the sticky header.
  const allItems = useMemo(
    () => SECTION_NAV.flatMap((g) => g.items),
    [],
  );
  const activeMeta = allItems.find((i) => i.id === active);

  return (
    <div className="flex flex-col h-full bg-slate-50/40" data-testid="api-integrations-page">
      {/* Sticky page header */}
      <header className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-slate-200 px-6 py-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <Link href="/admin">
              <Button variant="ghost" size="sm" className="-ml-2" data-testid="link-back-to-admin">
                <ArrowLeft className="w-4 h-4 mr-1" /> Admin
              </Button>
            </Link>
            <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500/15 to-blue-500/15 text-indigo-700 shrink-0">
              <Plug className="w-5 h-5" strokeWidth={1.75} />
            </span>
            <div className="min-w-0">
              <h1 className="text-xl font-semibold text-slate-900 truncate" data-testid="text-api-integrations-title">
                API Integration Station
              </h1>
              <p className="text-sm text-slate-500 truncate">
                {activeMeta ? activeMeta.label : "Overview"} · eClinicalWorks FHIR R4
              </p>
            </div>
          </div>
          <Badge variant="outline" className="text-xs" data-testid="badge-phase-1">
            Phase 1 · UI foundation only
          </Badge>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Left rail */}
        <aside className="w-64 shrink-0 border-r border-slate-200 bg-white overflow-y-auto" data-testid="api-integrations-nav">
          <nav className="px-3 py-4 space-y-5">
            {SECTION_NAV.map((group) => (
              <div key={group.label}>
                <div className="px-2 text-[10px] font-semibold tracking-[0.18em] uppercase text-slate-400 mb-1.5">
                  {group.label}
                </div>
                <ul className="space-y-0.5">
                  {group.items.map(({ id, label, Icon }) => {
                    const isActive = active === id;
                    return (
                      <li key={id}>
                        <button
                          type="button"
                          onClick={() => setActive(id)}
                          className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-sm transition-colors ${
                            isActive
                              ? "bg-indigo-50 text-indigo-700"
                              : "text-slate-700 hover:bg-slate-100"
                          }`}
                          data-testid={`nav-${id}`}
                        >
                          <Icon className={`w-4 h-4 shrink-0 ${isActive ? "text-indigo-600" : "text-slate-400"}`} strokeWidth={1.75} />
                          <span className="truncate">{label}</span>
                          {isActive ? <ChevronRight className="w-3.5 h-3.5 ml-auto text-indigo-400" /> : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
        </aside>

        {/* Section body */}
        <main className="flex-1 overflow-y-auto px-6 py-6">
          <div className="max-w-5xl mx-auto space-y-6">
            {active === "overview" && <OverviewSection setActive={setActive} />}
            {active === "connection" && (
              <ConnectionProfileSection
                profile={profile}
                setProfile={setProfile}
                pendingToast={pendingToast}
              />
            )}
            {active === "scopes" && <ScopesSection pendingToast={pendingToast} />}
            {active === "sync-controls" && (
              <SyncControlsSection pendingToast={pendingToast} />
            )}
            {active === "resource-counts" && <ResourceCountsSection />}
            {active === "raw-viewer" && <RawFhirViewerSection />}
            {active === "field-mapping" && <FieldMappingSection />}
            {active === "clinic-mapping" && <ClinicMappingSection />}
            {active === "provider-mapping" && <ProviderMappingSection />}
            {active === "patient-identity" && <PatientIdentitySection />}
            {active === "scheduling-mapping" && <SchedulingMappingSection />}
            {active === "orders-mapping" && <OrdersMappingSection />}
            {active === "documents-mapping" && <DocumentsMappingSection />}
            {active === "insurance-mapping" && <InsuranceMappingSection />}
            {active === "billing-readiness" && <BillingReadinessSection />}
            {active === "sync-jobs" && <SyncJobsSection />}
            {active === "error-center" && <ErrorCenterSection />}
            {active === "audit-log" && <AuditLogSection />}
            {active === "security" && <SecuritySection />}
            {active === "routing" && <DownstreamRoutingSection />}
            {active === "test-console" && (
              <TestConsoleSection pendingToast={pendingToast} />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Overview
// ─────────────────────────────────────────────────────────────────────────

function OverviewSection({ setActive }: { setActive: (id: SectionId) => void }) {
  return (
    <SectionShell
      title="API Integration Station"
      subtitle="Central admin console for third-party EMR + FHIR integrations. Currently scoped to eClinicalWorks FHIR R4 (18 read scopes). Phase 1 ships the UI + mapping + routing model; Phase 2 ships the sync worker + credential vault + normalization pipeline."
      status={<Badge variant="secondary" className="text-[10px]">Foundation</Badge>}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <IntegrationKpiCard label="Vendors configured" value={0} hint="eClinicalWorks pending Phase 2 backend." />
        <IntegrationKpiCard label="Scopes represented" value={ECW_SCOPE_DEFINITIONS.length} hint="All 18 eCW FHIR R4 read scopes." />
        <IntegrationKpiCard label="Downstream modules" value={11} hint="Patient Directory · Plexus IQ · Imaging Central · Ancillary Docs · Billing · Engagement · Scheduling · Document Library · Patient Journey · Team Ops · Mission Control." />
        <IntegrationKpiCard label="Active connections" value={0} hint="Save Configuration is disabled until credential vault lands." />
      </div>

      <BackendPendingNotice
        message="Phase 1 of the Integration Station ships the admin UI, scope/mapping/routing model, and the architecture plan. There is no backend yet — no real syncs, no PHI, no credential storage. Open the Connection Profile to review the configuration form, or jump to a specific mapping surface from the left rail."
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <QuickJumpTile title="Configure eCW Connection" desc="Sandbox / Production endpoints, client ID, vault reference for client secret." onClick={() => setActive("connection")} />
        <QuickJumpTile title="Review all 18 Scopes" desc="Patient · Encounter · Condition · MedicationRequest · Medication · Observation · DiagnosticReport · DocumentReference · Binary · Procedure · AllergyIntolerance · Coverage · Immunization · ServiceRequest · Practitioner · Device · MedicationAdministration · Specimen." onClick={() => setActive("scopes")} />
        <QuickJumpTile title="Downstream Routing" desc="See where each FHIR resource lands inside Plexus IQ, Imaging Central, Ancillary Documents, and Billing Readiness." onClick={() => setActive("routing")} />
      </div>
    </SectionShell>
  );
}

function QuickJumpTile({ title, desc, onClick }: { title: string; desc: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left rounded-xl border border-slate-200 bg-white p-4 hover:border-indigo-300 hover:bg-indigo-50/40 transition-colors group"
      data-testid={`quick-${title.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <div className="text-sm font-semibold text-slate-900 group-hover:text-indigo-700">{title}</div>
      <p className="text-xs text-slate-500 mt-1 leading-snug">{desc}</p>
      <span className="inline-flex items-center gap-1 text-[11px] text-indigo-600 mt-2 font-medium">
        Open <ChevronRight className="w-3 h-3" />
      </span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// A. Connection Profile (eCW)
// ─────────────────────────────────────────────────────────────────────────

function ConnectionProfileSection({
  profile,
  setProfile,
  pendingToast,
}: {
  profile: IntegrationConnectionProfile;
  setProfile: (p: IntegrationConnectionProfile) => void;
  pendingToast: (action: string) => void;
}) {
  const update = <K extends keyof IntegrationConnectionProfile>(
    key: K,
    value: IntegrationConnectionProfile[K],
  ) => setProfile({ ...profile, [key]: value });

  const saveDisabled = !profile.backendCredentialStoreReady;
  const statusTone =
    profile.authorizationStatus === "Authorized"
      ? "text-emerald-700 bg-emerald-50 border-emerald-200"
      : profile.authorizationStatus === "Token Expired" || profile.authorizationStatus === "Refresh Failed" || profile.authorizationStatus === "Error"
        ? "text-rose-700 bg-rose-50 border-rose-200"
        : "text-slate-600 bg-slate-50 border-slate-200";

  return (
    <SectionShell
      title="eClinicalWorks Connection Profile"
      subtitle="OAuth + SMART-on-FHIR + Bulk FHIR endpoints. Credentials are stored server-side in the credential vault — never in the browser, never in localStorage, never in logs."
      status={
        <Badge
          variant="outline"
          className={`text-[10px] uppercase tracking-wide ${statusTone}`}
          data-testid="badge-authorization-status"
        >
          {profile.authorizationStatus}
        </Badge>
      }
    >
      <BackendPendingNotice
        title="Credential vault wiring pending"
        message="Save / Test / Refresh Token / Run Validation are disabled until the Phase 2 credential vault and OAuth endpoints land. The form below is editable for review; nothing persists yet."
        tone="warning"
      />

      <Card className="rounded-xl border-slate-200 p-5 space-y-5" data-testid="card-connection-profile">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Connection name">
            <Input
              value={profile.connectionName}
              onChange={(e) => update("connectionName", e.target.value)}
              placeholder="e.g., Summit eCW Sandbox"
              data-testid="input-connection-name"
            />
          </Field>
          <Field label="Vendor">
            <Input value={profile.vendor} disabled data-testid="input-vendor" />
          </Field>
          <Field label="Clinic / tenant">
            <Input
              value={profile.clinicLabel ?? ""}
              onChange={(e) => update("clinicLabel", e.target.value || null)}
              placeholder="Pick from Clinic Mapping or type a label"
              data-testid="input-clinic-label"
            />
          </Field>
          <Field label="Environment">
            <Select value={profile.environment} onValueChange={(v) => update("environment", v as typeof profile.environment)}>
              <SelectTrigger data-testid="select-environment"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Sandbox">Sandbox</SelectItem>
                <SelectItem value="Production">Production</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>

        <Separator />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="FHIR base URL">
            <Input
              value={profile.fhirBaseUrl}
              onChange={(e) => update("fhirBaseUrl", e.target.value)}
              placeholder="https://fhir4.eclinicalworks.com/.../fhir"
              data-testid="input-fhir-base-url"
            />
          </Field>
          <Field label="Bulk export endpoint">
            <Input
              value={profile.bulkExportUrl ?? ""}
              onChange={(e) => update("bulkExportUrl", e.target.value || null)}
              placeholder="$export endpoint (optional)"
              data-testid="input-bulk-export-url"
            />
          </Field>
          <Field label="Authorization URL">
            <Input
              value={profile.authorizationUrl}
              onChange={(e) => update("authorizationUrl", e.target.value)}
              placeholder="OAuth /authorize"
              data-testid="input-authorization-url"
            />
          </Field>
          <Field label="Token URL">
            <Input
              value={profile.tokenUrl}
              onChange={(e) => update("tokenUrl", e.target.value)}
              placeholder="OAuth /token"
              data-testid="input-token-url"
            />
          </Field>
        </div>

        <Separator />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Client ID">
            <Input
              value={profile.clientId}
              onChange={(e) => update("clientId", e.target.value)}
              placeholder="Vendor-issued client id"
              data-testid="input-client-id"
            />
          </Field>
          <Field label="Client secret · vault reference">
            <div className="flex items-center gap-2">
              <LockKeyhole className="w-4 h-4 text-slate-400 shrink-0" />
              <Input
                value={profile.clientSecretVaultRef ?? ""}
                onChange={(e) => update("clientSecretVaultRef", e.target.value || null)}
                placeholder="vault:integration/ecw/<connection-id>"
                disabled
                data-testid="input-client-secret-vault-ref"
              />
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              Never type a raw client secret here. Phase 2 will accept secrets through a server-side rotate flow and store the vault reference back here.
            </p>
          </Field>
          <Field label="Organization identifier">
            <Input
              value={profile.organizationIdentifier ?? ""}
              onChange={(e) => update("organizationIdentifier", e.target.value || null)}
              placeholder="Optional"
              data-testid="input-org-identifier"
            />
          </Field>
          <Field label="Group identifier">
            <Input
              value={profile.groupIdentifier ?? ""}
              onChange={(e) => update("groupIdentifier", e.target.value || null)}
              placeholder="Optional"
              data-testid="input-group-identifier"
            />
          </Field>
        </div>

        <Separator />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <ToggleField
            label="System-level access enabled"
            checked={profile.systemLevelAccessEnabled}
            onChange={(v) => update("systemLevelAccessEnabled", v)}
            testId="toggle-system-level"
            hint="`system/*.read` scopes use system-level OAuth client credentials."
          />
          <ToggleField
            label="SMART-on-FHIR enabled"
            checked={profile.smartOnFhirEnabled}
            onChange={(v) => update("smartOnFhirEnabled", v)}
            testId="toggle-smart"
          />
          <ToggleField
            label="Bulk FHIR enabled"
            checked={profile.bulkFhirEnabled}
            onChange={(v) => update("bulkFhirEnabled", v)}
            testId="toggle-bulk"
            hint="$export-based bulk import."
          />
        </div>

        <Separator />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Last token refresh">
            <Input value={profile.lastTokenRefresh ?? "Never"} disabled data-testid="input-last-token-refresh" />
          </Field>
          <Field label="Token expires at">
            <Input value={profile.tokenExpiresAt ?? "—"} disabled data-testid="input-token-expires" />
          </Field>
          <Field label="Last authorization status">
            <Input value={profile.authorizationStatus} disabled data-testid="input-last-auth-status" />
          </Field>
        </div>

        <Separator />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Vendor support contact">
            <Input
              value={profile.vendorSupportContact ?? ""}
              onChange={(e) => update("vendorSupportContact", e.target.value || null)}
              placeholder="email or phone"
              data-testid="input-vendor-support"
            />
          </Field>
          <Field label="Implementation owner">
            <Input
              value={profile.implementationOwner ?? ""}
              onChange={(e) => update("implementationOwner", e.target.value || null)}
              placeholder="Internal owner"
              data-testid="input-impl-owner"
            />
          </Field>
          <Field label="Go-live target date">
            <Input
              type="date"
              value={profile.goLiveTargetDate ?? ""}
              onChange={(e) => update("goLiveTargetDate", e.target.value || null)}
              data-testid="input-go-live"
            />
          </Field>
        </div>

        <Field label="Notes">
          <Textarea
            rows={3}
            value={profile.notes}
            onChange={(e) => update("notes", e.target.value)}
            placeholder="Implementation notes (no PHI, no secrets)."
            data-testid="textarea-notes"
          />
        </Field>

        <div className="flex flex-wrap gap-2 pt-2">
          <Button disabled={saveDisabled} onClick={() => pendingToast("Save Configuration")} data-testid="button-save-configuration">Save Configuration</Button>
          <Button variant="outline" disabled onClick={() => pendingToast("Test Connection")} data-testid="button-test-connection">Test Connection</Button>
          <Button variant="outline" disabled onClick={() => pendingToast("Test Authentication")} data-testid="button-test-auth">Test Authentication</Button>
          <Button variant="outline" disabled onClick={() => pendingToast("Refresh Token")} data-testid="button-refresh-token">Refresh Token</Button>
          <Button variant="outline" disabled onClick={() => pendingToast("Run Validation")} data-testid="button-run-validation">Run Validation</Button>
          <Button variant="destructive" disabled onClick={() => pendingToast("Disable Connection")} data-testid="button-disable-connection">Disable Connection</Button>
        </div>
      </Card>
    </SectionShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-slate-500">{label}</Label>
      {children}
    </div>
  );
}

function ToggleField({
  label,
  checked,
  onChange,
  testId,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  testId: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 p-3 bg-slate-50/40">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium text-slate-800">{label}</Label>
        <Switch checked={checked} onCheckedChange={onChange} data-testid={testId} />
      </div>
      {hint ? <p className="text-[11px] text-slate-500 mt-1">{hint}</p> : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// B. Scope Management
// ─────────────────────────────────────────────────────────────────────────

function ScopesSection({ pendingToast }: { pendingToast: (a: string) => void }) {
  return (
    <SectionShell
      title="eCW Scope Management"
      subtitle="All 18 FHIR R4 read scopes Phase 1 represents. Toggling a scope ON here is a UI-only intent — the actual scope grant lives in the vendor's OAuth tenant and the eventual server config row."
    >
      <BackendPendingNotice
        message="Scope toggles do not persist yet. Last-import counts, statuses, and timestamps will populate once the Phase 2 sync worker writes back to `integration_scopes`."
      />
      <Card className="rounded-xl border-slate-200 overflow-hidden">
        <Table data-testid="table-scopes">
          <TableHeader>
            <TableRow>
              <TableHead>Scope</TableHead>
              <TableHead>Resource</TableHead>
              <TableHead>Required for go-live</TableHead>
              <TableHead>Destinations</TableHead>
              <TableHead className="text-right">Last imported</TableHead>
              <TableHead>Last sync</TableHead>
              <TableHead>Mapping status</TableHead>
              <TableHead>Enabled</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ECW_SCOPE_DEFINITIONS.map((scope) => {
              const runtime = INITIAL_SCOPE_RUNTIME_STATE.find((s) => s.scope === scope.scope);
              return (
                <TableRow key={scope.scope} data-testid={`row-scope-${scope.resource}`}>
                  <TableCell className="font-mono text-xs text-slate-700">{scope.scope}</TableCell>
                  <TableCell className="text-slate-800 font-medium">{scope.resource}</TableCell>
                  <TableCell>
                    {scope.requiredForGoLive ? (
                      <Badge variant="default" className="text-[10px]">Required</Badge>
                    ) : (
                      <Badge variant="secondary" className="text-[10px]">Optional</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {scope.destinationModules.slice(0, 3).map((m) => (
                        <Badge key={m} variant="outline" className="text-[10px]">{m}</Badge>
                      ))}
                      {scope.destinationModules.length > 3 ? (
                        <span className="text-[11px] text-slate-500">+{scope.destinationModules.length - 3}</span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-slate-500">
                    {runtime?.lastImportedCount ?? "—"}
                  </TableCell>
                  <TableCell className="text-slate-500 text-xs">{runtime?.lastSyncAt ?? "Never"}</TableCell>
                  <TableCell><Badge variant="outline" className="text-[10px]">{runtime?.mappingStatus ?? "Not Started"}</Badge></TableCell>
                  <TableCell>
                    <Switch
                      checked={false}
                      onCheckedChange={() => pendingToast(`Toggle ${scope.scope}`)}
                      data-testid={`switch-scope-${scope.resource}`}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </SectionShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// C. Sync Controls
// ─────────────────────────────────────────────────────────────────────────

function SyncControlsSection({ pendingToast }: { pendingToast: (a: string) => void }) {
  const controls: { label: string; description: string }[] = [
    { label: "Full Import", description: "All scopes, all dates, full panel." },
    { label: "Incremental Sync", description: "Since last successful sync per resource." },
    { label: "Resource-Specific Sync", description: "Single resource (e.g., DiagnosticReport)." },
    { label: "Date Range Import", description: "Bounded window for backfill." },
    { label: "Patient Panel Import", description: "Limit to a clinic's active panel." },
    { label: "Clinic / Location Import", description: "Sync Practitioner + clinic location only." },
    { label: "Provider Import", description: "Sync Practitioner only." },
    { label: "Validation Only", description: "Pull a sample without writing downstream." },
    { label: "Dry-run Mode", description: "Run the full pipeline against a sample, no persistence." },
    { label: "Stop Sync", description: "Cancel an in-flight sync." },
    { label: "Resume Sync", description: "Resume from the last paused checkpoint." },
    { label: "Retry Failed Resources", description: "Re-attempt the failed slice without resyncing the rest." },
  ];

  const statuses = ["Requested", "Accepted", "In Progress", "Complete", "Partial Complete", "Failed", "Cancelled", "Paused"];

  return (
    <SectionShell
      title="Sync Controls"
      subtitle="Manual triggers for the Phase 2 sync worker. Every control is disabled today — flipping it on requires the server-side endpoint + advisory-locked worker."
    >
      <BackendPendingNotice
        message="No sync worker is wired in Phase 1. Buttons below intentionally do not perform any network calls."
        tone="warning"
      />

      <Card className="rounded-xl border-slate-200 p-5 space-y-3">
        <div className="text-sm font-semibold text-slate-800">Triggers</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {controls.map((c) => (
            <div key={c.label} className="rounded-lg border border-slate-200 p-3 flex items-start gap-3" data-testid={`control-${c.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-slate-800">{c.label}</div>
                <div className="text-[11px] text-slate-500 mt-0.5 leading-snug">{c.description}</div>
              </div>
              <Button size="sm" variant="outline" disabled onClick={() => pendingToast(c.label)}>
                Run
              </Button>
            </div>
          ))}
        </div>
      </Card>

      <Card className="rounded-xl border-slate-200 p-5">
        <div className="text-sm font-semibold text-slate-800 mb-2">Sync statuses</div>
        <div className="flex flex-wrap gap-2">
          {statuses.map((s) => (
            <Badge key={s} variant="outline" className="text-[10px]">{s}</Badge>
          ))}
        </div>
      </Card>
    </SectionShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// D. Resource Counts
// ─────────────────────────────────────────────────────────────────────────

function ResourceCountsSection() {
  return (
    <SectionShell
      title="Resource Counts"
      subtitle="Counts of FHIR resources imported per scope. Phase 1 renders zeros — the worker that writes these values lands in Phase 2."
    >
      <BackendPendingNotice
        message="Each card shows the live count once the Phase 2 sync worker writes back to `integration_scopes.lastImportedCount`."
      />
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3" data-testid="grid-resource-counts">
        {INITIAL_RESOURCE_COUNTS.map((row) => (
          <Card key={row.resource} className="rounded-xl border-slate-200 p-4" data-testid={`count-${row.resource}`}>
            <div className="text-2xl font-bold tabular-nums text-slate-900">{row.lastImportedCount ?? 0}</div>
            <div className="text-[11px] text-slate-500 mt-0.5 truncate">{row.resource}</div>
            <div className="text-[10px] text-slate-400 mt-1">{row.lastSyncAt ?? "Never synced"}</div>
          </Card>
        ))}
      </div>
    </SectionShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// E. Raw FHIR Viewer
// ─────────────────────────────────────────────────────────────────────────

function RawFhirViewerSection() {
  return (
    <SectionShell
      title="Raw FHIR Viewer"
      subtitle="Admin-only viewer for ingested FHIR JSON. Phase 1 ships the search UI; the raw resource store lands in Phase 2."
    >
      <BackendPendingNotice
        title="Raw resource store pending backend implementation"
        message="The raw FHIR store table (`integration_raw_resources`) and the read endpoint are Phase 2 work. The search form below is a stub so the layout is reviewable now."
        tone="warning"
      />
      <Card className="rounded-xl border-slate-200 p-5 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <Field label="Patient name"><Input placeholder="Last, First" disabled data-testid="raw-search-name" /></Field>
          <Field label="MRN"><Input placeholder="MRN-…" disabled data-testid="raw-search-mrn" /></Field>
          <Field label="DOB"><Input type="date" disabled data-testid="raw-search-dob" /></Field>
          <Field label="FHIR ID"><Input placeholder="resource id" disabled data-testid="raw-search-fhir-id" /></Field>
          <Field label="Resource type">
            <Select disabled>
              <SelectTrigger data-testid="raw-search-resource-type"><SelectValue placeholder="Any" /></SelectTrigger>
              <SelectContent>
                {ECW_RESOURCES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <Button size="sm" disabled data-testid="button-raw-search"><Search className="w-4 h-4 mr-1" /> Search</Button>
      </Card>
      <Card className="rounded-xl border-dashed border-slate-300 bg-slate-50/40 p-10 text-center text-sm text-slate-500" data-testid="raw-empty-state">
        Raw resource store pending backend implementation. No PHI to display.
      </Card>
    </SectionShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Field Mapping
// ─────────────────────────────────────────────────────────────────────────

function FieldMappingSection() {
  const [resource, setResource] = useState<EcwResourceType>("Patient");
  const rows = getFieldMappingsForResource(resource);
  return (
    <SectionShell
      title="Field Mapping"
      subtitle="FHIR source paths and the internal targets they normalize into. These are the Phase 1 defaults — Phase 2 will let admins override per connection."
      actions={
        <Select value={resource} onValueChange={(v) => setResource(v as EcwResourceType)}>
          <SelectTrigger className="w-48" data-testid="select-field-resource"><SelectValue /></SelectTrigger>
          <SelectContent>
            {ECW_RESOURCES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
          </SelectContent>
        </Select>
      }
    >
      <BackendPendingNotice
        message="Mappings are read-only in Phase 1. Phase 2 will persist edits to `integration_field_mappings`."
      />
      <Card className="rounded-xl border-slate-200 overflow-hidden">
        <Table data-testid="table-field-mappings">
          <TableHeader>
            <TableRow>
              <TableHead>FHIR source path</TableHead>
              <TableHead>Internal target</TableHead>
              <TableHead>Required</TableHead>
              <TableHead>Validation</TableHead>
              <TableHead>Notes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((m) => (
              <TableRow key={m.id} data-testid={`field-row-${m.id}`}>
                <TableCell className="font-mono text-xs text-slate-700">{m.sourcePath}</TableCell>
                <TableCell className="font-mono text-xs text-slate-700">{m.internalTarget}</TableCell>
                <TableCell>
                  {m.required ? (
                    <Badge variant="default" className="text-[10px]">Required</Badge>
                  ) : (
                    <Badge variant="secondary" className="text-[10px]">Optional</Badge>
                  )}
                </TableCell>
                <TableCell><Badge variant="outline" className="text-[10px]">{m.validationStatus}</Badge></TableCell>
                <TableCell className="text-xs text-slate-500">{m.notes || "—"}</TableCell>
              </TableRow>
            ))}
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-slate-400 py-6">No mappings seeded for this resource yet.</TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </Card>
      <div className="text-xs text-slate-500">{ECW_FIELD_MAPPINGS.length} default mappings across {ECW_RESOURCES.length} resources.</div>
    </SectionShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Clinic / Facility Mapping
// ─────────────────────────────────────────────────────────────────────────

function ClinicMappingSection() {
  return (
    <SectionShell
      title="Clinic / Facility Mapping"
      subtitle="Resolve eCW location IDs to internal facility rows. Drives downstream `Encounter.location` and `ServiceRequest.location` routing."
    >
      <BackendPendingNotice
        message="The clinic mapping table is empty until the Phase 2 worker pulls eCW Locations. Until then, the canonical facilities live in the internal Clinic Profiles surface (unchanged)."
      />
      <Card className="rounded-xl border-slate-200 overflow-hidden">
        <Table data-testid="table-clinic-mappings">
          <TableHeader>
            <TableRow>
              <TableHead>eCW location ID</TableHead>
              <TableHead>eCW location name</TableHead>
              <TableHead>Internal facility</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Notes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {DEMO_CLINIC_MAPPINGS.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-slate-400 py-10" data-testid="clinic-empty-state">
                  No clinic mappings yet. Sync the Practitioner / Location resources to populate this table.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </Card>
    </SectionShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Provider Mapping
// ─────────────────────────────────────────────────────────────────────────

function ProviderMappingSection() {
  return (
    <SectionShell
      title="Provider Mapping"
      subtitle="Match eCW Practitioners (with NPI) to internal user accounts. Drives Encounter ownership, ServiceRequest requester, and signing routing."
    >
      <BackendPendingNotice
        message="The provider mapping table populates once the Practitioner scope syncs. NPI-based auto-match runs in Phase 2."
      />
      <Card className="rounded-xl border-slate-200 overflow-hidden">
        <Table data-testid="table-provider-mappings">
          <TableHeader>
            <TableRow>
              <TableHead>eCW Practitioner</TableHead>
              <TableHead>NPI</TableHead>
              <TableHead>Internal user</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {DEMO_PROVIDER_MAPPINGS.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-slate-400 py-10" data-testid="provider-empty-state">
                  No provider mappings yet. Sync Practitioner to populate.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </Card>
    </SectionShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Patient Identity Matching
// ─────────────────────────────────────────────────────────────────────────

function PatientIdentitySection() {
  return (
    <SectionShell
      title="Patient Identity Matching"
      subtitle="Rules + weights for matching incoming eCW Patient rows to existing internal patients. Auto-match threshold below."
    >
      <BackendPendingNotice
        title="Match worker pending Phase 2"
        message="Identity match candidates appear here once the worker scores incoming Patient rows. Manual merge actions are Phase 2 work and require explicit admin approval."
        tone="warning"
      />

      <Card className="rounded-xl border-slate-200 p-5" data-testid="card-match-rules">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-sm font-semibold text-slate-800">Match rules</div>
            <div className="text-xs text-slate-500">Weighted signals — sum determines auto-match.</div>
          </div>
          <Badge variant="outline" className="text-[10px]">Auto-match threshold: {PATIENT_MATCH_AUTO_THRESHOLD}</Badge>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Signal</TableHead>
              <TableHead className="text-right">Weight</TableHead>
              <TableHead>Enabled</TableHead>
              <TableHead>Notes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {PATIENT_MATCH_RULES.map((rule) => (
              <TableRow key={rule.id} data-testid={`match-rule-${rule.id}`}>
                <TableCell className="font-medium text-slate-800">{rule.signal}</TableCell>
                <TableCell className="text-right tabular-nums">{rule.weight}</TableCell>
                <TableCell>
                  <Badge variant={rule.enabled ? "default" : "secondary"} className="text-[10px]">
                    {rule.enabled ? "Enabled" : "Disabled"}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-slate-500">{rule.notes}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Card className="rounded-xl border-slate-200 p-5" data-testid="card-match-candidates">
        <div className="text-sm font-semibold text-slate-800 mb-2">Pending candidates</div>
        {DEMO_PATIENT_IDENTITY_CANDIDATES.length === 0 ? (
          <div className="text-center text-slate-400 py-8 text-sm" data-testid="match-empty-state">
            No identity match candidates pending. Surface populates once Patient sync runs.
          </div>
        ) : null}
      </Card>
    </SectionShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Scheduling Mapping
// ─────────────────────────────────────────────────────────────────────────

function SchedulingMappingSection() {
  return (
    <SectionShell
      title="Scheduling Mapping"
      subtitle="Encounter = a real visit on the EMR's calendar. ServiceRequest = an order/referral that needs to be scheduled and executed. Rules below route incoming ServiceRequests into the correct execution queue."
    >
      <Card className="rounded-xl border-slate-200 p-4 bg-slate-50/40 text-sm text-slate-700 space-y-2" data-testid="card-scheduling-explainer">
        <div className="font-semibold text-slate-900">Encounter vs ServiceRequest semantics</div>
        <ul className="list-disc pl-5 text-xs space-y-1 text-slate-600 leading-snug">
          <li><span className="font-medium text-slate-800">Encounter</span> — a patient visit already on the EMR's calendar. We reconcile with our scheduling pipeline; we don't put the patient back in the qualification queue.</li>
          <li><span className="font-medium text-slate-800">ServiceRequest</span> — an order or referral that needs to be qualified, scheduled, and executed. We route by code/category into the right downstream surface (Plexus IQ, Imaging Central, Engagement Center, etc.).</li>
        </ul>
      </Card>

      <BackendPendingNotice
        message="ServiceRequest routing rules render below. Editing + persistence lands in Phase 2 alongside the normalization pipeline."
      />

      <Card className="rounded-xl border-slate-200 overflow-hidden">
        <Table data-testid="table-sr-routing">
          <TableHeader>
            <TableRow>
              <TableHead>Match</TableHead>
              <TableHead>Value</TableHead>
              <TableHead>Routes to</TableHead>
              <TableHead>Enabled</TableHead>
              <TableHead>Notes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {SERVICE_REQUEST_ROUTING_DEFAULTS.map((rule) => (
              <TableRow key={rule.id} data-testid={`sr-rule-${rule.id}`}>
                <TableCell><Badge variant="outline" className="text-[10px]">{rule.matchType}</Badge></TableCell>
                <TableCell className="font-mono text-xs text-slate-700">{rule.matchValue}</TableCell>
                <TableCell className="text-slate-800">{rule.routesTo}</TableCell>
                <TableCell>
                  <Badge variant={rule.enabled ? "default" : "secondary"} className="text-[10px]">
                    {rule.enabled ? "On" : "Off"}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-slate-500">{rule.notes || "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </SectionShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Orders / Ancillary Mapping
// ─────────────────────────────────────────────────────────────────────────

function OrdersMappingSection() {
  return (
    <SectionShell
      title="Orders / Ancillary Routing"
      subtitle="Where each qualified ancillary type physically executes. Imaging Central is ULTRASOUND-ONLY; BrainWave / VitalWave / EKG / PGX / CGX live in their own modules."
    >
      <BackendPendingNotice
        message="Routing rules are read-only in Phase 1. Phase 2 will let admins override per clinic."
      />
      <Card className="rounded-xl border-slate-200 overflow-hidden">
        <Table data-testid="table-ancillary-routing">
          <TableHeader>
            <TableRow>
              <TableHead>Ancillary</TableHead>
              <TableHead>Destination</TableHead>
              <TableHead>Imaging Central · ultrasound-only?</TableHead>
              <TableHead>Enabled</TableHead>
              <TableHead>Notes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ANCILLARY_ROUTING_DEFAULTS.map((rule) => (
              <TableRow key={rule.id} data-testid={`ancillary-rule-${rule.id}`}>
                <TableCell className="font-medium text-slate-800">{rule.ancillary}</TableCell>
                <TableCell><Badge variant="outline" className="text-[10px]">{rule.destination}</Badge></TableCell>
                <TableCell><Badge variant={rule.ancillary === "Ultrasound" ? "default" : "secondary"} className="text-[10px]">{rule.ancillary === "Ultrasound" ? "Yes" : "No (out of scope)"}</Badge></TableCell>
                <TableCell>
                  <Badge variant={rule.enabled ? "default" : "secondary"} className="text-[10px]">
                    {rule.enabled ? "On" : "Off"}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-slate-500">{rule.notes || "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </SectionShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Documents & Reports Mapping
// ─────────────────────────────────────────────────────────────────────────

function DocumentsMappingSection() {
  return (
    <SectionShell
      title="Documents & Reports Routing"
      subtitle="DocumentReference + DiagnosticReport land here. Codes (mostly LOINC) decide the destination."
    >
      <BackendPendingNotice
        message="Phase 1 ships an explicit seed list. Phase 2 expands to the full LOINC subset and lets admins extend per connection."
      />
      <Card className="rounded-xl border-slate-200 overflow-hidden">
        <Table data-testid="table-document-routing">
          <TableHeader>
            <TableRow>
              <TableHead>System</TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Display</TableHead>
              <TableHead>Routes to</TableHead>
              <TableHead>Enabled</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {DOCUMENT_ROUTING_DEFAULTS.map((rule) => (
              <TableRow key={rule.id} data-testid={`doc-rule-${rule.id}`}>
                <TableCell><Badge variant="outline" className="text-[10px]">{rule.codingSystem}</Badge></TableCell>
                <TableCell className="font-mono text-xs">{rule.code}</TableCell>
                <TableCell className="text-slate-700">{rule.displayLabel}</TableCell>
                <TableCell className="text-slate-700">{rule.routesTo}</TableCell>
                <TableCell>
                  <Badge variant={rule.enabled ? "default" : "secondary"} className="text-[10px]">
                    {rule.enabled ? "On" : "Off"}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </SectionShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Insurance / Coverage Mapping
// ─────────────────────────────────────────────────────────────────────────

function InsuranceMappingSection() {
  return (
    <SectionShell
      title="Insurance / Coverage Mapping"
      subtitle="eCW payor strings → internal payor classes + cooldown profiles. Drives Medicare-12mo / PPO-6mo cooldown logic and payor-mix analytics."
    >
      <BackendPendingNotice
        message="Payor strings appear once Coverage syncs. Phase 2 reconciles them against our internal payor catalog + cooldown profiles."
      />
      <Card className="rounded-xl border-slate-200 overflow-hidden">
        <Table data-testid="table-coverage-mapping">
          <TableHeader>
            <TableRow>
              <TableHead>eCW payor</TableHead>
              <TableHead>Internal class</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>Cooldown profile</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {DEMO_COVERAGE_MAPPINGS.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-slate-400 py-10" data-testid="coverage-empty-state">
                  No coverage mappings yet. Sync the Coverage resource to populate.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </Card>
    </SectionShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Billing Readiness Mapping
// ─────────────────────────────────────────────────────────────────────────

function BillingReadinessSection() {
  return (
    <SectionShell
      title="Billing Readiness Mapping"
      subtitle="Each readiness check pairs with the FHIR resource + path that feeds it. Phase 2 wires the actual flags into `billing_readiness_checks`."
    >
      <BackendPendingNotice
        message="Phase 2 will fire these readiness checks as part of the normalization pipeline. Phase 1 just documents the inputs."
      />
      <Card className="rounded-xl border-slate-200 overflow-hidden">
        <Table data-testid="table-billing-readiness">
          <TableHeader>
            <TableRow>
              <TableHead>Check</TableHead>
              <TableHead>Source resource</TableHead>
              <TableHead>Source path</TableHead>
              <TableHead>Internal flag</TableHead>
              <TableHead>Required</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {BILLING_READINESS_CHECKLIST.map((item) => (
              <TableRow key={item.id} data-testid={`billing-check-${item.id}`}>
                <TableCell className="font-medium text-slate-800">{item.label}</TableCell>
                <TableCell><Badge variant="outline" className="text-[10px]">{item.sourceResource}</Badge></TableCell>
                <TableCell className="font-mono text-xs text-slate-700">{item.sourceField}</TableCell>
                <TableCell className="font-mono text-xs text-slate-700">{item.internalReadinessFlag}</TableCell>
                <TableCell>
                  {item.required ? (
                    <Badge variant="default" className="text-[10px]">Required</Badge>
                  ) : (
                    <Badge variant="secondary" className="text-[10px]">Optional</Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </SectionShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Sync Jobs
// ─────────────────────────────────────────────────────────────────────────

function SyncJobsSection() {
  return (
    <SectionShell
      title="Sync Jobs"
      subtitle="History of sync runs — full / incremental / per-resource / dry-run. Phase 2 writes rows into `integration_sync_jobs`."
    >
      <BackendPendingNotice
        message="No jobs to show in Phase 1. The Sync Controls section will trigger jobs once the worker lands."
      />
      <Card className="rounded-xl border-slate-200 overflow-hidden">
        <Table data-testid="table-sync-jobs">
          <TableHeader>
            <TableRow>
              <TableHead>Job</TableHead>
              <TableHead>Resource</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Started</TableHead>
              <TableHead>Finished</TableHead>
              <TableHead className="text-right">Imported</TableHead>
              <TableHead className="text-right">Errors</TableHead>
              <TableHead>Requested by</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {DEMO_SYNC_JOBS.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-slate-400 py-10" data-testid="sync-jobs-empty-state">
                  No sync jobs yet. Trigger a job from the Sync Controls section once the backend is wired.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </Card>
    </SectionShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Error Center
// ─────────────────────────────────────────────────────────────────────────

function ErrorCenterSection() {
  const categories = [
    "Authentication",
    "Authorization",
    "Network",
    "Rate Limit",
    "Validation",
    "Mapping",
    "Downstream Routing",
    "PHI Integrity",
    "Unknown",
  ];
  return (
    <SectionShell
      title="Error Center"
      subtitle="Surfaces sync + mapping + routing failures. Phase 2 writes errors into `integration_sync_errors`; Phase 1 shows the shape only."
    >
      <BackendPendingNotice
        message="No errors to show — there is no sync running. The table shape below matches what Phase 2 will populate."
      />
      <Card className="rounded-xl border-slate-200 p-4">
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Categories</div>
        <div className="flex flex-wrap gap-2">
          {categories.map((c) => (
            <Badge key={c} variant="outline" className="text-[10px]">{c}</Badge>
          ))}
        </div>
      </Card>
      <Card className="rounded-xl border-slate-200 overflow-hidden">
        <Table data-testid="table-errors">
          <TableHeader>
            <TableRow>
              <TableHead>Severity</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Resource</TableHead>
              <TableHead>Message</TableHead>
              <TableHead>Occurred</TableHead>
              <TableHead>Acknowledged</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {DEMO_SYNC_ERRORS.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-slate-400 py-10" data-testid="errors-empty-state">
                  No errors. Empty by design — Phase 1 ships no sync worker.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </Card>
    </SectionShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Audit Log
// ─────────────────────────────────────────────────────────────────────────

function AuditLogSection() {
  const eventTypes = [
    "Connection Created",
    "Connection Updated",
    "Authorization Started",
    "Authorization Succeeded",
    "Authorization Failed",
    "Token Refreshed",
    "Sync Requested",
    "Sync Completed",
    "Sync Failed",
    "Mapping Updated",
    "Scope Toggled",
    "Secret Rotated",
    "Connection Disabled",
  ];
  return (
    <SectionShell
      title="Audit Log"
      subtitle="Append-only trail of who changed what. Per the platform operating model, never logs PHI."
    >
      <BackendPendingNotice
        message="No audit entries in Phase 1. Phase 2 writes to `integration_audit_log`. The event-type catalog is locked here so the consumer schema is stable."
      />
      <Card className="rounded-xl border-slate-200 p-4">
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Event types</div>
        <div className="flex flex-wrap gap-2">
          {eventTypes.map((e) => (
            <Badge key={e} variant="outline" className="text-[10px]">{e}</Badge>
          ))}
        </div>
      </Card>
      <Card className="rounded-xl border-slate-200 overflow-hidden">
        <Table data-testid="table-audit-log">
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Event</TableHead>
              <TableHead>Summary</TableHead>
              <TableHead>Connection</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {DEMO_AUDIT_LOG.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-slate-400 py-10" data-testid="audit-empty-state">
                  No audit entries. Empty until the connection is created.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </Card>
    </SectionShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Security & Credentials
// ─────────────────────────────────────────────────────────────────────────

function SecuritySection() {
  return (
    <SectionShell
      title="Security & Credentials"
      subtitle="Credential vault status, scope grants, token TTL, and rotation history."
      status={<Badge variant="outline" className="text-[10px]">Phase 1 read-only</Badge>}
    >
      <BackendPendingNotice
        title="Credential vault wiring pending"
        message="The credential vault is the only place client secrets live. The vault wiring + rotation endpoint land in Phase 2. Phase 1 surfaces the controls so the security review can sign off the shape."
        tone="warning"
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <IntegrationKpiCard label="Secrets stored" value={0} hint="Vault is not yet wired." />
        <IntegrationKpiCard label="Active tokens" value={0} hint="No active authorization." />
        <IntegrationKpiCard label="Last rotation" value="Never" hint="Rotation flow ships in Phase 2." />
      </div>

      <Card className="rounded-xl border-slate-200 p-5 space-y-3">
        <div className="text-sm font-semibold text-slate-800">Credential storage policy</div>
        <ul className="list-disc pl-5 text-xs text-slate-600 leading-snug space-y-1">
          <li>Client secrets are stored server-side, never in localStorage, never echoed back to the UI.</li>
          <li>Vault references in the Connection Profile are opaque pointers — they tell the server which secret to fetch.</li>
          <li>Tokens are stored in encrypted columns with explicit TTL. Refresh logic runs server-side under an advisory lock.</li>
          <li>Every secret read writes an audit event (`Secret Rotated`, `Authorization Started`, etc.).</li>
          <li>PHI is never logged. Error messages strip patient identifiers before persisting.</li>
        </ul>
      </Card>
    </SectionShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Downstream Routing
// ─────────────────────────────────────────────────────────────────────────

function DownstreamRoutingSection() {
  // Build a quick visualization of resource → destination modules.
  const rows = ECW_SCOPE_DEFINITIONS.map((scope) => ({
    resource: scope.resource,
    destinations: scope.destinationModules,
    internalTables: scope.internalTables,
    dependsOn: scope.dependsOn,
  }));

  return (
    <SectionShell
      title="Downstream Routing"
      subtitle="One row per FHIR resource — where each scope's data lands, the internal tables Phase 2 will populate, and which resources must sync first."
    >
      <BackendPendingNotice
        message="Phase 1 documents the routing intent. Phase 2 will surface live routing health here (last successful route per resource, downstream confirmation counts)."
      />
      <Card className="rounded-xl border-slate-200 overflow-hidden">
        <Table data-testid="table-routing">
          <TableHeader>
            <TableRow>
              <TableHead>Resource</TableHead>
              <TableHead>Downstream modules</TableHead>
              <TableHead>Internal tables (Phase 2)</TableHead>
              <TableHead>Depends on</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.resource} data-testid={`routing-${row.resource}`}>
                <TableCell className="font-medium text-slate-800">{row.resource}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {row.destinations.map((d) => (
                      <Badge key={d} variant="outline" className="text-[10px]">{d}</Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1 font-mono text-[10px] text-slate-600">
                    {row.internalTables.map((t) => (
                      <span key={t} className="rounded bg-slate-50 border border-slate-200 px-1.5 py-0.5">{t}</span>
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1 text-xs text-slate-500">
                    {row.dependsOn.length === 0 ? "—" : row.dependsOn.join(", ")}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </SectionShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Test Console
// ─────────────────────────────────────────────────────────────────────────

function TestConsoleSection({ pendingToast }: { pendingToast: (a: string) => void }) {
  const checks = [
    "Ping FHIR base URL",
    "Verify OAuth metadata",
    "Authorize (client credentials)",
    "Fetch sample Patient",
    "Fetch sample Encounter",
    "Fetch sample DiagnosticReport",
    "Resolve sample Binary",
    "Run mapping validation",
    "Trigger dry-run normalization",
  ];
  return (
    <SectionShell
      title="Test Console"
      subtitle="One-off diagnostic actions admins can run to verify connectivity / authorization / mapping. Every action is held until Phase 2."
    >
      <BackendPendingNotice
        message="The Test Console is the safest way to verify a connection before turning on full sync. Phase 2 wires the underlying server endpoints."
      />
      <Card className="rounded-xl border-slate-200 p-5">
        <ul className="divide-y divide-slate-100">
          {checks.map((c) => (
            <li key={c} className="py-3 flex items-center justify-between" data-testid={`test-${c.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
              <div className="text-sm text-slate-800">{c}</div>
              <Button size="sm" variant="outline" disabled onClick={() => pendingToast(c)}>
                Run
              </Button>
            </li>
          ))}
        </ul>
      </Card>
    </SectionShell>
  );
}
