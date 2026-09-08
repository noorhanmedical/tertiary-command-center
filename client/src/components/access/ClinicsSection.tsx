// Phase 4B — Clinics settings section. List + edit (name/status/short name).
// Organization ownership and scope are backend-authoritative.

import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { qk } from "@/hooks/api/keys";
import { useAccess } from "@/lib/access/accessContext";
import { useAccessClinics, useAccessOrganizations } from "@/hooks/api/access";
import { accessApi, describeAccessError, type AccessClinic } from "@/lib/access/accessApi";
import { AccessGroup, LoadingState, EmptyState, ErrorState } from "./AccessPrimitives";

export function ClinicsSection() {
  const { hasPermission } = useAccess();
  const canManage = hasPermission("clinic.manage");
  const query = useAccessClinics();
  const orgsQuery = useAccessOrganizations();
  const client = useQueryClient();
  const [editing, setEditing] = useState<AccessClinic | null>(null);

  const orgName = (id: number | null | undefined) =>
    id == null ? "—" : orgsQuery.data?.find((o) => o.id === id)?.name ?? `Org ${id}`;

  return (
    <AccessGroup title="Clinics" desc="Facilities within your administrable scope.">
      <div className="overflow-hidden rounded-xl border border-slate-200/80">
        {query.isLoading ? (
          <LoadingState label="Loading clinics…" />
        ) : query.isError ? (
          <ErrorState message={describeAccessError(query.error)} onRetry={() => query.refetch()} />
        ) : (query.data ?? []).length === 0 ? (
          <EmptyState label="No clinics" hint="No clinics are in your administrable scope." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/80">
                <TableHead>Clinic Name</TableHead>
                <TableHead>Organization</TableHead>
                <TableHead className="hidden md:table-cell">Short Name</TableHead>
                <TableHead>Status</TableHead>
                {canManage && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {(query.data ?? []).map((c) => (
                <TableRow key={c.id} data-testid={`row-clinic-${c.id}`}>
                  <TableCell className="font-medium text-slate-900">{c.name}</TableCell>
                  <TableCell className="text-slate-500">{orgName(c.organizationId)}</TableCell>
                  <TableCell className="hidden text-slate-500 md:table-cell">{c.shortName ?? "—"}</TableCell>
                  <TableCell className="text-slate-600">{c.active === false ? "Inactive" : "Active"}</TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" onClick={() => setEditing(c)} data-testid={`button-edit-clinic-${c.id}`}>
                        Edit
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <Dialog open={!!editing} onOpenChange={(v) => { if (!v) setEditing(null); }}>
        {editing && (
          <DialogContent data-testid="dialog-edit-clinic">
            <EditClinicForm
              key={editing.id}
              clinic={editing}
              onSaved={() => {
                client.invalidateQueries({ queryKey: qk.access.clinics() });
                setEditing(null);
              }}
              onCancel={() => setEditing(null)}
            />
          </DialogContent>
        )}
      </Dialog>
    </AccessGroup>
  );
}

function EditClinicForm({ clinic, onSaved, onCancel }: { clinic: AccessClinic; onSaved: () => void; onCancel: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState(clinic.name);
  const [shortName, setShortName] = useState(clinic.shortName ?? "");
  const [active, setActive] = useState(clinic.active !== false);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await accessApi.updateClinic(clinic.id, { name: name.trim(), shortName: shortName.trim(), active });
      toast({ title: "Clinic updated" });
      onSaved();
    } catch (err) {
      toast({ title: "Could not update clinic", description: describeAccessError(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Edit {clinic.name}</DialogTitle>
        <DialogDescription>Update clinic name, short name, and active status.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label>Clinic Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} data-testid="input-clinic-name" />
        </div>
        <div className="space-y-1.5">
          <Label>Short Name</Label>
          <Input value={shortName} onChange={(e) => setShortName(e.target.value)} data-testid="input-clinic-short" />
        </div>
        <div className="flex items-center justify-between rounded-lg border border-slate-200/80 px-3 py-2">
          <div>
            <div className="text-sm font-medium text-slate-700">Active</div>
            <div className="text-xs text-slate-400">Inactive clinics are hidden from operational surfaces.</div>
          </div>
          <Switch checked={active} onCheckedChange={setActive} data-testid="switch-clinic-active" />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button onClick={save} disabled={saving} data-testid="button-submit-clinic">
          {saving ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </>
  );
}
