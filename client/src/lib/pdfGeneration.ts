import type { PatientScreening } from "@shared/schema";
import { getAncillaryCategory } from "@/features/schedule/ancillaryMeta";

export type ReasoningValue =
  | string
  | {
      clinician_understanding: string;
      patient_talking_points: string;
      confidence?: "high" | "medium" | "low";
      qualifying_factors?: string[];
      icd10_codes?: string[];
      pearls?: string[];
      approvalRequired?: boolean;
    };

export function esc(s: string | null | undefined): string {
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

export function getOneSentenceDesc(test: string): string {
  const desc = TEST_DESCRIPTIONS[test] ?? TEST_DESCRIPTIONS[normalizeTestName(test)];
  if (!desc) return "A non-invasive diagnostic test recommended based on the patient's history and risk factors.";
  const full = desc.kind === "simple" ? desc.text : desc.intro;
  const m = full.match(/^[^.!?]*[.!?]/);
  return m ? m[0].trim() : full;
}

export function getTestDescHTML(test: string): string {
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
`;

export function buildPrintWindow(title: string, bodyHtml: string, options?: { injectScript?: string }): void {
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

export function buildPatientTop(p: PatientScreening, batchName: string, date: string, reportLabel: string): string {
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

export function normalizeUltrasoundName(test: string): string {
  return test.replace(/\s*\(\d{4,5}\)\s*$/, "").trim();
}

export function getUltrasoundIcon(test: string, colorOverride?: string): string {
  const entry = ULTRASOUND_ICONS[normalizeUltrasoundName(test)];
  if (!entry) return "";
  const c = colorOverride ?? entry.color;
  return `<svg width="16" height="16" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:middle;flex-shrink:0;">${entry.paths(c)}</svg>`;
}

export function formatScheduleDate(scheduleDate: string | null | undefined, createdAt: string | Date | null | undefined): string {
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

export function getPrevTestsSign(_insurance: string | null | undefined, _previousTests: string | null | undefined, _scheduleDate: string): string {
  return "";
}

export function generateClinicianPDF(batchName: string, patients: PatientScreening[], scheduleDate?: string | null, createdAt?: string | Date | null): void {
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

    const prevSign = getPrevTestsSign(p.insurance, p.previousTests, scheduleDate || new Date().toISOString().slice(0, 10));
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

  buildPrintWindow(`Clinician Report — ${batchName}`, pages);
}

export function generatePlexusPDF(batchName: string, patients: PatientScreening[], scheduleDate?: string | null, createdAt?: string | Date | null): void {
  const date = formatScheduleDate(scheduleDate, createdAt);
  const catAccent: Record<string, string> = { brainwave: "#7c3aed", vitalwave: "#be123c", ultrasound: "#047857", other: "#475569" };

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

  const sectionLabel = (label: string, color: string) =>
    `<div style="font-size:9.5px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px;padding-bottom:3px;border-bottom:2px solid ${color};">${esc(label)}</div>`;

  const factorPills = (factors: string[] | null | undefined) => {
    if (!factors || factors.length === 0) return "";
    return `<div style="margin-top:3px;line-height:1.8;">${factors.slice(0, 3).map(f =>
      `<span style="display:inline-block;font-size:8px;font-weight:600;color:#475569;background:#f1f5f9;border-radius:3px;padding:1px 5px;margin:1px 3px 1px 0;">${esc(f)}</span>`
    ).join("")}</div>`;
  };

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
              ${pearls.map(pearl => `<li style="font-size:9px;line-height:1.5;color:#1e293b;break-inside:avoid;">${esc(pearl)}</li>`).join("")}
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

    return [`<div class="page" style="padding:16px 20px;">${buildCompactTop(p)}${sections.join("")}</div>`];
  });

  buildPrintWindow(`Plexus Team Script — ${batchName}`, pages.join(""));
}
