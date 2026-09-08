// Phase 4B — Users & Access list. The primary access-management surface.
//
// Compact, operational, enterprise. Filters drive the backend query (search /
// status / role / organization / clinic). Clicking a row opens the full access
// detail drawer. The list deliberately does NOT render a user's permission set.

import { useMemo, useState } from "react";
import { Search, UserPlus, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
import { useAccess } from "@/lib/access/accessContext";
import { PermissionGuard } from "@/lib/access/PermissionGuard";
import {
  useAccessUsers,
  useAccessRoles,
  useAccessOrganizations,
  useAccessClinics,
} from "@/hooks/api/access";
import type { UserListFilters } from "@/lib/access/accessApi";
import { resolveDisplayName, statusLabel, formatTimestamp } from "@/lib/access/labels";
import { AccessGroup, LoadingState, EmptyState, ErrorState, StatusBadge } from "./AccessPrimitives";
import { UserAccessDetailDrawer } from "./UserAccessDetailDrawer";
import { CreateUserDialog } from "./CreateUserDialog";
import { describeAccessError } from "@/lib/access/accessApi";

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "suspended", label: "Suspended" },
];

export function UsersAccessSection() {
  const { hasPermission } = useAccess();
  const canManage = hasPermission("users.manage");

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [role, setRole] = useState("all");
  const [organizationId, setOrganizationId] = useState("all");
  const [clinicId, setClinicId] = useState("all");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const filters: UserListFilters = useMemo(
    () => ({
      search: search.trim() || undefined,
      status: status === "all" ? undefined : status,
      role: role === "all" ? undefined : role,
      organizationId: organizationId === "all" ? undefined : Number(organizationId),
      clinicId: clinicId === "all" ? undefined : Number(clinicId),
    }),
    [search, status, role, organizationId, clinicId],
  );

  const usersQuery = useAccessUsers(filters);
  const rolesQuery = useAccessRoles();
  const orgsQuery = useAccessOrganizations();
  const clinicsQuery = useAccessClinics();

  const hasActiveFilters =
    !!search.trim() || status !== "all" || role !== "all" || organizationId !== "all" || clinicId !== "all";

  function clearFilters() {
    setSearch("");
    setStatus("all");
    setRole("all");
    setOrganizationId("all");
    setClinicId("all");
  }

  const roleLabelByKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rolesQuery.data ?? []) map.set(r.key, r.displayName);
    return map;
  }, [rolesQuery.data]);

  return (
    <AccessGroup
      title="Users"
      desc="Search and filter people, then open a user to manage their access."
      actions={
        canManage ? (
          <Button size="sm" onClick={() => setCreateOpen(true)} data-testid="button-create-user">
            <UserPlus className="mr-1.5 h-4 w-4" /> New User
          </Button>
        ) : undefined
      }
    >
      {/* Filter bar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email, username…"
            className="pl-8"
            data-testid="input-user-search"
          />
        </div>

        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[150px]" data-testid="select-filter-status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={role} onValueChange={setRole}>
          <SelectTrigger className="w-[170px]" data-testid="select-filter-role">
            <SelectValue placeholder="All roles" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All roles</SelectItem>
            {(rolesQuery.data ?? []).map((r) => (
              <SelectItem key={r.key} value={r.key}>
                {r.displayName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={organizationId} onValueChange={setOrganizationId}>
          <SelectTrigger className="w-[170px]" data-testid="select-filter-org">
            <SelectValue placeholder="All organizations" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All organizations</SelectItem>
            {(orgsQuery.data ?? []).map((o) => (
              <SelectItem key={o.id} value={String(o.id)}>
                {o.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={clinicId} onValueChange={setClinicId}>
          <SelectTrigger className="w-[160px]" data-testid="select-filter-clinic">
            <SelectValue placeholder="All clinics" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All clinics</SelectItem>
            {(clinicsQuery.data ?? []).map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters} data-testid="button-clear-filters">
            <X className="mr-1 h-3.5 w-3.5" /> Clear
          </Button>
        )}
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-slate-200/80">
        {usersQuery.isLoading ? (
          <LoadingState label="Loading users…" />
        ) : usersQuery.isError ? (
          <ErrorState message={describeAccessError(usersQuery.error)} onRetry={() => usersQuery.refetch()} />
        ) : (usersQuery.data ?? []).length === 0 ? (
          <EmptyState
            label="No users found"
            hint={hasActiveFilters ? "Try clearing filters to widen the search." : undefined}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/80">
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead className="hidden lg:table-cell">Job Title</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden xl:table-cell">Last Login</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(usersQuery.data ?? []).map((u) => (
                <TableRow
                  key={u.id}
                  className="cursor-pointer"
                  onClick={() => setSelectedUserId(u.id)}
                  data-testid={`row-user-${u.id}`}
                >
                  <TableCell className="font-medium text-slate-900">{resolveDisplayName(u)}</TableCell>
                  <TableCell className="text-slate-600">{u.email ?? "—"}</TableCell>
                  <TableCell className="hidden text-slate-600 lg:table-cell">{u.jobTitle ?? "—"}</TableCell>
                  <TableCell className="text-slate-600">
                    {u.primaryLegacyRole
                      ? roleLabelByKey.get(u.primaryLegacyRole) ?? u.primaryLegacyRole
                      : "—"}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={u.status} />
                  </TableCell>
                  <TableCell className="hidden text-slate-500 xl:table-cell">
                    {formatTimestamp(u.lastLoginAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedUserId(u.id);
                      }}
                      data-testid={`button-manage-${u.id}`}
                    >
                      Manage
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {(usersQuery.data ?? []).length > 0 && (
        <p className="mt-2 text-xs text-slate-400">
          {usersQuery.data!.length} user{usersQuery.data!.length === 1 ? "" : "s"}. Organization and clinic
          membership are shown in each user's detail.
        </p>
      )}

      <UserAccessDetailDrawer
        userId={selectedUserId}
        onClose={() => setSelectedUserId(null)}
      />

      <PermissionGuard permission="users.manage">
        <CreateUserDialog open={createOpen} onOpenChange={setCreateOpen} />
      </PermissionGuard>
    </AccessGroup>
  );
}
