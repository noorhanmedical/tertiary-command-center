// Team Operations — canonical Admin Settings surface (Phase 4C).
//
// The authoritative management surface for teams, memberships, managers,
// facility coverage, and the coherent per-member operational profile
// (identity / teams / facilities / portal / call work / phone / management).
// Engagement/messaging/tasks CONSUME these; they are not configured elsewhere.

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

type Team = { id: number; name: string; slug: string; type: string; facilityId: string | null; active: boolean };
type Membership = { id: number; teamId: number; userId: string; membershipRole: string; primaryTeam: boolean; active: boolean };
type ManagerRel = { id: number; managerUserId: string; teamId: number | null; active: boolean };

async function api<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", headers: { "Content-Type": "application/json" }, ...opts });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Request failed (${res.status})`);
  return res.json();
}

const TEAM_TYPES = ["PCS", "ACS", "management", "custom"] as const;

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
                  <li key={m.id} className="flex items-center gap-2">
                    <span className="font-mono text-xs">{m.userId.slice(0, 8)}…</span>
                    <Badge variant="outline">{m.membershipRole}</Badge>
                    {m.primaryTeam && <Badge variant="secondary">primary</Badge>}
                  </li>
                ))}
                {members.length === 0 && <li className="text-muted-foreground">No active members.</li>}
              </ul>
            </div>
            <div>
              <h4 className="mb-2 text-sm font-semibold">Managers ({managers.length})</h4>
              <ul className="space-y-1 text-sm" data-testid="team-managers-list">
                {managers.map((m) => (
                  <li key={m.id} className="font-mono text-xs">{m.managerUserId.slice(0, 8)}…</li>
                ))}
                {managers.length === 0 && <li className="text-muted-foreground">No managers assigned.</li>}
              </ul>
            </div>
          </CardContent>
        </Card>
      )}

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
