import { useState, useCallback, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { autoGeneratePatientNotes } from "@/lib/noteGeneration";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Upload,
  FileText,
  Brain,
  Activity,
  Scan,
  Loader2,
  ChevronDown, // used in sidebar/results
  ChevronRight,
  ChevronLeft,
  Download,
  Stethoscope,
  Pill,
  Zap,
  Check,
  Trash2,
  MessageCircle,
  GraduationCap,
  Plus,
  Sparkles,
  Calendar,
  X,
  Clock,
  PanelLeft,
  Database,
  AlertTriangle,
  ShieldAlert,
  Search,
  Users,
  DollarSign,
  Building2,
  Share2,
  Copy,
  Printer,
  Users2,
  Archive,
  Lock,
  Phone,
  ClipboardList,
  RefreshCw,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ScreeningBatch, PatientScreening, PatientTestHistory, AncillaryAppointment } from "@shared/schema";
import { SiGooglesheets } from "react-icons/si";
import { ExternalLink } from "lucide-react";
import { EditableScreeningFormModal } from "@/components/EditableScreeningFormModal";
import { PlexusDrive } from "@/components/PlexusDrive";
import { type GeneratedDocument } from "@shared/plexus";

type ScreeningBatchWithPatients = ScreeningBatch & { patients?: PatientScreening[] };
type ReasoningValue = string | { clinician_understanding: string; patient_talking_points: string; confidence?: "high" | "medium" | "low"; qualifying_factors?: string[]; icd10_codes?: string[]; pearls?: string[]; approvalRequired?: boolean };

const ULTRASOUND_TESTS = ["carotid", "echo", "stress", "venous", "duplex", "renal", "arterial", "aortic", "aneurysm", "aaa", "93880", "93306", "93975", "93925", "93930", "93978", "93350", "93971", "93970"];

function getAncillaryCategory(test: string): "brainwave" | "vitalwave" | "ultrasound" | "other" {
  const lower = test.toLowerCase();
  if (lower.includes("brain")) return "brainwave";
  if (lower.includes("vital")) return "vitalwave";
  if (ULTRASOUND_TESTS.some((u) => lower.includes(u))) return "ultrasound";
  return "other";
}

const categoryStyles: Record<string, { bg: string; border: string; accent: string; icon: string }> = {
  brainwave: { bg: "bg-violet-50 dark:bg-violet-950/30", border: "border-violet-200 dark:border-violet-800", accent: "text-violet-700 dark:text-violet-300", icon: "text-violet-500 dark:text-violet-400" },
  vitalwave: { bg: "bg-red-50 dark:bg-red-950/30", border: "border-red-200 dark:border-red-800", accent: "text-red-700 dark:text-red-300", icon: "text-red-500 dark:text-red-400" },
  ultrasound: { bg: "bg-emerald-50 dark:bg-emerald-950/30", border: "border-emerald-200 dark:border-emerald-800", accent: "text-emerald-700 dark:text-emerald-300", icon: "text-emerald-500 dark:text-emerald-400" },
  other: { bg: "bg-slate-50 dark:bg-slate-950/30", border: "border-slate-200 dark:border-slate-800", accent: "text-slate-700 dark:text-slate-300", icon: "text-slate-500 dark:text-slate-400" },
};

const categoryLabels: Record<string, string> = { brainwave: "BrainWave", vitalwave: "VitalWave", ultrasound: "Ultrasound Studies", other: "Other" };
const categoryIcons: Record<string, typeof Brain> = { brainwave: Brain, vitalwave: Activity, ultrasound: Scan, other: Scan };

const ALL_AVAILABLE_TESTS: string[] = [
  "BrainWave",
  "VitalWave",
  "Bilateral Carotid Duplex",
  "Echocardiogram TTE",
  "Stress Echocardiogram",
  "Lower Extremity Venous Duplex",
  "Upper Extremity Venous Duplex",
  "Renal Artery Doppler",
  "Lower Extremity Arterial Doppler",
  "Upper Extremity Arterial Doppler",
  "Abdominal Aortic Aneurysm Duplex",
];

function StepTimeline({ current, onNavigate, canGoToResults }: { current: "home" | "build" | "results"; onNavigate: (step: "home" | "build" | "results") => void; canGoToResults: boolean }) {
  const steps = [
    { id: "home" as const, label: "Home", num: 1 },
    { id: "build" as const, label: "Build Schedule", num: 2 },
    { id: "results" as const, label: "Final Schedule", num: 3 },
  ];
  const currentIdx = steps.findIndex((s) => s.id === current);

  return (
    <div className="flex items-center justify-center gap-0 py-2 px-4 border-b bg-white/50 dark:bg-card/50" data-testid="step-timeline">
      {steps.map((step, i) => {
        const isActive = step.id === current;
        const isPast = i < currentIdx;
        const isClickable = true;

        return (
          <div key={step.id} className="flex items-center">
            {i > 0 && (
              <div className={`w-8 sm:w-12 h-px mx-1 ${isPast || isActive ? "bg-primary" : "bg-border"}`} />
            )}
            <Button
              variant={isActive ? "default" : "ghost"}
              size="sm"
              onClick={() => isClickable && onNavigate(step.id)}
              disabled={!isClickable}
              className={`gap-1.5 text-xs ${
                isActive
                  ? ""
                  : isPast
                  ? "text-primary"
                  : ""
              }`}
              data-testid={`step-${step.id}`}
            >
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                isActive
                  ? "bg-primary-foreground text-primary"
                  : isPast
                  ? "bg-primary/20 text-primary"
                  : "bg-muted text-muted-foreground"
              }`}>
                {isPast ? <Check className="w-3 h-3" /> : step.num}
              </span>
              <span className="hidden sm:inline">{step.label}</span>
            </Button>
          </div>
        );
      })}
    </div>
  );
}

function getBadgeColor(cat: string): string {
  switch (cat) {
    case "brainwave": return "bg-violet-100 text-violet-800 dark:bg-violet-900/50 dark:text-violet-300";
    case "vitalwave": return "bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300";
    case "ultrasound": return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300";
    default: return "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300";
  }
}

const FACILITIES = ["Taylor Family Practice", "NWPG - Spring", "NWPG - Veterans"] as const;
type Facility = typeof FACILITIES[number];

const APPOINTMENT_STATUSES = ["Completed", "No Show", "Rescheduled", "Scheduled Different Day", "Cancelled", "Pending"] as const;
type AppointmentStatus = typeof APPOINTMENT_STATUSES[number];

const IMPORT_ACCESS_CODE = "1234";

type TabItem = { type: "home" } | { type: "history" } | { type: "references" } | { type: "schedule"; batchId: number; label: string; viewMode?: "build" | "results" };

function ScheduleTile() {
  const fmt12 = (time24: string) => {
    const [h, m] = time24.split(":").map(Number);
    return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
  };

  const { data: appts = [], isLoading } = useQuery<AncillaryAppointment[]>({
    queryKey: ["/api/appointments/schedule-tile"],
    queryFn: async () => {
      const apiKey = import.meta.env.VITE_API_KEY as string | undefined;
      const headers: Record<string, string> = {};
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
      const res = await fetch("/api/appointments?upcoming=true&limit=100", { headers });
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 60000,
  });

  const DISPLAY_MAX = 20;
  const displayed = appts.slice(0, DISPLAY_MAX);
  const overflow = appts.length - DISPLAY_MAX;

  const grouped: Record<string, AncillaryAppointment[]> = {};
  for (const a of displayed) {
    if (!grouped[a.scheduledDate]) grouped[a.scheduledDate] = [];
    grouped[a.scheduledDate].push(a);
  }
  const sortedDates = Object.keys(grouped).sort();

  function testTypeBadge(testType: string) {
    if (testType === "BrainWave") return { label: "BrainWave", cls: "bg-violet-100 text-violet-700" };
    if (testType === "VitalWave") return { label: "VitalWave", cls: "bg-red-100 text-red-600" };
    return { label: testType, cls: "bg-emerald-100 text-emerald-700" };
  }

  function formatDateHeader(dateStr: string) {
    const d = new Date(dateStr + "T00:00:00");
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    if (d.getTime() === today.getTime()) return "Today";
    if (d.getTime() === tomorrow.getTime()) return "Tomorrow";
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  }

  if (isLoading) {
    return (
      <div className="space-y-2 animate-pulse">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-8 bg-slate-100 rounded-lg" />
        ))}
      </div>
    );
  }

  if (appts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center" data-testid="schedule-tile-empty">
        <Calendar className="w-10 h-10 text-slate-300 mb-3" strokeWidth={1.5} />
        <p className="text-sm font-medium text-slate-500 mb-1">No appointments scheduled</p>
        <p className="text-xs text-slate-400">Book BrainWave and VitalWave slots from the Schedule page</p>
      </div>
    );
  }

  return (
    <div data-testid="schedule-tile-list">
      <div className="space-y-4">
        {sortedDates.map((dateStr) => (
          <div key={dateStr}>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
                {formatDateHeader(dateStr)}
              </span>
              <div className="flex-1 h-px bg-slate-100" />
            </div>
            <div className="space-y-1">
              {grouped[dateStr].map((a) => {
                const badge = testTypeBadge(a.testType);
                return (
                  <div
                    key={a.id}
                    className="flex items-center gap-3 px-3 py-2 rounded-xl bg-slate-50/80 border border-slate-100 hover:bg-slate-100/70 transition-colors"
                    data-testid={`schedule-tile-row-${a.id}`}
                  >
                    <span className="text-xs font-semibold text-primary w-16 shrink-0 tabular-nums">{fmt12(a.scheduledTime)}</span>
                    <span className="text-xs font-medium text-slate-800 flex-1 truncate">{a.patientName}</span>
                    <span className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
                    <span className="text-[10px] text-slate-400 shrink-0 truncate max-w-[120px]">{a.facility}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {overflow > 0 && (
        <p className="text-xs text-slate-400 mt-3 text-center">+{overflow} more — view full schedule</p>
      )}
    </div>
  );
}

export default function Home() {
  const [tabs, setTabs] = useState<TabItem[]>([{ type: "home" }]);
  const [activeTabIndex, setActiveTabIndex] = useState(0);
  const [expandedPatient, setExpandedPatient] = useState<number | null>(null);
  const [expandedClinical, setExpandedClinical] = useState<number | null>(null);
  const [selectedTestDetail, setSelectedTestDetail] = useState<{ patientId: number; category: string; tests: string[]; reasoning: Record<string, ReasoningValue> } | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [clinicianInput, setClinicianInput] = useState("");
  const [analyzingPatients, setAnalyzingPatients] = useState<Set<number>>(new Set());
  const [historyPasteText, setHistoryPasteText] = useState("");
  const [historySearch, setHistorySearch] = useState("");
  const [dirPasteText, setDirPasteText] = useState("");
  const [dirSearch, setDirSearch] = useState("");
  const [selectedBatchIds, setSelectedBatchIds] = useState<Set<number>>(new Set());

  const activeTab = tabs[activeTabIndex] || tabs[0] || { type: "home" };
  const selectedBatchId = activeTab.type === "schedule" ? activeTab.batchId : null;
  const scheduleViewMode = activeTab.type === "schedule" ? (activeTab.viewMode || "build") : null;
  const view = activeTab.type === "history" ? "history" : activeTab.type === "references" ? "references" : activeTab.type === "schedule" ? "schedule" : "home";

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { setOpen: setSidebarOpen } = useSidebar();
  const [, setLocation] = useLocation();
  const [newScheduleDialogOpen, setNewScheduleDialogOpen] = useState(false);
  const [newScheduleDate, setNewScheduleDate] = useState<Date | undefined>(new Date());
  const [newScheduleFacility, setNewScheduleFacility] = useState<string>("");
  const [importUnlocked, setImportUnlocked] = useState(false);
  const [importCodeInput, setImportCodeInput] = useState("");
  const [importCodeError, setImportCodeError] = useState(false);
  const [scheduleModalPatient, setScheduleModalPatient] = useState<PatientScreening | null>(null);

  const { data: batches = [], isLoading: batchesLoading } = useQuery<ScreeningBatchWithPatients[]>({
    queryKey: ["/api/screening-batches"],
  });

  const { data: selectedBatch, isLoading: batchLoading } = useQuery<ScreeningBatchWithPatients>({
    queryKey: ["/api/screening-batches", selectedBatchId],
    enabled: !!selectedBatchId,
    refetchInterval: (query) => query.state.data?.status === "processing" ? 2000 : false,
  });

  const { data: testHistory = [], isLoading: historyLoading } = useQuery<PatientTestHistory[]>({
    queryKey: ["/api/test-history"],
    enabled: view === "history" || view === "references" || tabs.some((t) => t.type === "history" || t.type === "references"),
  });

  const importHistoryMutation = useMutation({
    mutationFn: async (text: string) => {
      const res = await apiRequest("POST", "/api/test-history/import", { text });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/test-history"] });
      toast({ title: `Imported ${data.imported} records` });
      setHistoryPasteText("");
    },
    onError: (e: any) => {
      toast({ title: "Import failed", description: e.message, variant: "destructive" });
    },
  });

  const importHistoryFileMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const apiKey = import.meta.env.VITE_API_KEY as string | undefined;
      const headers: Record<string, string> = {};
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
      const res = await fetch("/api/test-history/import", { method: "POST", headers, body: formData });
      if (!res.ok) throw new Error((await res.json()).error || "Import failed");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/test-history"] });
      toast({ title: `Imported ${data.imported} records` });
    },
    onError: (e: any) => {
      toast({ title: "Import failed", description: e.message, variant: "destructive" });
    },
  });

  const deleteHistoryMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/test-history/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/test-history"] });
    },
  });

  const clearHistoryMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", "/api/test-history");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/test-history"] });
      toast({ title: "All history cleared" });
    },
  });


  const openScheduleTab = useCallback((batchId: number, label: string, status?: string) => {
    const existingIdx = tabs.findIndex((t) => t.type === "schedule" && t.batchId === batchId);
    if (existingIdx >= 0) {
      setActiveTabIndex(existingIdx);
    } else {
      const newTab: TabItem = { type: "schedule", batchId, label };
      setTabs((prev) => [...prev, newTab]);
      setActiveTabIndex(tabs.length);
    }
  }, [tabs]);

  const closeTab = useCallback((index: number) => {
    setTabs((prev) => {
      const next = prev.filter((_, i) => i !== index);
      if (next.length === 0) return [{ type: "home" as const }];
      return next;
    });
    setActiveTabIndex((prev) => {
      if (index < prev) return prev - 1;
      if (index === prev) return Math.max(0, index - 1);
      return prev;
    });
  }, []);

  const createBatchMutation = useMutation({
    mutationFn: async ({ name, facility, scheduleDate }: { name: string; facility: string; scheduleDate?: string }) => {
      const res = await apiRequest("POST", "/api/batches", { name, facility, scheduleDate });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/screening-batches"] });
      openScheduleTab(data.id, data.name || "New Schedule");
    },
  });

  const addPatientMutation = useMutation({
    mutationFn: async ({ batchId, name, time }: { batchId: number; name: string; time?: string }) => {
      const res = await apiRequest("POST", `/api/batches/${batchId}/patients`, { name, time });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/screening-batches", selectedBatchId] });
      queryClient.invalidateQueries({ queryKey: ["/api/screening-batches"] });
    },
  });

  const importTextMutation = useMutation({
    mutationFn: async ({ batchId, text }: { batchId: number; text: string }) => {
      const res = await apiRequest("POST", `/api/batches/${batchId}/import-text`, { text });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/screening-batches", selectedBatchId] });
      queryClient.invalidateQueries({ queryKey: ["/api/screening-batches"] });
      setPasteText("");
      toast({ title: `Imported ${data.imported} patients` });
    },
  });

  const importFileMutation = useMutation({
    mutationFn: async ({ batchId, formData }: { batchId: number; formData: FormData }) => {
      const apiKey = import.meta.env.VITE_API_KEY as string | undefined;
      const headers: Record<string, string> = {};
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
      const res = await fetch(`/api/batches/${batchId}/import-file`, { method: "POST", headers, body: formData });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/screening-batches", selectedBatchId] });
      queryClient.invalidateQueries({ queryKey: ["/api/screening-batches"] });
      toast({ title: `Imported ${data.imported} patients` });
    },
  });

  const updatePatientMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: number; updates: any }) => {
      const res = await apiRequest("PATCH", `/api/patients/${id}`, updates);
      return res.json();
    },
    onSuccess: (updatedPatient: PatientScreening, { id }) => {
      const batchId = updatedPatient.batchId ?? selectedBatchId;
      queryClient.setQueryData<ScreeningBatchWithPatients>(
        ["/api/screening-batches", batchId],
        (old) => {
          if (!old) return old;
          return {
            ...old,
            patients: (old.patients || []).map((p) =>
              p.id === id ? { ...p, ...updatedPatient } : p
            ),
          };
        }
      );
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      toast({ title: "Update failed", description: msg, variant: "destructive" });
      queryClient.invalidateQueries({ queryKey: ["/api/screening-batches", selectedBatchId] });
    },
  });

  const deletePatientMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/patients/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/screening-batches", selectedBatchId] });
      queryClient.invalidateQueries({ queryKey: ["/api/screening-batches"] });
    },
  });

  const deleteBatchMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/screening-batches/${id}`);
    },
    onSuccess: (_, deletedId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/screening-batches"] });
      const tabIdx = tabs.findIndex((t) => t.type === "schedule" && t.batchId === deletedId);
      if (tabIdx >= 0) closeTab(tabIdx);
    },
  });

  const updateClinicianMutation = useMutation({
    mutationFn: async ({ id, clinicianName }: { id: number; clinicianName: string }) => {
      await apiRequest("PATCH", `/api/screening-batches/${id}`, { clinicianName });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/screening-batches", selectedBatchId] });
    },
  });

  useEffect(() => {
    setClinicianInput(selectedBatch?.clinicianName || "");
  }, [selectedBatch?.id, selectedBatch?.clinicianName]);

  useEffect(() => {
    if (selectedBatchIds.size === 0) return;
    const validIds = new Set(batches.map((b) => b.id));
    setSelectedBatchIds((prev) => {
      const pruned = new Set(Array.from(prev).filter((id) => validIds.has(id)));
      return pruned.size === prev.size ? prev : pruned;
    });
  }, [batches]);

  const [analysisProgress, setAnalysisProgress] = useState<{ completed: number; total: number } | null>(null);

  const analyzeAllMutation = useMutation({
    mutationFn: async (batchId: number) => {
      const res = await apiRequest("POST", `/api/batches/${batchId}/analyze`);
      const data = await res.json();
      const total = data.patientCount || 0;
      setAnalysisProgress({ completed: 0, total });

      const MAX_POLLS = 180; // 6 minutes max (180 × 2s)
      let lastCompletedCount = 0;
      let stallStreak = 0;

      const pollProgress = async (attempt = 0): Promise<void> => {
        if (attempt >= MAX_POLLS) {
          throw new Error("Analysis is taking longer than expected. Click Generate All to resume.");
        }

        const apiKey = import.meta.env.VITE_API_KEY as string | undefined;
        const pollHeaders: Record<string, string> = {};
        if (apiKey) pollHeaders["Authorization"] = `Bearer ${apiKey}`;
        const batchRes = await fetch(`/api/screening-batches/${batchId}`, { headers: pollHeaders });
        if (!batchRes.ok) throw new Error("Lost connection during analysis. Click Generate All to resume.");
        const batchData = await batchRes.json();

        const completedCount = (batchData.patients || []).filter((p: any) => p.status === "completed").length;
        setAnalysisProgress({ completed: completedCount, total });
        queryClient.invalidateQueries({ queryKey: ["/api/screening-batches", batchId] });

        if (batchData.status === "completed") return;

        if (batchData.status === "error" || batchData.status === "draft") {
          throw new Error("Analysis stopped unexpectedly. Click Generate All to try again.");
        }

        // Detect stall: no new patients completing for 2 minutes AFTER the first one finishes
        if (completedCount > lastCompletedCount) {
          lastCompletedCount = completedCount;
          stallStreak = 0;
        } else if (lastCompletedCount > 0) {
          // Only start stall counting after at least one patient completes
          stallStreak++;
          if (stallStreak >= 60) {
            throw new Error("Analysis appears stalled. Click Generate All to resume.");
          }
        }

        await new Promise((resolve) => setTimeout(resolve, 2000));
        return pollProgress(attempt + 1);
      };

      await pollProgress();
      return data;
    },
    onSuccess: () => {
      setAnalysisProgress(null);
      queryClient.invalidateQueries({ queryKey: ["/api/screening-batches", selectedBatchId] });
      queryClient.invalidateQueries({ queryKey: ["/api/screening-batches"] });
      toast({ title: "Analysis complete", description: "All patients have been screened." });
      setTabs((prev) => prev.map((tab, i) => {
        if (i === activeTabIndex && tab.type === "schedule") return { ...tab, viewMode: "results" as const };
        return tab;
      }));
    },
    onError: (err: Error) => {
      setAnalysisProgress(null);
      toast({ title: "Analysis failed", description: err.message, variant: "destructive" });
    },
  });

  const analyzeOnePatient = useCallback(async (patientId: number) => {
    setAnalyzingPatients((prev) => new Set(prev).add(patientId));
    try {
      const res = await apiRequest("POST", `/api/patients/${patientId}/analyze`);
      await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/screening-batches", selectedBatchId] });
      toast({ title: "Patient analyzed" });
    } catch (err: any) {
      toast({ title: "Analysis failed", description: err.message, variant: "destructive" });
    } finally {
      setAnalyzingPatients((prev) => {
        const next = new Set(prev);
        next.delete(patientId);
        return next;
      });
    }
  }, [selectedBatchId, queryClient, toast]);

  const handleFileUpload = useCallback(
    (files: FileList | File[]) => {
      if (!selectedBatchId) return;
      const formData = new FormData();
      Array.from(files).forEach((file) => formData.append("files", file));
      importFileMutation.mutate({ batchId: selectedBatchId, formData });
    },
    [selectedBatchId, importFileMutation]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer.files.length > 0) handleFileUpload(e.dataTransfer.files);
    },
    [handleFileUpload]
  );

  const handleExport = useCallback(async () => {
    if (!selectedBatchId) return;
    const apiKey = import.meta.env.VITE_API_KEY as string | undefined;
    const exportHeaders: Record<string, string> = {};
    if (apiKey) exportHeaders["Authorization"] = `Bearer ${apiKey}`;
    const res = await fetch(`/api/screening-batches/${selectedBatchId}/export`, { headers: exportHeaders });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `screening-results-${selectedBatchId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [selectedBatchId]);

  const patients = selectedBatch?.patients || [];
  const isProcessing = analyzeAllMutation.isPending;
  const completedCount = patients.filter((p) => p.status === "completed").length;

  const setScheduleViewMode = useCallback((mode: "build" | "results") => {
    setTabs((prev) => prev.map((tab, i) => {
      if (i === activeTabIndex && tab.type === "schedule") {
        return { ...tab, viewMode: mode };
      }
      return tab;
    }));
  }, [activeTabIndex]);

  const handleTimelineNav = useCallback((step: "home" | "build" | "results") => {
    if (step === "home") {
      const homeIdx = tabs.findIndex((t) => t.type === "home");
      if (homeIdx >= 0) setActiveTabIndex(homeIdx);
      else {
        setTabs((prev) => [{ type: "home" }, ...prev]);
        setActiveTabIndex(0);
      }
    } else if (step === "build" || step === "results") {
      setScheduleViewMode(step);
    }
  }, [tabs, setScheduleViewMode]);

  const handleSelectSchedule = useCallback((batch: ScreeningBatchWithPatients) => {
    openScheduleTab(batch.id, batch.name);
    setSidebarOpen(false);
  }, [openScheduleTab, setSidebarOpen]);

  const handleNewSchedule = useCallback(() => {
    setNewScheduleDate(new Date());
    setNewScheduleDialogOpen(true);
  }, []);

  const handleNewScheduleConfirm = useCallback(() => {
    const date = newScheduleDate ?? new Date();
    const _d = date;
    const scheduleDateStr = `${_d.getFullYear()}-${String(_d.getMonth() + 1).padStart(2, "0")}-${String(_d.getDate()).padStart(2, "0")}`;
    createBatchMutation.mutate({ name: `Schedule - ${date.toLocaleDateString()}`, facility: newScheduleFacility, scheduleDate: scheduleDateStr }, {
      onSuccess: () => {
        setNewScheduleDialogOpen(false);
        setNewScheduleFacility("");
      },
    });
  }, [createBatchMutation, newScheduleDate, newScheduleFacility]);

  const openHistoryTab = useCallback(() => {
    const existingIdx = tabs.findIndex((t) => t.type === "history");
    if (existingIdx >= 0) {
      setActiveTabIndex(existingIdx);
    } else {
      setTabs((prev) => [...prev, { type: "history" }]);
      setActiveTabIndex(tabs.length);
    }
  }, [tabs]);

  const openReferencesTab = useCallback(() => {
    const existingIdx = tabs.findIndex((t) => t.type === "references");
    if (existingIdx >= 0) {
      setActiveTabIndex(existingIdx);
    } else {
      setTabs((prev) => [...prev, { type: "references" }]);
      setActiveTabIndex(tabs.length);
    }
  }, [tabs]);

  return (
    <>
      <Sidebar collapsible="offcanvas" data-testid="sidebar-history">
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Tools</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    onClick={() => {
                      openHistoryTab();
                      setSidebarOpen(false);
                    }}
                    isActive={view === "history"}
                    data-testid="sidebar-patient-history"
                  >
                    <Database className="w-4 h-4 shrink-0" />
                    <span className="text-sm font-medium">Patient History</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    onClick={() => {
                      openReferencesTab();
                      setSidebarOpen(false);
                    }}
                    isActive={view === "references"}
                    data-testid="sidebar-patient-directory"
                  >
                    <Users className="w-4 h-4 shrink-0" />
                    <span className="text-sm font-medium">Patient Directory</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild data-testid="sidebar-archive">
                    <Link href="/archive" onClick={() => setSidebarOpen(false)}>
                      <Archive className="w-4 h-4 shrink-0" />
                      <span className="text-sm font-medium">Patient Archive</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild data-testid="sidebar-documents">
                    <Link href="/documents" onClick={() => setSidebarOpen(false)}>
                      <FileText className="w-4 h-4 shrink-0" />
                      <span className="text-sm font-medium">Ancillary Documents</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild data-testid="sidebar-document-upload">
                    <Link href="/document-upload" onClick={() => setSidebarOpen(false)}>
                      <Upload className="w-4 h-4 shrink-0" />
                      <span className="text-sm font-medium">Document Upload</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild data-testid="sidebar-appointments">
                    <Link href="/appointments" onClick={() => setSidebarOpen(false)}>
                      <Calendar className="w-4 h-4 shrink-0" />
                      <span className="text-sm font-medium">Appointments</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild data-testid="sidebar-billing">
                    <Link href="/billing" onClick={() => setSidebarOpen(false)}>
                      <DollarSign className="w-4 h-4 shrink-0" />
                      <span className="text-sm font-medium">Billing</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup>
            <div className="flex items-center justify-between px-2 pt-2 pb-1">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Schedule History</span>
              {batches.length > 0 && (
                <button
                  className="text-[10px] text-primary hover:underline"
                  onClick={() =>
                    setSelectedBatchIds(selectedBatchIds.size === batches.length
                      ? new Set()
                      : new Set(batches.map((b) => b.id))
                    )
                  }
                  data-testid="button-select-all-schedules"
                >
                  {selectedBatchIds.size === batches.length && batches.length > 0 ? "Deselect All" : "Select All"}
                </button>
              )}
            </div>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    onClick={() => {
                      handleNewSchedule();
                      setSidebarOpen(false);
                    }}
                    data-testid="sidebar-new-schedule"
                  >
                    <Plus className="w-4 h-4 shrink-0" />
                    <span className="text-sm font-medium">New Schedule</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                {batchesLoading ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  </div>
                ) : batches.length === 0 ? (
                  <div className="px-2 py-3 text-xs text-muted-foreground text-center">
                    No schedules yet
                  </div>
                ) : (
                  batches.map((batch) => (
                    <SidebarMenuItem key={batch.id}>
                      <div className="flex items-center w-full group">
                        <Checkbox
                          checked={selectedBatchIds.has(batch.id)}
                          onCheckedChange={() => {
                            setSelectedBatchIds((prev) => {
                              const next = new Set(prev);
                              next.has(batch.id) ? next.delete(batch.id) : next.add(batch.id);
                              return next;
                            });
                          }}
                          className="shrink-0 ml-1 mr-1 opacity-40 group-hover:opacity-100 data-[state=checked]:opacity-100 transition-opacity"
                          data-testid={`checkbox-schedule-${batch.id}`}
                        />
                        <SidebarMenuButton
                          onClick={() => handleSelectSchedule(batch)}
                          isActive={selectedBatchId === batch.id}
                          tooltip={batch.name}
                          data-testid={`sidebar-schedule-${batch.id}`}
                          className="flex-1 min-w-0"
                        >
                          <Calendar className="w-4 h-4 shrink-0" />
                          <div className="flex flex-col min-w-0">
                            <span className="truncate text-sm">{batch.name}</span>
                            <span className="text-[10px] text-muted-foreground">
                              {batch.patientCount} patients
                              {batch.status === "completed" && " · Complete"}
                            </span>
                          </div>
                        </SidebarMenuButton>
                        {selectedBatchIds.size === 0 && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mr-1"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (confirm(`Delete "${batch.name}"?`)) deleteBatchMutation.mutate(batch.id);
                            }}
                            data-testid={`button-delete-schedule-${batch.id}`}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        )}
                      </div>
                    </SidebarMenuItem>
                  ))
                )}
              </SidebarMenu>
              {selectedBatchIds.size > 0 && (
                <div className="px-2 pt-2 pb-1">
                  <Button
                    variant="destructive"
                    size="sm"
                    className="w-full text-xs h-7 gap-1"
                    onClick={async () => {
                      if (!confirm(`Delete ${selectedBatchIds.size} schedule(s)?`)) return;
                      for (const id of Array.from(selectedBatchIds)) {
                        await deleteBatchMutation.mutateAsync(id);
                      }
                      setSelectedBatchIds(new Set());
                    }}
                    data-testid="button-delete-selected-schedules"
                  >
                    <Trash2 className="w-3 h-3" />
                    Delete Selected ({selectedBatchIds.size})
                  </Button>
                </div>
              )}
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>

      <div className="flex flex-col flex-1 min-w-0 relative bg-background">
        <div className="bg-[#1e3a5f]/95 backdrop-blur-sm flex items-center gap-0 px-2 shrink-0 overflow-x-auto" data-testid="tab-bar">
          {tabs.map((tab, i) => {
            const isActive = i === activeTabIndex;
            const label = tab.type === "home" ? "Home" : tab.type === "history" ? "Patient History" : tab.type === "references" ? "Patient Directory" : tab.label;
            const canClose = tabs.length > 1;
            return (
              <div
                key={`${tab.type}-${tab.type === "schedule" ? tab.batchId : i}`}
                className={`flex items-center gap-1.5 px-4 py-2 cursor-pointer text-sm font-medium whitespace-nowrap transition-colors border-b-2 ${
                  isActive
                    ? "bg-white/15 text-white border-white"
                    : "text-blue-200/70 border-transparent hover:text-white hover:bg-white/5"
                }`}
                onClick={() => setActiveTabIndex(i)}
                data-testid={`tab-${tab.type}${tab.type === "schedule" ? `-${tab.batchId}` : ""}`}
              >
                <span className="truncate max-w-[180px]">{label}</span>
                {canClose && (
                  <button
                    className="ml-1 p-0.5 rounded hover:bg-white/20 transition-colors"
                    onClick={(e) => { e.stopPropagation(); closeTab(i); }}
                    data-testid={`button-close-tab-${i}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            );
          })}
          <button
            className="flex items-center gap-1 px-3 py-2 text-blue-200/60 hover:text-white transition-colors text-sm"
            onClick={handleNewSchedule}
            data-testid="button-new-tab"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        {view === "history" ? (
          <div className="flex flex-col h-full relative z-10">
            <header className="bg-white/85 dark:bg-card/85 backdrop-blur-md sticky top-0 z-50">
              <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-2 flex-wrap border-b">
                <div className="flex items-center gap-2">
                  <SidebarTrigger data-testid="button-sidebar-toggle-history" />
                  <div>
                    <h1 className="text-base font-bold tracking-tight flex items-center gap-2">
                      <Database className="w-4 h-4" />
                      Patient Test History
                    </h1>
                    <p className="text-xs text-muted-foreground">{testHistory.length} records</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {testHistory.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (confirm("Clear all test history records?")) clearHistoryMutation.mutate();
                      }}
                      className="gap-1.5 text-red-600"
                      data-testid="button-clear-history"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Clear All
                    </Button>
                  )}
                </div>
              </div>
            </header>
            <div className="flex-1 overflow-auto p-4">
              <div className="max-w-5xl mx-auto space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Card className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Upload className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm font-semibold">Upload File</span>
                    </div>
                    <p className="text-xs text-muted-foreground mb-2">Import from Excel, CSV, or text files. CSV columns: PatientName, TestName, DOS, InsuranceType</p>
                    <input
                      type="file"
                      accept=".xlsx,.xls,.csv,.txt"
                      className="text-xs"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) importHistoryFileMutation.mutate(file);
                        e.target.value = "";
                      }}
                      data-testid="input-history-file"
                    />
                    {importHistoryFileMutation.isPending && (
                      <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                        <Loader2 className="w-3 h-3 animate-spin" /> Importing...
                      </div>
                    )}
                  </Card>
                  <Card className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <FileText className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm font-semibold">Paste Data</span>
                    </div>
                    <Textarea
                      placeholder="Paste patient test history data here..."
                      value={historyPasteText}
                      onChange={(e) => setHistoryPasteText(e.target.value)}
                      className="text-xs min-h-[80px] mb-2"
                      data-testid="input-history-paste"
                    />
                    <Button
                      size="sm"
                      disabled={!historyPasteText.trim() || importHistoryMutation.isPending}
                      onClick={() => importHistoryMutation.mutate(historyPasteText)}
                      className="gap-1.5"
                      data-testid="button-import-history"
                    >
                      {importHistoryMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                      Import
                    </Button>
                  </Card>
                </div>

                {testHistory.length > 0 && (
                  <Card className="p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Search className="w-4 h-4 text-muted-foreground" />
                      <Input
                        placeholder="Search by patient name..."
                        value={historySearch}
                        onChange={(e) => setHistorySearch(e.target.value)}
                        className="text-xs h-8 max-w-xs"
                        data-testid="input-history-search"
                      />
                    </div>
                    <div className="overflow-auto max-h-[60vh]">
                      <table className="w-full border-collapse text-xs">
                        <thead>
                          <tr className="bg-slate-100 dark:bg-muted">
                            <th className="border px-3 py-2 text-left font-semibold">Patient Name</th>
                            <th className="border px-3 py-2 text-left font-semibold">Test</th>
                            <th className="border px-3 py-2 text-left font-semibold">Date of Service</th>
                            <th className="border px-3 py-2 text-left font-semibold">Insurance</th>
                            <th className="border px-3 py-2 text-left font-semibold">Clinic</th>
                            <th className="border px-3 py-2 text-left font-semibold w-10"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {testHistory
                            .filter((r) => !historySearch || r.patientName.toLowerCase().includes(historySearch.toLowerCase()))
                            .map((record) => (
                              <tr key={record.id} className="hover:bg-slate-50 dark:hover:bg-muted/30" data-testid={`row-history-${record.id}`}>
                                <td className="border px-3 py-1.5">{record.patientName}</td>
                                <td className="border px-3 py-1.5">{record.testName}</td>
                                <td className="border px-3 py-1.5">{record.dateOfService}</td>
                                <td className="border px-3 py-1.5">
                                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                    record.insuranceType === "medicare"
                                      ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                                      : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
                                  }`}>
                                    {record.insuranceType.toUpperCase()}
                                  </span>
                                </td>
                                <td className="border px-3 py-1.5">
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                                    {record.clinic || "NWPG"}
                                  </span>
                                </td>
                                <td className="border px-3 py-1.5">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-6 w-6"
                                    onClick={() => deleteHistoryMutation.mutate(record.id)}
                                    data-testid={`button-delete-history-${record.id}`}
                                  >
                                    <X className="w-3 h-3" />
                                  </Button>
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                )}

                {historyLoading && (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : view === "references" ? (
          <PatientDirectoryView
            testHistory={testHistory}
            historyLoading={historyLoading}
            dirPasteText={dirPasteText}
            setDirPasteText={setDirPasteText}
            dirSearch={dirSearch}
            setDirSearch={setDirSearch}
            onImportFile={(file) => importHistoryFileMutation.mutate(file)}
            onImportText={(text) => {
              importHistoryMutation.mutate(text, { onSuccess: () => setDirPasteText("") });
            }}
            onClearAll={() => { if (confirm("Clear all patient history records?")) clearHistoryMutation.mutate(); }}
            importFilePending={importHistoryFileMutation.isPending}
            importTextPending={importHistoryMutation.isPending}
            onOpenHistory={openHistoryTab}
          />
        ) : view === "schedule" && selectedBatchId && (scheduleViewMode === "results" || (selectedBatch?.status === "completed" && scheduleViewMode !== "build")) ? (
          <ResultsView
            batch={selectedBatch}
            patients={patients}
            loading={batchLoading}
            onExport={handleExport}
            onNavigate={handleTimelineNav}
            expandedPatient={expandedPatient}
            setExpandedPatient={setExpandedPatient}
            expandedClinical={expandedClinical}
            setExpandedClinical={setExpandedClinical}
            selectedTestDetail={selectedTestDetail}
            setSelectedTestDetail={setSelectedTestDetail}
            onUpdatePatient={(id, updates) => updatePatientMutation.mutate({ id, updates })}
          />
        ) : view === "schedule" && selectedBatchId ? (
          <div className="flex flex-col h-full relative z-10">
            <header className="bg-white/85 dark:bg-card/85 backdrop-blur-md sticky top-0 z-50">
              <StepTimeline current="build" onNavigate={handleTimelineNav} canGoToResults={completedCount > 0} />
              <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-2 flex-wrap border-b">
                <div className="flex items-center gap-2">
                  <SidebarTrigger data-testid="button-sidebar-toggle" />
                  <div>
                    <h1 className="text-base font-bold tracking-tight" data-testid="text-schedule-name">{selectedBatch?.name || "Loading..."}</h1>
                    <div className="flex items-center gap-1 mt-0.5">
                      <input
                        type="text"
                        placeholder="Clinician / Provider"
                        value={clinicianInput}
                        onChange={(e) => setClinicianInput(e.target.value)}
                        onBlur={() => {
                          if (selectedBatchId) {
                            updateClinicianMutation.mutate({ id: selectedBatchId, clinicianName: clinicianInput });
                          }
                        }}
                        className="text-xs text-muted-foreground bg-transparent border-0 border-b border-dashed border-muted-foreground/40 focus:border-primary focus:outline-none px-0 py-0.5 w-44 placeholder:text-muted-foreground/50"
                        data-testid="input-clinician-name"
                      />
                    </div>
                    {selectedBatch?.facility && (
                      <div className="flex items-center gap-1 mt-0.5">
                        <Building2 className="w-3 h-3 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground" data-testid="text-facility-build">{selectedBatch.facility}</span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {patients.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (confirm("Delete all patients from this schedule?")) {
                          patients.forEach((p) => deletePatientMutation.mutate(p.id));
                        }
                      }}
                      disabled={isProcessing}
                      className="gap-1.5"
                      data-testid="button-delete-all"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Delete All
                    </Button>
                  )}
                  <Button
                    onClick={() => analyzeAllMutation.mutate(selectedBatchId!)}
                    disabled={isProcessing || patients.length === 0}
                    className="gap-1.5"
                    data-testid="button-generate-all"
                  >
                    {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                    Generate All
                  </Button>
                </div>
              </div>
            </header>

            <main className="flex-1 overflow-auto">
              <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
                {isProcessing && (
                  <Card className="p-6">
                    <div className="flex flex-col items-center gap-3">
                      <Loader2 className="w-10 h-10 text-primary animate-spin" />
                      <p className="font-semibold">Analyzing patients...</p>
                      {analysisProgress && (
                        <>
                          <p className="text-sm text-muted-foreground" data-testid="text-analysis-progress">
                            {analysisProgress.completed} of {analysisProgress.total} completed
                          </p>
                          <div className="w-full max-w-xs bg-slate-200 dark:bg-muted rounded-full h-2 overflow-hidden">
                            <div
                              className="h-full bg-primary rounded-full transition-all duration-500 ease-out"
                              style={{ width: `${analysisProgress.total > 0 ? (analysisProgress.completed / analysisProgress.total) * 100 : 0}%` }}
                            />
                          </div>
                        </>
                      )}
                      {!analysisProgress && (
                        <p className="text-sm text-muted-foreground">Starting AI screening...</p>
                      )}
                    </div>
                  </Card>
                )}

                <section>
                  <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Add Patients</h2>
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    {importUnlocked ? (
                      <>
                        <Card className="p-4">
                          <div className="flex items-center gap-2 mb-3">
                            <Upload className="w-4 h-4 text-muted-foreground" />
                            <span className="text-base font-semibold">Upload File</span>
                          </div>
                          <div
                            className={`flex flex-col items-center justify-center border-2 border-dashed rounded-md p-6 cursor-pointer transition-colors ${
                              dragOver ? "border-primary bg-primary/5" : "border-border"
                            }`}
                            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                            onDragLeave={() => setDragOver(false)}
                            onDrop={handleDrop}
                            onClick={() => {
                              const input = document.createElement("input");
                              input.type = "file";
                              input.multiple = true;
                              input.accept = ".xlsx,.xls,.csv,.txt,.text,.pdf,.jpg,.jpeg,.png,.gif,.bmp,.webp";
                              input.onchange = (e) => {
                                const files = (e.target as HTMLInputElement).files;
                                if (files) handleFileUpload(files);
                              };
                              input.click();
                            }}
                            data-testid="dropzone-upload"
                          >
                            {importFileMutation.isPending ? (
                              <Loader2 className="w-6 h-6 text-muted-foreground animate-spin" />
                            ) : (
                              <>
                                <Upload className="w-6 h-6 text-muted-foreground mb-1.5" />
                                <p className="text-xs text-muted-foreground text-center">Drop files or click to browse</p>
                                <p className="text-[10px] text-muted-foreground mt-0.5">Excel, CSV, PDF, images, text</p>
                              </>
                            )}
                          </div>
                        </Card>

                        <Card className="p-4">
                          <div className="flex items-center gap-2 mb-3">
                            <FileText className="w-4 h-4 text-muted-foreground" />
                            <span className="text-base font-semibold">Paste List</span>
                          </div>
                          <Textarea
                            placeholder={"Paste patient list here — it will import automatically\n\n9:00 AM - John Smith\n9:30 AM - Jane Doe\nBob Johnson"}
                            className="min-h-[82px] resize-none text-sm mb-2"
                            value={pasteText}
                            onChange={(e) => setPasteText(e.target.value)}
                            onPaste={(e) => {
                              const pasted = e.clipboardData.getData("text");
                              if (pasted.trim() && selectedBatchId) {
                                e.preventDefault();
                                setPasteText(pasted);
                                importTextMutation.mutate({ batchId: selectedBatchId, text: pasted.trim() });
                              }
                            }}
                            data-testid="input-paste-list"
                          />
                          <Button
                            className="w-full gap-1.5"
                            variant="outline"
                            onClick={() => {
                              if (!pasteText.trim() || !selectedBatchId) return;
                              importTextMutation.mutate({ batchId: selectedBatchId, text: pasteText.trim() });
                            }}
                            disabled={!pasteText.trim() || importTextMutation.isPending}
                            data-testid="button-import-text"
                          >
                            {importTextMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                            Import List
                          </Button>
                        </Card>
                      </>
                    ) : (
                      <Card className="p-4 col-span-1 lg:col-span-2">
                        <div className="flex items-center gap-2 mb-3">
                          <Lock className="w-4 h-4 text-muted-foreground" />
                          <span className="text-base font-semibold">Import Access</span>
                        </div>
                        <p className="text-xs text-muted-foreground mb-3">
                          File upload and paste import require an access code. Manual entry is always available.
                        </p>
                        <div className="flex items-center gap-2">
                          <Input
                            type="password"
                            inputMode="numeric"
                            maxLength={4}
                            placeholder="Enter 4-digit code"
                            value={importCodeInput}
                            onChange={(e) => {
                              setImportCodeInput(e.target.value.replace(/\D/g, "").slice(0, 4));
                              setImportCodeError(false);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                if (importCodeInput === IMPORT_ACCESS_CODE) {
                                  setImportUnlocked(true);
                                  setImportCodeInput("");
                                  setImportCodeError(false);
                                } else {
                                  setImportCodeError(true);
                                  setImportCodeInput("");
                                }
                              }
                            }}
                            className={`max-w-[160px] ${importCodeError ? "border-red-400" : ""}`}
                            data-testid="input-import-code"
                          />
                          <Button
                            size="sm"
                            onClick={() => {
                              if (importCodeInput === IMPORT_ACCESS_CODE) {
                                setImportUnlocked(true);
                                setImportCodeInput("");
                                setImportCodeError(false);
                              } else {
                                setImportCodeError(true);
                                setImportCodeInput("");
                              }
                            }}
                            data-testid="button-import-unlock"
                          >
                            Unlock
                          </Button>
                        </div>
                        {importCodeError && (
                          <p className="text-xs text-red-500 mt-1.5" data-testid="text-import-code-error">Incorrect code. Please try again.</p>
                        )}
                      </Card>
                    )}

                    <Card className="p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <Plus className="w-4 h-4 text-muted-foreground" />
                        <span className="text-base font-semibold">Manual Entry</span>
                      </div>
                      <Button
                        className="w-full gap-1.5"
                        onClick={() => {
                          if (!selectedBatchId) return;
                          addPatientMutation.mutate({ batchId: selectedBatchId, name: "", time: undefined });
                        }}
                        disabled={addPatientMutation.isPending}
                        data-testid="button-add-patient"
                      >
                        {addPatientMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                        Add Patient
                      </Button>
                    </Card>
                  </div>
                </section>

                {patients.length > 0 && (
                  <section>
                    <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
                      <h2 className="text-base font-semibold text-muted-foreground uppercase tracking-wider">
                        Schedule Generator ({patients.length})
                      </h2>
                      {completedCount > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {completedCount}/{patients.length} analyzed
                        </span>
                      )}
                    </div>
                    <div className="space-y-3">
                      {patients.map((patient) => (
                        <PatientCard
                          key={patient.id}
                          patient={patient}
                          isAnalyzing={analyzingPatients.has(patient.id)}
                          onUpdate={(field, value) => {
                            const updates: Record<string, unknown> = { [field]: value };
                            if (field === "time") {
                              updates.patientType = (value as string).trim() ? "visit" : "outreach";
                            }
                            updatePatientMutation.mutate({ id: patient.id, updates });
                          }}
                          onDelete={() => deletePatientMutation.mutate(patient.id)}
                          onAnalyze={() => analyzeOnePatient(patient.id)}
                          onOpenScheduleModal={(p) => setScheduleModalPatient(p)}
                        />
                      ))}
                    </div>
                  </section>
                )}

                {patients.length === 0 && !isProcessing && (
                  <div className="text-center py-16 text-muted-foreground">
                    <FileText className="w-10 h-10 mx-auto mb-3 opacity-40" />
                    <p className="text-sm">No patients yet. Use the options above to add patients.</p>
                  </div>
                )}
              </div>
            </main>
          </div>
        ) : (
          <div className="flex flex-col h-full">
            <header className="sticky top-0 z-50 bg-white/80 dark:bg-card/80 backdrop-blur-xl border-b border-slate-200/60">
              <div className="px-8 py-3 flex items-center">
                <SidebarTrigger data-testid="button-sidebar-toggle-home" />
              </div>
            </header>

            <main className="flex-1 overflow-auto">
              <div className="max-w-5xl mx-auto px-8 pt-10 pb-16">
                <div className="mb-12 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-16 h-16 rounded-2xl bg-indigo-500 flex items-center justify-center shadow-md">
                      <Activity className="w-9 h-9 text-white" />
                    </div>
                    <div>
                      <h2 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-foreground" data-testid="text-home-heading">
                        Plexus
                      </h2>
                      <p className="text-sm text-slate-500 dark:text-muted-foreground mt-0.5 tracking-wide uppercase font-medium">
                        Ancillary Screening
                      </p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                  <Card
                    className={`group cursor-pointer rounded-2xl bg-white dark:bg-card border border-slate-200/60 dark:border-border shadow-sm transition-transform duration-100 active:scale-95 hover:scale-[1.03] ${createBatchMutation.isPending ? "pointer-events-none opacity-60" : ""}`}
                    onClick={handleNewSchedule}
                    data-testid="tile-new-schedule"
                  >
                    <div className="aspect-square flex flex-col items-center justify-center gap-3 p-5">
                      {createBatchMutation.isPending ? (
                        <Loader2 className="w-14 h-14 text-indigo-500 animate-spin" strokeWidth={1.75} />
                      ) : (
                        <Plus className="w-14 h-14 text-indigo-500" strokeWidth={1.75} />
                      )}
                      <span className="text-sm font-semibold text-slate-800 dark:text-foreground text-center leading-tight" data-testid="text-tile-new-schedule">New Schedule</span>
                    </div>
                  </Card>

                  <Card
                    className="group cursor-pointer rounded-2xl bg-white dark:bg-card border border-slate-200/60 dark:border-border shadow-sm transition-transform duration-100 active:scale-95 hover:scale-[1.03]"
                    onClick={() => setLocation("/documents")}
                    data-testid="tile-documents"
                  >
                    <div className="aspect-square flex flex-col items-center justify-center gap-3 p-5">
                      <FileText className="w-14 h-14 text-indigo-500" strokeWidth={1.75} />
                      <span className="text-sm font-semibold text-slate-800 dark:text-foreground text-center leading-tight" data-testid="text-tile-documents">Ancillary Documents</span>
                    </div>
                  </Card>

                  <Link href="/document-upload">
                    <Card
                      className="group cursor-pointer rounded-2xl bg-white dark:bg-card border border-slate-200/60 dark:border-border shadow-sm transition-transform duration-100 active:scale-95 hover:scale-[1.03]"
                      data-testid="tile-document-upload"
                    >
                      <div className="aspect-square flex flex-col items-center justify-center gap-3 p-5">
                        <Upload className="w-14 h-14 text-indigo-500" strokeWidth={1.75} />
                        <span className="text-sm font-semibold text-slate-800 dark:text-foreground text-center leading-tight" data-testid="text-tile-document-upload">Document Upload</span>
                      </div>
                    </Card>
                  </Link>

                  <Link href="/billing">
                    <Card
                      className="group cursor-pointer rounded-2xl bg-white dark:bg-card border border-slate-200/60 dark:border-border shadow-sm transition-transform duration-100 active:scale-95 hover:scale-[1.03]"
                      data-testid="tile-billing"
                    >
                      <div className="aspect-square flex flex-col items-center justify-center gap-3 p-5">
                        <DollarSign className="w-14 h-14 text-indigo-500" strokeWidth={1.75} />
                        <span className="text-sm font-semibold text-slate-800 dark:text-foreground text-center leading-tight" data-testid="text-tile-billing">Billing</span>
                      </div>
                    </Card>
                  </Link>

                  <Card
                    className="group cursor-pointer rounded-2xl bg-white dark:bg-card border border-slate-200/60 dark:border-border shadow-sm transition-transform duration-100 active:scale-95 hover:scale-[1.03]"
                    onClick={openReferencesTab}
                    data-testid="tile-patient-directory"
                  >
                    <div className="aspect-square flex flex-col items-center justify-center gap-3 p-5">
                      <Users className="w-14 h-14 text-indigo-500" strokeWidth={1.75} />
                      <span className="text-sm font-semibold text-slate-800 dark:text-foreground text-center leading-tight" data-testid="text-tile-patient-directory">Patient Directory</span>
                    </div>
                  </Card>

                </div>

                <Link href="/appointments">
                  <Card
                    className="group cursor-pointer rounded-2xl bg-white dark:bg-card border border-slate-200/60 dark:border-border shadow-sm transition-shadow hover:shadow-md mt-4"
                    data-testid="tile-appointments"
                  >
                    <div className="p-5">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                            <Calendar className="w-5 h-5 text-primary" strokeWidth={1.75} />
                          </div>
                          <div>
                            <span className="text-base font-bold text-slate-800 dark:text-foreground" data-testid="text-tile-appointments">Schedule</span>
                            <p className="text-xs text-slate-500">Ancillary appointment schedule</p>
                          </div>
                        </div>
                        <span className="text-xs text-primary font-medium group-hover:underline shrink-0">View Full Schedule →</span>
                      </div>
                      <ScheduleTile />
                    </div>
                  </Card>
                </Link>

                {batches.length > 0 && (
                  <div className="mt-10">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSidebarOpen(true)}
                      className="gap-2 text-sm"
                      data-testid="button-view-history"
                    >
                      <Clock className="w-4 h-4" />
                      Schedule History ({batches.length})
                    </Button>
                  </div>
                )}

                <QualificationModeSettings />

                <PlexusDrive />
              </div>
            </main>
          </div>
        )}
      </div>

      <Dialog open={newScheduleDialogOpen} onOpenChange={(v) => { if (!v) setNewScheduleDialogOpen(false); }}>
        <DialogContent className="max-w-sm" data-testid="dialog-new-schedule">
          <DialogHeader>
            <DialogTitle>New Schedule</DialogTitle>
          </DialogHeader>
          <div className="flex justify-center py-2">
            <CalendarPicker
              mode="single"
              selected={newScheduleDate}
              onSelect={setNewScheduleDate}
              initialFocus
              data-testid="calendar-new-schedule"
            />
          </div>
          <div className="px-1 pb-2">
            <label className="text-sm font-medium text-muted-foreground mb-1 block">Facility</label>
            <Select value={newScheduleFacility} onValueChange={setNewScheduleFacility}>
              <SelectTrigger data-testid="select-facility">
                <SelectValue placeholder="Select a facility..." />
              </SelectTrigger>
              <SelectContent>
                {FACILITIES.map((f) => (
                  <SelectItem key={f} value={f}>{f}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewScheduleDialogOpen(false)} data-testid="button-cancel-new-schedule">
              Cancel
            </Button>
            <Button
              onClick={handleNewScheduleConfirm}
              disabled={createBatchMutation.isPending || !newScheduleFacility}
              data-testid="button-create-new-schedule"
            >
              {createBatchMutation.isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {scheduleModalPatient && (
        <PatientScheduleModal
          patient={scheduleModalPatient}
          onClose={() => setScheduleModalPatient(null)}
        />
      )}
    </>
  );
}

function PatientScheduleModal({ patient, onClose }: { patient: PatientScreening; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const today = new Date();
  const [calYear, setCalYear] = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth());
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [selectedTestType, setSelectedTestType] = useState<string>(() => {
    const qt = patient.qualifyingTests || [];
    if (qt.includes("BrainWave")) return "BrainWave";
    if (qt.includes("VitalWave")) return "VitalWave";
    return "BrainWave";
  });

  const facility = (patient.facility as string) || "Taylor Family Practice";

  const { data: appointments = [] } = useQuery<AncillaryAppointment[]>({
    queryKey: ["/api/appointments", facility],
    queryFn: async () => {
      const apiKey = import.meta.env.VITE_API_KEY as string | undefined;
      const headers: Record<string, string> = {};
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
      const res = await fetch(`/api/appointments?facility=${encodeURIComponent(facility)}`, { headers });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: patientAppts = [] } = useQuery<AncillaryAppointment[]>({
    queryKey: ["/api/appointments/patient", patient.id],
    queryFn: async () => {
      const apiKey = import.meta.env.VITE_API_KEY as string | undefined;
      const headers: Record<string, string> = {};
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
      const res = await fetch(`/api/appointments/patient/${patient.id}`, { headers });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const bookMutation = useMutation({
    mutationFn: async ({ scheduledTime }: { scheduledTime: string }) => {
      const scheduledDate = `${calYear}-${String(calMonth + 1).padStart(2, "0")}-${String(selectedDay!).padStart(2, "0")}`;
      const res = await apiRequest("POST", "/api/appointments", {
        patientScreeningId: patient.id,
        patientName: patient.name,
        facility,
        scheduledDate,
        scheduledTime,
        testType: selectedTestType,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to book");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/appointments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/appointments/upcoming"] });
      queryClient.invalidateQueries({ queryKey: ["/api/appointments/patient", patient.id] });
      toast({ title: "Appointment booked!", description: `${patient.name} scheduled for ${selectedTestType}` });
      onClose();
    },
    onError: (e: Error) => {
      toast({ title: "Booking failed", description: e.message, variant: "destructive" });
    },
  });

  const isVW = selectedTestType === "VitalWave";
  const slots = isVW
    ? (() => { const s: string[] = []; for (let h = 8; h <= 16; h++) { s.push(`${String(h).padStart(2, "0")}:00`); if (h < 16) s.push(`${String(h).padStart(2, "0")}:30`); } s.push("16:30"); return s; })()
    : (() => { const s: string[] = []; for (let h = 8; h <= 16; h++) { s.push(`${String(h).padStart(2, "0")}:00`); } return s; })();

  const selectedDateStr = selectedDay
    ? `${calYear}-${String(calMonth + 1).padStart(2, "0")}-${String(selectedDay).padStart(2, "0")}`
    : null;

  const bookedSlots = new Set(
    appointments
      .filter((a) => {
        if (a.scheduledDate !== selectedDateStr || a.status !== "scheduled") return false;
        const aIsVW = a.testType === "VitalWave";
        return aIsVW === isVW;
      })
      .map((a) => a.scheduledTime)
  );

  const bookedDates = new Set<string>(
    appointments.filter((a) => a.status === "scheduled").map((a) => a.scheduledDate)
  );

  function fmt12(time24: string) {
    const [h, m] = time24.split(":").map(Number);
    return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
  }

  const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];

  const firstDow = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const scheduledForThisPatient = patientAppts.filter((a) => a.status === "scheduled");

  const availTests = patient.qualifyingTests && (patient.qualifyingTests as string[]).length > 0
    ? (patient.qualifyingTests as string[])
    : ALL_AVAILABLE_TESTS;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            <Calendar className="w-4 h-4 text-primary" />
            Schedule Appointment — {patient.name}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {scheduledForThisPatient.length > 0 && (
            <div className="bg-primary/5 rounded-lg px-3 py-2 border border-primary/20">
              <p className="text-xs font-semibold text-primary mb-1.5">Existing appointments</p>
              <div className="space-y-1">
                {scheduledForThisPatient.map((a) => (
                  <div key={a.id} className="text-xs text-slate-600 flex items-center gap-2">
                    <Badge variant="secondary" className="text-[9px]">{a.testType}</Badge>
                    <span>{new Date(a.scheduledDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                    <span>{fmt12(a.scheduledTime)}</span>
                    <span className="text-slate-400">{a.facility}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-slate-700 mb-1 block">Test Type</label>
              <Select value={selectedTestType} onValueChange={setSelectedTestType}>
                <SelectTrigger className="text-sm" data-testid="select-modal-test-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {availTests.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-700 mb-1 block">Facility</label>
              <div className="text-sm text-slate-600 px-3 py-2 bg-slate-50 rounded-md border border-slate-200">{facility}</div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex items-center justify-between mb-3">
                <Button variant="ghost" size="sm" onClick={() => {
                  if (calMonth === 0) { setCalMonth(11); setCalYear((y) => y - 1); }
                  else setCalMonth((m) => m - 1);
                }} className="h-7 w-7 p-0" data-testid="modal-cal-prev">
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="text-sm font-semibold text-slate-800">{monthNames[calMonth]} {calYear}</span>
                <Button variant="ghost" size="sm" onClick={() => {
                  if (calMonth === 11) { setCalMonth(0); setCalYear((y) => y + 1); }
                  else setCalMonth((m) => m + 1);
                }} className="h-7 w-7 p-0" data-testid="modal-cal-next">
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
              <div className="grid grid-cols-7 gap-0.5 mb-1">
                {["Su","Mo","Tu","We","Th","Fr","Sa"].map((d) => (
                  <div key={d} className="text-center text-[10px] font-medium text-slate-400 py-1">{d}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-0.5">
                {cells.map((d, i) => {
                  if (!d) return <div key={i} />;
                  const key = `${calYear}-${String(calMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
                  const isToday = key === todayKey;
                  const isSel = d === selectedDay;
                  const hasBooking = bookedDates.has(key);
                  return (
                    <button
                      key={i}
                      onClick={() => setSelectedDay(d)}
                      data-testid={`modal-cal-day-${d}`}
                      className={`relative flex flex-col items-center justify-center h-8 w-full rounded text-xs font-medium transition-colors
                        ${isSel ? "bg-primary text-white" : isToday ? "bg-primary/10 text-primary font-bold" : "hover:bg-slate-100 text-slate-700"}`}
                    >
                      {d}
                      {hasBooking && (
                        <span className={`absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full ${isSel ? "bg-white" : "bg-primary"}`} />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              {!selectedDay ? (
                <div className="flex flex-col items-center justify-center h-full text-slate-400 text-sm">
                  <Calendar className="w-8 h-8 mb-2 opacity-30" />
                  Select a day
                </div>
              ) : (
                <div>
                  <p className="text-xs font-medium text-slate-700 mb-2">
                    {new Date(calYear, calMonth, selectedDay).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} — {selectedTestType} slots
                  </p>
                  <div className="space-y-1 max-h-[280px] overflow-y-auto pr-1">
                    {slots.map((slot) => {
                      const isBooked = bookedSlots.has(slot);
                      return (
                        <button
                          key={slot}
                          disabled={isBooked || bookMutation.isPending}
                          onClick={() => !isBooked && bookMutation.mutate({ scheduledTime: slot })}
                          data-testid={`modal-slot-${slot}`}
                          className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs border transition-colors
                            ${isBooked
                              ? "bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed"
                              : "bg-white border-slate-200 hover:border-primary hover:bg-primary/5 cursor-pointer text-slate-700"}`}
                        >
                          <span className="font-medium">{fmt12(slot)}</span>
                          <span className={isBooked ? "text-slate-400" : "text-slate-400 text-[10px]"}>
                            {isBooked ? "Booked" : "Available"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PatientCard({
  patient,
  isAnalyzing,
  onUpdate,
  onDelete,
  onAnalyze,
  onOpenScheduleModal,
}: {
  patient: PatientScreening;
  isAnalyzing: boolean;
  onUpdate: (field: string, value: string | string[] | boolean) => void;
  onDelete: () => void;
  onAnalyze: () => void;
  onOpenScheduleModal: (patient: PatientScreening) => void;
}) {
  const isCompleted = patient.status === "completed";
  const serverTests = patient.qualifyingTests || [];
  const [localTests, setLocalTests] = useState<string[]>(serverTests);
  const [generatingTests, setGeneratingTests] = useState<Set<string>>(new Set());
  const cardQueryClient = useQueryClient();
  const { toast: cardToast } = useToast();

  const { data: patientAppts = [] } = useQuery<AncillaryAppointment[]>({
    queryKey: ["/api/appointments/patient", patient.id],
    enabled: !!patient.id,
  });
  const scheduledAppt = patientAppts.find((a: AncillaryAppointment) => a.status === "scheduled");

  useEffect(() => { setLocalTests(patient.qualifyingTests || []); }, [patient.qualifyingTests]);

  const handleAddTest = useCallback((test: string) => {
    if (localTests.includes(test)) return;
    const updated = [...localTests, test];
    setLocalTests(updated);
    onUpdate("qualifyingTests", updated);
    setGeneratingTests(prev => new Set([...prev, test]));
    apiRequest("POST", `/api/patients/${patient.id}/analyze-test`, { testName: test })
      .then(r => r.json())
      .then((data: PatientScreening) => {
        if (data) {
          cardQueryClient.setQueryData<ScreeningBatchWithPatients>(
            ["/api/screening-batches", patient.batchId],
            (old) => {
              if (!old) return old;
              return {
                ...old,
                patients: (old.patients || []).map((p) =>
                  p.id === patient.id ? { ...p, ...data } : p
                ),
              };
            }
          );
        }
      })
      .catch(() => {
        cardToast({ title: "Could not generate reasoning", description: `Qualification notes for ${test} were not generated. You can still proceed.`, variant: "destructive" });
      })
      .finally(() => {
        setGeneratingTests(prev => {
          const next = new Set(prev);
          next.delete(test);
          return next;
        });
      });
  }, [localTests, onUpdate, patient.id, patient.batchId, cardQueryClient, cardToast]);

  const handleRemoveTest = useCallback((test: string) => {
    const updated = localTests.filter((t) => t !== test);
    setLocalTests(updated);
    onUpdate("qualifyingTests", updated);
  }, [localTests, onUpdate]);

  const tests = localTests;

  const [localName, setLocalName] = useState(patient.name || "");
  const [localTime, setLocalTime] = useState(patient.time || "");
  const [localDob, setLocalDob] = useState(patient.dob || "");
  const [localPhone, setLocalPhone] = useState(patient.phoneNumber || "");
  const [localInsurance, setLocalInsurance] = useState(patient.insurance || "");
  const [localDx, setLocalDx] = useState(patient.diagnoses || "");
  const [localHx, setLocalHx] = useState(patient.history || "");
  const [localRx, setLocalRx] = useState(patient.medications || "");
  const [localPrevTests, setLocalPrevTests] = useState(patient.previousTests || "");
  const [localPrevTestsDate, setLocalPrevTestsDate] = useState(patient.previousTestsDate || "");
  const [localNoPrevTests, setLocalNoPrevTests] = useState(patient.noPreviousTests || false);
  const [pasteText, setPasteText] = useState("");
  const [isParsing, setIsParsing] = useState(false);

  useEffect(() => { setLocalName(patient.name || ""); }, [patient.name]);
  useEffect(() => { setLocalTime(patient.time || ""); }, [patient.time]);
  useEffect(() => { setLocalDob(patient.dob || ""); }, [patient.dob]);
  useEffect(() => { setLocalPhone(patient.phoneNumber || ""); }, [patient.phoneNumber]);
  useEffect(() => { setLocalInsurance(patient.insurance || ""); }, [patient.insurance]);
  useEffect(() => { setLocalDx(patient.diagnoses || ""); }, [patient.diagnoses]);
  useEffect(() => { setLocalHx(patient.history || ""); }, [patient.history]);
  useEffect(() => { setLocalRx(patient.medications || ""); }, [patient.medications]);
  useEffect(() => { setLocalPrevTests(patient.previousTests || ""); }, [patient.previousTests]);
  useEffect(() => { setLocalPrevTestsDate(patient.previousTestsDate || ""); }, [patient.previousTestsDate]);
  useEffect(() => { setLocalNoPrevTests(patient.noPreviousTests || false); }, [patient.noPreviousTests]);

  return (
    <Card className={`overflow-visible ${isCompleted ? "ring-1 ring-emerald-200 dark:ring-emerald-800" : ""}`} data-testid={`card-patient-${patient.id}`}>
      <div className="px-4 py-3 flex items-center justify-between gap-2 border-b flex-wrap">
        <div className="flex items-center gap-3">
          <div className="flex flex-col gap-1">
            <Input
              placeholder="Patient name"
              value={localName}
              onChange={(e) => setLocalName(e.target.value)}
              onBlur={() => { if (localName !== (patient.name || "")) onUpdate("name", localName); }}
              className="h-8 text-base font-semibold px-2"
              data-testid={`input-patient-name-${patient.id}`}
            />
            <div className="flex items-center gap-1.5">
              <Input
                placeholder="Time"
                value={localTime}
                onChange={(e) => setLocalTime(e.target.value)}
                onBlur={() => { if (localTime !== (patient.time || "")) onUpdate("time", localTime); }}
                className="h-6 text-xs px-2"
                data-testid={`input-patient-time-${patient.id}`}
              />
              <Input
                placeholder="DOB"
                value={localDob}
                onChange={(e) => setLocalDob(e.target.value)}
                onBlur={() => { if (localDob !== (patient.dob || "")) onUpdate("dob", localDob); }}
                className="h-6 text-xs px-2"
                data-testid={`input-patient-dob-${patient.id}`}
              />
              <Input
                placeholder="Phone"
                value={localPhone}
                onChange={(e) => setLocalPhone(e.target.value)}
                onBlur={() => { if (localPhone !== (patient.phoneNumber || "")) onUpdate("phoneNumber", localPhone); }}
                className="h-6 text-xs px-2"
                data-testid={`input-patient-phone-${patient.id}`}
              />
            </div>
            <div className="flex items-center gap-1.5">
              <Input
                placeholder="Insurance"
                value={localInsurance}
                onChange={(e) => setLocalInsurance(e.target.value)}
                onBlur={() => { if (localInsurance !== (patient.insurance || "")) onUpdate("insurance", localInsurance); }}
                className="h-6 text-xs px-2"
                data-testid={`input-patient-insurance-${patient.id}`}
              />
            </div>
          </div>
          {isCompleted && (
            <Badge variant="outline" className="text-xs gap-1 no-default-hover-elevate no-default-active-elevate">
              <Check className="w-3 h-3 text-emerald-500" /> Analyzed
            </Badge>
          )}
        </div>
        <div className="flex flex-col gap-2 items-end min-w-[220px]">
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={onAnalyze}
              disabled={isAnalyzing}
              className="gap-1.5"
              data-testid={`button-generate-${patient.id}`}
            >
              {isAnalyzing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {isCompleted ? "Re-Generate" : "Generate"}
            </Button>
            {scheduledAppt && (
              <span
                className="inline-flex items-center gap-1 text-[10px] font-medium text-primary bg-primary/10 border border-primary/20 rounded-full px-2 py-0.5"
                data-testid={`badge-scheduled-${patient.id}`}
              >
                <Calendar className="w-2.5 h-2.5" />
                Scheduled {scheduledAppt.scheduledDate}
              </span>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onOpenScheduleModal(patient)}
              title="Schedule appointment"
              className="text-muted-foreground hover:text-primary"
              data-testid={`button-schedule-${patient.id}`}
            >
              <Calendar className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => { if (confirm("Remove this patient?")) onDelete(); }}
              title="Remove patient"
              className="text-muted-foreground hover:text-destructive"
              data-testid={`button-delete-patient-${patient.id}`}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
          <div className="w-full space-y-1.5">
            <Textarea
              placeholder="Paste patient info here — name, DOB, insurance, meds, previous tests…"
              className="min-h-[64px] resize-none text-xs w-full"
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              data-testid={`input-paste-info-${patient.id}`}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={!pasteText.trim() || isParsing}
              className="gap-1.5 w-full"
              onClick={async () => {
                if (!pasteText.trim()) return;
                setIsParsing(true);
                try {
                  const res = await apiRequest("POST", "/api/parse-patient-paste", { text: pasteText });
                  const data: { fields?: Record<string, string>; error?: string } = await res.json();
                  if (data.error) throw new Error(data.error);
                  const f = data.fields || {};
                  const updates: Array<[string, string]> = [];
                  if (f.name && f.name !== (patient.name || "")) { setLocalName(f.name); updates.push(["name", f.name]); }
                  if (f.dob && f.dob !== (patient.dob || "")) { setLocalDob(f.dob); updates.push(["dob", f.dob]); }
                  if (f.phone && f.phone !== (patient.phoneNumber || "")) { setLocalPhone(f.phone); updates.push(["phoneNumber", f.phone]); }
                  if (f.insurance && f.insurance !== (patient.insurance || "")) { setLocalInsurance(f.insurance); updates.push(["insurance", f.insurance]); }
                  if (f.diagnoses && f.diagnoses !== (patient.diagnoses || "")) { setLocalDx(f.diagnoses); updates.push(["diagnoses", f.diagnoses]); }
                  if (f.history && f.history !== (patient.history || "")) { setLocalHx(f.history); updates.push(["history", f.history]); }
                  if (f.medications && f.medications !== (patient.medications || "")) { setLocalRx(f.medications); updates.push(["medications", f.medications]); }
                  if (f.previousTests && f.previousTests !== (patient.previousTests || "")) {
                    setLocalPrevTests(f.previousTests);
                    updates.push(["previousTests", f.previousTests]);
                    if (localNoPrevTests) {
                      setLocalNoPrevTests(false);
                      onUpdate("noPreviousTests", false);
                    }
                  }
                  if (f.previousTestsDate && f.previousTestsDate !== (patient.previousTestsDate || "")) { setLocalPrevTestsDate(f.previousTestsDate); updates.push(["previousTestsDate", f.previousTestsDate]); }
                  updates.forEach(([field, value]) => onUpdate(field, value));
                  if (updates.length > 0) setPasteText("");
                } catch (err: any) {
                  cardToast({ title: "Parse failed", description: err.message || "Could not parse patient info.", variant: "destructive" });
                } finally {
                  setIsParsing(false);
                }
              }}
              data-testid={`button-parse-paste-${patient.id}`}
            >
              {isParsing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {isParsing ? "Parsing…" : "Parse & Fill"}
            </Button>
          </div>
        </div>
      </div>

      <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        <div>
          <label className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5 mb-1.5">
            <Stethoscope className="w-3.5 h-3.5" /> Dx (Diagnoses)
          </label>
          <Textarea
            placeholder="HTN, DM2, HLD..."
            className="min-h-[70px] resize-none text-sm"
            value={localDx}
            onChange={(e) => setLocalDx(e.target.value)}
            onBlur={() => { if (localDx !== (patient.diagnoses || "")) onUpdate("diagnoses", localDx); }}
            data-testid={`input-dx-${patient.id}`}
          />
        </div>
        <div>
          <label className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5 mb-1.5">
            <FileText className="w-3.5 h-3.5" /> Hx (History / PMH)
          </label>
          <Textarea
            placeholder="MI 2019, CABG, TIA..."
            className="min-h-[70px] resize-none text-sm"
            value={localHx}
            onChange={(e) => setLocalHx(e.target.value)}
            onBlur={() => { if (localHx !== (patient.history || "")) onUpdate("history", localHx); }}
            data-testid={`input-hx-${patient.id}`}
          />
        </div>
        <div>
          <label className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5 mb-1.5">
            <Pill className="w-3.5 h-3.5" /> Rx (Medications)
          </label>
          <Textarea
            placeholder="Metformin, Lisinopril..."
            className="min-h-[70px] resize-none text-sm"
            value={localRx}
            onChange={(e) => setLocalRx(e.target.value)}
            onBlur={() => { if (localRx !== (patient.medications || "")) onUpdate("medications", localRx); }}
            data-testid={`input-rx-${patient.id}`}
          />
        </div>
        <div className="col-span-1 md:col-span-2 lg:col-span-4">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <label className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5">
              <ClipboardList className="w-3.5 h-3.5" />
              Previous Tests
              {!localNoPrevTests && <span className="text-red-500 font-bold ml-0.5">*</span>}
            </label>
            <label className="flex items-center gap-1.5 ml-auto cursor-pointer select-none" data-testid={`label-no-prev-tests-${patient.id}`}>
              <input
                type="checkbox"
                checked={localNoPrevTests}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setLocalNoPrevTests(checked);
                  if (checked) {
                    setLocalPrevTests("");
                    setLocalPrevTestsDate("");
                    onUpdate("noPreviousTests", true);
                    onUpdate("previousTests", "");
                    onUpdate("previousTestsDate", "");
                  } else {
                    onUpdate("noPreviousTests", false);
                  }
                }}
                className="w-3.5 h-3.5 accent-primary"
                data-testid={`checkbox-no-prev-tests-${patient.id}`}
              />
              <span className="text-xs text-muted-foreground">No previous tests</span>
            </label>
          </div>
          <div className={`flex gap-2 ${localNoPrevTests ? "opacity-40 pointer-events-none" : ""}`}>
            <Textarea
              placeholder="Echo TTE 01/2024, Carotid Duplex 06/2023..."
              className={`min-h-[60px] resize-none text-sm flex-1 ${!localNoPrevTests && !localPrevTests ? "border-red-300 focus-visible:ring-red-300" : ""}`}
              value={localPrevTests}
              disabled={localNoPrevTests}
              onChange={(e) => setLocalPrevTests(e.target.value)}
              onBlur={() => {
                if (localPrevTests !== (patient.previousTests || "")) {
                  onUpdate("previousTests", localPrevTests);
                  const extracted = extractMostRecentDate(localPrevTests);
                  if (extracted) {
                    const yr = extracted.getFullYear();
                    const mo = String(extracted.getMonth() + 1).padStart(2, "0");
                    const dy = String(extracted.getDate()).padStart(2, "0");
                    const dateStr = `${yr}-${mo}-${dy}`;
                    if (dateStr !== localPrevTestsDate) {
                      setLocalPrevTestsDate(dateStr);
                      onUpdate("previousTestsDate", dateStr);
                    }
                  }
                }
              }}
              data-testid={`input-prev-tests-${patient.id}`}
            />
            <div className="flex flex-col gap-1 w-32 shrink-0">
              <label className="text-xs text-muted-foreground font-medium">Most Recent Date</label>
              <Input
                placeholder="YYYY-MM-DD"
                value={localPrevTestsDate}
                disabled={localNoPrevTests}
                onChange={(e) => setLocalPrevTestsDate(e.target.value)}
                onBlur={() => { if (localPrevTestsDate !== (patient.previousTestsDate || "")) onUpdate("previousTestsDate", localPrevTestsDate); }}
                className="h-8 text-xs px-2"
                data-testid={`input-prev-tests-date-${patient.id}`}
              />
            </div>
          </div>
          {!localNoPrevTests && !localPrevTests && (
            <p className="text-xs text-red-500 mt-1" data-testid={`text-prev-tests-required-${patient.id}`}>Required — enter previous tests or check "No previous tests"</p>
          )}
        </div>
      </div>

      <div className="px-4 pb-3">
        <div className="flex items-center gap-1.5 flex-wrap">
          {tests.length > 0 && (
            <>
              <span className="text-xs text-muted-foreground mr-1">Qualifying:</span>
              {tests.map((test) => {
                const cat = getAncillaryCategory(test);
                const isGenerating = generatingTests.has(test);
                return (
                  <span key={test} className={`inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md text-[10px] font-medium ${getBadgeColor(cat)}`}>
                    {isGenerating && <Loader2 className="w-2.5 h-2.5 animate-spin shrink-0" />}
                    {test}
                    <button
                      className="rounded hover:bg-black/10 transition-colors p-0.5 -mr-0.5 shrink-0"
                      title={`Remove ${test}`}
                      onClick={() => handleRemoveTest(test)}
                      data-testid={`button-remove-test-${patient.id}-${test.replace(/\s+/g, "-")}`}
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </span>
                );
              })}
            </>
          )}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-6 px-2 text-[10px] gap-1"
                data-testid={`button-add-test-${patient.id}`}
              >
                <Plus className="w-3 h-3" />
                Add Test
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-2" align="start" data-testid={`popover-test-picker-${patient.id}`}>
              <p className="text-xs font-semibold text-muted-foreground mb-2 px-1">Select tests to add</p>
              <div className="space-y-1">
                {ALL_AVAILABLE_TESTS.map((test) => {
                  const isSelected = tests.includes(test);
                  const cat = getAncillaryCategory(test);
                  return (
                    <button
                      key={test}
                      disabled={isSelected}
                      onClick={() => handleAddTest(test)}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left transition-colors ${
                        isSelected
                          ? "opacity-50 cursor-not-allowed"
                          : "hover:bg-accent cursor-pointer"
                      }`}
                      data-testid={`option-test-${patient.id}-${test.replace(/\s+/g, "-")}`}
                    >
                      <span className={`w-3.5 h-3.5 flex items-center justify-center shrink-0 rounded border ${isSelected ? "bg-primary border-primary" : "border-muted-foreground/40"}`}>
                        {isSelected && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                      </span>
                      <span className={`flex-1 ${isSelected ? "line-through" : ""}`}>{test}</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-sm font-medium ${getBadgeColor(cat)}`}>
                        {cat === "brainwave" ? "BW" : cat === "vitalwave" ? "VW" : "US"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </Card>
  );
}

function isImagingTest(test: string): boolean {
  const cat = getAncillaryCategory(test);
  return cat === "ultrasound";
}

// ─── PDF helpers ──────────────────────────────────────────────────────────────

function esc(s: string | null | undefined): string {
  if (!s) return "";
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

type TestDescSimple = { kind: "simple"; text: string };
type TestDescBullets = { kind: "bullets"; intro: string; bullets: { label: string; text: string }[] };
type TestDesc = TestDescSimple | TestDescBullets;

const TEST_DESCRIPTIONS: Record<string, TestDesc> = {
  "BrainWave": {
    kind: "bullets",
    intro: "A suite of non-invasive tests that examine how the brain and nervous system are functioning. Based on what the doctor ordered, it may include any combination of the following:",
    bullets: [
      { label: "Memory and thinking evaluation", text: "A structured series of questions and tasks that measures memory, attention span, processing speed, and problem-solving ability — designed to catch early signs of cognitive decline, dementia, or brain disease before symptoms become obvious." },
      { label: "Brain wave recording", text: "Small sensors placed gently on the scalp pick up the brain's electrical signals to screen for seizure activity, abnormal brain patterns, and sleep-related disorders." },
      { label: "Visual nerve response test", text: "Measures how quickly the brain responds to a visual signal to check for damage along the nerve pathway running from the eyes to the brain." },
      { label: "Auditory and sound processing test", text: "Tests how well the brain receives and interprets sound — can detect nerve-related hearing issues or processing problems that a standard hearing test would miss." },
    ],
  },
  "VitalWave": {
    kind: "bullets",
    intro: "A suite of non-invasive tests that assess how well the heart, blood vessels, and the nervous system controlling them are working together. It may include any combination of the following:",
    bullets: [
      { label: "Limb blood pressure mapping", text: "Blood pressure cuffs are placed at several points along the arms and legs to create a detailed map of blood flow and pinpoint exactly where arteries may be narrowed or blocked." },
      { label: "Nervous system response test", text: "The patient lies flat and is slowly tilted upright while the machine tracks heart rate and blood pressure in real time — checks whether the nervous system properly adjusts to position changes, which explains dizziness, fainting, or unexplained falls." },
      { label: "Heart rhythm recording", text: "A short electrical recording of the heart that checks for irregular rhythms, skipped beats, or other electrical problems that may not show up on a routine exam." },
    ],
  },
  "Bilateral Carotid Duplex": { kind: "simple", text: "An ultrasound of the arteries on both sides of the neck. It uses sound waves — no radiation, no needles — to look for plaque buildup or narrowing that could cut off blood flow to the brain and cause a stroke." },
  "Echocardiogram TTE": { kind: "simple", text: "An ultrasound of the heart taken through the chest wall. It shows the heart pumping in real time so the doctor can see how strong it is, whether the valves open and close properly, and whether there are any structural problems." },
  "Renal Artery Doppler": { kind: "simple", text: "An ultrasound of the arteries that carry blood to the kidneys. Blockages here can silently damage the kidneys over time or make blood pressure nearly impossible to control with medication — this test finds those blockages early." },
  "Lower Extremity Arterial Doppler": { kind: "simple", text: "An ultrasound of the arteries in both legs. It checks how well blood is flowing from the hips down to the feet, and identifies blockages that cause leg pain with walking, wounds that won't heal, or risk of limb loss." },
  "Upper Extremity Arterial Doppler": { kind: "simple", text: "An ultrasound of the arteries in both arms. It looks for blockages or narrowing that cause arm pain, numbness, or a significant difference in blood pressure between the two arms — which can signal a serious artery disease." },
  "Abdominal Aortic Aneurysm Duplex": { kind: "simple", text: "An ultrasound of the large main artery running through the abdomen. It measures the width of the aorta to check for dangerous ballooning — an aneurysm that goes undetected can rupture without warning and become life-threatening." },
  "Stress Echocardiogram": { kind: "simple", text: "A heart ultrasound done before and right after exercise (or a medication that safely mimics exercise). Comparing the two images reveals blockages in the heart's arteries that only appear under physical stress and would look completely normal at rest." },
  "Lower Extremity Venous Duplex": { kind: "simple", text: "An ultrasound of the veins in both legs. It checks for blood clots hiding deep in the leg — clots that can travel to the lungs — and also looks for damaged vein valves that cause chronic swelling and heaviness." },
  "Upper Extremity Venous Duplex": { kind: "simple", text: "An ultrasound of the veins in both arms. It checks for blood clots or poorly functioning vein valves in the arms — especially important for patients with a history of IV lines, pacemakers, or unexplained arm swelling." },
};

function normalizeTestName(test: string): string {
  return test.replace(/\s*\(\d{4,5}\)\s*$/, "").trim();
}

function getOneSentenceDesc(test: string): string {
  const desc = TEST_DESCRIPTIONS[test] ?? TEST_DESCRIPTIONS[normalizeTestName(test)];
  if (!desc) return "A non-invasive diagnostic test recommended based on the patient's history and risk factors.";
  const full = desc.kind === "simple" ? desc.text : desc.intro;
  const m = full.match(/^[^.!?]*[.!?]/);
  return m ? m[0].trim() : full;
}

function getTestDescHTML(test: string): string {
  const desc = TEST_DESCRIPTIONS[test] ?? TEST_DESCRIPTIONS[normalizeTestName(test)];
  if (!desc) return `<p style="font-size:12px;line-height:1.65;color:#475569;font-style:italic;">This test checks for conditions related to the patient's clinical history and risk factors.</p>`;
  if (desc.kind === "simple") {
    return `<p style="font-size:12px;line-height:1.65;color:#1e293b;margin:0;">${esc(desc.text)}</p>`;
  }
  const bullets = desc.bullets.map(b => `
    <li style="margin-bottom:6px;">
      <span style="font-weight:700;color:#1e293b;">${esc(b.label)}:</span>
      <span style="color:#334155;"> ${esc(b.text)}</span>
    </li>`).join("");
  return `
    <p style="font-size:12px;line-height:1.65;color:#1e293b;margin:0 0 8px;">${esc(desc.intro)}</p>
    <ul style="margin:0;padding-left:18px;font-size:12px;line-height:1.65;color:#334155;">${bullets}</ul>`;
}

const PDF_BASE_STYLES = `
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 0; color: #1e293b; }
  @page { size: letter portrait; margin: 0.5in; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .page { page-break-after: always; break-after: page; }
    .page:last-child { page-break-after: avoid; break-after: avoid; }
  }
  .cover { min-height:9.5in; display:flex; flex-direction:column; align-items:center; justify-content:center; background:#1a365d; color:white; text-align:center; padding:40px; }
  .cover h1 { font-size:30px; font-weight:800; margin:0 0 8px; }
  .cover h2 { font-size:17px; font-weight:400; margin:0 0 20px; opacity:0.8; }
  .cover .meta { font-size:13px; opacity:0.6; }
  .page { padding:0; min-height:0; }
  .patient-header { border-bottom:2px solid #1a365d; padding-bottom:14px; margin-bottom:18px; }
  .patient-name { font-size:20px; font-weight:800; color:#1a365d; margin:0 0 4px; }
  .patient-meta { font-size:12px; color:#64748b; }
  .clinical-box { background:#f1f5f9; border-radius:8px; padding:14px; margin-bottom:16px; }
  .clinical-label { font-size:10px; font-weight:700; color:#94a3b8; text-transform:uppercase; letter-spacing:0.06em; margin-bottom:8px; }
  .clinical-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; }
  .clinical-field-label { font-size:10px; font-weight:700; color:#475569; margin-bottom:3px; }
  .clinical-field-val { font-size:11px; color:#1e293b; line-height:1.55; }
  .section-heading { font-size:11px; font-weight:700; color:#1e293b; margin:0 0 10px; text-transform:uppercase; letter-spacing:0.05em; }
  .cooldown-box { background:#fffbeb; border:1px solid #fcd34d; border-radius:8px; padding:12px; margin-bottom:14px; }
`;

function buildPrintWindow(title: string, bodyHtml: string, options?: { injectScript?: string }): void {
  const win = window.open("", "_blank");
  if (!win) { alert("Please allow pop-ups to generate PDFs."); return; }
  const scriptTag = options?.injectScript ? `<script>${options.injectScript}<\/script>` : "";
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${PDF_BASE_STYLES}</style></head><body>${bodyHtml}${scriptTag}</body></html>`);
  win.document.close();
  win.focus();
  if (!options?.injectScript) {
    setTimeout(() => win.print(), 600);
  }
}

function buildPatientTop(p: PatientScreening, batchName: string, date: string, reportLabel: string): string {
  const demoLine = [p.time, p.age ? `${p.age}yo` : "", p.gender, p.insurance].filter(Boolean).map(esc).join(" · ");
  const clinicalBlock = (p.diagnoses || p.history || p.medications) ? `
    <div class="clinical-box">
      <div class="clinical-label">Clinical Summary</div>
      <div class="clinical-grid">
        ${p.diagnoses ? `<div><div class="clinical-field-label">Diagnoses</div><div class="clinical-field-val">${esc(p.diagnoses)}</div></div>` : ""}
        ${p.history ? `<div><div class="clinical-field-label">History</div><div class="clinical-field-val">${esc(p.history)}</div></div>` : ""}
        ${p.medications ? `<div><div class="clinical-field-label">Medications</div><div class="clinical-field-val">${esc(p.medications)}</div></div>` : ""}
      </div>
    </div>` : "";
  return `
    <div style="display:flex;align-items:center;justify-content:space-between;padding-bottom:8px;margin-bottom:16px;border-bottom:1px solid #cbd5e1;">
      <span style="font-size:11px;font-weight:700;color:#1a365d;">${esc(batchName)}</span>
      <span style="font-size:10px;color:#94a3b8;">${esc(reportLabel)} — ${esc(date)}</span>
    </div>
    <div class="patient-header">
      <div class="patient-name">${esc(p.name)}</div>
      <div class="patient-meta">${demoLine}</div>
    </div>
    ${clinicalBlock}`;
}

const ULTRASOUND_ICONS: Record<string, { paths: (c: string) => string; color: string }> = {
  "Bilateral Carotid Duplex": {
    color: "#dc2626",
    paths: c => `<path d="M12 3C9 3 6.5 5.5 6.5 9c0 2.5 1.5 4.5 4 5.5v4.5h3V14.5c2.5-1 4-3 4-5.5C17.5 5.5 15 3 12 3z" stroke="${c}" stroke-width="1.4" fill="none" stroke-linejoin="round"/><line x1="12" y1="3" x2="12" y2="19" stroke="${c}" stroke-width="1.2"/><path d="M9.5 7.5c0.5 1 1.5 1.5 2.5 1" stroke="${c}" stroke-width="1" fill="none"/><path d="M14.5 7.5c-0.5 1-1.5 1.5-2.5 1" stroke="${c}" stroke-width="1" fill="none"/><path d="M9.5 11c0.5-0.8 1.5-1 2.5-0.5" stroke="${c}" stroke-width="1" fill="none"/><path d="M14.5 11c-0.5-0.8-1.5-1-2.5-0.5" stroke="${c}" stroke-width="1" fill="none"/>`,
  },
  "Echocardiogram TTE": {
    color: "#dc2626",
    paths: c => `<path d="M12 20C12 20 3.5 15 3.5 9.5A4.75 4.75 0 0 1 12 7a4.75 4.75 0 0 1 8.5 2.5C20.5 15 12 20 12 20z" stroke="${c}" stroke-width="1.5" fill="none" stroke-linejoin="round"/>`,
  },
  "Renal Artery Doppler": {
    color: "#dc2626",
    paths: c => `<path d="M10 3C7 3 5 5.5 5 8.5c0 4 2 8 5 9.5 1.5 0.8 2.5 0.2 2.5-1.5 0-1.2-1-2.2-1.5-3.5C10.5 11.5 11 10 12.5 9.5c1.5-0.5 2-2 1-3.5C12.5 4.5 11.5 3 10 3z" stroke="${c}" stroke-width="1.4" fill="none"/><path d="M14 3c3 0.5 5 3 5 6 0 3.5-1.5 6.5-4 8" stroke="${c}" stroke-width="1.4" fill="none" stroke-linecap="round"/>`,
  },
  "Lower Extremity Arterial Doppler": {
    color: "#dc2626",
    paths: c => `<path d="M9.5 2h4c0.5 2 0.5 6 0 9.5L16 22h-3l-1.5-7.5L10 22H7l2.5-10.5C9 8 9 4 9.5 2z" stroke="${c}" stroke-width="1.4" fill="none" stroke-linejoin="round"/><path d="M9.5 2c0.5-0.5 1.5-0.5 4 0" stroke="${c}" stroke-width="1.4" fill="none" stroke-linecap="round"/>`,
  },
  "Upper Extremity Arterial Doppler": {
    color: "#dc2626",
    paths: c => `<path d="M8 3c2 0 3.5 1 3.5 3.5l3.5 9c0.5 1.5 0 2.5-1.5 2.5s-2-1-2.5-2.5L10 11.5l-1 5.5c-0.5 1.5-1.5 2-3 2s-2-1.5-2-2.5V6c0-2 1.5-3 4-3z" stroke="${c}" stroke-width="1.4" fill="none" stroke-linejoin="round"/>`,
  },
  "Abdominal Aortic Aneurysm Duplex": {
    color: "#dc2626",
    paths: c => `<path d="M12 3L20 9l-8 12L4 9z" stroke="${c}" stroke-width="1.4" fill="none" stroke-linejoin="round"/><line x1="12" y1="5" x2="12" y2="19" stroke="${c}" stroke-width="1.5"/><line x1="8" y1="12" x2="16" y2="12" stroke="${c}" stroke-width="1"/>`,
  },
  "Stress Echocardiogram": {
    color: "#dc2626",
    paths: c => `<path d="M12 20C12 20 3.5 15 3.5 9.5A4.75 4.75 0 0 1 12 7a4.75 4.75 0 0 1 8.5 2.5C20.5 15 12 20 12 20z" stroke="${c}" stroke-width="1.5" fill="none" stroke-linejoin="round"/>`,
  },
  "Lower Extremity Venous Duplex": {
    color: "#2563eb",
    paths: c => `<path d="M9.5 2h4c0.5 2 0.5 6 0 9.5L16 22h-3l-1.5-7.5L10 22H7l2.5-10.5C9 8 9 4 9.5 2z" stroke="${c}" stroke-width="1.4" fill="none" stroke-linejoin="round"/><path d="M9.5 2c0.5-0.5 1.5-0.5 4 0" stroke="${c}" stroke-width="1.4" fill="none" stroke-linecap="round"/>`,
  },
  "Upper Extremity Venous Duplex": {
    color: "#2563eb",
    paths: c => `<path d="M8 3c2 0 3.5 1 3.5 3.5l3.5 9c0.5 1.5 0 2.5-1.5 2.5s-2-1-2.5-2.5L10 11.5l-1 5.5c-0.5 1.5-1.5 2-3 2s-2-1.5-2-2.5V6c0-2 1.5-3 4-3z" stroke="${c}" stroke-width="1.4" fill="none" stroke-linejoin="round"/>`,
  },
};

function normalizeUltrasoundName(test: string): string {
  return test.replace(/\s*\(\d{4,5}\)\s*$/, "").trim();
}

function getUltrasoundIcon(test: string, colorOverride?: string): string {
  const entry = ULTRASOUND_ICONS[normalizeUltrasoundName(test)];
  if (!entry) return "";
  const c = colorOverride ?? entry.color;
  return `<svg width="16" height="16" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:middle;flex-shrink:0;">${entry.paths(c)}</svg>`;
}


const TEST_TO_ULTRASOUND_KEY: Record<string, string> = {
  "Bilateral Carotid Duplex": "Carotid Duplex",
  "Abdominal Aortic Aneurysm Duplex": "Abdominal Aorta",
  "Renal Artery Doppler": "Renal Artery Duplex",
  "Lower Extremity Arterial Doppler": "Lower Extremity Arterial",
  "Lower Extremity Venous Duplex": "Lower Extremity Venous",
  "Echocardiogram TTE": "Echocardiogram TTE",
  "Stress Echocardiogram": "Stress Echocardiogram",
  "Upper Extremity Arterial Doppler": "Upper Extremity Arterial",
  "Upper Extremity Venous Duplex": "Upper Extremity Venous",
};


function formatScheduleDate(scheduleDate: string | null | undefined, createdAt: string | Date | null | undefined): string {
  if (scheduleDate) {
    const [yyyy, mm, dd] = scheduleDate.split("-").map(Number);
    const d = new Date(yyyy, mm - 1, dd);
    return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  }
  if (createdAt) {
    return new Date(createdAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  }
  return new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function classifyInsuranceForCooldown(insurance: string | null | undefined): "medicare" | "ppo" | "none" {
  if (!insurance || !insurance.trim()) return "none";
  const s = insurance.toLowerCase().trim();
  const isMedicareAdvantage =
    s.includes("advantage") ||
    s.includes("mapd") ||
    s.includes("ma-pd") ||
    s.includes("hmo medicare") ||
    s.includes("ma plan");
  if (isMedicareAdvantage) return "ppo";
  if (s.includes("medicare")) return "medicare";
  return "ppo";
}

function extractMostRecentDate(text: string | null | undefined): Date | null {
  if (!text) return null;
  const monthMap: Record<string, number> = {
    january:0,february:1,march:2,april:3,may:4,june:5,
    july:6,august:7,september:8,october:9,november:10,december:11
  };
  const dates: Date[] = [];
  let m: RegExpExecArray | null;
  const p0 = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g;
  while ((m = p0.exec(text)) !== null) {
    const d = new Date(parseInt(m[3]), parseInt(m[1])-1, parseInt(m[2]));
    if (!isNaN(d.getTime())) dates.push(d);
  }
  const p1 = /\b(\d{1,2})\/(\d{1,2})\/(\d{2})\b/g;
  while ((m = p1.exec(text)) !== null) {
    const yr = parseInt(m[3]);
    const fullYr = yr >= 0 && yr <= 30 ? 2000 + yr : 1900 + yr;
    const d = new Date(fullYr, parseInt(m[1])-1, parseInt(m[2]));
    if (!isNaN(d.getTime())) dates.push(d);
  }
  const p2 = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
  while ((m = p2.exec(text)) !== null) {
    const d = new Date(parseInt(m[1]), parseInt(m[2])-1, parseInt(m[3]));
    if (!isNaN(d.getTime())) dates.push(d);
  }
  const p3 = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})\b/gi;
  while ((m = p3.exec(text)) !== null) {
    const d = new Date(parseInt(m[3]), monthMap[m[1].toLowerCase()], parseInt(m[2]));
    if (!isNaN(d.getTime())) dates.push(d);
  }
  const p4 = /\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/gi;
  while ((m = p4.exec(text)) !== null) {
    const d = new Date(parseInt(m[3]), monthMap[m[2].toLowerCase()], parseInt(m[1]));
    if (!isNaN(d.getTime())) dates.push(d);
  }
  // MM/YYYY (month/year only — day defaults to 1)
  // Negative lookbehind (?<!\/) prevents matching DD portion of MM/DD/YYYY
  const p5 = /(?<!\/)\b(\d{1,2})\/(\d{4})\b/g;
  while ((m = p5.exec(text)) !== null) {
    const mo = parseInt(m[1]);
    const yr = parseInt(m[2]);
    if (mo >= 1 && mo <= 12) {
      const d = new Date(yr, mo-1, 1);
      if (!isNaN(d.getTime())) dates.push(d);
    }
  }
  if (dates.length === 0) return null;
  return dates.reduce((a, b) => b > a ? b : a);
}

function getPrevTestsSign(insurance: string | null | undefined, previousTests: string | null | undefined, scheduleDate: string): string {
  const insType = classifyInsuranceForCooldown(insurance);
  if (insType === "none") return "";
  const testDate = extractMostRecentDate(previousTests);
  if (!testDate) return "";
  const parts = scheduleDate.split("-").map(Number);
  const refDate = parts.length === 3 ? new Date(parts[0], parts[1]-1, parts[2]) : new Date(scheduleDate);
  if (isNaN(refDate.getTime())) return "";
  const cooldownMonths = insType === "medicare" ? 12 : 6;
  const cutoff = new Date(testDate);
  cutoff.setMonth(cutoff.getMonth() + cooldownMonths);
  return refDate <= cutoff ? "🛑 " : "🟢 ";
}

function generateClinicianPDF(batchName: string, patients: PatientScreening[], scheduleDate?: string | null, createdAt?: string | Date | null): void {
  const date = formatScheduleDate(scheduleDate, createdAt);

  const oneSentence = (text: string | null | undefined): string => {
    if (!text) return "";
    const m = text.match(/^[^.!?]*[.!?]/);
    return m ? m[0].trim() : text.slice(0, 130).trim();
  };

  const renderFactors = (factors: string[] | null | undefined) => {
    if (!factors || factors.length === 0) return "";
    return factors.slice(0, 4).map(f =>
      `<span style="display:inline-block;font-size:8.5px;font-weight:600;color:#475569;background:#f1f5f9;border-radius:4px;padding:1px 5px;margin:1px 2px 1px 0;">${esc(f)}</span>`
    ).join("");
  };

  const pages = patients.map(p => {
    const allTests = (p.qualifyingTests || []) as string[];
    const reasoning = (p.reasoning || {}) as Record<string, ReasoningValue>;
    const demoLine = [p.time, p.age ? `${p.age}yo` : "", p.gender, p.insurance].filter(Boolean).map(esc).join(" · ");
    const firstName = (() => {
      const name = p.name.trim();
      if (!name) return name;
      if (name.includes(",")) {
        const after = name.split(",")[1]?.trim() ?? "";
        const token = after.split(/\s+/)[0] ?? "";
        return token || name;
      }
      const token = name.split(/\s+/)[0] ?? "";
      return token || name;
    })();

    const ancillaryTests = allTests.filter(t => {
      const cat = getAncillaryCategory(t);
      return cat === "brainwave" || cat === "vitalwave";
    });
    const ultrasoundTests = allTests.filter(t => getAncillaryCategory(t) === "ultrasound");

    const ancillaryColor: Record<string, string> = { brainwave: "#7c3aed", vitalwave: "#dc2626" };

    const prevSign = getPrevTestsSign(p.insurance, p.previousTests, scheduleDate || new Date().toISOString().slice(0,10));
    const chartReview = (p.diagnoses || p.history || p.medications || p.previousTests || p.previousTestsDate) ? `
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:6px 10px;margin-bottom:8px;">
        <div style="font-size:8px;font-weight:700;color:#1a365d;text-transform:uppercase;letter-spacing:0.09em;margin-bottom:5px;">${esc(p.name)} Chart Review</div>
        ${p.diagnoses ? `<div style="display:flex;gap:6px;margin-bottom:2px;"><span style="font-size:7.5px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;min-width:16px;padding-top:1px;">Dx</span><span style="font-size:8.5px;color:#334155;line-height:1.4;">${esc(p.diagnoses)}</span></div>` : ""}
        ${p.history ? `<div style="display:flex;gap:6px;margin-bottom:2px;"><span style="font-size:7.5px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;min-width:16px;padding-top:1px;">Hx</span><span style="font-size:8.5px;color:#334155;line-height:1.4;">${esc(p.history)}</span></div>` : ""}
        ${p.medications ? `<div style="display:flex;gap:6px;margin-bottom:2px;"><span style="font-size:7.5px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;min-width:16px;padding-top:1px;">Rx</span><span style="font-size:8.5px;color:#334155;line-height:1.4;">${esc(p.medications)}</span></div>` : ""}
        ${p.previousTests || p.previousTestsDate ? `<div style="display:flex;gap:6px;background:#fef9c3;border-radius:4px;padding:3px 5px;margin-top:2px;"><span style="font-size:7.5px;font-weight:700;color:#78350f;letter-spacing:0.05em;min-width:70px;padding-top:1px;white-space:nowrap;">${prevSign}Previous Tests</span><span style="font-size:8.5px;font-weight:700;color:#334155;line-height:1.4;">${p.previousTests ? esc(p.previousTests) : ""}${p.previousTestsDate ? `${p.previousTests ? " — " : ""}Date: ${esc(p.previousTestsDate)}` : ""}</span></div>` : ""}
      </div>` : "";

    const leftHtml = ancillaryTests.length === 0
      ? `<p style="font-size:10px;color:#94a3b8;font-style:italic;">No qualifying ancillary tests.</p>`
      : ancillaryTests.map((test, i) => {
          const r = reasoning[test];
          const clinician = r ? (typeof r === "string" ? r : r.clinician_understanding) : null;
          const ancFactors = r && typeof r !== "string" ? r.qualifying_factors : null;
          const color = ancillaryColor[getAncillaryCategory(test)] || "#475569";
          const isLast = i === ancillaryTests.length - 1;
          const ancExplain = oneSentence(clinician) || (ancFactors && ancFactors.length > 0 ? oneSentence(ancFactors[0]) : "") || oneSentence(getOneSentenceDesc(test));
          return `
            <div style="margin-bottom:${isLast ? "0" : "10px"};padding-bottom:${isLast ? "0" : "10px"};${isLast ? "" : "border-bottom:1px solid #e2e8f0;"}">
              <div style="display:flex;align-items:center;gap:5px;margin-bottom:3px;">
                <span style="font-size:17px;color:${color};line-height:1;">&#9744;</span>
                <span style="font-size:14px;font-weight:800;color:${color};">${esc(test)}</span>
              </div>
              ${ancFactors && ancFactors.length > 0 ? `<div style="margin-bottom:3px;line-height:1.5;">${renderFactors(ancFactors)}</div>` : ""}
              ${ancExplain ? `<p style="font-size:8.5px;line-height:1.4;color:#475569;margin:0;font-style:italic;">${esc(ancExplain)}</p>` : ""}
            </div>`;
        }).join("");

    const rightHtml = ultrasoundTests.length === 0
      ? `<p style="font-size:10px;color:#94a3b8;font-style:italic;">No qualifying ultrasound studies.</p>`
      : ultrasoundTests.map((test, i) => {
          const r = reasoning[test];
          const clinician = r ? (typeof r === "string" ? r : r.clinician_understanding) : null;
          const factors = r && typeof r !== "string" ? r.qualifying_factors : null;
          const icon = getUltrasoundIcon(test, "#16a34a");
          const isLast = i === ultrasoundTests.length - 1;
          const oneliner = oneSentence(clinician) || (factors && factors.length > 0 ? oneSentence(factors[0]) : "") || oneSentence(getOneSentenceDesc(test));
          return `
            <div style="padding:${i === 0 ? "0 0 6px" : "5px 0 6px"};${isLast ? "" : "border-bottom:1px solid #f1f5f9;"}">
              <div style="display:flex;align-items:center;gap:5px;margin-bottom:3px;">
                <span style="font-size:17px;color:#16a34a;line-height:1;">&#9744;</span>
                ${icon}
                <span style="font-size:14px;font-weight:700;color:#16a34a;">${esc(normalizeUltrasoundName(test))}</span>
              </div>
              ${factors && factors.length > 0 ? `<div style="margin-bottom:2px;padding-left:22px;line-height:1.5;">${renderFactors(factors)}</div>` : ""}
              ${oneliner ? `<div style="font-size:8.5px;line-height:1.4;color:#475569;padding-left:22px;font-style:italic;">${esc(oneliner)}</div>` : ""}
            </div>`;
        }).join("");

    return `
      <div class="page" style="padding:14px 20px;overflow:hidden;">
        <div style="display:flex;align-items:center;justify-content:space-between;padding-bottom:4px;margin-bottom:6px;border-bottom:1px solid #cbd5e1;">
          <span style="font-size:9.5px;font-weight:700;color:#1a365d;">${esc(batchName)}</span>
          <span style="font-size:8.5px;color:#94a3b8;">Clinician Summary — ${esc(date)}</span>
        </div>
        <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:1px;">
          <span style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.09em;">Plexus Qualifying Ancillaries</span>
          <span style="font-size:18px;font-weight:800;color:#1a365d;">${esc(p.name)}</span>
        </div>
        <div style="font-size:8.5px;color:#94a3b8;text-align:right;margin-bottom:7px;">${demoLine}</div>
        ${chartReview}
        <div style="font-size:17px;font-weight:700;color:#1e293b;text-transform:uppercase;letter-spacing:0.09em;text-align:center;margin-top:6px;margin-bottom:10px;">Qualified Ancillary Tests for ${esc(firstName)}</div>
        <div style="display:grid;grid-template-columns:38% 1fr;gap:10px;border-top:2px solid #e2e8f0;padding-top:10px;">
          <div>
            ${leftHtml}
          </div>
          <div>
            ${rightHtml}
          </div>
        </div>
      </div>`;
  }).join("");

  buildPrintWindow(
    `Clinician Report — ${batchName}`,
    pages,
  );
}

function generatePlexusPDF(batchName: string, patients: PatientScreening[], scheduleDate?: string | null, createdAt?: string | Date | null): void {
  const date = formatScheduleDate(scheduleDate, createdAt);
  const catAccent: Record<string, string> = { brainwave: "#7c3aed", vitalwave: "#be123c", ultrasound: "#047857", other: "#475569" };

  // Compact page-top: run name + date bar, patient name, demo line + Dx/Hx/Rx mini row
  const buildCompactTop = (p: PatientScreening) => {
    const demoLine = [p.time, p.age ? `${p.age}yo` : "", p.gender, p.insurance].filter(Boolean).map(esc).join(" · ");
    const trunc = (s: string | null | undefined, max = 80) =>
      s ? (s.length > max ? esc(s.slice(0, max)) + "…" : esc(s)) : "";
    const clinFields = [
      p.insurance ? { label: "Insurance", val: trunc(p.insurance, 40) } : null,
      p.diagnoses ? { label: "Dx", val: trunc(p.diagnoses) } : null,
      p.history   ? { label: "Hx", val: trunc(p.history) }   : null,
      p.medications ? { label: "Rx", val: trunc(p.medications) } : null,
      p.previousTests ? { label: "Prev Tests", val: trunc(p.previousTests) } : null,
    ].filter(Boolean) as { label: string; val: string }[];
    const clinRow = clinFields.length ? `
      <div style="display:grid;grid-template-columns:repeat(${clinFields.length},1fr);gap:8px;margin-top:5px;padding:5px 8px;background:#f8fafc;border-radius:4px;border:1px solid #e2e8f0;">
        ${clinFields.map(f => `<div><span style="font-size:8px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;">${f.label} </span><span style="font-size:8.5px;color:#475569;">${f.val}</span></div>`).join("")}
      </div>` : "";
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;padding-bottom:5px;margin-bottom:6px;border-bottom:1px solid #cbd5e1;">
        <span style="font-size:10px;font-weight:700;color:#1a365d;">${esc(batchName)}</span>
        <span style="font-size:9px;color:#94a3b8;">Plexus Team Script — ${esc(date)}</span>
      </div>
      <div style="margin-bottom:10px;">
        <div style="font-size:17px;font-weight:800;color:#1a365d;margin-bottom:1px;">${esc(p.name)}</div>
        <div style="font-size:10px;color:#64748b;">${demoLine}</div>
        ${clinRow}
      </div>`;
  };

  // Section label (visual divider, no page break)
  const sectionLabel = (label: string, color: string) =>
    `<div style="font-size:9.5px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px;padding-bottom:3px;border-bottom:2px solid ${color};">${esc(label)}</div>`;

  // Factor pills (up to 3)
  const factorPills = (factors: string[] | null | undefined) => {
    if (!factors || factors.length === 0) return "";
    return `<div style="margin-top:3px;line-height:1.8;">${factors.slice(0, 3).map(f =>
      `<span style="display:inline-block;font-size:8px;font-weight:600;color:#475569;background:#f1f5f9;border-radius:3px;padding:1px 5px;margin:1px 3px 1px 0;">${esc(f)}</span>`
    ).join("")}</div>`;
  };

  // ICD-10 code pills
  const icd10Pills = (codes: string[] | null | undefined) => {
    if (!codes || codes.length === 0) return "";
    return `<div style="margin-top:3px;">${codes.slice(0, 4).map(c =>
      `<span style="display:inline-block;font-size:7.5px;font-weight:600;color:#64748b;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:3px;padding:1px 4px;margin:1px 2px 1px 0;">${esc(c)}</span>`
    ).join("")}</div>`;
  };

  const pages = patients.flatMap(p => {
    const allTests = (p.qualifyingTests || []) as string[];
    if (allTests.length === 0) return [];
    const reasoning = (p.reasoning || {}) as Record<string, ReasoningValue>;
    const rawFirst = p.name.trim().includes(",")
      ? (p.name.split(",")[1]?.trim().split(/\s+/)[0] ?? "").trim() || p.name.trim()
      : p.name.trim().split(/\s+/)[0] || p.name.trim();
    const firstName = esc(rawFirst || "the patient");

    // Test card: Clinical Basis (clinician_understanding) + Talking Points (patient_talking_points)
    const renderTest = (test: string, isLast: boolean) => {
      const r = reasoning[test];
      const clinician = r && typeof r !== "string" ? r.clinician_understanding : null;
      const talking   = r ? (typeof r === "string" ? r : r.patient_talking_points) : null;
      const factors   = r && typeof r !== "string" ? r.qualifying_factors : null;
      const icd10     = r && typeof r !== "string" ? r.icd10_codes : null;
      const pearls    = r && typeof r !== "string" ? r.pearls : null;
      const accent    = catAccent[getAncillaryCategory(test)] || "#475569";
      const whatIs    = getOneSentenceDesc(test);
      const pearlsBlock = (pearls && pearls.length > 0) ? `
          <div style="margin-top:5px;background:#f0f9ff;border-left:3px solid #0ea5e9;border-radius:3px;padding:4px 8px;break-inside:avoid;">
            <div style="font-size:8px;font-weight:700;color:#0369a1;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:3px;">Pearls</div>
            <ul style="margin:0;padding-left:14px;">
              ${pearls.map(p => `<li style="font-size:9px;line-height:1.5;color:#1e293b;break-inside:avoid;">${esc(p)}</li>`).join("")}
            </ul>
          </div>` : "";
      return `
        <div style="margin-bottom:${isLast ? "0" : "8px"};padding-bottom:${isLast ? "0" : "8px"};${isLast ? "" : "border-bottom:1px solid #f1f5f9;"}break-inside:avoid;">
          <div style="font-size:11.5px;font-weight:800;color:${accent};margin-bottom:2px;">${esc(test)}</div>
          <p style="font-size:8.5px;line-height:1.35;color:#64748b;margin:0 0 3px;font-style:italic;">${esc(whatIs)}</p>
          ${clinician ? `
          <div style="font-size:8px;font-weight:700;color:#1a365d;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:1px;">Clinical Basis</div>
          <p style="font-size:9px;line-height:1.4;color:#334155;margin:0 0 1px;">${esc(clinician)}</p>
          ${icd10Pills(icd10)}` : ""}
          <div style="font-size:8px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:1px;margin-top:${clinician ? "3px" : "0"};">Talking Points</div>
          <p style="font-size:9px;line-height:1.4;color:#1e293b;margin:0;">${talking ? esc(talking) : `Clinical indicators in this patient's chart support this study.`}</p>
          ${factorPills(factors)}
          ${pearlsBlock}
        </div>`;
    };

    // Group by category — section labels are visual dividers only
    const brainwaveTests = allTests.filter(t => getAncillaryCategory(t) === "brainwave");
    const vitalwaveTests  = allTests.filter(t => getAncillaryCategory(t) === "vitalwave");
    const ultrasoundTests = allTests.filter(t => getAncillaryCategory(t) === "ultrasound");
    const otherTests      = allTests.filter(t => {
      const c = getAncillaryCategory(t);
      return c !== "brainwave" && c !== "vitalwave" && c !== "ultrasound";
    });

    const sections: string[] = [];

    if (brainwaveTests.length) {
      sections.push(sectionLabel("BrainWave", catAccent.brainwave));
      sections.push(...brainwaveTests.map((t, i) => renderTest(t, i === brainwaveTests.length - 1 && !vitalwaveTests.length && !ultrasoundTests.length && !otherTests.length)));
    }
    if (vitalwaveTests.length) {
      if (sections.length) sections.push(`<div style="margin-top:10px;"></div>`);
      sections.push(sectionLabel("VitalWave", catAccent.vitalwave));
      sections.push(...vitalwaveTests.map((t, i) => renderTest(t, i === vitalwaveTests.length - 1 && !ultrasoundTests.length && !otherTests.length)));
    }
    if (ultrasoundTests.length) {
      if (sections.length) sections.push(`<div style="margin-top:10px;"></div>`);
      sections.push(sectionLabel(`Ultrasound Studies (${ultrasoundTests.length})`, catAccent.ultrasound));
      sections.push(...ultrasoundTests.map((t, i) => renderTest(t, i === ultrasoundTests.length - 1 && !otherTests.length)));
    }
    if (otherTests.length) {
      if (sections.length) sections.push(`<div style="margin-top:10px;"></div>`);
      sections.push(sectionLabel(`Additional Studies (${otherTests.length})`, catAccent.other));
      sections.push(...otherTests.map((t, i) => renderTest(t, i === otherTests.length - 1)));
    }

    // Single .page div per patient — content flows naturally across physical pages
    return [`<div class="page" style="padding:16px 20px;">${buildCompactTop(p)}${sections.join("")}</div>`];
  });

  buildPrintWindow(
    `Plexus Team Script — ${batchName}`,
    pages.join(""),
  );
}

function PdfPatientSelectDialog({
  open,
  mode,
  patients,
  onClose,
  onGenerate,
}: {
  open: boolean;
  mode: "clinician" | "plexus" | null;
  patients: PatientScreening[];
  onClose: () => void;
  onGenerate: (selected: PatientScreening[]) => void;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (open) setSelected(new Set(patients.map(p => p.id)));
  }, [open, patients]);

  const allSelected = selected.size === patients.length;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(patients.map(p => p.id)));
  const toggle = (id: number) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const title = mode === "clinician" ? "Clinician PDF" : "Plexus Team PDF";
  const desc = mode === "clinician"
    ? "Select patients to include. Each gets a page with Dx/Hx/Rx and clinician reasoning per test."
    : "Select patients to include. Each gets a page with chart summary, test explanations, and conversation scripts.";

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md" data-testid="dialog-pdf-select">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {mode === "clinician" ? <Printer className="w-4 h-4 text-slate-500" /> : <Users2 className="w-4 h-4 text-slate-500" />}
            {title}
          </DialogTitle>
          <p className="text-xs text-slate-500 mt-1">{desc}</p>
        </DialogHeader>

        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <div
            className="flex items-center gap-3 px-4 py-3 bg-slate-50 border-b border-slate-200"
            data-testid="checkbox-select-all-patients"
          >
            <Checkbox
              checked={allSelected}
              onCheckedChange={toggleAll}
              id="select-all"
            />
            <Label htmlFor="select-all" className="text-sm font-semibold cursor-pointer select-none flex-1">
              Select all patients
            </Label>
            <span className="text-xs font-semibold text-slate-500">{selected.size}/{patients.length}</span>
          </div>
          <div className="max-h-64 overflow-y-auto divide-y divide-slate-100">
            {patients.map(p => (
              <div
                key={p.id}
                className="flex items-center gap-3 px-4 py-2.5"
                data-testid={`checkbox-patient-pdf-${p.id}`}
              >
                <Checkbox
                  checked={selected.has(p.id)}
                  onCheckedChange={() => toggle(p.id)}
                  id={`pdf-p-${p.id}`}
                />
                <Label htmlFor={`pdf-p-${p.id}`} className="flex-1 min-w-0 cursor-pointer select-none">
                  <span className="text-sm font-medium block">{p.name}</span>
                  <span className="text-[11px] text-slate-400">{[p.time, p.age ? `${p.age}yo` : "", p.gender].filter(Boolean).join(" · ")}</span>
                </Label>
                {(p.qualifyingTests || []).length > 0 && (
                  <span className="text-[10px] font-semibold text-emerald-600 shrink-0">{(p.qualifyingTests || []).length} tests</span>
                )}
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose} data-testid="button-pdf-cancel">Cancel</Button>
          <Button
            size="sm"
            disabled={selected.size === 0}
            onClick={() => onGenerate(patients.filter(p => selected.has(p.id)))}
            className="gap-1.5"
            data-testid="button-pdf-generate"
          >
            {mode === "clinician" ? <Printer className="w-3.5 h-3.5" /> : <Users2 className="w-3.5 h-3.5" />}
            Generate PDF ({selected.size})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function computeNextEligible(dos: string, insuranceType: string): { date: Date; eligible: boolean } | null {
  if (!dos) return null;
  const dosDate = new Date(dos.includes("T") ? dos : dos + "T00:00:00");
  if (isNaN(dosDate.getTime())) return null;
  const months = insuranceType === "medicare" ? 12 : 6;
  const next = new Date(dosDate);
  next.setMonth(next.getMonth() + months);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return { date: next, eligible: today >= next };
}

function formatDisplayDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

interface PatientDirectoryViewProps {
  testHistory: PatientTestHistory[];
  historyLoading: boolean;
  dirPasteText: string;
  setDirPasteText: (v: string) => void;
  dirSearch: string;
  setDirSearch: (v: string) => void;
  onImportFile: (file: File) => void;
  onImportText: (text: string) => void;
  onClearAll: () => void;
  importFilePending: boolean;
  importTextPending: boolean;
  onOpenHistory: () => void;
}

function PatientDirectoryView({ testHistory, historyLoading, dirPasteText, setDirPasteText, dirSearch, setDirSearch, onImportFile, onImportText, onClearAll, importFilePending, importTextPending, onOpenHistory }: PatientDirectoryViewProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [addRecordOpen, setAddRecordOpen] = useState(false);
  const [addRecordName, setAddRecordName] = useState("");
  const [addRecordTest, setAddRecordTest] = useState("");
  const [addRecordDos, setAddRecordDos] = useState<Date | undefined>(new Date());
  const [addRecordInsurance, setAddRecordInsurance] = useState<"ppo" | "medicare">("ppo");

  const [patientsSyncedAt, setPatientsSyncedAt] = useState<string | null>(null);
  const [patientsSheetUrl, setPatientsSheetUrl] = useState<string | null>(null);

  const { data: googleStatus } = useQuery<{
    sheets: {
      connected: boolean;
      lastSyncedPatients: string | null;
      patientsSpreadsheetUrl: string | null;
    };
    drive: { connected: boolean; email: string | null };
  }>({ queryKey: ["/api/google/status"], refetchInterval: 30000 });

  useEffect(() => {
    if (!googleStatus?.sheets) return;
    setPatientsSyncedAt(googleStatus.sheets.lastSyncedPatients ?? null);
    setPatientsSheetUrl(googleStatus.sheets.patientsSpreadsheetUrl ?? null);
  }, [googleStatus]);

  const syncPatientsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/google/sync/patients");
      return res.json();
    },
    onSuccess: (data) => {
      if (data.syncedAt) {
        setPatientsSyncedAt(data.syncedAt);
        if (data.spreadsheetUrl) setPatientsSheetUrl(data.spreadsheetUrl);
        toast({ title: "Synced to Google Sheets", description: `${data.patientCount} patients, ${data.testHistoryCount} test records pushed` });
      } else {
        toast({ title: "Sync queued", description: "Another sync is in progress; your changes will be included" });
      }
    },
    onError: (err: Error) => {
      toast({ title: "Sync failed", description: err.message, variant: "destructive" });
    },
  });

  const addRecordMutation = useMutation({
    mutationFn: async () => {
      const _d = addRecordDos || new Date();
      const dos = `${_d.getFullYear()}-${String(_d.getMonth() + 1).padStart(2, "0")}-${String(_d.getDate()).padStart(2, "0")}`;
      const res = await apiRequest("POST", "/api/test-history", {
        patientName: addRecordName.trim(),
        testName: addRecordTest.trim(),
        dateOfService: dos,
        insuranceType: addRecordInsurance,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/test-history"] });
      toast({ title: "Record added" });
      setAddRecordOpen(false);
      setAddRecordName("");
      setAddRecordTest("");
      setAddRecordDos(new Date());
      setAddRecordInsurance("ppo");
    },
    onError: (e: any) => {
      toast({ title: "Failed to add record", description: e.message, variant: "destructive" });
    },
  });

  const patientMap = new Map<string, { displayName: string; dob?: string; records: PatientTestHistory[] }>();
  for (const record of testHistory) {
    const key = record.patientName.trim().toLowerCase();
    const existing = patientMap.get(key);
    if (existing) {
      existing.records.push(record);
      if (!existing.dob && record.dob) existing.dob = record.dob;
    } else {
      patientMap.set(key, { displayName: record.patientName, dob: record.dob || undefined, records: [record] });
    }
  }

  const patients = Array.from(patientMap.values()).sort((a, b) => a.displayName.localeCompare(b.displayName));
  const filtered = dirSearch ? patients.filter(p => p.displayName.toLowerCase().includes(dirSearch.toLowerCase())) : patients;

  return (
    <div className="flex flex-col h-full relative z-10">
      <Dialog open={addRecordOpen} onOpenChange={setAddRecordOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Record</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1">
              <Label className="text-xs">Patient Name</Label>
              <Input
                placeholder="Full name"
                value={addRecordName}
                onChange={(e) => setAddRecordName(e.target.value)}
                data-testid="input-add-record-name"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Test Name</Label>
              <Select value={addRecordTest} onValueChange={setAddRecordTest}>
                <SelectTrigger data-testid="select-add-record-test">
                  <SelectValue placeholder="Select test" />
                </SelectTrigger>
                <SelectContent>
                  {ALL_AVAILABLE_TESTS.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Date of Service</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="w-full justify-start gap-2 font-normal" data-testid="button-add-record-dos">
                    <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
                    {addRecordDos ? `${addRecordDos.getFullYear()}-${String(addRecordDos.getMonth() + 1).padStart(2, "0")}-${String(addRecordDos.getDate()).padStart(2, "0")}` : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarPicker mode="single" selected={addRecordDos} onSelect={setAddRecordDos} initialFocus />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Insurance Type</Label>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant={addRecordInsurance === "ppo" ? "default" : "outline"}
                  onClick={() => setAddRecordInsurance("ppo")}
                  className="flex-1"
                  data-testid="button-add-record-ppo"
                >PPO</Button>
                <Button
                  size="sm"
                  variant={addRecordInsurance === "medicare" ? "default" : "outline"}
                  onClick={() => setAddRecordInsurance("medicare")}
                  className="flex-1"
                  data-testid="button-add-record-medicare"
                >Medicare</Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setAddRecordOpen(false)}>Cancel</Button>
            <Button
              size="sm"
              disabled={!addRecordName.trim() || !addRecordTest.trim() || !addRecordDos || addRecordMutation.isPending}
              onClick={() => addRecordMutation.mutate()}
              data-testid="button-add-record-submit"
            >
              {addRecordMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
              Add Record
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <header className="bg-white/85 dark:bg-card/85 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-2 flex-wrap border-b">
          <div className="flex items-center gap-2">
            <SidebarTrigger data-testid="button-sidebar-toggle-dir" />
            <div>
              <h1 className="text-base font-bold tracking-tight flex items-center gap-2">
                <Users className="w-4 h-4" />
                Patient Directory
              </h1>
              <p className="text-xs text-muted-foreground">{patients.length} patients · {testHistory.length} completed tests</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                onClick={() => syncPatientsMutation.mutate()}
                disabled={syncPatientsMutation.isPending}
                className="gap-1.5 text-emerald-700 border-emerald-200 hover:bg-emerald-50"
                data-testid="button-sync-patients-sheets"
              >
                {syncPatientsMutation.isPending ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <SiGooglesheets className="w-3.5 h-3.5" />
                )}
                Sync to Sheets
              </Button>
              {patientsSyncedAt && (
                <span className="text-[10px] text-slate-400 whitespace-nowrap">
                  Synced {new Date(patientsSyncedAt).toLocaleTimeString()}
                  {patientsSheetUrl && (
                    <a href={patientsSheetUrl} target="_blank" rel="noopener noreferrer" className="ml-1 text-emerald-600 hover:underline inline-flex items-center gap-0.5">
                      <ExternalLink className="w-2.5 h-2.5" />Open
                    </a>
                  )}
                </span>
              )}
              {googleStatus?.drive?.email && (
                <span className="text-[10px] text-slate-400 whitespace-nowrap" data-testid="text-drive-email-patients">
                  Drive: {googleStatus.drive.email}
                </span>
              )}
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={onOpenHistory}
              className="gap-1.5"
              data-testid="button-ancillary-test-history"
            >
              <ClipboardList className="w-3.5 h-3.5" />
              Ancillary Test History
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAddRecordOpen(true)}
              className="gap-1.5"
              data-testid="button-add-record"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Record
            </Button>
            {testHistory.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={onClearAll}
                className="gap-1.5 text-red-600"
                data-testid="button-clear-directory"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Clear All
              </Button>
            )}
          </div>
        </div>
      </header>
      <div className="flex-1 overflow-auto p-4">
        <div className="max-w-5xl mx-auto space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Upload className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-semibold">Upload File</span>
              </div>
              <p className="text-xs text-muted-foreground mb-2">Import from Excel or CSV: Name, DOB, Test, DOS, Insurance</p>
              <input
                type="file"
                accept=".xlsx,.xls,.csv,.txt"
                className="text-xs"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onImportFile(file);
                  e.target.value = "";
                }}
                data-testid="input-dir-file"
              />
              {importFilePending && (
                <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                  <Loader2 className="w-3 h-3 animate-spin" /> Importing...
                </div>
              )}
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <FileText className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-semibold">Paste Data</span>
              </div>
              <Textarea
                placeholder="Paste test history data (Name, DOB, Test, Date of Service, Insurance)..."
                value={dirPasteText}
                onChange={(e) => setDirPasteText(e.target.value)}
                className="text-xs min-h-[80px] mb-2"
                data-testid="input-dir-paste"
              />
              <Button
                size="sm"
                disabled={!dirPasteText.trim() || importTextPending}
                onClick={() => onImportText(dirPasteText)}
                className="gap-1.5"
                data-testid="button-import-dir"
              >
                {importTextPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                Import
              </Button>
            </Card>
          </div>

          {testHistory.length > 0 && (
            <div className="flex items-center gap-2">
              <Search className="w-4 h-4 text-muted-foreground shrink-0" />
              <Input
                placeholder="Search patients..."
                value={dirSearch}
                onChange={(e) => setDirSearch(e.target.value)}
                className="text-xs h-8 max-w-xs"
                data-testid="input-dir-search"
              />
            </div>
          )}

          {historyLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 && testHistory.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No patient records yet. Import test history to get started.</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">No patients match your search.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filtered.map((patient) => {
                const sortedRecords = [...patient.records].sort((a, b) => b.dateOfService.localeCompare(a.dateOfService));
                return (
                  <Card key={patient.displayName} className="p-4 space-y-3" data-testid={`card-patient-dir-${patient.displayName.replace(/\s+/g, "-").toLowerCase()}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-sm text-slate-900 dark:text-foreground">{patient.displayName}</p>
                        {patient.dob && (
                          <p className="text-xs text-muted-foreground mt-0.5">DOB: {patient.dob}</p>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0 mt-0.5">{patient.records.length} test{patient.records.length !== 1 ? "s" : ""}</span>
                    </div>
                    <div className="space-y-2">
                      {sortedRecords.map((record) => {
                        const eligible = computeNextEligible(record.dateOfService, record.insuranceType);
                        return (
                          <div key={record.id} className="bg-slate-50 dark:bg-muted/40 rounded-lg px-3 py-2 space-y-1" data-testid={`row-dir-test-${record.id}`}>
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <span className="text-xs font-medium text-slate-800 dark:text-foreground">{record.testName}</span>
                              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                record.insuranceType === "medicare"
                                  ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                                  : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                              }`}>
                                {record.insuranceType === "medicare" ? "Medicare" : "PPO"}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-2 text-[11px] flex-wrap">
                              <span className="text-muted-foreground">DOS: {record.dateOfService}</span>
                              {eligible ? (
                                <span className={`font-medium ${eligible.eligible ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"}`}>
                                  {eligible.eligible ? "Eligible now" : `Eligible ${formatDisplayDate(eligible.date)}`}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ResultsView({
  batch,
  patients,
  loading,
  onExport,
  onNavigate,
  expandedPatient,
  setExpandedPatient,
  expandedClinical,
  setExpandedClinical,
  selectedTestDetail,
  setSelectedTestDetail,
  onUpdatePatient,
}: {
  batch: ScreeningBatchWithPatients | undefined;
  patients: PatientScreening[];
  loading: boolean;
  onExport: () => void;
  onNavigate: (step: "home" | "build" | "results") => void;
  expandedPatient: number | null;
  setExpandedPatient: (id: number | null) => void;
  expandedClinical: number | null;
  setExpandedClinical: (id: number | null) => void;
  selectedTestDetail: { patientId: number; category: string; tests: string[]; reasoning: Record<string, ReasoningValue> } | null;
  setSelectedTestDetail: (v: { patientId: number; category: string; tests: string[]; reasoning: Record<string, ReasoningValue> } | null) => void;
  onUpdatePatient: (id: number, updates: Record<string, unknown>) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [shareButtonText, setShareButtonText] = useState("Share");
  const [pdfMode, setPdfMode] = useState<"clinician" | "plexus" | null>(null);
  const [generatingNotesFor, setGeneratingNotesFor] = useState<Set<number>>(new Set());
  const [patientNotes, setPatientNotes] = useState<Record<number, GeneratedDocument[]>>({});
  const [inlineScreeningFormDoc, setInlineScreeningFormDoc] = useState<{ doc: GeneratedDocument; patient: PatientScreening } | null>(null);

  const { data: batchNotes = [] } = useQuery<Array<{ id: number; patientId: number; service: string; docKind: string; title: string; sections: Array<{ heading: string; body: string }> }>>({
    queryKey: ["/api/generated-notes/batch", batch?.id],
    enabled: !!batch?.id,
  });

  const savedNotesByPatient = batchNotes.reduce<Record<number, typeof batchNotes>>((acc, n) => {
    if (!acc[n.patientId]) acc[n.patientId] = [];
    acc[n.patientId].push(n);
    return acc;
  }, {});

  const saveNotesMutation = useMutation({
    mutationFn: async (payload: Array<{
      patientId: number; batchId: number; facility?: string | null; scheduleDate?: string | null;
      patientName: string; service: string; docKind: string; title: string;
      sections: Array<{ heading: string; body: string }>;
    }>) => {
      const res = await apiRequest("POST", "/api/generated-notes", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/generated-notes/batch", batch?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/generated-notes"] });
    },
    onError: (e: any) => {
      toast({ title: "Failed to save notes", description: e.message, variant: "destructive" });
    },
  });

  const handleStatusChange = async (patient: PatientScreening, newStatus: string) => {
    onUpdatePatient(patient.id, { appointmentStatus: newStatus });
    if (newStatus.toLowerCase() === "completed" && (patient.qualifyingTests || []).length > 0) {
      setGeneratingNotesFor((prev) => new Set(Array.from(prev).concat(patient.id)));
      try {
        const docs = await autoGeneratePatientNotes(patient, batch?.scheduleDate, batch?.facility, batch?.clinicianName);
        if (docs.length > 0) {
          setPatientNotes((prev) => ({ ...prev, [patient.id]: docs }));
          const payload = docs.map((doc) => ({
            patientId: patient.id,
            batchId: batch!.id,
            facility: batch?.facility ?? null,
            scheduleDate: batch?.scheduleDate ?? null,
            patientName: patient.name,
            service: doc.service,
            docKind: doc.kind,
            title: doc.title,
            sections: doc.sections,
          }));
          saveNotesMutation.mutate(payload);
        }
      } finally {
        setGeneratingNotesFor((prev) => { const s = new Set(prev); s.delete(patient.id); return s; });
      }
    }
  };

  const handlePdfGenerate = useCallback((selected: PatientScreening[]) => {
    if (!batch) return;
    setPdfMode(null);
    if (pdfMode === "clinician") generateClinicianPDF(batch.name, selected, batch.scheduleDate, batch.createdAt);
    else if (pdfMode === "plexus") generatePlexusPDF(batch.name, selected, batch.scheduleDate, batch.createdAt);
  }, [batch, pdfMode]);

  const handleShare = useCallback(() => {
    if (!batch) return;
    const url = `${window.location.origin}/schedule/${batch.id}`;
    navigator.clipboard.writeText(url).then(() => {
      setShareButtonText("Copied!");
      toast({ title: "Link copied", description: "Share link copied to clipboard" });
      setTimeout(() => setShareButtonText("Share"), 2000);
    }).catch(() => {
      toast({ title: "Copy failed", description: url, variant: "destructive" });
    });
  }, [batch, toast]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center relative z-10">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full relative z-10">
      <header className="bg-white/80 backdrop-blur-xl sticky top-0 z-50 border-b border-slate-200/60">
        <StepTimeline current="results" onNavigate={onNavigate} canGoToResults={true} />
        <div className="px-8 lg:px-[10%] py-3 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <SidebarTrigger data-testid="button-sidebar-toggle-results" />
            <div>
              <h1 className="text-base font-semibold tracking-tight" data-testid="text-results-title">{batch?.name} — Final Schedule</h1>
              {batch?.clinicianName && (
                <p className="text-xs font-medium text-primary" data-testid="text-results-clinician">Dr. {batch.clinicianName}</p>
              )}
              {batch?.facility && (
                <p className="text-xs text-slate-600 flex items-center gap-1" data-testid="text-results-facility">
                  <Building2 className="w-3 h-3 inline" />
                  {batch.facility}
                </p>
              )}
              <p className="text-xs text-slate-900">{patients.length} patients screened</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={handleShare} className="gap-1.5 rounded-xl" data-testid="button-share">
              {shareButtonText === "Copied!" ? <Check className="w-3.5 h-3.5" /> : <Share2 className="w-3.5 h-3.5" />} {shareButtonText}
            </Button>
            <Button variant="outline" size="sm" onClick={onExport} className="gap-1.5 rounded-xl" data-testid="button-export">
              <Download className="w-3.5 h-3.5" /> Export CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPdfMode("clinician")}
              className="gap-1.5 rounded-xl"
              data-testid="button-clinician-pdf"
              disabled={patients.length === 0}
            >
              <Printer className="w-3.5 h-3.5" /> Clinician PDF
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPdfMode("plexus")}
              className="gap-1.5 rounded-xl"
              data-testid="button-plexus-pdf"
              disabled={patients.length === 0}
            >
              <Users2 className="w-3.5 h-3.5" /> Plexus PDF
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-auto bg-slate-50/50">
        <div className="px-8 lg:px-[10%] py-6">
          <div className="space-y-3" data-testid="table-final-schedule">
            {patients.map((patient) => {
              const allTests = patient.qualifyingTests || [];
              const reasoning = (patient.reasoning || {}) as Record<string, ReasoningValue>;
              const cooldowns = (patient.cooldownTests || []) as { test: string; lastDate: string; insuranceType: string; cooldownMonths: number }[];
              const qualTests = allTests.filter((t) => !isImagingTest(t));
              const qualImaging = allTests.filter((t) => isImagingTest(t));
              const isExpanded = expandedPatient === patient.id;
              const hasCooldowns = cooldowns.length > 0;

              return (
                <Card
                  key={patient.id}
                  className={`rounded-2xl border-0 shadow-sm bg-white/85 backdrop-blur-sm overflow-hidden transition-shadow hover:shadow-md ${hasCooldowns ? "ring-1 ring-amber-300 dark:ring-amber-700" : ""}`}
                  data-testid={`row-result-${patient.id}`}
                >
                  <div
                    className="p-4 cursor-pointer hover:bg-slate-50/60 transition-colors"
                    onClick={() => setExpandedPatient(isExpanded ? null : patient.id)}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-4 min-w-0 flex-1">
                        {patient.time && (
                          <span className="text-sm text-slate-900 font-medium shrink-0 mt-0.5 tabular-nums">{patient.time}</span>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <p className="font-semibold text-base text-slate-900 truncate">{patient.name}</p>
                            <span className="text-xs text-slate-900">
                              {[patient.age && `${patient.age}yo`, patient.gender].filter(Boolean).join(" · ")}
                            </span>
                            <span
                              className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold capitalize cursor-pointer select-none ${
                                (patient.patientType || "visit") === "outreach"
                                  ? "bg-orange-100 text-orange-800"
                                  : "bg-teal-100 text-teal-800"
                              }`}
                              title="Click to toggle patient type"
                              onClick={(e) => {
                                e.stopPropagation();
                                const newType = (patient.patientType || "visit") === "visit" ? "outreach" : "visit";
                                onUpdatePatient(patient.id, { patientType: newType });
                              }}
                              data-testid={`badge-patient-type-${patient.id}`}
                            >
                              {patient.patientType || "visit"}
                            </span>
                            {hasCooldowns && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300" data-testid={`badge-cooldown-${patient.id}`}>
                                <AlertTriangle className="w-3 h-3" />
                                Cooldown ({cooldowns.length})
                              </span>
                            )}
                          </div>
                          {(patient.diagnoses || patient.history || patient.medications || patient.previousTests) && (
                            <div
                              className="flex items-center gap-3 text-xs text-slate-900 cursor-pointer hover:text-slate-700 group mt-0.5 rounded-lg px-1 -ml-1 py-0.5 hover:bg-slate-100/70 transition-colors"
                              onClick={(e) => { e.stopPropagation(); setExpandedClinical(expandedClinical === patient.id ? null : patient.id); }}
                              data-testid={`button-expand-clinical-${patient.id}`}
                            >
                              {patient.diagnoses && (
                                <span className="truncate max-w-[200px]">
                                  <span className="font-semibold">Dx:</span> {patient.diagnoses}
                                </span>
                              )}
                              {patient.history && (
                                <span className="truncate max-w-[160px]">
                                  <span className="font-semibold">Hx:</span> {patient.history}
                                </span>
                              )}
                              {patient.medications && (
                                <span className="truncate max-w-[160px]">
                                  <span className="font-semibold">Rx:</span> {patient.medications}
                                </span>
                              )}
                              {patient.previousTests && (
                                <span className="truncate max-w-[160px]">
                                  <span className="font-semibold">Prev:</span> {patient.previousTests}
                                </span>
                              )}
                              {expandedClinical === patient.id
                                ? <ChevronDown className="w-3 h-3 text-slate-400 shrink-0 ml-auto" />
                                : <ChevronRight className="w-3 h-3 text-slate-400 shrink-0 ml-auto" />
                              }
                            </div>
                          )}
                          {expandedClinical === patient.id && (
                            <div
                              className="mt-2 rounded-xl bg-slate-50/80 border border-slate-200/70 px-4 py-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3"
                              onClick={(e) => e.stopPropagation()}
                              data-testid={`panel-clinical-${patient.id}`}
                            >
                              {patient.diagnoses && (
                                <div>
                                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Diagnoses</p>
                                  <p className="text-xs text-slate-900 leading-relaxed">{patient.diagnoses}</p>
                                </div>
                              )}
                              {patient.history && (
                                <div>
                                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">History</p>
                                  <p className="text-xs text-slate-900 leading-relaxed">{patient.history}</p>
                                </div>
                              )}
                              {patient.medications && (
                                <div>
                                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Medications</p>
                                  <p className="text-xs text-slate-900 leading-relaxed">{patient.medications}</p>
                                </div>
                              )}
                              {(patient.previousTests || patient.previousTestsDate) && (
                                <div>
                                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Previous Tests</p>
                                  {patient.previousTests && <p className="text-xs text-slate-900 leading-relaxed">{patient.previousTests}</p>}
                                  {patient.previousTestsDate && <p className="text-xs text-amber-700 font-medium mt-0.5">Date: {patient.previousTestsDate}</p>}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2 shrink-0">
                        <div className="flex items-center gap-2">
                          <select
                            className="text-[10px] border border-slate-200 rounded-lg px-2 py-0.5 bg-white font-medium cursor-pointer capitalize focus:outline-none focus:ring-1 focus:ring-primary"
                            value={patient.appointmentStatus || "pending"}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => {
                              e.stopPropagation();
                              handleStatusChange(patient, e.target.value);
                            }}
                            data-testid={`select-appointment-status-${patient.id}`}
                          >
                            {APPOINTMENT_STATUSES.map((s) => (
                              <option key={s} value={s.toLowerCase()}>{s}</option>
                            ))}
                          </select>
                          {allTests.length > 0 && (
                            isExpanded
                              ? <ChevronDown className="w-4 h-4 text-slate-400 transition-transform" />
                              : <ChevronRight className="w-4 h-4 text-slate-400 transition-transform" />
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap justify-end max-w-[340px]">
                          {qualTests.map((test) => (
                            <span key={test} className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${getBadgeColor(getAncillaryCategory(test))}`}>
                              {test}
                            </span>
                          ))}
                          {qualImaging.length > 0 && (
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${getBadgeColor("ultrasound")}`}>
                              <Scan className="w-3 h-3 mr-1" />
                              Ultrasound Studies ({qualImaging.length})
                            </span>
                          )}
                          {allTests.length === 0 && (
                            <span className="text-xs text-slate-900 italic">No qualifying tests</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {isExpanded && (allTests.length > 0 || hasCooldowns) && (
                    <div className="border-t border-slate-100 bg-slate-50/60 p-5" data-testid={`row-expanded-${patient.id}`}>
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="font-semibold text-base text-slate-900">{patient.name} — Ancillary Details</h3>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); setExpandedPatient(null); }} data-testid="button-close-detail">
                          <X className="w-4 h-4 text-slate-400" />
                        </Button>
                      </div>

                      {hasCooldowns && (
                        <div className="rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-4 mb-4" data-testid={`card-cooldown-${patient.id}`}>
                          <div className="flex items-center gap-2 mb-3">
                            <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                            <span className="font-semibold text-sm text-amber-800 dark:text-amber-300">Cooldown Violations</span>
                          </div>
                          <div className="space-y-2">
                            {cooldowns.map((cd, idx) => (
                              <div key={idx} className="flex items-center justify-between gap-3 rounded-lg bg-white/80 dark:bg-amber-900/20 px-3 py-2" data-testid={`cooldown-item-${idx}`}>
                                <div className="flex items-center gap-2 min-w-0">
                                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                                  <span className="text-sm font-medium text-amber-900 dark:text-amber-200 truncate">{cd.test}</span>
                                </div>
                                <div className="flex items-center gap-3 shrink-0 text-xs text-amber-700 dark:text-amber-400">
                                  <span className="flex items-center gap-1">
                                    <Calendar className="w-3 h-3" />
                                    Last: {cd.lastDate}
                                  </span>
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-amber-200/60 dark:bg-amber-800/40 text-[10px] font-semibold uppercase">
                                    {cd.insuranceType}
                                  </span>
                                  <span className="text-[10px]">
                                    {cd.cooldownMonths}mo cooldown
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="flex flex-wrap gap-2">
                        {(() => {
                          const grouped: Record<string, string[]> = {};
                          for (const test of allTests) {
                            const cat = getAncillaryCategory(test);
                            if (!grouped[cat]) grouped[cat] = [];
                            grouped[cat].push(test);
                          }
                          return ["brainwave", "vitalwave", "ultrasound", "other"].filter((c) => grouped[c]).map((cat) => {
                            const tests = grouped[cat];
                            const style = categoryStyles[cat];
                            const IconComp = categoryIcons[cat];
                            return (
                              <button
                                key={cat}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedTestDetail({ patientId: patient.id, category: cat, tests, reasoning });
                                }}
                                className={`flex items-center gap-2 rounded-xl ${style.bg} border ${style.border} px-4 py-3 hover:shadow-md transition-shadow cursor-pointer text-left`}
                                data-testid={`card-ancillary-${cat}-${patient.id}`}
                              >
                                <IconComp className={`w-4 h-4 ${style.icon} shrink-0`} />
                                <span className={`font-semibold text-sm ${style.accent}`}>{categoryLabels[cat]}</span>
                                {tests.length > 1 && (
                                  <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${getBadgeColor(cat)}`}>{tests.length}</span>
                                )}
                                <ChevronRight className="w-3.5 h-3.5 text-slate-400 ml-1 shrink-0" />
                              </button>
                            );
                          });
                        })()}
                      </div>

                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </div>
      </main>

      <Sheet open={!!selectedTestDetail} onOpenChange={(open) => { if (!open) setSelectedTestDetail(null); }}>
        <SheetContent side="bottom" className="h-[70vh] flex flex-col rounded-t-2xl p-0" data-testid="sheet-test-detail">
          {selectedTestDetail && (() => {
            const { category, tests, reasoning } = selectedTestDetail;
            const style = categoryStyles[category];
            const IconComp = categoryIcons[category];
            const confidenceStyles: Record<string, string> = {
              high: "bg-emerald-100 text-emerald-700",
              medium: "bg-amber-100 text-amber-700",
              low: "bg-orange-100 text-orange-700",
            };
            return (
              <>
                <SheetHeader className={`px-6 py-4 border-b border-slate-100 ${style.bg} rounded-t-2xl shrink-0`}>
                  <div className="flex items-center justify-between">
                    <SheetTitle className="flex items-center gap-2">
                      <IconComp className={`w-5 h-5 ${style.icon}`} />
                      <span className={`font-semibold text-base ${style.accent}`}>{categoryLabels[category]}</span>
                    </SheetTitle>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSelectedTestDetail(null)} data-testid="button-close-sheet">
                      <X className="w-4 h-4 text-slate-400" />
                    </Button>
                  </div>
                </SheetHeader>

                <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
                  {tests.map((test) => {
                    const reason = reasoning[test];
                    const clinician = reason ? (typeof reason === "string" ? reason : reason.clinician_understanding) : null;
                    const talking = reason ? (typeof reason === "string" ? null : reason.patient_talking_points) : null;
                    const confidence = reason && typeof reason !== "string" ? reason.confidence : null;
                    const qualifyingFactors = reason && typeof reason !== "string" ? reason.qualifying_factors : null;
                    const approvalRequired = reason && typeof reason !== "string" && category === "ultrasound" ? reason.approvalRequired : false;

                    return (
                      <div key={test} className={`rounded-xl border ${style.border} ${style.bg} p-4`} data-testid={`sheet-test-${test}`}>
                        <div className="flex items-center gap-2 mb-3 flex-wrap">
                          <p className={`text-sm font-semibold ${style.accent}`}>{test}</p>
                          {confidence && !approvalRequired && (
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${confidenceStyles[confidence]}`} data-testid={`badge-confidence-${test}`}>
                              {confidence.toUpperCase()}
                            </span>
                          )}
                          {approvalRequired && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-800 border border-amber-300" data-testid={`badge-approval-required-${test}`}>
                              <AlertTriangle className="w-3 h-3" />
                              Requires Approval: Dr. Ali Imran / Dr. Ayman Alhadheri
                            </span>
                          )}
                        </div>

                        {qualifyingFactors && qualifyingFactors.length > 0 && (
                          <div className="flex items-center gap-1.5 flex-wrap mb-3" data-testid={`factors-${test}`}>
                            {qualifyingFactors.map((factor, idx) => (
                              <span key={idx} className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-50 text-blue-700 border border-blue-200/60">
                                {factor}
                              </span>
                            ))}
                          </div>
                        )}

                        {clinician && (
                          <div className="rounded-xl bg-white/80 backdrop-blur-sm p-3 mb-2 shadow-sm">
                            <div className="flex items-center gap-1.5 mb-1.5">
                              <GraduationCap className="w-3.5 h-3.5 text-slate-400" />
                              <span className="text-[10px] font-semibold text-slate-900 uppercase tracking-wider">Clinician Understanding</span>
                            </div>
                            <p className="text-[11px] leading-relaxed text-slate-900">{clinician}</p>
                          </div>
                        )}

                        {talking && (
                          <div className="rounded-xl bg-white/80 backdrop-blur-sm p-3 shadow-sm">
                            <div className="flex items-center gap-1.5 mb-1.5">
                              <MessageCircle className="w-3.5 h-3.5 text-slate-400" />
                              <span className="text-[10px] font-semibold text-slate-900 uppercase tracking-wider">Patient Talking Points</span>
                            </div>
                            <p className="text-[11px] leading-relaxed text-slate-900">{talking}</p>
                          </div>
                        )}

                        {!clinician && !talking && (
                          <p className="text-[11px] text-slate-900 italic">No detailed reasoning available.</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            );
          })()}
        </SheetContent>
      </Sheet>

      <PdfPatientSelectDialog
        open={pdfMode !== null}
        mode={pdfMode}
        patients={patients}
        onClose={() => setPdfMode(null)}
        onGenerate={handlePdfGenerate}
      />

      {inlineScreeningFormDoc && (
        <EditableScreeningFormModal
          note={{
            service: inlineScreeningFormDoc.doc.service,
            title: inlineScreeningFormDoc.doc.title,
            sections: inlineScreeningFormDoc.doc.sections,
            patientId: inlineScreeningFormDoc.patient.id,
            batchId: batch?.id ?? 0,
            facility: batch?.facility ?? null,
            scheduleDate: batch?.scheduleDate ?? null,
            patientName: inlineScreeningFormDoc.patient.name,
            clinicianName: batch?.clinicianName ?? null,
          }}
          onClose={() => setInlineScreeningFormDoc(null)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ["/api/generated-notes/batch", batch?.id] });
          }}
        />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "draft":
      return <Badge variant="outline" className="text-xs gap-1 no-default-hover-elevate no-default-active-elevate"><FileText className="w-3 h-3" /> Draft</Badge>;
    case "processing":
      return <Badge variant="outline" className="text-xs gap-1 no-default-hover-elevate no-default-active-elevate"><Loader2 className="w-3 h-3 animate-spin" /> Processing</Badge>;
    case "completed":
      return <Badge variant="outline" className="text-xs gap-1 no-default-hover-elevate no-default-active-elevate"><Check className="w-3 h-3 text-emerald-500" /> Complete</Badge>;
    default:
      return <Badge variant="outline" className="text-xs no-default-hover-elevate no-default-active-elevate">{status}</Badge>;
  }
}

type QualMode = "permissive" | "standard" | "conservative";

const QUAL_MODE_LABELS: Record<QualMode, string> = {
  permissive: "Permissive",
  standard: "Standard",
  conservative: "Conservative",
};

const QUAL_MODE_DESCRIPTIONS: Record<QualMode, string> = {
  permissive: "Any indirect link qualifies. Maximizes test qualification.",
  standard: "Direct clinical connection required between diagnosis and test.",
  conservative: "Multi-factor evidence required. More tests flagged for approval.",
};

function QualificationModeSettings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: modes, isLoading } = useQuery<Record<string, string>>({
    queryKey: ["/api/settings/qualification-modes"],
  });

  const [pendingModes, setPendingModes] = useState<Record<string, QualMode>>({});

  const saveMutation = useMutation({
    mutationFn: async ({ facility, mode }: { facility: string; mode: QualMode }) => {
      const res = await apiRequest("POST", "/api/settings/qualification-modes", { facility, mode });
      return res.json();
    },
    onSuccess: (_, { facility, mode }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/qualification-modes"] });
      setPendingModes((prev) => {
        const next = { ...prev };
        delete next[facility];
        return next;
      });
      toast({ title: "Saved", description: `${facility}: ${QUAL_MODE_LABELS[mode]}` });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to save", description: err.message, variant: "destructive" });
    },
  });

  function getMode(facility: string): QualMode {
    if (pendingModes[facility]) return pendingModes[facility];
    const val = modes?.[facility];
    if (val === "standard" || val === "conservative") return val;
    return "permissive";
  }

  return (
    <div className="mt-12" data-testid="section-qualification-modes">
      <h3 className="text-sm font-semibold text-slate-500 dark:text-muted-foreground uppercase tracking-wider mb-4">
        Qualification Mode
      </h3>
      <div className="space-y-3">
        {FACILITIES.map((facility) => {
          const currentMode = getMode(facility);
          const savedMode: QualMode = (() => {
            const val = modes?.[facility];
            if (val === "standard" || val === "conservative") return val;
            return "permissive";
          })();
          const isDirty = pendingModes[facility] !== undefined && pendingModes[facility] !== savedMode;

          return (
            <Card key={facility} className="p-4" data-testid={`card-qual-mode-${facility.replace(/\s+/g, "-")}`}>
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-800 dark:text-foreground" data-testid={`text-facility-${facility.replace(/\s+/g, "-")}`}>{facility}</div>
                  <div className="text-xs text-muted-foreground mt-0.5" data-testid={`text-mode-desc-${facility.replace(/\s+/g, "-")}`}>
                    {QUAL_MODE_DESCRIPTIONS[currentMode]}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {isLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  ) : (
                    <Select
                      value={currentMode}
                      onValueChange={(val) => {
                        if (val === "permissive" || val === "standard" || val === "conservative") {
                          setPendingModes((prev) => ({ ...prev, [facility]: val }));
                        }
                      }}
                    >
                      <SelectTrigger className="w-40 h-8 text-xs" data-testid={`select-qual-mode-${facility.replace(/\s+/g, "-")}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="permissive" data-testid="option-permissive">Permissive</SelectItem>
                        <SelectItem value="standard" data-testid="option-standard">Standard</SelectItem>
                        <SelectItem value="conservative" data-testid="option-conservative">Conservative</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                  <Button
                    size="sm"
                    variant={isDirty ? "default" : "outline"}
                    className="h-8 text-xs"
                    disabled={saveMutation.isPending || !isDirty}
                    onClick={() => saveMutation.mutate({ facility, mode: currentMode })}
                    data-testid={`button-save-qual-mode-${facility.replace(/\s+/g, "-")}`}
                  >
                    {saveMutation.isPending && saveMutation.variables?.facility === facility ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      "Save"
                    )}
                  </Button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
