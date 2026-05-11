import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Users, Plus, Trash2, UserX, UserCheck, Settings2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { PageHeader } from "@/components/PageHeader";
import {
  TEAM_MEMBER_WORKSPACE_TYPES,
  TEAM_MEMBER_WORKSPACE_MODES,
  defaultPatientCareSpecialistProfile,
  defaultAncillaryCareSpecialistProfile,
  fallbackWorkspaceTypeForRole,
  type TeamMemberProfileSetting,
  type TeamMemberWorkspaceType,
  type TeamMemberWorkspaceMode,
} from "@shared/teamMemberProfile";
import {
  fetchTeamMemberProfile,
  saveTeamMemberProfile,
} from "@/lib/workflow/teamMemberProfileApi";

type TeamUser = {
  id: string;
  username: string;
  role?: string | null;
  active?: boolean;
};

const USER_ROLE_OPTIONS = [
  "admin",
  "clinician",
  "scheduler",
  "technician",
  "liaison",
  "biller",
] as const;

function formatList(arr: string[]): string {
  return arr.join(", ");
}

function parseList(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const WORKSPACE_TYPE_LABELS: Record<TeamMemberWorkspaceType, string> = {
  patientCareSpecialist: "Patient Care Specialist Workspace",
  ancillaryCareSpecialist: "Ancillary Care Specialist Workspace",
};

const WORKSPACE_MODE_LABELS: Record<TeamMemberWorkspaceMode, string> = {
  clinicSchedule: "Clinic Schedule",
  ancillarySchedule: "Ancillary Schedule",
  callList: "Call List",
};

export default function AdminUsersPage() {
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TeamUser | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<TeamUser | null>(null);
  const [profileTarget, setProfileTarget] = useState<TeamUser | null>(null);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<string>("clinician");
  const [fieldError, setFieldError] = useState<string | null>(null);

  const { data: users = [], isLoading } = useQuery<TeamUser[]>({
    queryKey: ["/api/users"],
  });

  const createMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/users", { username: username.trim(), password, role }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setAddOpen(false);
      setUsername("");
      setPassword("");
      setRole("clinician");
      setFieldError(null);
      toast({ title: "User created", description: `Account "${username.trim()}" has been created.` });
    },
    onError: (err: any) => {
      const raw: string = err?.message ?? "";
      const jsonStart = raw.indexOf("{");
      let serverMsg = "";
      if (jsonStart !== -1) {
        try {
          const parsed = JSON.parse(raw.slice(jsonStart));
          serverMsg = parsed?.message ?? "";
        } catch {}
      }
      const lower = (serverMsg || raw).toLowerCase();
      if (lower.includes("already exists") || lower.includes("duplicate") || raw.startsWith("409")) {
        setFieldError("That username is already taken.");
      } else {
        setFieldError(serverMsg || "Failed to create user.");
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/users/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setDeleteTarget(null);
      toast({ title: "User removed", description: "The account has been permanently deleted." });
    },
    onError: (err: any) => {
      const raw: string = err?.message ?? "";
      const jsonStart = raw.indexOf("{");
      let msg = "Failed to delete user.";
      if (jsonStart !== -1) {
        try { msg = JSON.parse(raw.slice(jsonStart))?.message || msg; } catch {}
      }
      toast({ title: "Error", description: msg, variant: "destructive" });
      setDeleteTarget(null);
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => apiRequest("PATCH", `/api/users/${id}/deactivate`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setDeactivateTarget(null);
      toast({ title: "User deactivated", description: "The account has been deactivated." });
    },
    onError: (err: any) => {
      const raw: string = err?.message ?? "";
      const jsonStart = raw.indexOf("{");
      let msg = "Failed to deactivate user.";
      if (jsonStart !== -1) {
        try { msg = JSON.parse(raw.slice(jsonStart))?.message || msg; } catch {}
      }
      toast({ title: "Error", description: msg, variant: "destructive" });
      setDeactivateTarget(null);
    },
  });

  function handleAddSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldError(null);
    if (!username.trim()) {
      setFieldError("Username is required.");
      return;
    }
    if (!password) {
      setFieldError("Password is required.");
      return;
    }
    createMutation.mutate();
  }

  return (
    <div className="finance-page">
      <div className="mx-auto flex w-full max-w-[900px] flex-col gap-6 px-6 py-6">
        <PageHeader
          backHref="/admin"
          eyebrow="PLEXUS ANCILLARY · USERS"
          icon={Users}
          iconAccent="bg-amber-100 text-amber-700"
          title="User Management"
          subtitle="Create and manage team accounts."
          actions={
            <Button
              onClick={() => {
                setAddOpen(true);
                setFieldError(null);
                setUsername("");
                setPassword("");
                setRole("clinician");
              }}
              data-testid="button-add-user"
              className="gap-2"
            >
              <Plus className="h-4 w-4" />
              Add User
            </Button>
          }
        />

        <Card className="rounded-3xl border border-white/60 bg-white/75 shadow-[0_18px_60px_rgba(15,23,42,0.08)] backdrop-blur-xl overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-slate-400 text-sm">
              Loading users…
            </div>
          ) : users.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-slate-400 text-sm">
              No users found.
            </div>
          ) : (
            <table className="w-full text-sm" data-testid="table-users">
              <thead>
                <tr className="border-b border-slate-100 text-left">
                  <th className="px-6 py-3 font-medium text-slate-500">Username</th>
                  <th className="px-6 py-3 font-medium text-slate-500">Role</th>
                  <th className="px-6 py-3 font-medium text-slate-500">ID</th>
                  <th className="px-6 py-3 font-medium text-slate-500">Status</th>
                  <th className="px-6 py-3 font-medium text-slate-500 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {users.map((u) => (
                  <tr key={u.id} data-testid={`row-user-${u.id}`} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-3 font-medium text-slate-800" data-testid={`text-username-${u.id}`}>
                      {u.username}
                    </td>
                    <td className="px-6 py-3 text-slate-600 capitalize">
                      {u.role ?? "—"}
                    </td>
                    <td className="px-6 py-3 text-slate-400 font-mono text-xs">{u.id}</td>
                    <td className="px-6 py-3">
                      {u.active !== false ? (
                        <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 border-emerald-200" data-testid={`status-active-${u.id}`}>
                          Active
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="bg-slate-100 text-slate-500" data-testid={`status-inactive-${u.id}`}>
                          Inactive
                        </Badge>
                      )}
                    </td>
                    <td className="px-6 py-3 text-right">
                      <div className="flex items-center justify-end gap-2 flex-wrap">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1 text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                          onClick={() => setProfileTarget(u)}
                          data-testid={`button-profile-${u.id}`}
                        >
                          <Settings2 className="h-3.5 w-3.5" />
                          Profile
                        </Button>
                        {u.active !== false && u.username !== "admin" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="gap-1 text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                            onClick={() => setDeactivateTarget(u)}
                            data-testid={`button-deactivate-${u.id}`}
                          >
                            <UserX className="h-3.5 w-3.5" />
                            Deactivate
                          </Button>
                        )}
                        {u.active === false && (
                          <span className="text-xs text-slate-400 italic flex items-center gap-1">
                            <UserCheck className="h-3.5 w-3.5" />
                            Deactivated
                          </span>
                        )}
                        {u.username !== "admin" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="gap-1 text-red-500 hover:text-red-600 hover:bg-red-50"
                            onClick={() => setDeleteTarget(u)}
                            data-testid={`button-delete-${u.id}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent data-testid="dialog-add-user">
          <DialogHeader>
            <DialogTitle>Add User</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-username">Username</Label>
              <Input
                id="new-username"
                data-testid="input-new-username"
                value={username}
                onChange={(e) => { setUsername(e.target.value); setFieldError(null); }}
                placeholder="e.g. jsmith"
                autoComplete="off"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-password">Initial password</Label>
              <Input
                id="new-password"
                type="password"
                data-testid="input-new-password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setFieldError(null); }}
                placeholder="Set a temporary password"
                autoComplete="new-password"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-role">Role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger id="new-role" data-testid="select-new-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {USER_ROLE_OPTIONS.map((r) => (
                    <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-slate-500">
                You can refine workspace assignments via the user's Profile after creation.
              </p>
            </div>
            {fieldError && (
              <p className="text-sm text-red-600" data-testid="text-field-error">{fieldError}</p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)} data-testid="button-cancel-add">
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending} data-testid="button-confirm-add">
                {createMutation.isPending ? "Creating…" : "Create User"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {profileTarget && (
        <TeamMemberProfileDialog
          user={profileTarget}
          onClose={() => setProfileTarget(null)}
        />
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent data-testid="dialog-confirm-delete">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleteTarget?.username}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the account. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deactivateTarget} onOpenChange={(o) => { if (!o) setDeactivateTarget(null); }}>
        <AlertDialogContent data-testid="dialog-confirm-deactivate">
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate "{deactivateTarget?.username}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will mark the account as inactive. The user will still exist but will be flagged as deactivated. You can delete the account afterwards if needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-deactivate">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-600 hover:bg-amber-700"
              onClick={() => deactivateTarget && deactivateMutation.mutate(deactivateTarget.id)}
              data-testid="button-confirm-deactivate"
            >
              {deactivateMutation.isPending ? "Deactivating…" : "Deactivate"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function TeamMemberProfileDialog({
  user,
  onClose,
}: {
  user: TeamUser;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const fallbackType = fallbackWorkspaceTypeForRole(user.role);
  const fallbackProfile =
    fallbackType === "ancillaryCareSpecialist"
      ? defaultAncillaryCareSpecialistProfile
      : defaultPatientCareSpecialistProfile;

  const [profile, setProfile] = useState<TeamMemberProfileSetting>({
    ...fallbackProfile,
    capabilities: { ...fallbackProfile.capabilities },
  });
  const [facilitiesText, setFacilitiesText] = useState("");
  const [serviceTypesText, setServiceTypesText] = useState("");

  const { data: loaded, isLoading } = useQuery({
    queryKey: ["/api/admin-settings/effective", "team_member", "workspace_profile", user.id],
    queryFn: () => fetchTeamMemberProfile(user.id, user.role ?? null),
  });

  useEffect(() => {
    if (loaded) {
      setProfile(loaded);
      setFacilitiesText(formatList(loaded.assignedFacilityIds));
      setServiceTypesText(formatList(loaded.allowedServiceTypes ?? []));
    }
  }, [loaded]);

  const saveMutation = useMutation({
    mutationFn: () =>
      saveTeamMemberProfile(user.id, {
        ...profile,
        assignedFacilityIds: parseList(facilitiesText),
        allowedServiceTypes: parseList(serviceTypesText),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin-settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin-settings/effective"] });
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "Profile saved", description: `Updated profile for "${user.username}".` });
      onClose();
    },
    onError: (err: any) => {
      const raw: string = err?.message ?? "Failed to save profile.";
      toast({ title: "Save failed", description: raw, variant: "destructive" });
    },
  });

  const isAncillary = profile.workspaceType === "ancillaryCareSpecialist";

  function setCap(key: keyof TeamMemberProfileSetting["capabilities"], v: boolean) {
    setProfile((p) => ({
      ...p,
      capabilities: { ...p.capabilities, [key]: v },
    }));
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg" data-testid="dialog-team-member-profile">
        <DialogHeader>
          <DialogTitle>Team Member Profile — {user.username}</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="py-6 text-center text-sm text-slate-500">Loading profile…</div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Workspace Type</Label>
              <Select
                value={profile.workspaceType}
                onValueChange={(v) =>
                  setProfile((p) => ({
                    ...p,
                    workspaceType: v as TeamMemberWorkspaceType,
                    defaultMode:
                      v === "ancillaryCareSpecialist" ? "clinicSchedule" : "callList",
                  }))
                }
              >
                <SelectTrigger data-testid="select-profile-workspace-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TEAM_MEMBER_WORKSPACE_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{WORKSPACE_TYPE_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="profile-facilities">Assigned facilities</Label>
              <Input
                id="profile-facilities"
                value={facilitiesText}
                onChange={(e) => setFacilitiesText(e.target.value)}
                placeholder="e.g. NWPG - Spring, Taylor Family Practice"
                data-testid="input-profile-facilities"
              />
              <p className="text-[11px] text-slate-500">Comma-separated facility names/IDs.</p>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="profile-default-facility">Default facility</Label>
              <Input
                id="profile-default-facility"
                value={profile.defaultFacilityId ?? ""}
                onChange={(e) =>
                  setProfile((p) => ({ ...p, defaultFacilityId: e.target.value.trim() || null }))
                }
                placeholder="optional"
                data-testid="input-profile-default-facility"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Default Mode</Label>
              <Select
                value={profile.defaultMode ?? "clinicSchedule"}
                onValueChange={(v) =>
                  setProfile((p) => ({ ...p, defaultMode: v as TeamMemberWorkspaceMode }))
                }
              >
                <SelectTrigger data-testid="select-profile-default-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TEAM_MEMBER_WORKSPACE_MODES.map((m) => (
                    <SelectItem key={m} value={m}>{WORKSPACE_MODE_LABELS[m]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label>Capabilities</Label>
              <CapabilityCheckbox
                label="Can call and schedule"
                checked={!!profile.capabilities.callAndSchedule}
                onChange={(v) => setCap("callAndSchedule", v)}
                testId="checkbox-cap-callAndSchedule"
              />
              <CapabilityCheckbox
                label="Can complete procedure (ACS only)"
                checked={!!profile.capabilities.completeProcedure && isAncillary}
                disabled={!isAncillary}
                onChange={(v) => setCap("completeProcedure", v)}
                testId="checkbox-cap-completeProcedure"
              />
              <CapabilityCheckbox
                label="Can manage consent / screening (ACS only)"
                checked={!!profile.capabilities.primaryConsentScreening && isAncillary}
                disabled={!isAncillary}
                onChange={(v) => setCap("primaryConsentScreening", v)}
                testId="checkbox-cap-primaryConsentScreening"
              />
              <CapabilityCheckbox
                label="Can upload procedure report (ACS only)"
                checked={!!profile.capabilities.uploadProcedureReport && isAncillary}
                disabled={!isAncillary}
                onChange={(v) => setCap("uploadProcedureReport", v)}
                testId="checkbox-cap-uploadProcedureReport"
              />
              <CapabilityCheckbox
                label="Can view all facilities"
                checked={!!profile.capabilities.viewAllFacilities}
                onChange={(v) => setCap("viewAllFacilities", v)}
                testId="checkbox-cap-viewAllFacilities"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="profile-service-types">Allowed Service Types</Label>
              <Input
                id="profile-service-types"
                value={serviceTypesText}
                onChange={(e) => setServiceTypesText(e.target.value)}
                placeholder="e.g. BrainWave, VitalWave, Ultrasound"
                data-testid="input-profile-service-types"
              />
              <p className="text-[11px] text-slate-500">Comma-separated; leave empty for all allowed.</p>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} data-testid="button-profile-cancel">
            Cancel
          </Button>
          <Button
            type="button"
            disabled={saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
            data-testid="button-profile-save"
          >
            {saveMutation.isPending ? "Saving…" : "Save Profile"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CapabilityCheckbox({
  label,
  checked,
  onChange,
  disabled,
  testId,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  testId: string;
}) {
  return (
    <label
      className={`flex items-center gap-2 text-sm ${disabled ? "opacity-50" : ""}`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        data-testid={testId}
        className="h-4 w-4 accent-plexus-navy-800"
      />
      <span className="text-slate-700">{label}</span>
    </label>
  );
}
