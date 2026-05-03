import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  ArrowLeft,
  Database,
  Settings as SettingsIcon,
  Sheet,
  Users2,
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
  Lock,
  HardDrive,
  BellRing,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { VALID_FACILITIES } from "@shared/plexus";
import { PageHeader } from "@/components/PageHeader";

const FACILITIES = VALID_FACILITIES;
type Facility = (typeof VALID_FACILITIES)[number];

const DEFAULT_SCHEDULERS: { name: string; facility: Facility }[] = [
  { name: "Callista", facility: "Taylor Family Practice" },
  { name: "Roilan",   facility: "NWPG - Spring" },
  { name: "Ashraful", facility: "NWPG - Veterans" },
  { name: "Brian",    facility: "Taylor Family Practice" },
];

type TeamMember = {
  id: string;
  name: string;
  initials: string;
  role: string;
};

type ClinicSpreadsheetConnection = {
  clinicKey: string;
  clinicLabel: string;
  spreadsheetId: string;
  patientTabName: string;
  calendarTabName: string;
};

type SettingsSnapshot = {
  teamMembers: TeamMember[];
  clinicSpreadsheetConnections: ClinicSpreadsheetConnection[];
  sharedCalendarSpreadsheetId: string;
  storageProvider?: "google_drive" | "s3";
};

type OutreachScheduler = {
  id: number;
  name: string;
  facility: string;
  capacityPercent: number;
  createdAt: string;
};

const CAPACITY_OPTIONS = [25, 50, 75, 100] as const;

type DistributionRow = {
  id: number;
  name: string;
  facility: string;
  capacityPercent: number;
  userId: string | null;
  onPtoToday: boolean;
  activeCount: number;
  reassignedInCount: number;
  lastCallAt: string | null;
};

function formatLastActivity(iso: string | null): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "—";
  const mins = Math.max(0, Math.round((Date.now() - t) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m ago`;
}

function CallListDistributionCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery<{ asOfDate: string; rows: DistributionRow[] }>({
    queryKey: ["/api/scheduler-assignments/dashboard"],
    refetchInterval: 60_000,
  });

  const rebuildMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/scheduler-assignments/rebuild", {});
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Rebuild failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scheduler-assignments/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/scheduler-assignments"] });
      toast({ title: "Call lists rebuilt for today" });
    },
    onError: (e: Error) => toast({ title: "Rebuild failed", description: e.message, variant: "destructive" }),
  });

  const redistributeMutation = useMutation({
    mutationFn: async (schedulerId: number) => {
      const res = await apiRequest("POST", "/api/scheduler-assignments/redistribute", {
        schedulerId,
        reason: "manual_redistribute",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Redistribute failed");
      }
      return res.json();
    },
    onSuccess: (summary: { released: number; reassigned: number; unassigned: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/scheduler-assignments/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/scheduler-assignments"] });
      toast({
        title: "Redistributed",
        description: `Released ${summary.released}, reassigned ${summary.reassigned}, unplaced ${summary.unassigned}`,
      });
    },
    onError: (e: Error) => toast({ title: "Redistribute failed", description: e.message, variant: "destructive" }),
  });

  const rows = data?.rows ?? [];

  return (
    <Card className="rounded-3xl border border-white/60 bg-white/75 p-5 shadow-[0_18px_60px_rgba(15,23,42,0.10)] backdrop-blur-xl">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <SettingsIcon className="h-5 w-5 text-indigo-600" />
          <h2 className="text-lg font-semibold text-slate-900">Call-List Distribution</h2>
          {data?.asOfDate && (
            <Badge variant="outline" className="rounded-full border-slate-200 bg-slate-50 text-slate-600">
              {data.asOfDate}
            </Badge>
          )}
        </div>
        <Button
          size="sm"
          onClick={() => rebuildMutation.mutate()}
          disabled={rebuildMutation.isPending}
          className="h-8 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700"
          data-testid="button-rebuild-distribution"
        >
          {rebuildMutation.isPending ? "Rebuilding…" : "Run distribution now"}
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-2xl bg-slate-100" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-6 text-center text-sm text-slate-400">
          No schedulers configured yet.
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-white/80 p-3"
              data-testid={`distribution-row-${r.id}`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-slate-900">{r.name}</span>
                  <Badge className={`rounded-full border text-[10px] ${facilityColor(r.facility)}`}>
                    {r.facility}
                  </Badge>
                  {r.onPtoToday && (
                    <Badge className="rounded-full border bg-amber-50 text-amber-700 border-amber-200 text-[10px]">
                      PTO today
                    </Badge>
                  )}
                </div>
                <div className="mt-1 text-[11px] text-slate-500" data-testid={`distribution-meta-${r.id}`}>
                  Capacity {r.capacityPercent}% · Queue {r.activeCount}
                  {r.reassignedInCount > 0 && ` · ↩ ${r.reassignedInCount} reassigned in`}
                  {` · Last activity ${formatLastActivity(r.lastCallAt)}`}
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => redistributeMutation.mutate(r.id)}
                disabled={redistributeMutation.isPending || r.activeCount === 0}
                className="h-8 rounded-xl text-xs"
                data-testid={`button-redistribute-${r.id}`}
              >
                Redistribute
              </Button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function facilityColor(f: string) {
  if (f.includes("Spring")) return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (f.includes("Veteran")) return "bg-violet-50 text-violet-700 border-violet-200";
  return "bg-blue-50 text-blue-700 border-blue-200";
}

function InvoiceReminderSettingsCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery<{ thresholdDays: number; defaultThresholdDays: number }>({
    queryKey: ["/api/settings/invoice-reminders"],
  });
  const [draft, setDraft] = useState<string>("");

  useEffect(() => {
    if (data?.thresholdDays != null) setDraft(String(data.thresholdDays));
  }, [data?.thresholdDays]);

  const saveMutation = useMutation({
    mutationFn: async (thresholdDays: number) => {
      const res = await apiRequest("POST", "/api/settings/invoice-reminders", { thresholdDays });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/invoice-reminders"] });
      toast({ title: "Reminder threshold saved" });
    },
    onError: (err: Error) =>
      toast({ title: "Failed to save", description: err.message, variant: "destructive" }),
  });

  const runMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/settings/invoice-reminders/run", {});
      return res.json() as Promise<{ threshold: number; evaluated: number; reminded: number }>;
    },
    onSuccess: (summary) => {
      toast({
        title: "Reminder sweep complete",
        description: `Evaluated ${summary.evaluated} overdue invoice(s), created ${summary.reminded} reminder task(s).`,
      });
    },
    onError: (err: Error) =>
      toast({ title: "Reminder sweep failed", description: err.message, variant: "destructive" }),
  });

  const parsedDraft = parseInt(draft, 10);
  const draftValid = Number.isFinite(parsedDraft) && parsedDraft >= 1 && parsedDraft <= 365;
  const isDirty = draftValid && data && parsedDraft !== data.thresholdDays;

  return (
    <Card className="rounded-3xl border border-white/60 bg-white/75 p-5 shadow-[0_18px_60px_rgba(15,23,42,0.10)] backdrop-blur-xl">
      <div className="mb-4 flex items-center gap-2">
        <BellRing className="h-5 w-5 text-rose-600" />
        <h2 className="text-lg font-semibold text-slate-900">Overdue Invoice Reminders</h2>
      </div>
      <p className="mb-3 text-sm text-slate-600">
        Each morning, invoices in <em>Sent</em> or <em>Partially Paid</em> status with a non-zero
        balance older than this many days create an urgent Plexus task for the billing team.
        Each invoice is re-surfaced at most once per window.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs font-medium text-slate-600 block mb-1">Threshold (days)</label>
          <Input
            type="number"
            min={1}
            max={365}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={isLoading}
            className="h-9 w-32 rounded-xl"
            data-testid="input-invoice-reminder-threshold"
          />
        </div>
        <Button
          onClick={() => draftValid && saveMutation.mutate(parsedDraft)}
          disabled={!isDirty || saveMutation.isPending}
          className="h-9 rounded-xl bg-rose-600 text-white hover:bg-rose-700"
          data-testid="button-save-invoice-reminder-threshold"
        >
          {saveMutation.isPending ? "Saving…" : "Save threshold"}
        </Button>
        <Button
          variant="outline"
          onClick={() => runMutation.mutate()}
          disabled={runMutation.isPending}
          className="h-9 rounded-xl"
          data-testid="button-run-invoice-reminders"
        >
          {runMutation.isPending ? "Running…" : "Run reminder sweep now"}
        </Button>
      </div>
      {data && (
        <p className="mt-3 text-xs text-slate-500" data-testid="text-invoice-reminder-current">
          Currently reminding on invoices ≥ {data.thresholdDays} day(s) old (default {data.defaultThresholdDays}).
        </p>
      )}
    </Card>
  );
}

function ChangePasswordCard() {
  const { toast } = useToast();
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (newPw !== confirm) { toast({ title: "Passwords do not match", variant: "destructive" }); return; }
    if (newPw.length < 6) { toast({ title: "New password must be at least 6 characters", variant: "destructive" }); return; }
    setLoading(true);
    try {
      await apiRequest("POST", "/api/auth/change-password", { currentPassword: currentPw, newPassword: newPw });
      toast({ title: "Password changed successfully" });
      setCurrentPw(""); setNewPw(""); setConfirm("");
    } catch (err: any) {
      const msg = err.message || "Failed to change password";
      toast({ title: msg.includes("401") ? "Current password is incorrect" : msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="rounded-3xl border border-white/60 bg-white/75 p-5 shadow-[0_18px_60px_rgba(15,23,42,0.10)] backdrop-blur-xl">
      <div className="mb-4 flex items-center gap-2">
        <Lock className="h-5 w-5 text-indigo-700" />
        <h2 className="text-lg font-semibold text-slate-900">Change Password</h2>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3 max-w-sm">
        <div>
          <label className="text-xs font-medium text-slate-600 block mb-1">Current password</label>
          <Input type="password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} className="rounded-xl" data-testid="input-current-password" />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600 block mb-1">New password</label>
          <Input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} className="rounded-xl" data-testid="input-new-password" />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600 block mb-1">Confirm new password</label>
          <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="rounded-xl" data-testid="input-confirm-password" />
        </div>
        <Button type="submit" disabled={loading || !currentPw || !newPw || !confirm} className="w-fit rounded-xl bg-indigo-600 text-white hover:bg-indigo-700" data-testid="button-change-password">
          {loading ? "Changing…" : "Change Password"}
        </Button>
      </form>
    </Card>
  );
}

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data } = useQuery<SettingsSnapshot>({
    queryKey: ["/api/settings/platform"],
    queryFn: async () => {
      const res = await fetch("/api/settings/platform");
      if (!res.ok) throw new Error("Failed to load settings");
      return res.json();
    },
  });

  const {
    data: schedulers = [],
    isLoading: schedulersLoading,
  } = useQuery<OutreachScheduler[]>({
    queryKey: ["/api/outreach/schedulers"],
  });

  const [newName, setNewName] = useState("");
  const [newFacility, setNewFacility] = useState<Facility>("Taylor Family Practice");
  const [newCapacity, setNewCapacity] = useState<number>(100);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editFacility, setEditFacility] = useState<Facility>("Taylor Family Practice");
  const [editCapacity, setEditCapacity] = useState<number>(100);
  const seededRef = useRef(false);

  const createMutation = useMutation({
    mutationFn: (body: { name: string; facility: string; capacityPercent?: number }) =>
      apiRequest("POST", "/api/outreach/schedulers", body).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/schedulers"] });
      setNewName("");
      setNewFacility("Taylor Family Practice");
      setNewCapacity(100);
      toast({ title: "Scheduler added" });
    },
    onError: (err: Error) =>
      toast({ title: "Failed to add scheduler", description: err.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: { name: string; facility: string; capacityPercent: number } }) =>
      apiRequest("PATCH", `/api/outreach/schedulers/${id}`, body).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/schedulers"] });
      setEditingId(null);
      toast({ title: "Scheduler updated" });
    },
    onError: (err: Error) =>
      toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      apiRequest("DELETE", `/api/outreach/schedulers/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/schedulers"] });
      toast({ title: "Scheduler removed" });
    },
    onError: (err: Error) =>
      toast({ title: "Delete failed", description: err.message, variant: "destructive" }),
  });

  useEffect(() => {
    if (schedulersLoading) return;
    if (schedulers.length > 0) return;
    if (seededRef.current) return;
    seededRef.current = true;
    DEFAULT_SCHEDULERS.forEach(({ name, facility }) => {
      createMutation.mutate({ name, facility });
    });
  }, [schedulersLoading, schedulers.length]);

  function startEdit(s: OutreachScheduler) {
    setEditingId(s.id);
    setEditName(s.name);
    setEditFacility(s.facility as Facility);
    setEditCapacity(s.capacityPercent ?? 100);
  }

  function cancelEdit() {
    setEditingId(null);
  }

  function submitEdit(id: number) {
    if (!editName.trim()) return;
    updateMutation.mutate({ id, body: { name: editName.trim(), facility: editFacility, capacityPercent: editCapacity } });
  }

  function handleAdd() {
    if (!newName.trim()) return;
    createMutation.mutate({ name: newName.trim(), facility: newFacility, capacityPercent: newCapacity });
  }

  return (
    <div className="min-h-full flex-1 overflow-auto plexus-page-radial">
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6 px-6 py-6">
        <PageHeader
          backHref="/"
          eyebrow="PLEXUS ANCILLARY · SETTINGS"
          icon={SettingsIcon}
          title="Settings"
          subtitle="Team members, patient databases, and clinic spreadsheet connections."
        />

        {/* Static Team Members card */}
        <Card className="rounded-3xl border border-white/60 bg-white/75 p-5 shadow-[0_18px_60px_rgba(15,23,42,0.10)] backdrop-blur-xl">
          <div className="mb-4 flex items-center gap-2">
            <Database className="h-5 w-5 text-blue-700" />
            <h2 className="text-lg font-semibold text-slate-900">Team Members</h2>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {(data?.teamMembers || []).map((member) => (
              <div key={member.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-100 text-sm font-semibold text-blue-700">
                    {member.initials}
                  </div>
                  <div>
                    <p className="font-semibold text-slate-900">{member.name}</p>
                    <p className="text-sm text-slate-500">{member.role}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Scheduler Team */}
        <Card className="rounded-3xl border border-white/60 bg-white/75 p-5 shadow-[0_18px_60px_rgba(15,23,42,0.10)] backdrop-blur-xl">
          <div className="mb-4 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Users2 className="h-5 w-5 text-violet-600" />
              <h2 className="text-lg font-semibold text-slate-900">Scheduler Team</h2>
            </div>
            <Badge variant="outline" className="rounded-full border-violet-200 bg-violet-50 text-violet-700">
              {schedulers.length} member{schedulers.length !== 1 ? "s" : ""}
            </Badge>
          </div>

          {schedulersLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-14 animate-pulse rounded-2xl bg-slate-100" />
              ))}
            </div>
          ) : schedulers.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-6 text-center text-sm text-slate-400">
              Setting up default team members…
            </div>
          ) : (
            <div className="space-y-2">
              {schedulers.map((s) =>
                editingId === s.id ? (
                  <div
                    key={s.id}
                    className="flex flex-wrap items-center gap-2 rounded-2xl border border-blue-200 bg-blue-50/60 p-3"
                    data-testid={`scheduler-edit-row-${s.id}`}
                  >
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="h-8 w-36 rounded-xl text-sm"
                      placeholder="Name"
                      data-testid={`input-edit-name-${s.id}`}
                    />
                    <Select value={editFacility} onValueChange={(v) => setEditFacility(v as Facility)}>
                      <SelectTrigger className="h-8 w-52 rounded-xl text-sm" data-testid={`select-edit-facility-${s.id}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {FACILITIES.map((f) => (
                          <SelectItem key={f} value={f}>{f}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={String(editCapacity)} onValueChange={(v) => setEditCapacity(parseInt(v, 10))}>
                      <SelectTrigger className="h-8 w-28 rounded-xl text-sm" data-testid={`select-edit-capacity-${s.id}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CAPACITY_OPTIONS.map((c) => (
                          <SelectItem key={c} value={String(c)}>{c}% calls</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      className="h-8 rounded-xl bg-blue-600 text-white hover:bg-blue-700"
                      onClick={() => submitEdit(s.id)}
                      disabled={updateMutation.isPending}
                      data-testid={`button-save-scheduler-${s.id}`}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 rounded-xl"
                      onClick={cancelEdit}
                      data-testid={`button-cancel-edit-${s.id}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : (
                  <div
                    key={s.id}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-slate-50/60 px-4 py-3 hover:border-slate-200"
                    data-testid={`scheduler-row-${s.id}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-xs font-semibold text-violet-700">
                        {s.name.slice(0, 2).toUpperCase()}
                      </div>
                      <p className="font-medium text-slate-900">{s.name}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className={`rounded-full border text-xs ${facilityColor(s.facility)}`}
                        data-testid={`badge-facility-${s.id}`}
                      >
                        {s.facility}
                      </Badge>
                      <Badge
                        variant="outline"
                        className="rounded-full border-slate-200 bg-white text-xs text-slate-600"
                        data-testid={`badge-capacity-${s.id}`}
                        title="Share of the workday spent on calls — drives capacity-weighted patient distribution."
                      >
                        {s.capacityPercent ?? 100}% calls
                      </Badge>
                      <button
                        type="button"
                        onClick={() => startEdit(s)}
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        data-testid={`button-edit-scheduler-${s.id}`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteMutation.mutate(s.id)}
                        disabled={deleteMutation.isPending}
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                        data-testid={`button-delete-scheduler-${s.id}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                )
              )}
            </div>
          )}

          {/* Add Member form */}
          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl border border-dashed border-slate-200 bg-white/60 p-3">
            <Plus className="h-4 w-4 shrink-0 text-slate-400" />
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              placeholder="Scheduler name"
              className="h-8 w-40 rounded-xl text-sm"
              data-testid="input-new-scheduler-name"
            />
            <Select value={newFacility} onValueChange={(v) => setNewFacility(v as Facility)}>
              <SelectTrigger className="h-8 w-52 rounded-xl text-sm" data-testid="select-new-scheduler-facility">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FACILITIES.map((f) => (
                  <SelectItem key={f} value={f}>{f}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={String(newCapacity)} onValueChange={(v) => setNewCapacity(parseInt(v, 10))}>
              <SelectTrigger className="h-8 w-32 rounded-xl text-sm" data-testid="select-new-scheduler-capacity">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CAPACITY_OPTIONS.map((c) => (
                  <SelectItem key={c} value={String(c)}>{c}% calls</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              onClick={handleAdd}
              disabled={!newName.trim() || createMutation.isPending}
              className="h-8 rounded-xl bg-violet-600 text-white hover:bg-violet-700"
              data-testid="button-add-scheduler"
            >
              Add Member
            </Button>
          </div>
        </Card>

        {/* Call-list distribution */}
        <CallListDistributionCard />

        {/* Overdue invoice reminders */}
        <InvoiceReminderSettingsCard />

        {/* Change Password */}
        <ChangePasswordCard />

        {/* Clinic Spreadsheet Connections */}
        <Card className="rounded-3xl border border-white/60 bg-white/75 p-5 shadow-[0_18px_60px_rgba(15,23,42,0.10)] backdrop-blur-xl">
          <div className="mb-4 flex items-center gap-2">
            <Sheet className="h-5 w-5 text-green-700" />
            <h2 className="text-lg font-semibold text-slate-900">Clinic Spreadsheet Connections</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {(data?.clinicSpreadsheetConnections || []).map((conn) => (
              <div key={conn.clinicKey} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold text-slate-900">{conn.clinicLabel}</p>
                  <Badge variant="outline" className="rounded-full border-slate-200 bg-white text-slate-700">
                    {conn.clinicKey}
                  </Badge>
                </div>
                <div className="mt-3 space-y-1 text-sm text-slate-600">
                  <p>Spreadsheet ID: {conn.spreadsheetId || "Not configured"}</p>
                  <p>Patient tab: {conn.patientTabName}</p>
                  <p>Calendar tab: {conn.calendarTabName}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
            Shared calendar spreadsheet ID: {data?.sharedCalendarSpreadsheetId || "Not configured"}
          </div>
        </Card>

        {/* Storage Provider */}
        <Card className="rounded-3xl border border-white/60 bg-white/75 p-5 shadow-[0_18px_60px_rgba(15,23,42,0.10)] backdrop-blur-xl">
          <div className="mb-4 flex items-center gap-2">
            <HardDrive className="h-5 w-5 text-indigo-600" />
            <h2 className="text-lg font-semibold text-slate-900">File Storage Provider</h2>
          </div>
          <div className="flex items-center gap-3">
            {data?.storageProvider === "s3" ? (
              <>
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-100">
                  <HardDrive className="h-5 w-5 text-orange-600" />
                </div>
                <div>
                  <p className="font-semibold text-slate-900">AWS S3</p>
                  <p className="text-sm text-slate-500">Clinical documents and reports stored in Amazon S3</p>
                </div>
                <Badge variant="outline" className="ml-auto rounded-full border-orange-200 bg-orange-50 text-orange-700" data-testid="badge-storage-provider">
                  S3
                </Badge>
              </>
            ) : (
              <>
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100">
                  <HardDrive className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <p className="font-semibold text-slate-900">Google Drive</p>
                  <p className="text-sm text-slate-500">Clinical documents and reports stored in Google Drive</p>
                </div>
                <Badge variant="outline" className="ml-auto rounded-full border-blue-200 bg-blue-50 text-blue-700" data-testid="badge-storage-provider">
                  Google Drive
                </Badge>
              </>
            )}
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Storage provider is configured via the <code className="rounded bg-slate-100 px-1 py-0.5 font-mono">STORAGE_PROVIDER</code> environment variable
            (<code className="rounded bg-slate-100 px-1 py-0.5 font-mono">google_drive</code> or <code className="rounded bg-slate-100 px-1 py-0.5 font-mono">s3</code>).
          </p>
        </Card>
      </div>

          <div className="mt-8 grid gap-6">
            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" data-testid="settings-staff-capacity">
              <h2 className="text-lg font-semibold text-slate-900">Scheduler, Liaison, and Technician Capacity Settings</h2>
              <p className="mt-1 text-sm text-slate-500">Configure scheduler, liaison, and technician participation percentages by staff member.</p>
              <div className="mt-4 grid gap-4 lg:grid-cols-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-medium text-slate-900 mb-3">Scheduler Capacity</div>
                  <label className="block text-xs text-slate-500 mb-1">Default role capacity</label>
                  <select className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" defaultValue="50">
                    <option value="25">25 percent</option>
                    <option value="50">50 percent</option>
                    <option value="75">75 percent</option>
                    <option value="100">100 percent</option>
                  </select>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-medium text-slate-900 mb-3">Liaison Capacity</div>
                  <label className="block text-xs text-slate-500 mb-1">Default role capacity</label>
                  <select className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" defaultValue="50">
                    <option value="25">25 percent</option>
                    <option value="50">50 percent</option>
                    <option value="75">75 percent</option>
                    <option value="100">100 percent</option>
                  </select>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-medium text-slate-900 mb-3">Technician Capacity</div>
                  <label className="block text-xs text-slate-500 mb-1">Default role capacity</label>
                  <select className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" defaultValue="50">
                    <option value="25">25 percent</option>
                    <option value="50">50 percent</option>
                    <option value="75">75 percent</option>
                    <option value="100">100 percent</option>
                  </select>
                </div>
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-medium text-slate-900">Scheduler % by staff member</div>
                  <div className="mt-1 text-xs text-slate-500">Examples: 25 percent, 50 percent, 75 percent, 100 percent.</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-medium text-slate-900">Liaison % by staff member</div>
                  <div className="mt-1 text-xs text-slate-500">Controls liaison call participation and assignment weighting.</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-medium text-slate-900">Technician % by staff member</div>
                  <div className="mt-1 text-xs text-slate-500">Controls technician call participation when thresholds are triggered.</div>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" data-testid="settings-patient-mix">
              <h2 className="text-lg font-semibold text-slate-900">Visit Patients vs Outreach Patients Mix Settings</h2>
              <p className="mt-1 text-sm text-slate-500">Define visit vs outreach mix targets for scheduler, liaison, and technician roles.</p>
              <div className="mt-4 grid gap-4 lg:grid-cols-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-medium text-slate-900 mb-3">Scheduler Mix</div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Visit Patients %</label>
                      <input className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" defaultValue="50" />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Outreach Patients %</label>
                      <input className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" defaultValue="50" />
                    </div>
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-medium text-slate-900 mb-3">Liaison Mix</div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Visit Patients %</label>
                      <input className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" defaultValue="50" />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Outreach Patients %</label>
                      <input className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" defaultValue="50" />
                    </div>
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-medium text-slate-900 mb-3">Technician Mix</div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Visit Patients %</label>
                      <input className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" defaultValue="50" />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Outreach Patients %</label>
                      <input className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" defaultValue="50" />
                    </div>
                  </div>
                </div>
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-medium text-slate-900">Scheduler visit vs outreach mix</div>
                  <div className="mt-1 text-xs text-slate-500">Example: 50 percent visit / 50 percent outreach.</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-medium text-slate-900">Liaison visit vs outreach mix</div>
                  <div className="mt-1 text-xs text-slate-500">Example: 50 percent visit / 50 percent outreach.</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-medium text-slate-900">Technician visit vs outreach mix</div>
                  <div className="mt-1 text-xs text-slate-500">Example: 50 percent visit / 50 percent outreach.</div>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" data-testid="settings-insurance-priority">
              <h2 className="text-lg font-semibold text-slate-900">Outreach Patients Insurance Priority Settings</h2>
              <p className="mt-1 text-sm text-slate-500">Set Outreach Patients insurance weighting for straight Medicare, PPO, and other insurance handling.</p>
              <div className="mt-4 grid gap-4 lg:grid-cols-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <label className="block text-sm font-medium text-slate-900 mb-1">Straight Medicare Weight</label>
                  <input className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" defaultValue="80" />
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <label className="block text-sm font-medium text-slate-900 mb-1">PPO Weight</label>
                  <input className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" defaultValue="20" />
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <label className="block text-sm font-medium text-slate-900 mb-1">Other Insurance Handling</label>
                  <select className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" defaultValue="admin_review">
                    <option value="admin_review">Send to admin review</option>
                    <option value="deny">Auto deny</option>
                    <option value="manual_only">Manual hold only</option>
                  </select>
                </div>
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-medium text-slate-900">Straight Medicare weight</div>
                  <div className="mt-1 text-xs text-slate-500">Primary outreach weighting bucket.</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-medium text-slate-900">PPO weight</div>
                  <div className="mt-1 text-xs text-slate-500">Secondary outreach weighting bucket.</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-medium text-slate-900">Other insurance handling rule</div>
                  <div className="mt-1 text-xs text-slate-500">Controls how non-priority insurance types are routed.</div>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" data-testid="settings-insurance-approval">
              <h2 className="text-lg font-semibold text-slate-900">Visit Patients and Outreach Patients Insurance Approval Settings</h2>
              <p className="mt-1 text-sm text-slate-500">Control when admin approval is required before tests are generated in Visit Patients and Outreach Patients.</p>
              <div className="mt-4 grid gap-4 lg:grid-cols-3">
                <label className="rounded-xl border border-slate-200 bg-slate-50 p-4 flex items-start gap-3">
                  <input type="checkbox" className="mt-1" defaultChecked />
                  <span>
                    <span className="block text-sm font-medium text-slate-900">Auto-hold non-Medicare / non-PPO</span>
                    <span className="block mt-1 text-xs text-slate-500">Do not generate tests on intake tiles until admin decision.</span>
                  </span>
                </label>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <label className="block text-sm font-medium text-slate-900 mb-1">Approval Routing Inbox</label>
                  <select className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" defaultValue="admin">
                    <option value="admin">Admin Inbox</option>
                    <option value="manager">Manager Inbox</option>
                    <option value="both">Admin + Manager</option>
                  </select>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <label className="block text-sm font-medium text-slate-900 mb-1">Decision Mode</label>
                  <select className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" defaultValue="approve_deny">
                    <option value="approve_deny">Approve / Deny</option>
                    <option value="approve_only">Approve Only</option>
                    <option value="manual_release">Manual Release</option>
                  </select>
                </div>
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-medium text-slate-900">Auto-hold non-Medicare / non-PPO</div>
                  <div className="mt-1 text-xs text-slate-500">Held patients do not generate tests on the intake tile UI.</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-medium text-slate-900">Admin approve / deny required</div>
                  <div className="mt-1 text-xs text-slate-500">Approval gate before downstream test generation is allowed.</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-medium text-slate-900">Inbox destination for review</div>
                  <div className="mt-1 text-xs text-slate-500">Defines where insurance approval items are routed.</div>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" data-testid="settings-technician-threshold">
              <h2 className="text-lg font-semibold text-slate-900">Technician Call Trigger Settings</h2>
              <p className="mt-1 text-sm text-slate-500">Define ancillary minutes and workload thresholds that trigger technician call lists.</p>
              <div className="mt-4 grid gap-4 lg:grid-cols-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <label className="block text-sm font-medium text-slate-900 mb-1">BrainWave Minutes per Test</label>
                  <input className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" defaultValue="60" />
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <label className="block text-sm font-medium text-slate-900 mb-1">VitalWave Minutes per Test</label>
                  <input className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" defaultValue="30" />
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <label className="block text-sm font-medium text-slate-900 mb-1">Call Trigger Threshold</label>
                  <input className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" defaultValue="240" />
                </div>
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-medium text-slate-900">BrainWave minutes per test</div>
                  <div className="mt-1 text-xs text-slate-500">Default operational duration per BrainWave test.</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-medium text-slate-900">VitalWave minutes per test</div>
                  <div className="mt-1 text-xs text-slate-500">Default operational duration per VitalWave test.</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-medium text-slate-900">Workload threshold to trigger technician call list</div>
                  <div className="mt-1 text-xs text-slate-500">Minimum ancillary workload that activates technician outbound calling.</div>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" data-testid="settings-follow-up-sequences">
              <h2 className="text-lg font-semibold text-slate-900">Follow-Up Sequence Settings</h2>
              <p className="mt-1 text-sm text-slate-500">Configure reusable follow-up steps with timing, method, and same-person vs new-person caller rules.</p>
              <div className="mt-4 space-y-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 grid gap-3 lg:grid-cols-5">
                  <input className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm" defaultValue="1" placeholder="Step #" />
                  <input className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm" defaultValue="1 day" placeholder="Timing" />
                  <select className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm" defaultValue="call">
                    <option value="call">Call</option>
                    <option value="text">Text</option>
                    <option value="email">Email</option>
                    <option value="portal">Clinic portal</option>
                  </select>
                  <select className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm" defaultValue="same">
                    <option value="same">Same person</option>
                    <option value="new">New person</option>
                  </select>
                  <input className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm" defaultValue="1x/day" placeholder="Attempts" />
                </div>
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                  Placeholder area for unlimited admin-defined follow-up rows.
                </div>
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-medium text-slate-900">Step number</div>
                  <div className="mt-1 text-xs text-slate-500">Attempt order within the sequence.</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-medium text-slate-900">Delay / timing</div>
                  <div className="mt-1 text-xs text-slate-500">In how many days or how many times per day.</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-medium text-slate-900">Method</div>
                  <div className="mt-1 text-xs text-slate-500">Call, text, email, or clinic patient portal.</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-medium text-slate-900">Same person vs new person</div>
                  <div className="mt-1 text-xs text-slate-500">Choose whether the caller stays the same or changes.</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-medium text-slate-900">Unlimited follow-ups</div>
                  <div className="mt-1 text-xs text-slate-500">Admin can add as many sequence steps as needed.</div>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" data-testid="settings-manager-reassignment">
              <h2 className="text-lg font-semibold text-slate-900">Reassignment / Manager Review Settings</h2>
              <p className="mt-1 text-sm text-slate-500">Controls unresolved-call alerts, reassignment thresholds, and role reassignment options.</p>
              <div className="mt-4 grid gap-4 lg:grid-cols-3">
                <label className="rounded-xl border border-slate-200 bg-slate-50 p-4 flex items-start gap-3">
                  <input type="checkbox" className="mt-1" defaultChecked />
                  <span>
                    <span className="block text-sm font-medium text-slate-900">Manager Inbox Alert</span>
                    <span className="block mt-1 text-xs text-slate-500">Send alert when a patient remains on a call list without completed call work.</span>
                  </span>
                </label>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <label className="block text-sm font-medium text-slate-900 mb-1">Reassignment Threshold</label>
                  <input className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" defaultValue="2 attempts" />
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <label className="block text-sm font-medium text-slate-900 mb-1">Role Reassignment Options</label>
                  <select className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" defaultValue="scheduler_liaison_technician">
                    <option value="scheduler_only">Scheduler only</option>
                    <option value="scheduler_liaison">Scheduler + Liaison</option>
                    <option value="scheduler_liaison_technician">Scheduler + Liaison + Technician</option>
                  </select>
                </div>
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-medium text-slate-900">Unresolved call manager inbox alert</div>
                  <div className="mt-1 text-xs text-slate-500">Manager alert when a listed call remains unfinished.</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-medium text-slate-900">Reassignment threshold</div>
                  <div className="mt-1 text-xs text-slate-500">How many attempts or how much time before review is required.</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-medium text-slate-900">Role reassignment options</div>
                  <div className="mt-1 text-xs text-slate-500">Move work to scheduler, liaison, technician, or keep current owner.</div>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" data-testid="settings-outreach-center">
              <h2 className="text-lg font-semibold text-slate-900">Outreach Center Settings Section</h2>
              <p className="mt-1 text-sm text-slate-500">Controls outreach metrics, manager inbox behavior, and marketing / outreach operational controls.</p>
              <div className="mt-4 grid gap-4 lg:grid-cols-3">
                <label className="rounded-xl border border-slate-200 bg-slate-50 p-4 flex items-start gap-3">
                  <input type="checkbox" className="mt-1" defaultChecked />
                  <span>
                    <span className="block text-sm font-medium text-slate-900">Show Manager Inbox in Outreach Center</span>
                    <span className="block mt-1 text-xs text-slate-500">Controls manager-review visibility in the Outreach Center tile.</span>
                  </span>
                </label>
                <label className="rounded-xl border border-slate-200 bg-slate-50 p-4 flex items-start gap-3">
                  <input type="checkbox" className="mt-1" defaultChecked />
                  <span>
                    <span className="block text-sm font-medium text-slate-900">Show Metrics + Role Mix</span>
                    <span className="block mt-1 text-xs text-slate-500">Controls role-mix snapshot and operational summary cards.</span>
                  </span>
                </label>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <label className="block text-sm font-medium text-slate-900 mb-1">Marketing Control Mode</label>
                  <select className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" defaultValue="enabled">
                    <option value="enabled">Enabled</option>
                    <option value="metrics_only">Metrics only</option>
                    <option value="hidden">Hidden</option>
                  </select>
                </div>
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-medium text-slate-900">Outreach metrics toggles</div>
                  <div className="mt-1 text-xs text-slate-500">Choose which metrics and counters appear in Outreach Center.</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-medium text-slate-900">Manager inbox behavior</div>
                  <div className="mt-1 text-xs text-slate-500">Controls unresolved-call review and escalation visibility.</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-medium text-slate-900">Marketing / outreach operational controls</div>
                  <div className="mt-1 text-xs text-slate-500">Controls campaign, outreach, and command-center behavior.</div>
                </div>
              </div>
            </section>
          </div>

    </div>
  );
}
