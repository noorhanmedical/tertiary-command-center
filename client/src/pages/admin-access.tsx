// Phase 4B — Plexus Access Management console.
//
// The access-management Settings surface, built on the frozen /api/access/*
// contracts. It lives inside the persistent Plexus Admin shell and mirrors the
// existing admin-settings design language (dark rail + flat white pane).
//
// PERMISSION-AWARE: every section is gated by the capability the backend
// requires for it. A user only sees the sections they are authorized for — an
// Organization Admin sees Users/Organizations/Clinics/Audit, never Platform or
// Integrations. Section visibility is UX; the API enforces the real boundary.

import { useEffect, useMemo, useState } from "react";
import {
  Users,
  Building2,
  Hospital,
  ShieldCheck,
  Boxes,
  Lock,
  Plug,
  ScrollText,
  type LucideIcon,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAccess } from "@/lib/access/accessContext";
import { UsersAccessSection } from "@/components/access/UsersAccessSection";
import { OrganizationsSection } from "@/components/access/OrganizationsSection";
import { ClinicsSection } from "@/components/access/ClinicsSection";
import { RolesCatalogSection } from "@/components/access/RolesCatalogSection";
import { ServiceAccessCatalogSection } from "@/components/access/ServiceAccessCatalogSection";
import { SecuritySection } from "@/components/access/SecuritySection";
import { IntegrationsSection } from "@/components/access/IntegrationsSection";
import { AuditLogSection } from "@/components/access/AuditLogSection";

type SectionKey =
  | "users"
  | "organizations"
  | "clinics"
  | "roles"
  | "services"
  | "security"
  | "integrations"
  | "audit";

interface SectionDef {
  key: SectionKey;
  label: string;
  desc: string;
  Icon: LucideIcon;
  accent: string;
  group: string;
  /** Visible if the user holds ANY of these permissions. */
  anyOf?: string[];
  /** Visible only if the user holds this permission. */
  permission?: string;
  /** Preserve legacy admin-only visibility (Integrations, until migrated). */
  legacyAdminOnly?: boolean;
  render: () => JSX.Element;
}

const SECTION_DEFS: SectionDef[] = [
  {
    key: "users",
    label: "Users & Access",
    desc: "People, roles, permissions, scope, and service access.",
    Icon: Users,
    accent: "text-sky-300",
    group: "People",
    anyOf: ["users.view", "users.manage"],
    render: () => <UsersAccessSection />,
  },
  {
    key: "organizations",
    label: "Organizations",
    desc: "Tenant groups above clinics.",
    Icon: Building2,
    accent: "text-indigo-300",
    group: "Structure",
    anyOf: ["organization.view", "organization.manage"],
    render: () => <OrganizationsSection />,
  },
  {
    key: "clinics",
    label: "Clinics",
    desc: "Facilities, their organization, and status.",
    Icon: Hospital,
    accent: "text-emerald-300",
    group: "Structure",
    anyOf: ["clinic.view", "clinic.manage"],
    render: () => <ClinicsSection />,
  },
  {
    key: "roles",
    label: "Roles & Permissions",
    desc: "System role templates and the permission catalog (read-only).",
    Icon: ShieldCheck,
    accent: "text-violet-300",
    group: "Catalog",
    anyOf: ["users.view", "users.manage"],
    render: () => <RolesCatalogSection />,
  },
  {
    key: "services",
    label: "Service Access",
    desc: "Ancillary services available for user-level access.",
    Icon: Boxes,
    accent: "text-amber-300",
    group: "Catalog",
    anyOf: ["users.view", "users.manage"],
    render: () => <ServiceAccessCatalogSection />,
  },
  {
    key: "security",
    label: "Security",
    desc: "Account status, MFA state, and last-login visibility.",
    Icon: Lock,
    accent: "text-rose-300",
    group: "Governance",
    permission: "users.manage",
    render: () => <SecuritySection />,
  },
  {
    key: "integrations",
    label: "Integrations",
    desc: "External integrations and technical configuration.",
    Icon: Plug,
    accent: "text-teal-300",
    group: "Governance",
    legacyAdminOnly: true,
    render: () => <IntegrationsSection />,
  },
  {
    key: "audit",
    label: "Audit Log",
    desc: "Access-management events within your authorized scope.",
    Icon: ScrollText,
    accent: "text-slate-300",
    group: "Governance",
    anyOf: ["platform.audit.view", "audit.organization.view"],
    render: () => <AuditLogSection />,
  },
];

const GROUP_ORDER = ["People", "Structure", "Catalog", "Governance"];

function readHashSection(keys: SectionKey[]): SectionKey | null {
  const raw = window.location.hash.replace(/^#/, "") as SectionKey;
  return keys.includes(raw) ? raw : null;
}

export default function AdminAccessPage() {
  const { hasAnyPermission, hasPermission, legacyRole } = useAccess();

  // Only sections the current user is authorized to see.
  const visibleSections = useMemo(
    () =>
      SECTION_DEFS.filter((s) => {
        if (s.legacyAdminOnly) return legacyRole === "admin";
        if (s.permission) return hasPermission(s.permission);
        if (s.anyOf) return hasAnyPermission(s.anyOf);
        return false;
      }),
    [hasAnyPermission, hasPermission, legacyRole],
  );

  const visibleKeys = visibleSections.map((s) => s.key);

  const [activeSection, setActiveSection] = useState<SectionKey | null>(() =>
    typeof window === "undefined" ? null : readHashSection(visibleKeys) ?? visibleKeys[0] ?? null,
  );

  // Keep the active section valid as visibility resolves (auth may load late).
  useEffect(() => {
    if (visibleKeys.length === 0) return;
    setActiveSection((cur) => (cur && visibleKeys.includes(cur) ? cur : visibleKeys[0]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleKeys.join(",")]);

  useEffect(() => {
    const onHash = () => {
      const next = readHashSection(visibleKeys);
      if (next) setActiveSection(next);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleKeys.join(",")]);

  function selectSection(next: SectionKey) {
    window.location.hash = next;
    setActiveSection(next);
  }

  const active = visibleSections.find((s) => s.key === activeSection) ?? visibleSections[0];

  const groups = GROUP_ORDER.map((label) => ({
    label,
    items: visibleSections.filter((s) => s.group === label),
  })).filter((g) => g.items.length > 0);

  if (!active) {
    return (
      <div className="finance-page">
        <div className="mx-auto flex w-full max-w-[1320px] flex-col gap-6 px-6 py-6">
          <PageHeader eyebrow="PLEXUS · ACCESS" icon={ShieldCheck} title="Access Management" context="Restricted" />
          <div className="rounded-2xl border border-slate-200/80 bg-white p-12 text-center text-sm text-slate-500">
            You do not have access to any access-management sections.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="finance-page">
      <div className="mx-auto flex w-full max-w-[1320px] flex-col gap-6 px-6 py-6">
        <PageHeader
          eyebrow="PLEXUS · ACCESS"
          icon={ShieldCheck}
          title="Access Management"
          context={active.label}
          subtitle="Manage users, roles, permissions, scope, and audit across your authorized organizations and clinics."
        />

        {/* Mobile section selector */}
        <div className="md:hidden">
          <Select value={active.key} onValueChange={(v) => selectSection(v as SectionKey)}>
            <SelectTrigger
              className="w-full rounded-xl border-slate-200 bg-white shadow-sm"
              data-testid="select-access-section"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {visibleSections.map((s) => (
                <SelectItem key={s.key} value={s.key} data-testid={`option-access-${s.key}`}>
                  <span className="flex items-center gap-2">
                    <s.Icon className="h-4 w-4" /> {s.label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_24px_70px_-28px_rgba(15,23,42,0.28)] md:flex md:min-h-[640px]">
          {/* Dark rail */}
          <nav
            className="hidden shrink-0 flex-col gap-6 overflow-y-auto bg-slate-900 p-4 md:flex md:w-[248px]"
            aria-label="Access management sections"
            data-testid="nav-access-settings"
          >
            {groups.map((group) => (
              <div key={group.label}>
                <div className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  {group.label}
                </div>
                <div className="flex flex-col gap-1">
                  {group.items.map((s) => {
                    const isActive = active.key === s.key;
                    return (
                      <button
                        key={s.key}
                        type="button"
                        onClick={() => selectSection(s.key)}
                        aria-current={isActive ? "page" : undefined}
                        className={cn(
                          "group flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors",
                          isActive ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5 hover:text-white",
                        )}
                        data-testid={`nav-access-${s.key}`}
                      >
                        <span
                          className={cn(
                            "flex h-7 w-7 items-center justify-center rounded-md bg-white/5",
                            isActive ? "text-white" : s.accent,
                          )}
                        >
                          <s.Icon className="h-4 w-4" />
                        </span>
                        {s.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          {/* Content pane */}
          <div className="flex min-w-0 flex-1 flex-col bg-white">
            <header className="flex items-center gap-3 border-b border-slate-200/80 px-6 py-5">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-slate-900">{active.label}</h2>
                <p className="truncate text-sm text-slate-500">{active.desc}</p>
              </div>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto" data-testid={`panel-access-${active.key}`}>
              {active.render()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
