import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Loader2,
  Mic,
  Search,
  Send,
  Sparkles,
  Stethoscope,
  User,
} from "lucide-react";
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
import { apiRequest } from "@/lib/queryClient";
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
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, pending]);

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
                disabled
                className="shrink-0 text-slate-400"
                data-testid="button-portal-chat-mic"
                aria-label="Voice input (coming soon)"
              >
                <Mic className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Coming soon</TooltipContent>
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
