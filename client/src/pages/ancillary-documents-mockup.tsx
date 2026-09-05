import { useState } from "react";
import {
  Search,
  ChevronDown,
  ChevronRight,
  SlidersHorizontal,
  Plus,
  ArrowUpDown,
  MoreVertical,
  FileText,
  CheckCircle2,
  AlertCircle,
  Circle,
  Eye,
  Copy,
  Printer,
  MoreHorizontal,
} from "lucide-react";

/* ══════════════════════════════════════════════════════════════════════
   /ancillary-documents-mockup  —  PIXEL-FAITHFUL DESIGN MOCKUP (Phase B2)
   Static sample data matching the approved reference. Not wired to live data,
   not the production route. Self-contained; touches no live page.
   ══════════════════════════════════════════════════════════════════════ */

// ─── Palette (winter / alpine, restrained) ──────────────────────────────
const C = {
  canvasTop: "#eef3f9",
  canvas: "#f4f7fb",
  ink: "#1e2a3a",
  ink2: "#5b6b82",
  muted: "#8a97ab",
  faint: "#aab4c5",
  edge: "#e6ecf3",
  edgeSoft: "#eef2f7",
  blue: "#3b6fd4",
  blueText: "#2f62c9",
  blueSoft: "#eaf1fd",
  blueSelBar: "#3b6fd4",
  green: "#1fa870",
  greenSoft: "#e9f6f0",
  amber: "#c58a36",
  amberSoft: "#fbf1e0",
  red: "#d9545d",
  white: "#ffffff",
};

type Tone = "ready" | "signed" | "review";
const STATUS: Record<Tone, { label: string; fg: string; bg: string }> = {
  ready: { label: "Ready", fg: C.green, bg: C.greenSoft },
  signed: { label: "Signed", fg: C.green, bg: C.greenSoft },
  review: { label: "Needs Review", fg: C.amber, bg: C.amberSoft },
};

// ─── Sample data (mirrors the reference) ─────────────────────────────────
const CLINICS = [
  { id: "taylor", name: "Taylor Family Practice", patients: 125, providers: 3 },
  { id: "desert", name: "Desert Valley Clinic", patients: 82, providers: 2 },
  { id: "lakeside", name: "Lakeside Internal Medicine", patients: 64, providers: 4 },
];

type DocIcon = "doc" | "check" | "alert" | "empty";
const PATIENTS = [
  { id: 1, name: "Belle Davis", dob: "09/14/1985", mrn: "1002387", age: "38 y", sex: "Female", icons: ["doc", "check", "alert"] as DocIcon[] },
  { id: 2, name: "Michael Duncan", dob: "02/21/1978", mrn: "1001832", age: "47 y", sex: "Male", icons: ["check", "check", "doc"] as DocIcon[] },
  { id: 3, name: "Chastity Beyer", dob: "12/03/1991", mrn: "1002751", age: "34 y", sex: "Female", icons: ["doc", "alert", "empty"] as DocIcon[] },
  { id: 4, name: "James Porter", dob: "07/07/1966", mrn: "1001129", age: "59 y", sex: "Male", icons: ["check", "alert", "doc"] as DocIcon[] },
];

const DOC_CARDS: { key: string; icon: typeof FileText; title: string; tone: Tone; updated: string }[] = [
  { key: "order", icon: FileText, title: "Order Note", tone: "ready", updated: "05/12/2025 9:15 AM" },
  { key: "procedure", icon: CheckCircle2, title: "Procedure Note", tone: "signed", updated: "05/11/2025 4:32 PM" },
  { key: "billing", icon: AlertCircle, title: "Billing Document", tone: "review", updated: "05/10/2025 11:03 AM" },
];

function StatusIcons({ icons }: { icons: DocIcon[] }) {
  return (
    <div className="flex items-center gap-1.5">
      {icons.map((t, i) => {
        if (t === "doc") return <FileText key={i} className="size-4" style={{ color: C.blue }} strokeWidth={2} />;
        if (t === "check") return <CheckCircle2 key={i} className="size-4" style={{ color: C.green }} strokeWidth={2} />;
        if (t === "alert") return <AlertCircle key={i} className="size-4" style={{ color: C.amber }} strokeWidth={2} />;
        return <Circle key={i} className="size-4" style={{ color: C.faint }} strokeWidth={2} />;
      })}
    </div>
  );
}

export default function AncillaryDocumentsMockup() {
  const [clinic, setClinic] = useState("taylor");
  const [patient, setPatient] = useState(1);
  const [doc, setDoc] = useState("order");
  const [tab, setTab] = useState("preview");

  return (
    <div
      className="min-h-full w-full overflow-auto"
      style={{
        fontFamily: '"Avenir Next", "Helvetica Neue", Arial, sans-serif',
        background: `radial-gradient(120% 80% at 50% -10%, ${C.canvasTop}, transparent 55%), ${C.canvas}`,
        color: C.ink,
      }}
    >
      <div className="mx-auto w-full max-w-[1180px] px-8 py-7">
        {/* ── Title row + user chip ─────────────────────────────────── */}
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h1 style={{ fontWeight: 300, fontSize: 40, lineHeight: 1.1, letterSpacing: "-0.02em", color: C.ink }}>
              Ancillary Documents
            </h1>
            <p className="mt-1" style={{ fontSize: 14, color: C.ink2 }}>Taylor Family Practice</p>
          </div>
          <button className="flex items-center gap-2.5 rounded-full py-1 pl-1 pr-2.5 transition-colors hover:bg-white/60">
            <img
              src="https://i.pravatar.cc/64?img=47"
              alt="Dr. Amanda Lewis"
              className="size-9 rounded-full object-cover"
              style={{ boxShadow: `0 0 0 1px ${C.edge}` }}
            />
            <span className="text-left leading-tight">
              <span className="block" style={{ fontSize: 13, fontWeight: 600, color: C.ink }}>Dr. Amanda Lewis</span>
              <span className="block" style={{ fontSize: 11, color: C.muted }}>Taylor Family Practice</span>
            </span>
            <ChevronDown className="size-4" style={{ color: C.muted }} />
          </button>
        </div>

        {/* ── Toolbar bar ───────────────────────────────────────────── */}
        <div
          className="mb-5 flex items-center gap-3 rounded-2xl px-3 py-2.5"
          style={{ background: C.white, border: `1px solid ${C.edge}`, boxShadow: "0 1px 2px rgba(20,30,50,0.04)" }}
        >
          <div className="relative flex w-[280px] items-center">
            <Search className="pointer-events-none absolute left-3 size-4" style={{ color: C.muted }} />
            <input
              placeholder="Search patients"
              className="h-9 w-full rounded-lg pl-9 pr-3 text-[13px] outline-none"
              style={{ background: "#f5f7fb", border: `1px solid ${C.edgeSoft}`, color: C.ink }}
            />
          </div>
          <ToolbarSelect label="Status" />
          <ToolbarSelect label="Clinic" />
          <div className="ml-auto flex items-center gap-2">
            <button className="flex size-9 items-center justify-center rounded-lg" style={{ border: `1px solid ${C.edge}`, color: C.ink2 }}>
              <SlidersHorizontal className="size-4" />
            </button>
            <button className="rounded-lg px-3 py-2 text-[13px] font-medium" style={{ color: C.blueText }}>Clear</button>
          </div>
        </div>

        {/* ── Two containers: [Clinics|Patients]  [Document] ────────── */}
        <div className="flex gap-5">
          {/* LEFT container: clinics + patients split by a divider */}
          <div
            className="flex w-[560px] shrink-0 overflow-hidden rounded-2xl"
            style={{ background: C.white, border: `1px solid ${C.edge}`, boxShadow: "0 1px 3px rgba(20,30,50,0.05)" }}
          >
            {/* Clinics */}
            <div className="w-[232px] shrink-0">
              <ColHeader title="CLINICS" right={<Plus className="size-4" style={{ color: C.muted }} />} />
              <div className="flex flex-col gap-1 p-2">
                {CLINICS.map((cl) => {
                  const sel = cl.id === clinic;
                  return (
                    <button
                      key={cl.id}
                      onClick={() => setClinic(cl.id)}
                      className="group flex items-start gap-2 rounded-lg py-2 pl-2.5 pr-2 text-left transition-colors"
                      style={{
                        background: sel ? C.blueSoft : "transparent",
                        boxShadow: sel ? `inset 3px 0 0 ${C.blueSelBar}` : "none",
                      }}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate" style={{ fontSize: 13.5, fontWeight: 600, color: sel ? C.blueText : C.ink }}>
                          {cl.name}
                        </span>
                        <span className="mt-0.5 block" style={{ fontSize: 11, color: C.muted }}>
                          {cl.patients} patients · {cl.providers} providers
                        </span>
                      </span>
                      <MoreVertical className="mt-0.5 size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" style={{ color: C.faint }} />
                    </button>
                  );
                })}
              </div>
            </div>

            {/* divider */}
            <div style={{ width: 1, background: C.edgeSoft }} />

            {/* Patients */}
            <div className="flex min-w-0 flex-1 flex-col">
              <ColHeader title="PATIENTS" right={<ArrowUpDown className="size-3.5" style={{ color: C.muted }} />} />
              <div className="flex flex-1 flex-col gap-0.5 p-2">
                {PATIENTS.map((pt) => {
                  const sel = pt.id === patient;
                  return (
                    <button
                      key={pt.id}
                      onClick={() => setPatient(pt.id)}
                      className="flex items-center gap-2 rounded-lg py-2 pl-2.5 pr-2 text-left transition-colors"
                      style={{
                        background: sel ? C.blueSoft : "transparent",
                        boxShadow: sel ? `inset 3px 0 0 ${C.blueSelBar}` : "none",
                      }}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate" style={{ fontSize: 14, fontWeight: 600, color: C.ink }}>{pt.name}</span>
                        <span className="mt-0.5 block" style={{ fontSize: 11.5, color: C.muted }}>
                          DOB {pt.dob} · MRN {pt.mrn}
                        </span>
                      </span>
                      <StatusIcons icons={pt.icons} />
                      <ChevronRight className="size-4 shrink-0" style={{ color: C.faint }} />
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center justify-between px-4 py-3" style={{ borderTop: `1px solid ${C.edgeSoft}` }}>
                <span style={{ fontSize: 12, color: C.muted }}>4 patients</span>
                <button style={{ fontSize: 12, fontWeight: 500, color: C.blueText }}>View all</button>
              </div>
            </div>
          </div>

          {/* RIGHT container: document panel */}
          <div
            className="min-w-0 flex-1 rounded-2xl p-6"
            style={{ background: C.white, border: `1px solid ${C.edge}`, boxShadow: "0 1px 3px rgba(20,30,50,0.05)" }}
          >
            {/* patient header */}
            <div className="mb-4">
              <h2 style={{ fontSize: 22, fontWeight: 500, color: C.ink }}>Belle Davis</h2>
              <p className="mt-0.5" style={{ fontSize: 12.5, color: C.muted }}>
                DOB 09/14/1985 &nbsp;(38 y)&nbsp; · &nbsp;MRN 1002387&nbsp; · &nbsp;Female
              </p>
            </div>

            {/* three doc cards */}
            <div className="mb-5 grid grid-cols-3 gap-3">
              {DOC_CARDS.map((d) => {
                const sel = d.key === doc;
                const st = STATUS[d.tone];
                const Icon = d.icon;
                return (
                  <button
                    key={d.key}
                    onClick={() => setDoc(d.key)}
                    className="rounded-xl p-3.5 text-left transition-all"
                    style={{
                      background: sel ? "#f7faff" : C.white,
                      border: `1.5px solid ${sel ? C.blue : C.edge}`,
                      boxShadow: sel ? `0 0 0 3px ${C.blue}1f` : "none",
                    }}
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <Icon className="size-4" style={{ color: sel ? C.blue : C.ink2 }} strokeWidth={2} />
                      <span style={{ fontSize: 13.5, fontWeight: 600, color: C.ink }}>{d.title}</span>
                    </div>
                    <span
                      className="inline-flex items-center rounded-full px-2 py-0.5"
                      style={{ fontSize: 11, fontWeight: 600, color: st.fg, background: st.bg }}
                    >
                      {st.label}
                    </span>
                    <p className="mt-2" style={{ fontSize: 11, color: C.muted }}>Updated {d.updated}</p>
                  </button>
                );
              })}
            </div>

            {/* action tabs */}
            <div className="mb-4 flex items-center gap-6" style={{ borderBottom: `1px solid ${C.edgeSoft}` }}>
              {[
                { k: "preview", label: "Preview", Icon: Eye },
                { k: "copy", label: "Copy", Icon: Copy },
                { k: "print", label: "Print", Icon: Printer },
              ].map(({ k, label, Icon }) => {
                const on = k === tab;
                return (
                  <button
                    key={k}
                    onClick={() => setTab(k)}
                    className="-mb-px flex items-center gap-1.5 pb-2.5 pt-1"
                    style={{
                      fontSize: 13,
                      fontWeight: on ? 600 : 500,
                      color: on ? C.blueText : C.ink2,
                      borderBottom: `2px solid ${on ? C.blue : "transparent"}`,
                    }}
                  >
                    <Icon className="size-4" strokeWidth={2} />
                    {label}
                  </button>
                );
              })}
              <button className="ml-auto flex items-center gap-1 pb-2.5 pt-1" style={{ fontSize: 13, fontWeight: 500, color: C.ink2 }}>
                <MoreHorizontal className="size-4" /> More <ChevronDown className="size-3.5" />
              </button>
            </div>

            {/* letterhead document */}
            <div style={{ fontSize: 12.5, color: C.ink }}>
              <div className="mb-5 flex items-start justify-between gap-6 pb-4" style={{ borderBottom: `1px solid ${C.edgeSoft}` }}>
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: C.blueText, letterSpacing: "0.02em" }}>TAYLOR FAMILY PRACTICE</div>
                  <div className="mt-1 leading-relaxed" style={{ color: C.ink2 }}>
                    123 Alpine Way, Suite 200<br />
                    Salt Lake City, UT 84101<br />
                    (801) 555-0142
                  </div>
                </div>
                <div className="text-right leading-relaxed" style={{ color: C.ink2 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>ORDER NOTE</div>
                  <div className="mt-1">Order ID: ON-2025-0512-0001</div>
                  <div>Date: May 12, 2025</div>
                  <div>Provider: Dr. Amanda Lewis, MD</div>
                </div>
              </div>

              <Section title="Patient">
                <div>
                  <span style={{ fontWeight: 700 }}>Belle Davis</span> &nbsp;(38 y, Female)
                </div>
                <div className="mt-0.5" style={{ color: C.ink2 }}>DOB: 09/14/1985 &nbsp;&nbsp; MRN: 1002387</div>
                <div style={{ color: C.ink2 }}>Preferred Phone: (801) 555-0198</div>
              </Section>

              <Section title="Clinical Summary">
                <p className="leading-relaxed" style={{ color: C.ink2 }}>
                  Patient presents for follow-up evaluation of hypertension. Reports improved adherence to medication
                  and lifestyle modifications. Denies chest pain, shortness of breath, dizziness, or edema.
                </p>
              </Section>

              <Section title="Orders">
                <table className="w-full" style={{ borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ color: C.muted, fontSize: 11, textAlign: "left" }}>
                      <th className="pb-1.5 font-semibold" style={{ borderBottom: `1px solid ${C.edgeSoft}` }}>Order</th>
                      <th className="pb-1.5 font-semibold" style={{ borderBottom: `1px solid ${C.edgeSoft}` }}>Details</th>
                      <th className="pb-1.5 font-semibold" style={{ borderBottom: `1px solid ${C.edgeSoft}` }}>Priority</th>
                      <th className="pb-1.5 font-semibold" style={{ borderBottom: `1px solid ${C.edgeSoft}` }}>Instructions</th>
                    </tr>
                  </thead>
                  <tbody style={{ color: C.ink }}>
                    {[
                      ["Comprehensive Metabolic Panel (CMP)", "Lab Test", "Routine", "Fasting not required"],
                      ["Hemoglobin A1c", "Lab Test", "Routine", "—"],
                      ["Lisinopril 10 mg", "Medication", "Routine", "Take 1 tablet by mouth once daily"],
                    ].map((r, i) => (
                      <tr key={i}>
                        {r.map((c, j) => (
                          <td key={j} className="py-2 pr-4 align-top" style={{ borderBottom: `1px solid ${C.edgeSoft}`, fontSize: 12 }}>{c}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Section>

              <Section title="Notes">
                <p style={{ color: C.ink2 }}>Continue current medication. Follow up in 3 months or sooner if symptoms worsen.</p>
              </Section>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ColHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid ${C.edgeSoft}` }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", color: C.muted }}>{title}</span>
      {right}
    </div>
  );
}

function ToolbarSelect({ label }: { label: string }) {
  return (
    <button
      className="flex h-9 items-center gap-2 rounded-lg px-3 text-[13px]"
      style={{ border: `1px solid ${C.edge}`, color: C.ink2, background: C.white }}
    >
      {label}
      <ChevronDown className="size-3.5" style={{ color: C.muted }} />
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="mb-1.5" style={{ fontSize: 12.5, fontWeight: 700, color: C.blueText }}>{title}</div>
      {children}
    </div>
  );
}
