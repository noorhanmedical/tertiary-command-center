import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  ArrowLeft,
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
  Settings as SettingsIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import type { OutreachScheduler } from "@shared/schema";

const VALID_FACILITIES = [
  "Taylor Family Practice",
  "NWPG - Spring",
  "NWPG - Veterans",
] as const;

type Facility = (typeof VALID_FACILITIES)[number];

function shellClass() {
  return "rounded-3xl border border-white/60 bg-white/75 backdrop-blur-xl shadow-[0_18px_60px_rgba(15,23,42,0.10)]";
}

type FormState = { name: string; facility: Facility | "" };
const EMPTY_FORM: FormState = { name: "", facility: "" };

export default function SettingsPage() {
  const { toast } = useToast();
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<FormState>(EMPTY_FORM);

  const { data: schedulers = [], isLoading } = useQuery<OutreachScheduler[]>({
    queryKey: ["/api/outreach/schedulers"],
  });

  const createMutation = useMutation({
    mutationFn: (data: { name: string; facility: string }) =>
      apiRequest("POST", "/api/outreach/schedulers", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/schedulers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/dashboard"] });
      setAddForm(EMPTY_FORM);
      setShowAdd(false);
      toast({ title: "Scheduler added" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { name: string; facility: string } }) =>
      apiRequest("PATCH", `/api/outreach/schedulers/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/schedulers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/dashboard"] });
      setEditingId(null);
      toast({ title: "Scheduler updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      apiRequest("DELETE", `/api/outreach/schedulers/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/schedulers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/dashboard"] });
      toast({ title: "Scheduler removed" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  function handleAdd() {
    if (!addForm.name.trim() || !addForm.facility) return;
    createMutation.mutate({ name: addForm.name.trim(), facility: addForm.facility });
  }

  function startEdit(sc: OutreachScheduler) {
    setEditingId(sc.id);
    setEditForm({ name: sc.name, facility: sc.facility as Facility });
  }

  function handleSaveEdit() {
    if (!editingId || !editForm.name.trim() || !editForm.facility) return;
    updateMutation.mutate({ id: editingId, data: { name: editForm.name.trim(), facility: editForm.facility } });
  }

  return (
    <div className="min-h-full flex-1 overflow-auto bg-[radial-gradient(circle_at_top,_rgba(191,219,254,0.45),_rgba(248,250,252,1)_40%,_rgba(239,246,255,0.92)_100%)]">
      <div className="mx-auto flex w-full max-w-[960px] flex-col gap-6 px-6 py-6">

        {/* Header */}
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild variant="outline" className="rounded-2xl border-white/60 bg-white/80 backdrop-blur">
            <Link href="/"><ArrowLeft className="mr-2 h-4 w-4" />Back</Link>
          </Button>
          <div className="flex items-center gap-2">
            <div className="rounded-2xl bg-slate-900/5 p-2 text-slate-700">
              <SettingsIcon className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Settings</h1>
              <p className="text-sm text-slate-500">Manage scheduler coverage assignments for Outreach.</p>
            </div>
          </div>
        </div>

        {/* Scheduler Coverage section */}
        <Card className={`${shellClass()} p-6`}>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Scheduler Coverage</h2>
              <p className="text-sm text-slate-500">
                Each entry maps a team member to the clinic they cover. One row per clinic per person.
              </p>
            </div>
            <Button
              onClick={() => { setShowAdd(true); setAddForm(EMPTY_FORM); }}
              className="rounded-2xl"
              data-testid="button-add-scheduler"
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Scheduler
            </Button>
          </div>

          {/* Add form */}
          {showAdd && (
            <div className="mb-4 rounded-2xl border border-blue-200/60 bg-blue-50/60 p-4">
              <p className="mb-3 text-sm font-medium text-slate-700">New Scheduler</p>
              <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                <div className="space-y-1">
                  <Label className="text-xs text-slate-500">Name</Label>
                  <Input
                    value={addForm.name}
                    onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Maria"
                    className="rounded-xl"
                    data-testid="input-scheduler-name"
                    onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-slate-500">Assigned Clinic</Label>
                  <Select
                    value={addForm.facility}
                    onValueChange={(v) => setAddForm((f) => ({ ...f, facility: v as Facility }))}
                  >
                    <SelectTrigger className="rounded-xl" data-testid="select-scheduler-facility">
                      <SelectValue placeholder="Select clinic" />
                    </SelectTrigger>
                    <SelectContent>
                      {VALID_FACILITIES.map((f) => (
                        <SelectItem key={f} value={f}>{f}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end gap-2">
                  <Button
                    onClick={handleAdd}
                    disabled={!addForm.name.trim() || !addForm.facility || createMutation.isPending}
                    className="rounded-xl"
                    data-testid="button-confirm-add-scheduler"
                  >
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setShowAdd(false)}
                    className="rounded-xl"
                    data-testid="button-cancel-add-scheduler"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Scheduler list */}
          {isLoading ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-8 text-center text-sm text-slate-500">
              Loading schedulers…
            </div>
          ) : schedulers.length === 0 && !showAdd ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-8 text-center text-sm text-slate-500">
              No schedulers configured yet. Click "Add Scheduler" to get started.
            </div>
          ) : (
            <div className="space-y-2">
              {schedulers.map((sc) =>
                editingId === sc.id ? (
                  <div
                    key={sc.id}
                    className="rounded-2xl border border-blue-200/60 bg-blue-50/40 p-4"
                    data-testid={`scheduler-edit-row-${sc.id}`}
                  >
                    <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                      <div className="space-y-1">
                        <Label className="text-xs text-slate-500">Name</Label>
                        <Input
                          value={editForm.name}
                          onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                          className="rounded-xl"
                          data-testid={`input-edit-name-${sc.id}`}
                          onKeyDown={(e) => e.key === "Enter" && handleSaveEdit()}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-slate-500">Assigned Clinic</Label>
                        <Select
                          value={editForm.facility}
                          onValueChange={(v) => setEditForm((f) => ({ ...f, facility: v as Facility }))}
                        >
                          <SelectTrigger className="rounded-xl" data-testid={`select-edit-facility-${sc.id}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {VALID_FACILITIES.map((f) => (
                              <SelectItem key={f} value={f}>{f}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex items-end gap-2">
                        <Button
                          onClick={handleSaveEdit}
                          disabled={!editForm.name.trim() || !editForm.facility || updateMutation.isPending}
                          className="rounded-xl"
                          data-testid={`button-save-edit-${sc.id}`}
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => setEditingId(null)}
                          className="rounded-xl"
                          data-testid={`button-cancel-edit-${sc.id}`}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div
                    key={sc.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white px-4 py-3 shadow-sm"
                    data-testid={`scheduler-row-${sc.id}`}
                  >
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-sm font-semibold text-slate-900" data-testid={`text-scheduler-name-${sc.id}`}>
                        {sc.name}
                      </span>
                      <Badge variant="outline" className="rounded-full border-slate-200 bg-slate-50 text-slate-600 text-xs">
                        {sc.facility}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => startEdit(sc)}
                        className="rounded-xl h-8 w-8 p-0"
                        data-testid={`button-edit-scheduler-${sc.id}`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => deleteMutation.mutate(sc.id)}
                        disabled={deleteMutation.isPending}
                        className="rounded-xl h-8 w-8 p-0 text-red-600 hover:bg-red-50 hover:border-red-200"
                        data-testid={`button-delete-scheduler-${sc.id}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ),
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
