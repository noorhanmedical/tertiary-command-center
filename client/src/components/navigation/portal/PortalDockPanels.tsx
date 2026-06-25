import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Loader2,
  Mic,
  Plane,
  Plus,
  Search,
  Send,
  Sparkles,
  Stethoscope,
  Trash2,
  User,
  Users,
  XCircle,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// ── Chat AI panel ────────────────────────────────────────────────────────────

type ChatMessage = { role: "user" | "assistant"; content: string };

export function PortalChatPanel({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [listening, setListening] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const draftBeforeSpeechRef = useRef("");

  const speechSupported =
    typeof window !== "undefined" &&
    (("SpeechRecognition" in window) || ("webkitSpeechRecognition" in window));

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, pending]);

  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.stop();
      } catch {
        // ignore
      }
    };
  }, []);

  // Stop listening if the panel is closed.
  useEffect(() => {
    if (!open && recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
    }
  }, [open]);

  function toggleListening() {
    if (listening) {
      try {
        recognitionRef.current?.stop();
      } catch {
        // ignore
      }
      return;
    }

    const SpeechRecognitionImpl =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionImpl) {
      toast({
        title: "Voice input unavailable",
        description: "Your browser doesn't support speech recognition. Try Chrome or Edge.",
        variant: "destructive",
      });
      return;
    }

    const recognition = new SpeechRecognitionImpl();
    recognition.lang = navigator.language || "en-US";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognitionRef.current = recognition;
    draftBeforeSpeechRef.current = draft ? draft.replace(/\s*$/, "") + " " : "";

    recognition.onstart = () => setListening(true);

    recognition.onresult = (event: any) => {
      let transcript = "";
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      setDraft(draftBeforeSpeechRef.current + transcript);
    };

    recognition.onerror = (event: any) => {
      setListening(false);
      recognitionRef.current = null;
      if (event?.error === "not-allowed" || event?.error === "service-not-allowed") {
        toast({
          title: "Microphone blocked",
          description: "Allow microphone access in your browser to use voice input.",
          variant: "destructive",
        });
      } else if (event?.error && event.error !== "aborted" && event.error !== "no-speech") {
        toast({
          title: "Voice input error",
          description: "Speech recognition stopped unexpectedly. Please try again.",
          variant: "destructive",
        });
      }
    };

    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };

    try {
      recognition.start();
    } catch {
      setListening(false);
      recognitionRef.current = null;
    }
  }

  async function send() {
    const text = draft.trim();
    if (!text || pending) return;
    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setDraft("");
    setPending(true);
    try {
      const res = await apiRequest("POST", "/api/portal/chat", { messages: next });
      const data = (await res.json()) as { reply: string };
      setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
    } catch (err) {
      toast({
        title: "Chat failed",
        description: err instanceof Error ? err.message : "Could not reach the assistant",
        variant: "destructive",
      });
      setMessages((prev) => prev.slice(0, -1));
      setDraft(text);
    } finally {
      setPending(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md flex flex-col overflow-hidden p-0">
        <SheetHeader className="shrink-0 px-6 pt-6 pb-3 border-b">
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-purple-500" />
            Plexus Assistant
          </SheetTitle>
          <SheetDescription>
            Ask about tests, qualification criteria, cooldowns, or workflow.
          </SheetDescription>
        </SheetHeader>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4 space-y-3" data-testid="portal-chat-thread">
          {messages.length === 0 && (
            <div className="text-sm text-slate-500 space-y-2">
              <p>Hi! I can help with questions like:</p>
              <ul className="list-disc pl-5 space-y-1 text-slate-400">
                <li>What does BrainWave screen for?</li>
                <li>Would a diabetic with leg pain qualify for VitalWave?</li>
                <li>What's the cooldown for a Medicare patient?</li>
              </ul>
            </div>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              data-testid={`portal-chat-message-${m.role}-${i}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap ${
                  m.role === "user"
                    ? "bg-slate-900 text-white rounded-br-sm"
                    : "bg-slate-100 text-slate-800 rounded-bl-sm"
                }`}
              >
                {m.content}
              </div>
            </div>
          ))}
          {pending && (
            <div className="flex justify-start">
              <div className="rounded-2xl rounded-bl-sm bg-slate-100 px-3.5 py-2 text-sm text-slate-500 inline-flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Thinking…
              </div>
            </div>
          )}
        </div>

        <div className="shrink-0 border-t px-4 py-3 flex items-end gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                disabled={!speechSupported || pending}
                onClick={toggleListening}
                className={`shrink-0 ${
                  listening
                    ? "text-red-500 bg-red-50 hover:bg-red-100 hover:text-red-600 animate-pulse"
                    : "text-slate-400"
                }`}
                data-testid="button-portal-chat-mic"
                aria-label={listening ? "Stop voice input" : "Start voice input"}
                aria-pressed={listening}
              >
                <Mic className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {speechSupported
                ? listening
                  ? "Listening… tap to stop"
                  : "Speak your question"
                : "Voice input not supported in this browser"}
            </TooltipContent>
          </Tooltip>
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Ask a question…"
            rows={1}
            className="min-h-[40px] max-h-32 resize-none"
            data-testid="input-portal-chat"
          />
          <Button
            type="button"
            size="icon"
            onClick={send}
            disabled={pending || !draft.trim()}
            className="shrink-0"
            data-testid="button-portal-chat-send"
            aria-label="Send"
          >
            {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── Patient Search panel ─────────────────────────────────────────────────────

type DirectoryPatient = {
  encodedKey: string;
  name: string;
  dob: string | null;
  representativeScreeningId: number;
};

type DirectoryGroup = { clinic: string; patients: DirectoryPatient[] };

type DirectoryResponse = { groups: DirectoryGroup[] };

export function PortalPatientSearchPanel({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isFetching } = useQuery<DirectoryResponse>({
    queryKey: ["/api/patients/database", { search: debounced }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (debounced) params.set("search", debounced);
      params.set("pageSize", "30");
      const res = await fetch(`/api/patients/database?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Search failed (${res.status})`);
      return res.json();
    },
    enabled: open && debounced.length > 0,
    staleTime: 10_000,
  });

  const rows = (data?.groups ?? []).flatMap((g) =>
    g.patients.map((p) => ({ ...p, clinic: g.clinic })),
  );

  function openPatient(p: DirectoryPatient) {
    navigate(`/patient-directory?patientId=${p.representativeScreeningId}`);
    onOpenChange(false);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md flex flex-col overflow-hidden p-0">
        <SheetHeader className="shrink-0 px-6 pt-6 pb-3 border-b">
          <SheetTitle className="flex items-center gap-2">
            <Search className="w-4 h-4 text-sky-500" />
            Patient Search
          </SheetTitle>
          <SheetDescription>Find a patient and open their full profile.</SheetDescription>
        </SheetHeader>

        <div className="shrink-0 px-6 py-3 border-b">
          <div className="flex items-center gap-2">
            <Search className="w-4 h-4 text-muted-foreground shrink-0" />
            <Input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or DOB…"
              className="h-9 text-sm"
              data-testid="input-portal-patient-search"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3" data-testid="portal-patient-search-results">
          {debounced.length === 0 ? (
            <p className="text-sm text-slate-400 px-2 py-3">Start typing to search patients.</p>
          ) : isFetching && rows.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-slate-500 px-2 py-3">
              <Loader2 className="w-4 h-4 animate-spin" /> Searching…
            </div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-slate-400 px-2 py-3">No patients found.</p>
          ) : (
            <ul className="space-y-1">
              {rows.map((p) => (
                <li key={p.encodedKey}>
                  <button
                    type="button"
                    onClick={() => openPatient(p)}
                    className="w-full text-left rounded-lg px-3 py-2 hover:bg-slate-100 transition-colors flex items-center gap-3"
                    data-testid={`button-portal-patient-${p.encodedKey}`}
                  >
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 shrink-0">
                      <User className="w-4 h-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-slate-900 truncate">{p.name}</span>
                      <span className="block text-[11px] text-slate-500 truncate">
                        {p.dob ? `DOB ${p.dob}` : "DOB —"} · {p.clinic}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── Mini Plexus IQ quick-qualify panel ───────────────────────────────────────

type TestReasoning = {
  clinician_understanding?: string;
  patient_talking_points?: string;
  confidence?: string;
  approvalRequired?: boolean;
};

type QuickQualifyResult = {
  name: string;
  age: number | null;
  gender: string | null;
  qualifyingTests: string[];
  reasoning: Record<string, TestReasoning>;
};

export function PortalPlexusIQPanel({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    name: "",
    dob: "",
    insurance: "PPO",
    diagnoses: "",
    history: "",
    medications: "",
    previousTests: "",
    noPreviousTests: false,
  });
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<QuickQualifyResult | null>(null);

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function qualify() {
    if (!form.name.trim() || pending) return;
    setPending(true);
    setResult(null);
    try {
      const res = await apiRequest("POST", "/api/portal/quick-qualify", {
        name: form.name.trim(),
        dob: form.dob.trim() || undefined,
        insurance: form.insurance,
        diagnoses: form.diagnoses.trim() || undefined,
        history: form.history.trim() || undefined,
        medications: form.medications.trim() || undefined,
        noPreviousTests: form.noPreviousTests,
        previousTests: form.noPreviousTests ? undefined : form.previousTests.trim() || undefined,
      });
      const data = (await res.json()) as QuickQualifyResult;
      setResult(data);
    } catch (err) {
      toast({
        title: "Qualification failed",
        description: err instanceof Error ? err.message : "Could not run qualification",
        variant: "destructive",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg flex flex-col overflow-hidden p-0">
        <SheetHeader className="shrink-0 px-6 pt-6 pb-3 border-b">
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-purple-500" />
            Plexus IQ — Quick Qualify
          </SheetTitle>
          <SheetDescription>
            One-off single-patient qualification. Nothing is saved to a schedule.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="qq-name">Name</Label>
              <Input
                id="qq-name"
                value={form.name}
                onChange={(e) => update("name", e.target.value)}
                placeholder="Jane Doe"
                data-testid="input-portal-qq-name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qq-dob">DOB</Label>
              <Input
                id="qq-dob"
                type="date"
                value={form.dob}
                onChange={(e) => update("dob", e.target.value)}
                data-testid="input-portal-qq-dob"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="qq-insurance">Insurance</Label>
            <Select value={form.insurance} onValueChange={(v) => update("insurance", v)}>
              <SelectTrigger id="qq-insurance" data-testid="select-portal-qq-insurance">
                <SelectValue placeholder="Select insurance" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PPO">PPO</SelectItem>
                <SelectItem value="Medicare">Medicare</SelectItem>
                <SelectItem value="Other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="qq-dx">Diagnosis (Dx)</Label>
            <Textarea
              id="qq-dx"
              value={form.diagnoses}
              onChange={(e) => update("diagnoses", e.target.value)}
              rows={2}
              placeholder="e.g. Hypertension, Type 2 Diabetes"
              data-testid="input-portal-qq-dx"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="qq-hx">History (Hx)</Label>
            <Textarea
              id="qq-hx"
              value={form.history}
              onChange={(e) => update("history", e.target.value)}
              rows={2}
              placeholder="e.g. Smoker, leg pain on exertion"
              data-testid="input-portal-qq-hx"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="qq-rx">Medications (Rx)</Label>
            <Textarea
              id="qq-rx"
              value={form.medications}
              onChange={(e) => update("medications", e.target.value)}
              rows={2}
              placeholder="e.g. Metformin, Amlodipine, Atorvastatin"
              data-testid="input-portal-qq-rx"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="qq-prev">Previous Tests</Label>
              <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer">
                <Checkbox
                  checked={form.noPreviousTests}
                  onCheckedChange={(v) => update("noPreviousTests", v === true)}
                  data-testid="checkbox-portal-qq-no-prev"
                />
                No previous tests
              </label>
            </div>
            <Textarea
              id="qq-prev"
              value={form.previousTests}
              onChange={(e) => update("previousTests", e.target.value)}
              rows={2}
              disabled={form.noPreviousTests}
              placeholder="e.g. Carotid Duplex 2025-01-12"
              data-testid="input-portal-qq-prev"
            />
          </div>

          <Button
            type="button"
            onClick={qualify}
            disabled={pending || !form.name.trim()}
            className="w-full"
            data-testid="button-portal-qq-qualify"
          >
            {pending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Qualifying…
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-2" /> Qualify
              </>
            )}
          </Button>

          {result && (
            <div className="pt-2 space-y-3 border-t" data-testid="portal-qq-results">
              <div className="pt-3">
                <h3 className="text-sm font-semibold text-slate-900">
                  {result.qualifyingTests.length > 0
                    ? `${result.qualifyingTests.length} qualifying ${result.qualifyingTests.length === 1 ? "test" : "tests"}`
                    : "No qualifying tests"}
                </h3>
                {result.qualifyingTests.length === 0 && (
                  <p className="text-xs text-slate-500 mt-1">
                    This patient did not qualify for any ancillary tests based on the information provided.
                  </p>
                )}
              </div>

              {result.qualifyingTests.map((test) => {
                const r = result.reasoning?.[test] ?? {};
                return (
                  <div
                    key={test}
                    className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-3"
                    data-testid={`portal-qq-test-${test}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-slate-900">{test}</span>
                      {r.approvalRequired && (
                        <span className="text-[10px] font-medium text-amber-700 bg-amber-50 rounded-full px-2 py-0.5">
                          Approval required
                        </span>
                      )}
                    </div>
                    {r.clinician_understanding && (
                      <div>
                        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-indigo-700">
                          <Stethoscope className="w-3.5 h-3.5" /> Clinician Understanding
                        </p>
                        <p className="text-sm text-slate-700 mt-1 leading-relaxed">
                          {r.clinician_understanding}
                        </p>
                      </div>
                    )}
                    {r.patient_talking_points && (
                      <div>
                        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                          <User className="w-3.5 h-3.5" /> Patient Talking Points
                        </p>
                        <p className="text-sm text-slate-700 mt-1 leading-relaxed">
                          {r.patient_talking_points}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── My Team Ops panel ─────────────────────────────────────────────────────────
// A team-member-private operations panel: request PTO, see today's coverage,
// and view a staffing calendar. Privacy: a member only ever sees their OWN PTO
// requests (and notes). For the rest of the team, only on/off availability and
// the coverage roster are visible — never other people's notes/reasons.

type PtoRow = {
  id: number;
  userId: string;
  startDate: string;
  endDate: string;
  note: string | null;
  status: "pending" | "approved" | "denied";
  userName?: string | null;
};

type SchedulerRow = {
  id: number;
  name: string;
  facility: string;
  capacityPercent: number;
  facilitiesCovered?: string[];
};

const PTO_STATUS_STYLES: Record<string, string> = {
  approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  denied: "bg-rose-50 text-rose-700 border-rose-200",
};

function isoToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function ptoCoversDate(p: PtoRow, dateKey: string): boolean {
  return p.startDate <= dateKey && p.endDate >= dateKey;
}

function formatRange(start: string, end: string): string {
  if (start === end) return start;
  return `${start} → ${end}`;
}

function addMonthKey(monthKey: string, delta: number): string {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString(undefined, {
    month: "long",
    year: "numeric",
  });
}

export function PortalTeamOpsPanel({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();

  const { data: myPto = [], isLoading: myLoading } = useQuery<PtoRow[]>({
    queryKey: ["/api/pto-requests", "scope=mine"],
    queryFn: async () => {
      const res = await fetch("/api/pto-requests?scope=mine", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load your PTO (${res.status})`);
      return res.json();
    },
    enabled: open,
    staleTime: 15_000,
  });

  const { data: teamPto = [] } = useQuery<PtoRow[]>({
    queryKey: ["/api/pto-requests", "scope=approved-team"],
    queryFn: async () => {
      const res = await fetch("/api/pto-requests?scope=approved-team", {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Failed to load team availability (${res.status})`);
      return res.json();
    },
    enabled: open,
    staleTime: 15_000,
  });

  const { data: schedulers = [] } = useQuery<SchedulerRow[]>({
    queryKey: ["/api/outreach/schedulers"],
    queryFn: async () => {
      const res = await fetch("/api/outreach/schedulers", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load coverage (${res.status})`);
      return res.json();
    },
    enabled: open,
    staleTime: 30_000,
  });

  // ── PTO request form ────────────────────────────────────────────────────
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submitPto() {
    if (!startDate || !endDate || submitting) return;
    if (endDate < startDate) {
      toast({
        title: "Invalid dates",
        description: "The end date must be on or after the start date.",
        variant: "destructive",
      });
      return;
    }
    setSubmitting(true);
    try {
      await apiRequest("POST", "/api/pto-requests", {
        startDate,
        endDate,
        note: note.trim() || undefined,
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/pto-requests"] });
      setStartDate("");
      setEndDate("");
      setNote("");
      toast({ title: "Request submitted", description: "Your PTO request is pending approval." });
    } catch (err) {
      toast({
        title: "Could not submit",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function withdrawPto(id: number) {
    try {
      await apiRequest("DELETE", `/api/pto-requests/${id}`);
      await queryClient.invalidateQueries({ queryKey: ["/api/pto-requests"] });
      toast({ title: "Request withdrawn" });
    } catch (err) {
      toast({
        title: "Could not withdraw",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  }

  // ── Coverage / who's off ────────────────────────────────────────────────
  const [coverageDate, setCoverageDate] = useState(isoToday());

  const offOnCoverageDate = useMemo(
    () =>
      teamPto
        .filter((p) => p.status === "approved" && ptoCoversDate(p, coverageDate))
        .map((p) => p.userName || "Team member"),
    [teamPto, coverageDate],
  );

  // ── Calendar ────────────────────────────────────────────────────────────
  const [monthKey, setMonthKey] = useState(isoToday().slice(0, 7));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const calendarCells = useMemo(() => {
    const [y, m] = monthKey.split("-").map(Number);
    const firstWeekday = new Date(y, m - 1, 1).getDay();
    const daysInMonth = new Date(y, m, 0).getDate();
    const cells: (string | null)[] = [];
    for (let i = 0; i < firstWeekday; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push(`${monthKey}-${String(d).padStart(2, "0")}`);
    }
    return cells;
  }, [monthKey]);

  const selectedDayOff = useMemo(() => {
    if (!selectedDay) return [];
    return teamPto
      .filter((p) => p.status === "approved" && ptoCoversDate(p, selectedDay))
      .map((p) => p.userName || "Team member");
  }, [teamPto, selectedDay]);

  const today = isoToday();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md flex flex-col overflow-hidden p-0">
        <SheetHeader className="shrink-0 px-6 pt-6 pb-3 border-b">
          <SheetTitle className="flex items-center gap-2">
            <CalendarClock className="w-4 h-4 text-sky-500" />
            My Team Ops
          </SheetTitle>
          <SheetDescription>
            Request time off, check coverage, and view the staffing calendar.
          </SheetDescription>
        </SheetHeader>

        <Tabs defaultValue="pto" className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="mx-6 mt-3 grid grid-cols-3 shrink-0">
            <TabsTrigger value="pto" data-testid="tab-team-ops-pto">
              Time Off
            </TabsTrigger>
            <TabsTrigger value="coverage" data-testid="tab-team-ops-coverage">
              Coverage
            </TabsTrigger>
            <TabsTrigger value="calendar" data-testid="tab-team-ops-calendar">
              Calendar
            </TabsTrigger>
          </TabsList>

          {/* ── Time Off tab ── */}
          <TabsContent value="pto" className="flex-1 overflow-y-auto px-6 py-4 space-y-5 mt-0">
            <div className="rounded-xl border border-slate-200 p-4 space-y-3">
              <p className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
                <Plane className="w-4 h-4 text-sky-500" /> Request time off
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="pto-start">Start</Label>
                  <Input
                    id="pto-start"
                    type="date"
                    value={startDate}
                    min={today}
                    onChange={(e) => setStartDate(e.target.value)}
                    data-testid="input-team-ops-pto-start"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pto-end">End</Label>
                  <Input
                    id="pto-end"
                    type="date"
                    value={endDate}
                    min={startDate || today}
                    onChange={(e) => setEndDate(e.target.value)}
                    data-testid="input-team-ops-pto-end"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pto-note">Note (optional)</Label>
                <Textarea
                  id="pto-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  placeholder="e.g. Family trip"
                  data-testid="input-team-ops-pto-note"
                />
              </div>
              <Button
                type="button"
                onClick={submitPto}
                disabled={submitting || !startDate || !endDate}
                className="w-full"
                data-testid="button-team-ops-pto-submit"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Submitting…
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4 mr-2" /> Submit request
                  </>
                )}
              </Button>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                My requests
              </p>
              {myLoading ? (
                <div className="flex items-center gap-2 text-sm text-slate-500 py-3">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading…
                </div>
              ) : myPto.length === 0 ? (
                <p className="text-sm text-slate-400 py-3">You have no PTO requests yet.</p>
              ) : (
                <ul className="space-y-2" data-testid="list-team-ops-my-pto">
                  {[...myPto]
                    .sort((a, b) => b.startDate.localeCompare(a.startDate))
                    .map((p) => (
                      <li
                        key={p.id}
                        className="rounded-lg border border-slate-200 p-3"
                        data-testid={`row-team-ops-pto-${p.id}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium text-slate-900">
                            {formatRange(p.startDate, p.endDate)}
                          </span>
                          <span
                            className={`inline-flex items-center gap-1 text-[11px] font-medium rounded-full border px-2 py-0.5 ${
                              PTO_STATUS_STYLES[p.status] ?? ""
                            }`}
                          >
                            {p.status === "approved" ? (
                              <CheckCircle2 className="w-3 h-3" />
                            ) : p.status === "denied" ? (
                              <XCircle className="w-3 h-3" />
                            ) : (
                              <Clock className="w-3 h-3" />
                            )}
                            {p.status}
                          </span>
                        </div>
                        {p.note && (
                          <p className="text-xs text-slate-500 mt-1.5">{p.note}</p>
                        )}
                        {p.status === "pending" && (
                          <button
                            type="button"
                            onClick={() => withdrawPto(p.id)}
                            className="mt-2 inline-flex items-center gap-1 text-xs text-rose-600 hover:text-rose-700"
                            data-testid={`button-team-ops-withdraw-${p.id}`}
                          >
                            <Trash2 className="w-3 h-3" /> Withdraw
                          </button>
                        )}
                      </li>
                    ))}
                </ul>
              )}
            </div>
          </TabsContent>

          {/* ── Coverage tab ── */}
          <TabsContent value="coverage" className="flex-1 overflow-y-auto px-6 py-4 space-y-5 mt-0">
            <div className="space-y-1.5">
              <Label htmlFor="coverage-date">Availability on</Label>
              <Input
                id="coverage-date"
                type="date"
                value={coverageDate}
                onChange={(e) => setCoverageDate(e.target.value)}
                data-testid="input-team-ops-coverage-date"
              />
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Off this day
              </p>
              {offOnCoverageDate.length === 0 ? (
                <p className="text-sm text-emerald-600 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" /> Everyone is available.
                </p>
              ) : (
                <ul className="space-y-1.5" data-testid="list-team-ops-off">
                  {offOnCoverageDate.map((name, i) => (
                    <li
                      key={`${name}-${i}`}
                      className="flex items-center gap-2 text-sm text-slate-700"
                    >
                      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-amber-50 text-amber-600 shrink-0">
                        <Plane className="w-3.5 h-3.5" />
                      </span>
                      {name}
                      <span className="text-[11px] text-amber-600 font-medium">PTO</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" /> Team coverage
              </p>
              {schedulers.length === 0 ? (
                <p className="text-sm text-slate-400">No coverage configured.</p>
              ) : (
                <ul className="space-y-1.5" data-testid="list-team-ops-coverage">
                  {schedulers.map((s) => {
                    const facilities =
                      s.facilitiesCovered && s.facilitiesCovered.length > 0
                        ? s.facilitiesCovered
                        : [s.facility];
                    return (
                      <li
                        key={s.id}
                        className="rounded-lg border border-slate-200 p-2.5"
                        data-testid={`row-team-ops-coverage-${s.id}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium text-slate-900">{s.name}</span>
                          <span className="text-[11px] text-slate-500">{s.capacityPercent}%</span>
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5 truncate">
                          {facilities.filter(Boolean).join(", ") || "—"}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </TabsContent>

          {/* ── Calendar tab ── */}
          <TabsContent value="calendar" className="flex-1 overflow-y-auto px-6 py-4 space-y-4 mt-0">
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  setMonthKey((k) => addMonthKey(k, -1));
                  setSelectedDay(null);
                }}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg hover:bg-slate-100"
                aria-label="Previous month"
                data-testid="button-team-ops-cal-prev"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm font-semibold text-slate-900" data-testid="text-team-ops-cal-month">
                {monthLabel(monthKey)}
              </span>
              <button
                type="button"
                onClick={() => {
                  setMonthKey((k) => addMonthKey(k, 1));
                  setSelectedDay(null);
                }}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg hover:bg-slate-100"
                aria-label="Next month"
                data-testid="button-team-ops-cal-next"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-7 gap-1 text-center">
              {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                <span key={i} className="text-[10px] font-medium text-slate-400 py-1">
                  {d}
                </span>
              ))}
              {calendarCells.map((cell, i) => {
                if (!cell) return <span key={`empty-${i}`} />;
                const mine = myPto.find((p) => ptoCoversDate(p, cell));
                const teamOff = teamPto.filter(
                  (p) => p.status === "approved" && ptoCoversDate(p, cell),
                ).length;
                const dayNum = Number(cell.slice(-2));
                const isToday = cell === today;
                const isSelected = cell === selectedDay;
                const mineClass =
                  mine?.status === "approved"
                    ? "bg-emerald-500 text-white"
                    : mine?.status === "pending"
                      ? "bg-amber-100 text-amber-800 border border-amber-300"
                      : "";
                return (
                  <button
                    key={cell}
                    type="button"
                    onClick={() => setSelectedDay(cell)}
                    className={`relative aspect-square rounded-lg text-xs flex flex-col items-center justify-center transition-colors ${
                      mineClass || "hover:bg-slate-100"
                    } ${isSelected ? "ring-2 ring-sky-400" : ""} ${
                      isToday && !mineClass ? "border border-sky-300" : ""
                    }`}
                    data-testid={`button-team-ops-cal-day-${cell}`}
                  >
                    <span>{dayNum}</span>
                    {teamOff > 0 && (
                      <span
                        className={`absolute bottom-1 inline-block h-1 w-1 rounded-full ${
                          mineClass ? "bg-white/80" : "bg-amber-400"
                        }`}
                      />
                    )}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-3 text-[11px] text-slate-500">
              <span className="flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded bg-emerald-500" /> My PTO
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded border border-amber-300 bg-amber-100" />{" "}
                Pending
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400" /> Team off
              </span>
            </div>

            {selectedDay && (
              <div className="rounded-xl border border-slate-200 p-3" data-testid="team-ops-cal-detail">
                <p className="text-sm font-semibold text-slate-900">{selectedDay}</p>
                {selectedDayOff.length === 0 ? (
                  <p className="text-sm text-emerald-600 mt-1 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4" /> Everyone is available.
                  </p>
                ) : (
                  <ul className="mt-1.5 space-y-1">
                    {selectedDayOff.map((name, i) => (
                      <li key={`${name}-${i}`} className="text-sm text-slate-700 flex items-center gap-2">
                        <Plane className="w-3.5 h-3.5 text-amber-500" /> {name}
                        <span className="text-[11px] text-amber-600 font-medium">PTO</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
