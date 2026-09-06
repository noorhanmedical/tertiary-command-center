// Phase 4B — Organizations settings section. List + detail + create/edit.
// Scope returned by the backend is authoritative; we never fabricate org
// relationships. Create requires platform scope (backend enforces); the button
// is shown only with organization.manage and a failed create surfaces cleanly.

import { useState } from "react";
import { Plus } from "lucide-react";
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
import { useToast } from "@/hooks/use-toast";
import { useAccess } from "@/lib/access/accessContext";
import { useAccessOrganizations } from "@/hooks/api/access";
import { accessApi, describeAccessError, type AccessOrganization } from "@/lib/access/accessApi";
import { useQueryClient } from "@tanstack/react-query";
import { qk } from "@/hooks/api/keys";
import { AccessGroup, LoadingState, EmptyState, ErrorState, StatusBadge } from "./AccessPrimitives";
import { formatTimestamp } from "@/lib/access/labels";

export function OrganizationsSection() {
  const { hasPermission } = useAccess();
  const canManage = hasPermission("organization.manage");
  const query = useAccessOrganizations();
  const client = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<AccessOrganization | null>(null);

  function refresh() {
    client.invalidateQueries({ queryKey: qk.access.organizations() });
  }

  return (
    <AccessGroup
      title="Organizations"
      desc="Tenant groups above clinics. Scope shown is limited to what you administer."
      actions={
        canManage ? (
          <Button size="sm" onClick={() => setCreateOpen(true)} data-testid="button-create-org">
            <Plus className="mr-1.5 h-4 w-4" /> New Organization
          </Button>
        ) : undefined
      }
    >
      <div className="overflow-hidden rounded-xl border border-slate-200/80">
        {query.isLoading ? (
          <LoadingState label="Loading organizations…" />
        ) : query.isError ? (
          <ErrorState message={describeAccessError(query.error)} onRetry={() => query.refetch()} />
        ) : (query.data ?? []).length === 0 ? (
          <EmptyState label="No organizations" hint="No organizations are in your administrable scope." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/80">
                <TableHead>Name</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden md:table-cell">Updated</TableHead>
                {canManage && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {(query.data ?? []).map((o) => (
                <TableRow key={o.id} data-testid={`row-org-${o.id}`}>
                  <TableCell className="font-medium text-slate-900">{o.name}</TableCell>
                  <TableCell className="text-slate-500">{o.slug}</TableCell>
                  <TableCell className="text-slate-500">{o.orgType}</TableCell>
                  <TableCell><StatusBadge status={o.status} /></TableCell>
                  <TableCell className="hidden text-slate-500 md:table-cell">{formatTimestamp(o.updatedAt)}</TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" onClick={() => setEditing(o)} data-testid={`button-edit-org-${o.id}`}>
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

      <CreateOrgDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={refresh} />
      <EditOrgDialog org={editing} onClose={() => setEditing(null)} onSaved={refresh} />
    </AccessGroup>
  );
}

function CreateOrgDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    try {
      await accessApi.createOrganization({ name: name.trim(), slug: slug.trim() });
      toast({ title: "Organization created" });
      setName(""); setSlug("");
      onCreated();
      onOpenChange(false);
    } catch (err) {
      toast({ title: "Could not create organization", description: describeAccessError(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dialog-create-org">
        <DialogHeader>
          <DialogTitle>New Organization</DialogTitle>
          <DialogDescription>Creating an organization requires platform authority.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} data-testid="input-org-name" />
          </div>
          <div className="space-y-1.5">
            <Label>Slug</Label>
            <Input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} placeholder="lowercase-hyphenated" data-testid="input-org-slug" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving || !name.trim() || !slug.trim()} data-testid="button-submit-org">
            {saving ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditOrgDialog({ org, onClose, onSaved }: { org: AccessOrganization | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  return (
    <Dialog open={!!org} onOpenChange={(v) => { if (!v) onClose(); }}>
      {org && (
        <DialogContent data-testid="dialog-edit-org">
          <EditOrgForm
            key={org.id}
            org={org}
            saving={saving}
            onSubmit={async (payload) => {
              setSaving(true);
              try {
                await accessApi.updateOrganization(org.id, payload);
                toast({ title: "Organization updated" });
                onSaved();
                onClose();
              } catch (err) {
                toast({ title: "Could not update organization", description: describeAccessError(err), variant: "destructive" });
              } finally {
                setSaving(false);
              }
            }}
            onCancel={onClose}
          />
        </DialogContent>
      )}
    </Dialog>
  );
}

function EditOrgForm({
  org,
  saving,
  onSubmit,
  onCancel,
}: {
  org: AccessOrganization;
  saving: boolean;
  onSubmit: (payload: { name?: string; status?: string }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(org.name);
  const [status, setStatus] = useState(org.status);
  return (
    <>
      <DialogHeader>
        <DialogTitle>Edit {org.name}</DialogTitle>
        <DialogDescription>Update the organization name and status.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} data-testid="input-edit-org-name" />
        </div>
        <div className="space-y-1.5">
          <Label>Status</Label>
          <select
            className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            data-testid="select-edit-org-status"
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="suspended">Suspended</option>
          </select>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button onClick={() => onSubmit({ name: name.trim(), status })} disabled={saving} data-testid="button-submit-edit-org">
          {saving ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </>
  );
}
