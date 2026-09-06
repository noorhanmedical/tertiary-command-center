// Phase 4B — Roles & Permissions catalog (READ-ONLY).
//
// Shows system role templates and the permission catalog. No creation, no
// deletion, no template editing in this phase. Selecting a role reveals its
// default permissions and service access (GET /api/access/roles/:key).

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAccessRoles, useAccessRole, useAccessPermissions } from "@/hooks/api/access";
import { describeAccessError } from "@/lib/access/accessApi";
import { scopeTypeLabel, workspaceLabel } from "@/lib/access/labels";
import { AccessGroup, LoadingState, EmptyState, ErrorState } from "./AccessPrimitives";

export function RolesCatalogSection() {
  const rolesQuery = useAccessRoles();
  const permsQuery = useAccessPermissions();
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [showPerms, setShowPerms] = useState(false);

  return (
    <>
      <AccessGroup
        title="System Roles"
        desc="Read-only role templates. Custom roles and template editing are not available yet."
        actions={
          <Button variant="outline" size="sm" onClick={() => setShowPerms((v) => !v)} data-testid="button-toggle-permission-catalog">
            {showPerms ? "Hide permission catalog" : "View permission catalog"}
          </Button>
        }
      >
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          {/* Role list */}
          <div className="overflow-hidden rounded-xl border border-slate-200/80">
            {rolesQuery.isLoading ? (
              <LoadingState label="Loading roles…" />
            ) : rolesQuery.isError ? (
              <ErrorState message={describeAccessError(rolesQuery.error)} onRetry={() => rolesQuery.refetch()} />
            ) : (rolesQuery.data ?? []).length === 0 ? (
              <EmptyState label="No roles" />
            ) : (
              <div className="max-h-[520px] divide-y divide-slate-100 overflow-y-auto">
                {(rolesQuery.data ?? []).map((r) => (
                  <button
                    key={r.key}
                    type="button"
                    onClick={() => setSelectedRole(r.key)}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-slate-50",
                      selectedRole === r.key && "bg-slate-50",
                    )}
                    data-testid={`role-item-${r.key}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-slate-800">{r.displayName}</span>
                        {r.isAssignable === false && (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                            Not assignable
                          </span>
                        )}
                      </div>
                      <div className="truncate text-[11px] text-slate-400">
                        {scopeTypeLabel(r.scopeType)} scope · {workspaceLabel(r.defaultWorkspace)}
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Role detail */}
          <div className="rounded-xl border border-slate-200/80 p-4">
            {selectedRole ? (
              <RoleDetail roleKey={selectedRole} />
            ) : (
              <div className="flex h-full items-center justify-center py-12 text-sm text-slate-400">
                Select a role to see its default permissions.
              </div>
            )}
          </div>
        </div>
      </AccessGroup>

      {showPerms && (
        <>
          <div className="h-px bg-slate-200/70" />
          <AccessGroup title="Permission Catalog" desc="All permission keys grouped by category.">
            {permsQuery.isLoading ? (
              <LoadingState label="Loading permissions…" />
            ) : permsQuery.isError ? (
              <ErrorState message={describeAccessError(permsQuery.error)} onRetry={() => permsQuery.refetch()} />
            ) : (
              <PermissionCatalog rows={permsQuery.data ?? []} />
            )}
          </AccessGroup>
        </>
      )}
    </>
  );
}

function RoleDetail({ roleKey }: { roleKey: string }) {
  const query = useAccessRole(roleKey);
  if (query.isLoading) return <LoadingState label="Loading role…" />;
  if (query.isError || !query.data) return <ErrorState message={describeAccessError(query.error)} onRetry={() => query.refetch()} />;
  const role = query.data;
  return (
    <div className="space-y-4" data-testid={`role-detail-${roleKey}`}>
      <div>
        <h4 className="text-base font-semibold text-slate-900">{role.displayName}</h4>
        <p className="mt-0.5 text-sm text-slate-500">{role.description ?? "System role."}</p>
      </div>
      <div className="grid grid-cols-2 gap-3 text-xs">
        <Meta label="Scope Type" value={scopeTypeLabel(role.scopeType)} />
        <Meta label="Default Workspace" value={workspaceLabel(role.defaultWorkspace)} />
        <Meta label="Assignable" value={role.isAssignable === false ? "No" : "Yes"} />
        <Meta label="System Role" value={role.isSystem ? "Yes" : "—"} />
      </div>
      <div>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Default Permissions</div>
        {role.defaultPermissions.length === 0 ? (
          <p className="text-xs text-slate-400">No default permissions.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {role.defaultPermissions.map((p) => (
              <code key={p} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{p}</code>
            ))}
          </div>
        )}
      </div>
      <div>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Default Service Access</div>
        {role.defaultServiceAccess.length === 0 ? (
          <p className="text-xs text-slate-400">No default service access.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {role.defaultServiceAccess.map((s) => (
              <code key={s} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{s}</code>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PermissionCatalog({ rows }: { rows: { key: string; category: string; description: string }[] }) {
  const groups: { category: string; items: typeof rows }[] = [];
  for (const r of rows) {
    let g = groups.find((x) => x.category === r.category);
    if (!g) { g = { category: r.category, items: [] }; groups.push(g); }
    g.items.push(r);
  }
  if (groups.length === 0) return <EmptyState label="No permissions" />;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {groups.map((g) => (
        <div key={g.category}>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{g.category}</div>
          <div className="divide-y divide-slate-100 rounded-lg border border-slate-200/80">
            {g.items.map((p) => (
              <div key={p.key} className="px-3 py-2">
                <code className="text-[12px] font-medium text-slate-700">{p.key}</code>
                <div className="text-[11px] text-slate-400">{p.description}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200/70 px-2.5 py-1.5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</div>
      <div className="text-slate-700">{value}</div>
    </div>
  );
}
