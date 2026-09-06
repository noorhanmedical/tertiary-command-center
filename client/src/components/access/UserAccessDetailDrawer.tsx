// Phase 4B — User Access Detail drawer.
//
// A right-side drawer integrated into the Admin shell. Loads the full access
// profile (GET /api/access/users/:id) and exposes section-level management:
// Identity, Account, Roles, Organizations, Clinics, Permissions, Service Access,
// Default Workspace, and an Access Summary. Each section saves independently to
// match backend audit granularity; after any mutation we refetch the profile so
// the UI reflects the backend's authoritative recomputation (no optimistic
// privilege state).

import { useEffect, useMemo, useState } from "react";
import { Check } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ROLE_CATALOG } from "@shared/accessControl/catalog";
import { useToast } from "@/hooks/use-toast";
import { useAccess } from "@/lib/access/accessContext";
import {
  accessApi,
  describeAccessError,
  type AccessUserProfile,
} from "@/lib/access/accessApi";
import {
  useAccessUser,
  useAccessRoles,
  useAccessOrganizations,
  useAccessClinics,
  useInvalidateAccessUser,
} from "@/hooks/api/access";
import {
  resolveDisplayName,
  workspaceLabel,
  scopeTypeLabel,
  statusLabel,
  formatTimestamp,
  WORKSPACE_OPTIONS,
} from "@/lib/access/labels";
import { LoadingState, ErrorState, StatusBadge, AccessGroup } from "./AccessPrimitives";
import { PermissionsEditor } from "./PermissionsEditor";
import { ServiceAccessEditor } from "./ServiceAccessEditor";

export function UserAccessDetailDrawer({
  userId,
  onClose,
}: {
  userId: string | null;
  onClose: () => void;
}) {
  const { hasPermission } = useAccess();
  const canManage = hasPermission("users.manage");
  const query = useAccessUser(userId);
  const invalidate = useInvalidateAccessUser();

  const refetchAll = () => {
    query.refetch();
    invalidate(userId ?? undefined);
  };

  return (
    <Sheet open={!!userId} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-2xl"
        data-testid="drawer-user-detail"
      >
        {!userId ? null : query.isLoading ? (
          <LoadingState label="Loading user…" />
        ) : query.isError || !query.data ? (
          <div className="p-6">
            <ErrorState message={describeAccessError(query.error)} onRetry={() => query.refetch()} />
          </div>
        ) : (
          <DetailBody profile={query.data} userId={userId} canManage={canManage} onSaved={refetchAll} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function DetailBody({
  profile,
  userId,
  canManage,
  onSaved,
}: {
  profile: AccessUserProfile;
  userId: string;
  canManage: boolean;
  onSaved: () => void;
}) {
  const rolesQuery = useAccessRoles();
  const primaryRoleLabel = useMemo(() => {
    const key = profile.roles.primary;
    if (!key) return "No role";
    return rolesQuery.data?.find((r) => r.key === key)?.displayName ?? key;
  }, [profile.roles.primary, rolesQuery.data]);

  const name = resolveDisplayName({ ...profile.identity });

  return (
    <>
      {/* At-a-glance header */}
      <SheetHeader className="border-b border-slate-200/80 bg-slate-50/60 px-6 py-5 text-left">
        <SheetTitle className="text-xl">{name}</SheetTitle>
        <SheetDescription className="sr-only">User access detail</SheetDescription>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">
          <span>{primaryRoleLabel}</span>
          <span className="text-slate-300">·</span>
          <StatusBadge status={profile.account.status} />
          <span className="text-slate-300">·</span>
          <span>{workspaceLabel(profile.defaultWorkspace)}</span>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-slate-500 sm:grid-cols-3">
          <SummaryStat label="Username" value={profile.identity.username} />
          <SummaryStat label="Primary Role" value={primaryRoleLabel} />
          <SummaryStat label="Default Workspace" value={workspaceLabel(profile.defaultWorkspace)} />
          <SummaryStat label="Platform Scope" value={profile.accessSummary.platformScope ? "Yes" : "No"} />
          <SummaryStat label="Organizations" value={String(profile.accessSummary.organizationIds.length)} />
          <SummaryStat label="Clinics" value={String(profile.accessSummary.clinicIds.length)} />
        </div>
      </SheetHeader>

      <Tabs defaultValue="profile" className="flex min-h-0 flex-1 flex-col">
        <div className="border-b border-slate-200/80 px-4">
          <TabsList className="h-auto flex-wrap justify-start gap-1 bg-transparent p-0 py-2">
            {["profile", "roles", "scope", "permissions", "services"].map((t) => (
              <TabsTrigger
                key={t}
                value={t}
                className="rounded-md capitalize data-[state=active]:bg-slate-900 data-[state=active]:text-white"
                data-testid={`tab-detail-${t}`}
              >
                {t}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <TabsContent value="profile" className="m-0">
            <IdentitySection profile={profile} userId={userId} canManage={canManage} onSaved={onSaved} />
            <div className="h-px bg-slate-200/70" />
            <AccountSection profile={profile} userId={userId} canManage={canManage} onSaved={onSaved} />
            <div className="h-px bg-slate-200/70" />
            <DefaultWorkspaceSection profile={profile} userId={userId} canManage={canManage} onSaved={onSaved} />
            <div className="h-px bg-slate-200/70" />
            <AccessSummarySection profile={profile} />
          </TabsContent>

          <TabsContent value="roles" className="m-0">
            <RolesSection profile={profile} userId={userId} canManage={canManage} onSaved={onSaved} />
          </TabsContent>

          <TabsContent value="scope" className="m-0">
            <OrganizationsAssignmentSection profile={profile} userId={userId} canManage={canManage} onSaved={onSaved} />
            <div className="h-px bg-slate-200/70" />
            <ClinicsAssignmentSection profile={profile} userId={userId} canManage={canManage} onSaved={onSaved} />
          </TabsContent>

          <TabsContent value="permissions" className="m-0 px-6 py-6">
            <PermissionsEditor userId={userId} profile={profile} canManage={canManage} onSaved={onSaved} />
          </TabsContent>

          <TabsContent value="services" className="m-0 px-6 py-6">
            <ServiceAccessEditor userId={userId} profile={profile} canManage={canManage} onSaved={onSaved} />
          </TabsContent>
        </div>
      </Tabs>
    </>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</div>
      <div className="truncate text-slate-700">{value}</div>
    </div>
  );
}

// ─── Identity ─────────────────────────────────────────────────────────────────

function IdentitySection({ profile, userId, canManage, onSaved }: SectionProps) {
  const { toast } = useToast();
  const [firstName, setFirstName] = useState(profile.identity.firstName ?? "");
  const [lastName, setLastName] = useState(profile.identity.lastName ?? "");
  const [displayName, setDisplayName] = useState(profile.identity.displayName ?? "");
  const [email, setEmail] = useState(profile.identity.email ?? "");
  const [jobTitle, setJobTitle] = useState(profile.identity.jobTitle ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setFirstName(profile.identity.firstName ?? "");
    setLastName(profile.identity.lastName ?? "");
    setDisplayName(profile.identity.displayName ?? "");
    setEmail(profile.identity.email ?? "");
    setJobTitle(profile.identity.jobTitle ?? "");
  }, [profile]);

  async function save() {
    setSaving(true);
    try {
      await accessApi.updateIdentity(userId, {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        displayName: displayName.trim(),
        email: email.trim(),
        jobTitle: jobTitle.trim(),
      });
      toast({ title: "Identity saved" });
      onSaved();
    } catch (err) {
      toast({ title: "Could not save identity", description: describeAccessError(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <AccessGroup title="Identity" desc="Name and contact details. Credentials are never shown.">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="First Name"><Input value={firstName} onChange={(e) => setFirstName(e.target.value)} disabled={!canManage} data-testid="input-firstName" /></Field>
        <Field label="Last Name"><Input value={lastName} onChange={(e) => setLastName(e.target.value)} disabled={!canManage} data-testid="input-lastName" /></Field>
        <Field label="Display Name"><Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} disabled={!canManage} data-testid="input-displayName" /></Field>
        <Field label="Work Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={!canManage} data-testid="input-email" /></Field>
        <Field label="Username"><Input value={profile.identity.username} disabled data-testid="input-username" /></Field>
        <Field label="Job Title"><Input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} disabled={!canManage} data-testid="input-jobTitle" /></Field>
      </div>
      {canManage && (
        <div className="mt-3 flex justify-end">
          <Button size="sm" onClick={save} disabled={saving} data-testid="button-save-identity">
            <Check className="mr-1.5 h-4 w-4" /> {saving ? "Saving…" : "Save Identity"}
          </Button>
        </div>
      )}
    </AccessGroup>
  );
}

// ─── Account ──────────────────────────────────────────────────────────────────

function AccountSection({ profile, userId, canManage, onSaved }: SectionProps) {
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const isActive = profile.account.status === "active";
  const name = resolveDisplayName({ ...profile.identity });

  async function applyStatus(next: string) {
    setSaving(true);
    try {
      await accessApi.setStatus(userId, next);
      toast({ title: next === "active" ? "User reactivated" : "User deactivated" });
      onSaved();
    } catch (err) {
      toast({ title: "Could not change status", description: describeAccessError(err), variant: "destructive" });
    } finally {
      setSaving(false);
      setConfirmOpen(false);
    }
  }

  return (
    <AccessGroup title="Account" desc="Account status, MFA, and activity.">
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
        <Stat label="Status"><StatusBadge status={profile.account.status} /></Stat>
        <Stat label="Active">{profile.account.active ? "Active" : "Inactive"}</Stat>
        <Stat label="MFA Requirement">
          <span className="text-slate-600">
            {profile.account.mfaRequired ? "Configuration present" : "Not required"}
          </span>
          <span className="block text-[11px] text-slate-400">Enforcement not yet enabled</span>
        </Stat>
        <Stat label="Last Login">{formatTimestamp(profile.account.lastLoginAt)}</Stat>
        <Stat label="Created">{formatTimestamp(profile.account.createdAt)}</Stat>
        <Stat label="Updated">{formatTimestamp(profile.account.updatedAt)}</Stat>
      </div>

      {canManage && (
        <div className="mt-4 flex items-center gap-2">
          {isActive ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmOpen(true)}
              disabled={saving}
              data-testid="button-deactivate"
            >
              Deactivate
            </Button>
          ) : (
            <Button size="sm" onClick={() => applyStatus("active")} disabled={saving} data-testid="button-activate">
              Reactivate
            </Button>
          )}
          <span className="text-xs text-slate-400">Deactivation revokes access on the next request.</span>
        </div>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent data-testid="dialog-deactivate">
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate {name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This user will lose access to Plexus on subsequent requests. You can reactivate them later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => applyStatus("inactive")} data-testid="button-confirm-deactivate">
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AccessGroup>
  );
}

// ─── Roles ────────────────────────────────────────────────────────────────────

function RolesSection({ profile, userId, canManage, onSaved }: SectionProps) {
  const { toast } = useToast();
  const rolesQuery = useAccessRoles();
  const [primary, setPrimary] = useState(profile.roles.primary ?? "");
  const [additional, setAdditional] = useState<string[]>(profile.roles.additional);
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    setPrimary(profile.roles.primary ?? "");
    setAdditional(profile.roles.additional);
  }, [profile]);

  const assignableRoles = useMemo(
    () => (rolesQuery.data ?? []).filter((r) => r.isAssignable !== false),
    [rolesQuery.data],
  );
  const roleDetail = (key: string) => ROLE_CATALOG.find((r) => r.key === key);
  const primaryChanged = primary !== (profile.roles.primary ?? "");
  const dirty = primaryChanged || additional.join(",") !== profile.roles.additional.join(",");
  const name = resolveDisplayName({ ...profile.identity });

  function toggleAdditional(key: string) {
    setAdditional((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  async function doSave() {
    setSaving(true);
    try {
      await accessApi.setRoles(userId, primary, additional.filter((k) => k !== primary));
      toast({ title: "Roles saved", description: "Inherited permissions recalculated." });
      onSaved();
    } catch (err) {
      toast({ title: "Could not save roles", description: describeAccessError(err), variant: "destructive" });
    } finally {
      setSaving(false);
      setConfirmOpen(false);
    }
  }

  function requestSave() {
    if (primaryChanged) setConfirmOpen(true);
    else doSave();
  }

  const currentPrimaryLabel = roleDetail(profile.roles.primary ?? "")?.displayName ?? profile.roles.primary ?? "none";
  const nextPrimaryLabel = roleDetail(primary)?.displayName ?? primary;

  return (
    <AccessGroup title="Roles" desc="Primary role and any additional roles. Roles determine inherited permissions.">
      <div className="space-y-4">
        <Field label="Primary Role">
          <Select value={primary} onValueChange={setPrimary} disabled={!canManage}>
            <SelectTrigger data-testid="select-primary-role">
              <SelectValue placeholder="Select a role" />
            </SelectTrigger>
            <SelectContent>
              {assignableRoles.map((r) => (
                <SelectItem key={r.key} value={r.key}>
                  {r.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {primary && (
            <p className="mt-1 text-xs text-slate-400">
              {roleDetail(primary)?.description ?? "System role."} · Scope: {scopeTypeLabel(roleDetail(primary)?.scopeType)} · Default:{" "}
              {workspaceLabel(roleDetail(primary)?.defaultWorkspace)}
            </p>
          )}
        </Field>

        <div>
          <Label className="mb-1.5 block">Additional Roles</Label>
          <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-slate-200/80 p-2">
            {assignableRoles
              .filter((r) => r.key !== primary)
              .map((r) => (
                <label
                  key={r.key}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-slate-50"
                  data-testid={`additional-role-${r.key}`}
                >
                  <Checkbox
                    checked={additional.includes(r.key)}
                    onCheckedChange={() => toggleAdditional(r.key)}
                    disabled={!canManage}
                  />
                  <span className="text-sm text-slate-700">{r.displayName}</span>
                </label>
              ))}
          </div>
        </div>

        {canManage && (
          <div className="flex items-center justify-end gap-2">
            {dirty && <span className="text-xs text-amber-600">Unsaved changes</span>}
            <Button size="sm" onClick={requestSave} disabled={!dirty || saving || !primary} data-testid="button-save-roles">
              <Check className="mr-1.5 h-4 w-4" /> {saving ? "Saving…" : "Save Roles"}
            </Button>
          </div>
        )}
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent data-testid="dialog-role-change">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Change {name} from {currentPrimaryLabel} to {nextPrimaryLabel}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Inherited permissions may change. Explicit grants and denies remain until you edit them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doSave} data-testid="button-confirm-role-change">
              Change Role
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AccessGroup>
  );
}

// ─── Organizations assignment ────────────────────────────────────────────────

function OrganizationsAssignmentSection({ profile, userId, canManage, onSaved }: SectionProps) {
  const { toast } = useToast();
  const orgsQuery = useAccessOrganizations();
  const [selected, setSelected] = useState<{ organizationId: number; isPrimary: boolean }[]>(
    profile.organizations.map((o) => ({ organizationId: o.organizationId, isPrimary: o.isPrimary })),
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSelected(profile.organizations.map((o) => ({ organizationId: o.organizationId, isPrimary: o.isPrimary })));
  }, [profile]);

  const original = profile.organizations.map((o) => `${o.organizationId}:${o.isPrimary}`).sort().join(",");
  const current = selected.map((o) => `${o.organizationId}:${o.isPrimary}`).sort().join(",");
  const dirty = original !== current;

  function toggle(id: number) {
    setSelected((prev) => {
      const exists = prev.find((o) => o.organizationId === id);
      if (exists) return prev.filter((o) => o.organizationId !== id);
      return [...prev, { organizationId: id, isPrimary: prev.length === 0 }];
    });
  }
  function setPrimary(id: number) {
    setSelected((prev) => prev.map((o) => ({ ...o, isPrimary: o.organizationId === id })));
  }

  async function save() {
    setSaving(true);
    try {
      await accessApi.setOrganizations(userId, selected);
      toast({ title: "Organization access saved" });
      onSaved();
    } catch (err) {
      toast({ title: "Could not save organizations", description: describeAccessError(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <AccessGroup title="Organizations" desc="Assign organizations. Mark one primary.">
      <MembershipList
        items={(orgsQuery.data ?? []).map((o) => ({ id: o.id, label: o.name, sub: o.slug }))}
        selected={selected.map((o) => ({ id: o.organizationId, isPrimary: o.isPrimary }))}
        canManage={canManage}
        onToggle={toggle}
        onSetPrimary={setPrimary}
        emptyLabel="No organizations in your scope"
        testPrefix="org"
      />
      {canManage && (
        <div className="mt-3 flex items-center justify-end gap-2">
          {dirty && <span className="text-xs text-amber-600">Unsaved changes</span>}
          <Button size="sm" onClick={save} disabled={!dirty || saving} data-testid="button-save-organizations">
            <Check className="mr-1.5 h-4 w-4" /> {saving ? "Saving…" : "Save Organization Access"}
          </Button>
        </div>
      )}
    </AccessGroup>
  );
}

// ─── Clinics assignment ──────────────────────────────────────────────────────

function ClinicsAssignmentSection({ profile, userId, canManage, onSaved }: SectionProps) {
  const { toast } = useToast();
  const clinicsQuery = useAccessClinics();
  const [selected, setSelected] = useState<{ clinicId: number; isPrimary: boolean }[]>(
    profile.clinics.map((c) => ({ clinicId: c.clinicId, isPrimary: c.isPrimary })),
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSelected(profile.clinics.map((c) => ({ clinicId: c.clinicId, isPrimary: c.isPrimary })));
  }, [profile]);

  const original = profile.clinics.map((c) => `${c.clinicId}:${c.isPrimary}`).sort().join(",");
  const current = selected.map((c) => `${c.clinicId}:${c.isPrimary}`).sort().join(",");
  const dirty = original !== current;

  function toggle(id: number) {
    setSelected((prev) => {
      const exists = prev.find((c) => c.clinicId === id);
      if (exists) return prev.filter((c) => c.clinicId !== id);
      return [...prev, { clinicId: id, isPrimary: prev.length === 0 }];
    });
  }
  function setPrimary(id: number) {
    setSelected((prev) => prev.map((c) => ({ ...c, isPrimary: c.clinicId === id })));
  }

  async function save() {
    setSaving(true);
    try {
      await accessApi.setClinics(userId, selected);
      toast({ title: "Clinic access saved" });
      onSaved();
    } catch (err) {
      toast({ title: "Could not save clinics", description: describeAccessError(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <AccessGroup title="Clinics" desc="Assign clinics. Mark one primary.">
      <MembershipList
        items={(clinicsQuery.data ?? []).map((c) => ({ id: c.id, label: c.name, sub: c.shortName ?? undefined }))}
        selected={selected.map((c) => ({ id: c.clinicId, isPrimary: c.isPrimary }))}
        canManage={canManage}
        onToggle={toggle}
        onSetPrimary={setPrimary}
        emptyLabel="No clinics in your scope"
        testPrefix="clinic"
      />
      {canManage && (
        <div className="mt-3 flex items-center justify-end gap-2">
          {dirty && <span className="text-xs text-amber-600">Unsaved changes</span>}
          <Button size="sm" onClick={save} disabled={!dirty || saving} data-testid="button-save-clinics">
            <Check className="mr-1.5 h-4 w-4" /> {saving ? "Saving…" : "Save Clinic Access"}
          </Button>
        </div>
      )}
    </AccessGroup>
  );
}

function MembershipList({
  items,
  selected,
  canManage,
  onToggle,
  onSetPrimary,
  emptyLabel,
  testPrefix,
}: {
  items: { id: number; label: string; sub?: string }[];
  selected: { id: number; isPrimary: boolean }[];
  canManage: boolean;
  onToggle: (id: number) => void;
  onSetPrimary: (id: number) => void;
  emptyLabel: string;
  testPrefix: string;
}) {
  if (items.length === 0) {
    return <div className="rounded-lg border border-slate-200/80 px-3 py-6 text-center text-sm text-slate-400">{emptyLabel}</div>;
  }
  const sel = new Map(selected.map((s) => [s.id, s.isPrimary]));
  return (
    <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-slate-200/80 p-2">
      {items.map((it) => {
        const isSelected = sel.has(it.id);
        const isPrimary = sel.get(it.id) === true;
        return (
          <div
            key={it.id}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-slate-50"
            data-testid={`${testPrefix}-item-${it.id}`}
          >
            <Checkbox checked={isSelected} onCheckedChange={() => onToggle(it.id)} disabled={!canManage} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-slate-700">{it.label}</div>
              {it.sub && <div className="truncate text-[11px] text-slate-400">{it.sub}</div>}
            </div>
            {isSelected && (
              <button
                type="button"
                disabled={!canManage}
                onClick={() => onSetPrimary(it.id)}
                className={
                  isPrimary
                    ? "rounded-md bg-indigo-100 px-2 py-0.5 text-[11px] font-semibold text-indigo-700"
                    : "rounded-md border border-slate-200 px-2 py-0.5 text-[11px] text-slate-500 hover:bg-slate-100"
                }
                data-testid={`${testPrefix}-primary-${it.id}`}
              >
                {isPrimary ? "Primary" : "Set primary"}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Default workspace ───────────────────────────────────────────────────────

function DefaultWorkspaceSection({ profile, userId, canManage, onSaved }: SectionProps) {
  const { toast } = useToast();
  const [value, setValue] = useState(profile.defaultWorkspace);
  const [saving, setSaving] = useState(false);
  useEffect(() => setValue(profile.defaultWorkspace), [profile]);
  const dirty = value !== profile.defaultWorkspace;

  async function save() {
    setSaving(true);
    try {
      await accessApi.setDefaultWorkspace(userId, value);
      toast({ title: "Default workspace saved" });
      onSaved();
    } catch (err) {
      toast({ title: "Could not save default workspace", description: describeAccessError(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <AccessGroup title="Default Workspace" desc="Where this user lands after signing in.">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Select value={value} onValueChange={setValue} disabled={!canManage}>
            <SelectTrigger data-testid="select-default-workspace">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WORKSPACE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {canManage && (
          <Button size="sm" onClick={save} disabled={!dirty || saving} data-testid="button-save-workspace">
            <Check className="mr-1.5 h-4 w-4" /> {saving ? "Saving…" : "Save"}
          </Button>
        )}
      </div>
    </AccessGroup>
  );
}

// ─── Access summary ──────────────────────────────────────────────────────────

function AccessSummarySection({ profile }: { profile: AccessUserProfile }) {
  return (
    <AccessGroup title="Access Summary" desc="Effective scope resolved by the backend.">
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
        <Stat label="Platform Scope">{profile.accessSummary.platformScope ? "Yes" : "No"}</Stat>
        <Stat label="Organization IDs">
          {profile.accessSummary.organizationIds.length ? profile.accessSummary.organizationIds.join(", ") : "—"}
        </Stat>
        <Stat label="Clinic IDs">
          {profile.accessSummary.clinicIds.length ? profile.accessSummary.clinicIds.join(", ") : "—"}
        </Stat>
        <Stat label="Effective Permissions">{String(profile.permissions.effective.length)}</Stat>
        <Stat label="Effective Services">{String(profile.serviceAccess.effective.length)}</Stat>
      </div>
    </AccessGroup>
  );
}

// ─── Shared field atoms ──────────────────────────────────────────────────────

interface SectionProps {
  profile: AccessUserProfile;
  userId: string;
  canManage: boolean;
  onSaved: () => void;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-slate-500">{label}</Label>
      {children}
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</div>
      <div className="text-sm text-slate-700">{children}</div>
    </div>
  );
}
