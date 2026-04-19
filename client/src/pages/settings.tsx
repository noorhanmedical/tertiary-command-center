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

function facilityColor(f: string) {
  if (f.includes("Spring")) return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (f.includes("Veteran")) return "bg-violet-50 text-violet-700 border-violet-200";
  return "bg-blue-50 text-blue-700 border-blue-200";
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
    <div className="min-h-full flex-1 overflow-auto bg-[radial-gradient(circle_at_top,_rgba(191,219,254,0.45),_rgba(248,250,252,1)_40%,_rgba(239,246,255,0.92)_100%)]">
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6 px-6 py-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button asChild variant="outline" className="rounded-2xl border-white/60 bg-white/80 backdrop-blur">
              <Link href="/">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Link>
            </Button>
            <div className="flex items-center gap-2">
              <div className="rounded-2xl bg-slate-900/5 p-2 text-slate-700">
                <SettingsIcon className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Settings</h1>
                <p className="text-sm text-slate-600">Team members, patient databases, and clinic spreadsheet connections.</p>
              </div>
            </div>
          </div>
        </div>

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
    </div>
  );
}
