// Temporary design-prototype route — mock data only, not production.
// Visual mockup of the redesigned Admin Review (Plexus IQ) as a clean
// TWO-PANEL layout: LEFT = ancillaries, RIGHT = action. No bottom panel.
// Used to preview the new direction on the canvas before redesigning the
// real client/src/components/qualification/AdminReviewDialog.tsx.
import { useState } from "react";
import {
  Brain,
  HeartPulse,
  Waves,
  X,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  RotateCcw,
  Trash2,
  Check,
  CheckCircle2,
  CircleAlert,
  Stethoscope,
  Pill,
  Activity,
  Lightbulb,
  FileText,
  FileSignature,
  CalendarClock,
  UserRound,
  ShieldAlert,
  Sparkles,
  StickyNote,
  ChevronRight as Caret,
} from "lucide-react";

const NAVY = "#173358";
const NAVY_700 = "#172663";
const BORDER = "#E6E8EF";
const MUTED = "#8A90A0";

type Tone = "purple" | "red" | "green";

const TONE: Record<Tone, { dot: string; soft: string; ring: string; text: string; bar: string }> = {
  purple: { dot: "#7c3aed", soft: "#F4F0FE", ring: "#E6DCFB", text: "#5b21b6", bar: "#8b5cf6" },
  red: { dot: "#dc2626", soft: "#FDECEC", ring: "#F7D2D2", text: "#991b1b", bar: "#ef4444" },
  green: { dot: "#059669", soft: "#EAF7EF", ring: "#CDEBD9", text: "#065f46", bar: "#10b981" },
};

function Chip({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | Tone }) {
  if (tone === "neutral") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium text-[#4F5563]" style={{ borderColor: BORDER, background: "#F7F8FB" }}>
        {children}
      </span>
    );
  }
  const t = TONE[tone];
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: t.soft, color: t.text, border: `1px solid ${t.ring}` }}>
      {children}
    </span>
  );
}

function StatusBadge({ ok }: { ok: boolean }) {
  return ok ? (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: "#EAF7EF", color: "#065f46", border: "1px solid #CDEBD9" }}>
      <Check className="h-3 w-3" /> Qualified
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold text-[#8A90A0]" style={{ background: "#F3F5F9", border: `1px solid ${BORDER}` }}>
      Not qualified
    </span>
  );
}

function AncillaryCard({
  icon: Icon,
  tone,
  title,
  cpt,
  qualified,
  clinician,
  patient,
  evidence,
  defaultOpen = false,
}: {
  icon: any;
  tone: Tone;
  title: string;
  cpt: string;
  qualified: boolean;
  clinician: string;
  patient: string;
  evidence: string[];
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const t = TONE[tone];
  return (
    <div className="overflow-hidden rounded-xl bg-white" style={{ border: `1px solid ${BORDER}`, boxShadow: "0 1px 2px rgba(16,24,40,.04)" }}>
      <div className="flex items-center gap-3 px-4 py-3" style={{ borderLeft: `3px solid ${t.bar}` }}>
        <div className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: t.soft, color: t.dot }}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[15px] font-semibold text-[#111114]">{title}</span>
            <span className="text-[11px] font-medium" style={{ color: MUTED }}>{cpt}</span>
          </div>
        </div>
        <StatusBadge ok={qualified} />
        <div className="flex items-center gap-1">
          <button className="flex h-7 w-7 items-center justify-center rounded-md text-[#8A90A0] hover:bg-[#F3F5F9]" title="Regenerate"><RefreshCw className="h-3.5 w-3.5" /></button>
          <button className="flex h-7 w-7 items-center justify-center rounded-md text-[#8A90A0] hover:bg-[#F3F5F9]" title="Clear"><Trash2 className="h-3.5 w-3.5" /></button>
          <button onClick={() => setOpen((v) => !v)} className="flex h-7 w-7 items-center justify-center rounded-md text-[#8A90A0] hover:bg-[#F3F5F9]">
            <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>
      {evidence.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-4 pb-3">
          {evidence.map((e) => (
            <Chip key={e} tone={tone}>{e}</Chip>
          ))}
        </div>
      )}
      {open && (
        <div className="space-y-3 border-t px-4 py-3" style={{ borderColor: BORDER, background: "#FBFBFD" }}>
          <div>
            <div className="mb-1 text-[11px] font-bold uppercase tracking-wide" style={{ color: t.text }}>Clinician Understanding</div>
            <p className="text-[13px] leading-relaxed text-[#4F5563]">{clinician}</p>
          </div>
          <div>
            <div className="mb-1 text-[11px] font-bold uppercase tracking-wide" style={{ color: t.text }}>Patient Talking Points</div>
            <p className="text-[13px] leading-relaxed text-[#4F5563]">{patient}</p>
          </div>
          <textarea
            placeholder="Add a note for this ancillary…"
            className="h-16 w-full resize-none rounded-lg border bg-white px-3 py-2 text-[13px] outline-none focus:ring-2"
            style={{ borderColor: BORDER }}
          />
        </div>
      )}
    </div>
  );
}

function UltrasoundGroup() {
  const t = TONE.green;
  const tests = [
    { name: "Bilateral Carotid Duplex", cpt: "93880", on: true },
    { name: "Echocardiogram TTE", cpt: "93306", on: true },
    { name: "Renal Artery Doppler", cpt: "93975", on: true },
    { name: "Lower Extremity Arterial Doppler", cpt: "93925", on: false },
    { name: "Abdominal Aortic Aneurysm Duplex", cpt: "93978", on: true },
    { name: "Lower Extremity Venous Duplex", cpt: "93971", on: false },
  ];
  return (
    <div className="overflow-hidden rounded-xl bg-white" style={{ border: `1px solid ${BORDER}`, boxShadow: "0 1px 2px rgba(16,24,40,.04)" }}>
      <div className="flex items-center gap-3 px-4 py-3" style={{ borderLeft: `3px solid ${t.bar}` }}>
        <div className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: t.soft, color: t.dot }}>
          <Waves className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold text-[#111114]">Ultrasounds</div>
          <div className="text-[11px]" style={{ color: MUTED }}>4 of 6 qualified</div>
        </div>
        <button className="flex h-7 w-7 items-center justify-center rounded-md text-[#8A90A0] hover:bg-[#F3F5F9]" title="Regenerate"><RefreshCw className="h-3.5 w-3.5" /></button>
      </div>
      <div className="divide-y" style={{ borderColor: BORDER }}>
        {tests.map((test) => (
          <div key={test.cpt} className="flex items-center gap-3 px-4 py-2.5">
            <div
              className="flex h-5 w-5 items-center justify-center rounded-md"
              style={test.on ? { background: t.dot, color: "white" } : { border: `1.5px solid ${BORDER}` }}
            >
              {test.on && <Check className="h-3.5 w-3.5" />}
            </div>
            <span className={`flex-1 text-[13px] ${test.on ? "font-medium text-[#111114]" : "text-[#8A90A0]"}`}>{test.name}</span>
            <span className="text-[11px]" style={{ color: MUTED }}>{test.cpt}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function QuickPicker({ icon: Icon, label, count }: { icon: any; label: string; count: number }) {
  return (
    <button className="flex items-center justify-between rounded-lg border bg-white px-3 py-2.5 text-left transition-colors hover:border-[#557ac1]" style={{ borderColor: BORDER }}>
      <span className="flex items-center gap-2">
        <Icon className="h-4 w-4" style={{ color: "#557ac1" }} />
        <span className="text-[13px] font-medium text-[#111114]">{label}</span>
      </span>
      <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold" style={{ background: "#EAF4FF", color: "#22419e" }}>{count}</span>
    </button>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[11px] font-bold uppercase tracking-wider" style={{ color: MUTED }}>{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

function Collapsible({ icon: Icon, title, hint }: { icon: any; title: string; hint: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border bg-white" style={{ borderColor: BORDER }}>
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left">
        <Icon className="h-4 w-4" style={{ color: MUTED }} />
        <span className="flex-1 text-[13px] font-medium text-[#111114]">{title}</span>
        <span className="text-[11px]" style={{ color: MUTED }}>{hint}</span>
        <Caret className={`h-4 w-4 text-[#8A90A0] transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <div className="border-t px-3 py-2.5 text-[12px] leading-relaxed text-[#4F5563]" style={{ borderColor: BORDER }}>
          HTN, Type 2 DM, hyperlipidemia, CKD stage 3, paroxysmal AFib. Lisinopril 20mg,
          metformin 1000mg BID, atorvastatin 40mg, apixaban 5mg BID. Reports intermittent
          dizziness and bilateral leg cramping on exertion.
        </div>
      )}
    </div>
  );
}

export default function AdminReviewPrototypePage() {
  const [decision, setDecision] = useState<"approve" | "info" | "reject" | null>("approve");
  return (
    <div className="flex h-screen w-full flex-col font-sans" style={{ background: "#EEF1F7" }}>
      {/* ===== TOP HEADER STRIP ===== */}
      <header className="flex flex-none items-center gap-4 px-6 py-3 text-white" style={{ background: `linear-gradient(90deg, ${NAVY} 0%, ${NAVY_700} 100%)` }}>
        <div className="flex h-10 w-10 items-center justify-center rounded-full" style={{ background: "rgba(255,255,255,.12)" }}>
          <UserRound className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <h1 className="text-[17px] font-semibold leading-none">Margaret Chen</h1>
            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: "rgba(245,200,120,.18)", color: "#FCE3B0" }}>
              <CircleAlert className="h-3 w-3" /> Needs Review
            </span>
          </div>
          <p className="mt-1 text-[12px]" style={{ color: "#AEC2E0" }}>DOB 03/14/1948 · 78F · Medicare · Taylor Family Practice</p>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg px-1" style={{ background: "rgba(255,255,255,.08)" }}>
            <button className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-white/10"><ChevronLeft className="h-4 w-4" /></button>
            <span className="px-1 text-[12px] tabular-nums" style={{ color: "#AEC2E0" }}>3 / 12</span>
            <button className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-white/10"><ChevronRight className="h-4 w-4" /></button>
          </div>
          <button className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium" style={{ background: "rgba(255,255,255,.12)" }}>
            <RotateCcw className="h-3.5 w-3.5" /> Regenerate all
          </button>
          <button className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-white/10"><X className="h-5 w-5" /></button>
        </div>
      </header>

      {/* ===== TWO-PANEL BODY ===== */}
      <div className="flex min-h-0 flex-1 gap-4 overflow-hidden p-4">
        {/* LEFT — ANCILLARIES */}
        <div className="flex min-h-0 flex-[1.35] flex-col overflow-hidden rounded-2xl bg-white" style={{ border: `1px solid ${BORDER}` }}>
          <div className="flex flex-none items-center justify-between border-b px-5 py-3.5" style={{ borderColor: BORDER }}>
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" style={{ color: "#557ac1" }} />
              <h2 className="text-[14px] font-semibold text-[#111114]">Ancillary Playground</h2>
            </div>
            <span className="text-[12px]" style={{ color: MUTED }}>6 qualifying tests</span>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4" style={{ background: "#F7F8FB" }}>
            <AncillaryCard
              icon={Brain}
              tone="purple"
              title="BrainWave"
              cpt="Cognitive / Autonomic"
              qualified
              defaultOpen
              evidence={["AFib", "Dizziness", "Age 78", "apixaban"]}
              clinician="Paroxysmal AFib with anticoagulation and reported dizziness raises concern for cerebral hypoperfusion and embolic risk; autonomic screening is appropriate."
              patient="This painless test checks how well blood and nerve signals are reaching your brain, given your heart rhythm and dizzy spells."
            />
            <AncillaryCard
              icon={HeartPulse}
              tone="red"
              title="VitalWave"
              cpt="Cardiac / Vascular"
              qualified
              evidence={["HTN", "Hyperlipidemia", "Leg cramping"]}
              clinician="Longstanding hypertension and hyperlipidemia with exertional leg cramping support peripheral and central vascular assessment."
              patient="We'll look at how your blood is flowing through your heart and legs to catch any narrowing early."
            />
            <UltrasoundGroup />
          </div>
        </div>

        {/* RIGHT — ACTION */}
        <div className="flex min-h-0 w-[420px] flex-none flex-col overflow-hidden rounded-2xl bg-white" style={{ border: `1px solid ${BORDER}` }}>
          <div className="min-h-0 flex-1 space-y-5 overflow-auto p-5">
            {/* DECISION — focal */}
            <Section title="Decision">
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => setDecision("approve")}
                  className="flex flex-col items-center gap-1 rounded-xl px-2 py-3 text-[13px] font-semibold transition-all"
                  style={
                    decision === "approve"
                      ? { background: "#059669", color: "white", boxShadow: "0 2px 8px rgba(5,150,105,.35)" }
                      : { background: "#EAF7EF", color: "#065f46", border: "1px solid #CDEBD9" }
                  }
                >
                  <CheckCircle2 className="h-5 w-5" /> Approve
                </button>
                <button
                  onClick={() => setDecision("info")}
                  className="flex flex-col items-center gap-1 rounded-xl px-2 py-3 text-[13px] font-semibold transition-all"
                  style={
                    decision === "info"
                      ? { background: "#d97706", color: "white", boxShadow: "0 2px 8px rgba(217,119,6,.35)" }
                      : { background: "#FBF3E4", color: "#92400e", border: "1px solid #F2DDB5" }
                  }
                >
                  <CircleAlert className="h-5 w-5" /> Needs Info
                </button>
                <button
                  onClick={() => setDecision("reject")}
                  className="flex flex-col items-center gap-1 rounded-xl px-2 py-3 text-[13px] font-semibold transition-all"
                  style={
                    decision === "reject"
                      ? { background: "#dc2626", color: "white", boxShadow: "0 2px 8px rgba(220,38,38,.35)" }
                      : { background: "#FDECEC", color: "#991b1b", border: "1px solid #F7D2D2" }
                  }
                >
                  <X className="h-5 w-5" /> Reject
                </button>
              </div>
            </Section>

            {/* EVIDENCE quick-pickers */}
            <Section title="Evidence">
              <div className="grid grid-cols-2 gap-2">
                <QuickPicker icon={Stethoscope} label="Diagnosis" count={5} />
                <QuickPicker icon={Pill} label="Medications" count={4} />
                <QuickPicker icon={Activity} label="Symptoms" count={3} />
                <QuickPicker icon={Lightbulb} label="Suggestions" count={2} />
              </div>
            </Section>

            {/* BLOCKING ALERTS */}
            <Section title="Pre-flight checks">
              <div className="space-y-2">
                <div className="flex items-center gap-2 rounded-lg px-3 py-2.5" style={{ background: "#EAF7EF", border: "1px solid #CDEBD9" }}>
                  <CheckCircle2 className="h-4 w-4 text-[#059669]" />
                  <span className="text-[12.5px] font-medium text-[#065f46]">ICD-10 codes present · Insurance on file</span>
                </div>
                <div className="flex items-center gap-2 rounded-lg px-3 py-2.5" style={{ background: "#FBF3E4", border: "1px solid #F2DDB5" }}>
                  <ShieldAlert className="h-4 w-4 text-[#d97706]" />
                  <span className="text-[12.5px] font-medium text-[#92400e]">Medicare cooldown: 12-month rule applies</span>
                </div>
              </div>
            </Section>

            {/* ADMIN NOTE */}
            <Section title="Admin note">
              <textarea
                placeholder="Add an internal note for this review…"
                className="h-20 w-full resize-none rounded-lg border bg-white px-3 py-2 text-[13px] outline-none focus:ring-2"
                style={{ borderColor: BORDER }}
              />
            </Section>

            {/* DOCUMENTS */}
            <Section title="Documents">
              <div className="grid grid-cols-2 gap-2">
                <button className="flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-[13px] font-medium text-white" style={{ background: NAVY }}>
                  <FileText className="h-4 w-4" /> Plexus PDF
                </button>
                <button className="flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-[13px] font-medium text-[#173358]" style={{ borderColor: BORDER }}>
                  <FileSignature className="h-4 w-4" /> Clinician PDF
                </button>
              </div>
            </Section>

            {/* SCHEDULER */}
            <Section title="Scheduler" action={<button className="text-[12px] font-medium" style={{ color: "#3358b0" }}>Reassign</button>}>
              <div className="flex items-center gap-3 rounded-lg border px-3 py-2.5" style={{ borderColor: BORDER, background: "#F7F8FB" }}>
                <div className="flex h-8 w-8 items-center justify-center rounded-full text-[12px] font-semibold text-white" style={{ background: "#7589B8" }}>MG</div>
                <div className="flex-1">
                  <div className="text-[13px] font-medium text-[#111114]">Maria Gomez</div>
                  <div className="text-[11px]" style={{ color: MUTED }}>Assigned scheduler</div>
                </div>
                <CalendarClock className="h-4 w-4" style={{ color: MUTED }} />
              </div>
            </Section>

            {/* REFERENCE — folded away */}
            <Section title="Reference">
              <div className="space-y-2">
                <Collapsible icon={FileText} title="Source data" hint="Dx · Rx · Hx" />
                <Collapsible icon={CalendarClock} title="Prior test history" hint="3 records" />
                <Collapsible icon={StickyNote} title="Updates made" hint="2 changes" />
              </div>
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}
