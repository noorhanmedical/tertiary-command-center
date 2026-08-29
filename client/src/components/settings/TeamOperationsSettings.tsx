// Team Operations — canonical Admin Settings surface (Phase 4C).
//
// The authoritative management surface for teams, memberships, managers,
// facility coverage, and the coherent per-member operational profile
// (identity / teams / facilities / portal / call work / phone / management).
// Engagement/messaging/tasks CONSUME these; they are not configured elsewhere.

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { VALID_FACILITIES } from "@shared/plexus";

type Team = { id: number; name: string; slug: string; type: string; facilityId: string | null; active: boolean };
type Membership = { id: number; teamId: number; userId: string; membershipRole: string; primaryTeam: boolean; active: boolean };
type ManagerRel = { id: number; managerUserId: string; teamId: number | null; active: boolean };
type DirUser = { id: string; username: string; role: string | null; active: boolean };
type MemberProfile = {
  identity: { userId: string; username: string; role: string | null; active: boolean };
  facilities: { coverage: { facilityId: string; coverageType: string; primaryCoverage: boolean }[] };
  portal: { workspaceType: string; defaultMode: string; defaultLeftTab: string };
  callWork: { schedulerId?: number; callWorkdayPercent?: number } | null;
};

async function api<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", headers: { "Content-Type": "application/json" }, ...opts });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Request failed (${res.status})`);
  return res.json();
}

const TEAM_TYPES = ["PCS", "ACS", "management", "custom"] as const;

function usernameFor(users: DirUser[], id: string): string {
  return users.find((u) => u.id === id)?.username ?? `${id.slice(0, 8)}…`;
}

// Per-member operational profile editor (K9): facility coverage + workload %.
// Seeds from GET /api/teams/member-profile/:userId; writes via the canonical
// Phase 4 routes (coverage) + engagement call settings (workload %).
function MemberProfileEditor({ userId, username, schedulerId }: { userId: string; username: string; schedulerId: number | null }) {
  const queryClient = useQueryClient();
  const { data: profile, isLoading } = useQuery<MemberProfile>({
    queryKey: ["/api/teams/member-profile", userId],
    queryFn: () => api<MemberProfile>(`/api/teams/member-profile/${userId}`),
  });
  const [addFacility, setAddFacility] = useState("");
  const [addType, setAddType] = useState<"primary" | "regular" | "temporary">("regular");

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/teams/member-profile", userId] });
  const addCoverage = useMutation({
    mutationFn: () => api(`/api/teams/member/${userId}/coverage`, { method: "POST", body: JSON.stringify({ facilityId: addFacility, coverageType: addType }) }),
    onSuccess: () => { setAddFacility(""); invalidate(); },
  });
  const removeCoverage = useMutation({
    mutationFn: (facilityId: string) => api(`/api/teams/member/${userId}/coverage/${encodeURIComponent(facilityId)}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
  // Workload % writes to the per-member engagement call settings (keyed by the
  // roster scheduler id). Resolve it from the profile's callWork row, falling
  // back to the schedulerId passed by the parent.
  const resolvedSchedulerId = profile?.callWork?.schedulerId ?? schedulerId;
  const setWorkload = useMutation({
    mutationFn: (pct: number) => {
      if (resolvedSchedulerId == null) throw new Error("This user has no call-team roster row.");
      return api(`/api/engagement/call-settings/${resolvedSchedulerId}`, { method: "PATCH", body: JSON.stringify({ callWorkdayPercent: pct }) });
    },
    onSuccess: invalidate,
  });

  const coverage = profile?.facilities.coverage ?? [];
  const coveredIds = new Set(coverage.map((c) => c.facilityId));
  const workloadPct = profile?.callWork?.callWorkdayPercent ?? 100;
  const hasRoster = resolvedSchedulerId != null;

  return (
    <Card data-testid="member-profile-editor">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{username} — operational profile</CardTitle>
        {profile ? (
          <p className="text-sm text-muted-foreground">
            {profile.portal.workspaceType} · default {profile.portal.defaultMode} · left tab {profile.portal.defaultLeftTab}
          </p>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? <p className="text-sm text-muted-foreground">Loading profile…</p> : (
          <>
            <div>
              <h4 className="mb-1 text-sm font-semibold">Facility coverage</h4>
              <ul className="space-y-1 text-sm" data-testid="member-coverage-list">
                {coverage.map((c) => (
                  <li key={c.facilityId} className="flex items-center gap-2" data-testid={`coverage-${c.facilityId}`}>
                    <span className="flex-1 truncate">{c.facilityId}</span>
                    <Badge variant={c.primaryCoverage ? "default" : "outline"}>{c.coverageType}</Badge>
                    <button className="text-muted-foreground hover:text-red-600" onClick={() => removeCoverage.mutate(c.facilityId)} data-testid={`remove-coverage-${c.facilityId}`}>
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
                {coverage.length === 0 && <li className="text-muted-foreground">No coverage — covers any facility.</li>}
              </ul>
              <div className="mt-2 flex gap-1">
                <Select value={addFacility} onValueChange={setAddFacility}>
                  <SelectTrigger className="h-8 flex-1 text-xs" data-testid="add-coverage-facility"><SelectValue placeholder="Add facility…" /></SelectTrigger>
                  <SelectContent>{VALID_FACILITIES.filter((f) => !coveredIds.has(f)).map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={addType} onValueChange={(v) => setAddType(v as typeof addType)}>
                  <SelectTrigger className="h-8 w-[110px] text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{(["primary", "regular", "temporary"] as const).map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
                <Button size="sm" disabled={!addFacility || addCoverage.isPending} onClick={() => addCoverage.mutate()} data-testid="add-coverage-button">Add</Button>
              </div>
            </div>

            <div>
              <h4 className="mb-1 text-sm font-semibold">Call workload %</h4>
              {!hasRoster ? (
                <p className="text-xs text-muted-foreground">Not on the call team roster — workload % unavailable.</p>
              ) : (
                <div className="flex items-center gap-1">
                  {[100, 50, 25, 0].map((pct) => (
                    <Button key={pct} size="sm" variant={workloadPct === pct ? "default" : "outline"}
                            onClick={() => setWorkload.mutate(pct)} disabled={setWorkload.isPending}
                            data-testid={`workload-${pct}`}>
                      {pct}%
                    </Button>
                  ))}
                  <span className="ml-2 text-xs text-muted-foreground">maps to canonical daily call capacity</span>
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function TeamOperationsSettings() {
  const qc = useQueryClient();
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<(typeof TEAM_TYPES)[number]>("custom");
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);

  const { data: teams = [], isLoading } = useQuery<Team[]>({
    queryKey: ["/api/teams"],
    queryFn: () => api<Team[]>("/api/teams"),
  });

  const createTeam = useMutation({
    mutationFn: () => api<Team>("/api/teams", { method: "POST", body: JSON.stringify({ name: newName, type: newType }) }),
    onSuccess: () => { setNewName(""); qc.invalidateQueries({ queryKey: ["/api/teams"] }); },
  });
  const toggleActive = useMutation({
    mutationFn: (t: Team) => api<Team>(`/api/teams/${t.id}`, { method: "PATCH", body: JSON.stringify({ active: !t.active }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/teams"] }),
  });

  const { data: members = [] } = useQuery<Membership[]>({
    queryKey: ["/api/teams", selectedTeamId, "members"],
    queryFn: () => api<Membership[]>(`/api/teams/${selectedTeamId}/members`),
    enabled: selectedTeamId != null,
  });
  const { data: managers = [] } = useQuery<ManagerRel[]>({
    queryKey: ["/api/teams", selectedTeamId, "managers"],
    queryFn: () => api<ManagerRel[]>(`/api/teams/${selectedTeamId}/managers`),
    enabled: selectedTeamId != null,
  });
  const { data: users = [] } = useQuery<DirUser[]>({
    queryKey: ["/api/plexus/users"],
    queryFn: () => api<DirUser[]>("/api/plexus/users"),
  });

  const [addMemberUserId, setAddMemberUserId] = useState("");
  const [addManagerUserId, setAddManagerUserId] = useState("");
  const [editMemberUserId, setEditMemberUserId] = useState<string | null>(null);
  const invalidateTeam = () => {
    qc.invalidateQueries({ queryKey: ["/api/teams", selectedTeamId, "members"] });
    qc.invalidateQueries({ queryKey: ["/api/teams", selectedTeamId, "managers"] });
  };
  const addMember = useMutation({
    mutationFn: (userId: string) => api(`/api/teams/${selectedTeamId}/members`, { method: "POST", body: JSON.stringify({ userId, membershipRole: "member" }) }),
    onSuccess: () => { setAddMemberUserId(""); invalidateTeam(); },
  });
  const removeMember = useMutation({
    mutationFn: (userId: string) => api(`/api/teams/${selectedTeamId}/members/${userId}`, { method: "DELETE" }),
    onSuccess: invalidateTeam,
  });
  const addManager = useMutation({
    mutationFn: (managerUserId: string) => api(`/api/teams/${selectedTeamId}/managers`, { method: "POST", body: JSON.stringify({ managerUserId }) }),
    onSuccess: () => { setAddManagerUserId(""); invalidateTeam(); },
  });
  const removeManager = useMutation({
    mutationFn: (managerUserId: string) => api(`/api/teams/${selectedTeamId}/managers/${managerUserId}`, { method: "DELETE" }),
    onSuccess: invalidateTeam,
  });

  const memberIds = new Set(members.map((m) => m.userId));
  const managerIds = new Set(managers.map((m) => m.managerUserId));
  const activeUsers = users.filter((u) => u.active !== false);

  return (
    <div className="space-y-6" data-testid="team-operations-settings">
      {/* Teams */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Teams</CardTitle>
          <p className="text-sm text-muted-foreground">
            Canonical org teams. Behavior keys off the stable <strong>type</strong> (PCS / ACS /
            management / custom), not the name. Engagement, messaging, and tasks consume these.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[200px]">
              <label className="text-xs font-medium text-muted-foreground">New team name</label>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. West Region PCS" data-testid="input-new-team-name" />
            </div>
            <Select value={newType} onValueChange={(v) => setNewType(v as (typeof TEAM_TYPES)[number])}>
              <SelectTrigger className="w-[160px]" data-testid="select-new-team-type"><SelectValue /></SelectTrigger>
              <SelectContent>{TEAM_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
            <Button onClick={() => createTeam.mutate()} disabled={!newName.trim() || createTeam.isPending} data-testid="button-create-team">
              Create team
            </Button>
          </div>
          {createTeam.isError && <p className="text-sm text-red-600">{(createTeam.error as Error).message}</p>}

          {isLoading ? <p className="text-sm text-muted-foreground">Loading teams…</p> : (
            <div className="divide-y rounded-md border">
              {teams.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-3 p-3"
                     data-testid={`team-row-${t.slug}`}>
                  <button className="flex items-center gap-2 text-left"
                          onClick={() => setSelectedTeamId(t.id === selectedTeamId ? null : t.id)}>
                    <span className="font-medium">{t.name}</span>
                    <Badge variant="outline">{t.type}</Badge>
                    {t.facilityId && <Badge variant="secondary">{t.facilityId}</Badge>}
                    {!t.active && <Badge variant="destructive">inactive</Badge>}
                  </button>
                  <Button size="sm" variant="ghost" onClick={() => toggleActive.mutate(t)}
                          data-testid={`button-toggle-team-${t.slug}`}>
                    {t.active ? "Deactivate" : "Activate"}
                  </Button>
                </div>
              ))}
              {teams.length === 0 && <p className="p-3 text-sm text-muted-foreground">No teams yet.</p>}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Members + managers of the selected team */}
      {selectedTeamId != null && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {teams.find((t) => t.id === selectedTeamId)?.name ?? "Team"} — members & managers
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Members and managers of this team. Managers gain scoped access to this team's
              workforce (tasks, needs-coverage, handoffs, redistribution, workload).
            </p>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div>
              <h4 className="mb-2 text-sm font-semibold">Members ({members.length})</h4>
              <ul className="space-y-1 text-sm" data-testid="team-members-list">
                {members.map((m) => (
                  <li key={m.id} className="flex items-center gap-2" data-testid={`team-member-${m.userId}`}>
                    <button className="flex-1 truncate text-left hover:underline"
                            onClick={() => setEditMemberUserId(m.userId === editMemberUserId ? null : m.userId)}
                            data-testid={`edit-member-${m.userId}`}>
                      {usernameFor(users, m.userId)}
                    </button>
                    <Badge variant="outline">{m.membershipRole}</Badge>
                    {m.primaryTeam && <Badge variant="secondary">primary</Badge>}
                    <button className="text-muted-foreground hover:text-red-600" title="Remove"
                            onClick={() => removeMember.mutate(m.userId)} data-testid={`remove-member-${m.userId}`}>
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
                {members.length === 0 && <li className="text-muted-foreground">No active members.</li>}
              </ul>
              <div className="mt-2 flex gap-1">
                <Select value={addMemberUserId} onValueChange={setAddMemberUserId}>
                  <SelectTrigger className="h-8 flex-1 text-xs" data-testid="add-member-select"><SelectValue placeholder="Add member…" /></SelectTrigger>
                  <SelectContent>
                    {activeUsers.filter((u) => !memberIds.has(u.id)).map((u) => <SelectItem key={u.id} value={u.id}>{u.username}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button size="sm" disabled={!addMemberUserId || addMember.isPending} onClick={() => addMember.mutate(addMemberUserId)} data-testid="add-member-button">Add</Button>
              </div>
            </div>
            <div>
              <h4 className="mb-2 text-sm font-semibold">Managers ({managers.length})</h4>
              <ul className="space-y-1 text-sm" data-testid="team-managers-list">
                {managers.map((m) => (
                  <li key={m.id} className="flex items-center gap-2" data-testid={`team-manager-${m.managerUserId}`}>
                    <span className="flex-1 truncate">{usernameFor(users, m.managerUserId)}</span>
                    <button className="text-muted-foreground hover:text-red-600" title="Remove"
                            onClick={() => removeManager.mutate(m.managerUserId)} data-testid={`remove-manager-${m.managerUserId}`}>
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
                {managers.length === 0 && <li className="text-muted-foreground">No managers assigned.</li>}
              </ul>
              <div className="mt-2 flex gap-1">
                <Select value={addManagerUserId} onValueChange={setAddManagerUserId}>
                  <SelectTrigger className="h-8 flex-1 text-xs" data-testid="add-manager-select"><SelectValue placeholder="Assign manager…" /></SelectTrigger>
                  <SelectContent>
                    {activeUsers.filter((u) => !managerIds.has(u.id)).map((u) => <SelectItem key={u.id} value={u.id}>{u.username}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button size="sm" disabled={!addManagerUserId || addManager.isPending} onClick={() => addManager.mutate(addManagerUserId)} data-testid="add-manager-button">Assign</Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Per-member operational profile editor (opens on a member click). */}
      {selectedTeamId != null && editMemberUserId ? (
        <MemberProfileEditor
          userId={editMemberUserId}
          username={usernameFor(users, editMemberUserId)}
          schedulerId={null}
        />
      ) : null}

      {/* Call Workload explainer (K11) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Call Workload %</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-1">
          <p>Workload % maps directly to the canonical daily call capacity model:</p>
          <ul className="list-disc pl-5">
            <li><strong>100%</strong> = full call workload (full completed-call KPI)</li>
            <li><strong>50%</strong> = half call workload</li>
            <li><strong>25%</strong> = quarter workload</li>
            <li><strong>0%</strong> = not taking calls</li>
          </ul>
          <p>Per-member workload is edited in Engagement Call Settings; it feeds the same
             capacity used by auto-distribution and the workload display.</p>
        </CardContent>
      </Card>
    </div>
  );
}

export default TeamOperationsSettings;
