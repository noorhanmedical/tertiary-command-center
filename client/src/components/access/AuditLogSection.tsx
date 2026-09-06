// Phase 4B — Audit Log. Scope-aware (platform vs organization), human-readable
// actions, and readable before/after diffs. Raw JSON is available on demand but
// is never the default presentation.

import { useState } from "react";
import { ChevronDown, ChevronRight, ShieldCheck, Building2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAccessAudit } from "@/hooks/api/access";
import { describeAccessError, type AccessAuditRow } from "@/lib/access/accessApi";
import { auditActionLabel, formatTimestamp, workspaceLabel } from "@/lib/access/labels";
import { AccessGroup, LoadingState, EmptyState, ErrorState } from "./AccessPrimitives";

export function AuditLogSection() {
  const query = useAccessAudit(true, 200);

  return (
    <AccessGroup
      title="Audit Log"
      desc="Access-management events within your authorized scope."
      actions={
        query.data ? (
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-semibold",
              query.data.scope === "platform"
                ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                : "border-emerald-200 bg-emerald-50 text-emerald-700",
            )}
            data-testid="audit-scope-badge"
          >
            {query.data.scope === "platform" ? <ShieldCheck className="h-3.5 w-3.5" /> : <Building2 className="h-3.5 w-3.5" />}
            {query.data.scope === "platform" ? "Platform-wide" : "Organization scope"}
          </span>
        ) : undefined
      }
    >
      {query.isLoading ? (
        <LoadingState label="Loading audit events…" />
      ) : query.isError ? (
        <ErrorState message={describeAccessError(query.error)} onRetry={() => query.refetch()} />
      ) : (query.data?.rows ?? []).length === 0 ? (
        <EmptyState label="No audit events" hint="Access-management changes will appear here." />
      ) : (
        <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200/80">
          {query.data!.rows.map((row) => (
            <AuditEntry key={row.id} row={row} />
          ))}
        </div>
      )}
    </AccessGroup>
  );
}

function AuditEntry({ row }: { row: AccessAuditRow }) {
  const [open, setOpen] = useState(false);
  const [rawOpen, setRawOpen] = useState(false);
  const diffs = readableDiff(row);

  return (
    <div className="px-3 py-2.5" data-testid={`audit-row-${row.id}`}>
      <button
        type="button"
        className="flex w-full items-center gap-3 text-left"
        onClick={() => setOpen((v) => !v)}
        data-testid={`audit-toggle-${row.id}`}
      >
        {open ? <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" /> : <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-sm font-medium text-slate-800">{auditActionLabel(row.action)}</span>
            <span className="text-xs text-slate-400">by {row.username ?? "system"}</span>
          </div>
          <div className="text-[11px] text-slate-400">
            {formatTimestamp(row.createdAt)}
            {row.entityId ? ` · target ${shorten(row.entityId)}` : ""}
            {row.clinicId != null ? ` · clinic ${row.clinicId}` : ""}
          </div>
        </div>
      </button>

      {open && (
        <div className="mt-2 space-y-2 pl-7">
          {diffs.length === 0 ? (
            <p className="text-xs text-slate-400">No field-level changes recorded.</p>
          ) : (
            <div className="space-y-1.5">
              {diffs.map((d, i) => (
                <div key={i} className="rounded-lg bg-slate-50 px-3 py-2 text-xs" data-testid={`audit-diff-${row.id}-${i}`}>
                  <div className="font-semibold text-slate-600">{d.label}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2">
                    <span className="text-slate-400">Before:</span>
                    <span className="text-slate-700">{d.before}</span>
                    <span className="text-slate-300">→</span>
                    <span className="text-slate-400">After:</span>
                    <span className="font-medium text-slate-800">{d.after}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
          <button
            type="button"
            className="text-[11px] font-medium text-indigo-600 hover:underline"
            onClick={() => setRawOpen((v) => !v)}
            data-testid={`audit-raw-toggle-${row.id}`}
          >
            {rawOpen ? "Hide technical detail" : "Show technical detail"}
          </button>
          {rawOpen && (
            <pre className="max-h-64 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-100">
              {JSON.stringify(row.changes, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function shorten(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

interface Diff {
  label: string;
  before: string;
  after: string;
}

/** Turn a raw audit `changes` object into readable before/after rows. */
function readableDiff(row: AccessAuditRow): Diff[] {
  const c = (row.changes ?? {}) as Record<string, any>;
  const before = c.before;
  const after = c.after;
  const out: Diff[] = [];

  switch (row.action) {
    case "user.role.assigned": {
      const beforePrimary = Array.isArray(before) ? before.find((b: any) => b.primary)?.key ?? "—" : "—";
      out.push({ label: "Primary Role", before: beforePrimary, after: after?.primary ?? "—" });
      const beforeAdd = Array.isArray(before) ? before.filter((b: any) => !b.primary).map((b: any) => b.key) : [];
      out.push({ label: "Additional Roles", before: listOrDash(beforeAdd), after: listOrDash(after?.additional) });
      return out;
    }
    case "user.status.changed":
      return [{ label: "Account Status", before: before?.status ?? "—", after: after?.status ?? "—" }];
    case "user.default_workspace.changed":
      return [{ label: "Default Workspace", before: workspaceLabel(before), after: workspaceLabel(after) }];
    case "user.permission.override_set":
      return overrideDiff("Permission", before, after);
    case "user.service_access.set":
      return overrideDiff("Service", before, after);
    case "user.organization.assigned":
      return [{ label: "Organizations", before: membershipList(before, "organizationId"), after: membershipList(after, "organizationId") }];
    case "user.clinic.assigned":
      return [{ label: "Clinics", before: membershipList(before, "clinicId"), after: membershipList(after, "clinicId") }];
    case "user.identity.updated": {
      if (after && typeof after === "object") {
        for (const [k, v] of Object.entries(after)) out.push({ label: humanizeField(k), before: "—", after: String(v ?? "—") });
      }
      return out;
    }
    default:
      if (before !== undefined || after !== undefined) {
        return [{ label: "Change", before: compact(before), after: compact(after) }];
      }
      return out;
  }
}

function overrideDiff(kind: string, before: any, after: any): Diff[] {
  const bGrants = new Set<string>(before?.grants ?? []);
  const aGrants = new Set<string>(after?.grants ?? []);
  const bDenies = new Set<string>(before?.denies ?? []);
  const aDenies = new Set<string>(after?.denies ?? []);
  const out: Diff[] = [];
  const grantsChanged = [...aGrants].sort().join(",") !== [...bGrants].sort().join(",");
  const deniesChanged = [...aDenies].sort().join(",") !== [...bDenies].sort().join(",");
  if (grantsChanged) out.push({ label: `${kind} Grants`, before: setOrDash(bGrants), after: setOrDash(aGrants) });
  if (deniesChanged) out.push({ label: `${kind} Denies`, before: setOrDash(bDenies), after: setOrDash(aDenies) });
  if (out.length === 0) out.push({ label: `${kind} Overrides`, before: "unchanged", after: "unchanged" });
  return out;
}

function listOrDash(arr: any): string {
  return Array.isArray(arr) && arr.length ? arr.join(", ") : "—";
}
function setOrDash(s: Set<string>): string {
  return s.size ? [...s].join(", ") : "none";
}
function membershipList(arr: any, key: string): string {
  if (!Array.isArray(arr) || arr.length === 0) return "—";
  return arr.map((x: any) => `${x[key]}${x.isPrimary ? " (primary)" : ""}`).join(", ");
}
function humanizeField(k: string): string {
  return k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}
function compact(v: any): string {
  if (v == null) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
