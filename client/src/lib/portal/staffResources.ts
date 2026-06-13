// Staff-facing resources catalog used by the Team Portal Templates /
// Resources left-rail tool. These are INTERNAL helpers for the
// scheduler / coordinator — email templates, call scripts, prep
// language, internal SOP / FAQ. Patient-facing brochures live in the
// MARKETING_MATERIALS catalog (server/services/marketingMaterials.ts)
// and are surfaced through the Marketing tool — they MUST NOT be
// duplicated here.

export type StaffResourceKind = "email-template" | "call-script" | "prep-language" | "sop" | "faq";

export type StaffResource = {
  id: string;
  kind: StaffResourceKind;
  title: string;
  description: string;
  /** Snippet body suitable for direct insertion into an email composer
   *  body field or a call-script reading. Plaintext only. */
  body: string;
};

export const STAFF_RESOURCES: ReadonlyArray<StaffResource> = [
  {
    id: "email-template-appointment-confirmation",
    kind: "email-template",
    title: "Appointment confirmation",
    description: "Confirm a scheduled clinic visit with date / time / location.",
    body:
      `Hi {{patientFirstName}},\n\n` +
      `Your visit is confirmed for {{appointmentDate}} at {{appointmentTime}} at\n` +
      `{{facility}}. Please bring a photo ID and your insurance card.\n\n` +
      `Reply to this email or call our office if you need to reschedule.\n\n` +
      `Thank you,\n{{schedulerName}} · Scheduling Team`,
  },
  {
    id: "email-template-callback-after-missed",
    kind: "email-template",
    title: "Callback after missed call",
    description: "Polite follow-up after a missed outbound call.",
    body:
      `Hi {{patientFirstName}},\n\n` +
      `We tried to reach you today about your upcoming screening. When you\n` +
      `have a moment, please reply or give us a call back at\n` +
      `{{schedulerPhone}} so we can finalize your visit.\n\n` +
      `Thank you,\n{{schedulerName}} · Scheduling Team`,
  },
  {
    id: "email-template-marketing-followup",
    kind: "email-template",
    title: "Follow-up after marketing material",
    description: "Pair with a marketing brochure attachment.",
    body:
      `Hi {{patientFirstName}},\n\n` +
      `As promised, the brochure for the {{testName}} screening is attached.\n` +
      `It covers what to expect, how to prepare, and the insurance side.\n\n` +
      `When you're ready to schedule, reply to this email and I'll get you on\n` +
      `the calendar.\n\n` +
      `Thank you,\n{{schedulerName}} · Scheduling Team`,
  },
  {
    id: "call-script-cold-outreach",
    kind: "call-script",
    title: "Cold outreach intro (1st attempt)",
    description: "First-call opener for a brand-new lead.",
    body:
      `Hi, may I speak with {{patientFirstName}}?\n\n` +
      `This is {{schedulerName}} calling from {{clinicName}}. Your provider\n` +
      `flagged you for a quick non-invasive screening — do you have a minute\n` +
      `to hear about it? It usually only takes about 20 minutes and is fully\n` +
      `covered by insurance.\n\n` +
      `If interested → schedule.\n` +
      `If hesitant → offer to email the brochure first.\n` +
      `If declined → ask if a callback in 1–2 weeks would help.`,
  },
  {
    id: "call-script-pre-visit-reminder",
    kind: "call-script",
    title: "Pre-visit reminder (24h out)",
    description: "Final confirmation call the day before a clinic visit.",
    body:
      `Hi {{patientFirstName}}, this is {{schedulerName}} from {{clinicName}}.\n\n` +
      `I'm calling to confirm your appointment for tomorrow,\n` +
      `{{appointmentDate}} at {{appointmentTime}}. Are you still able to make\n` +
      `it?\n\n` +
      `If YES → confirm in system, note any prep questions.\n` +
      `If NO → reschedule or set a callback.`,
  },
  {
    id: "prep-language-brainwave",
    kind: "prep-language",
    title: "BrainWave prep talking points",
    description: "Standardized prep language for BrainWave screening.",
    body:
      `BrainWave prep is minimal. No fasting. No medication changes.\n\n` +
      `Talking points:\n` +
      `  - 20-minute non-invasive screening.\n` +
      `  - Sit in a comfortable chair, follow the on-screen prompts.\n` +
      `  - Results go to the provider for review at the next visit.\n` +
      `  - Covered by most insurances; we'll verify before the appointment.`,
  },
  {
    id: "prep-language-vitalwave",
    kind: "prep-language",
    title: "VitalWave prep talking points",
    description: "Standardized prep language for VitalWave / vascular risk.",
    body:
      `VitalWave prep talking points:\n` +
      `  - Wear comfortable, loose clothing (sleeves can be rolled up).\n` +
      `  - Avoid heavy caffeine 2 hours before the screening.\n` +
      `  - 20-30 minute appointment. Non-invasive, no needles.\n` +
      `  - Results integrate with the provider's vascular risk record.`,
  },
  {
    id: "prep-language-ultrasound",
    kind: "prep-language",
    title: "Ultrasound prep talking points",
    description: "Common prep guidance covering most ultrasound studies.",
    body:
      `Ultrasound prep depends on the study:\n` +
      `  - Carotid Duplex: no prep needed.\n` +
      `  - Renal Artery: NPO 4 hours before.\n` +
      `  - Abdominal Aortic Aneurysm: NPO overnight.\n` +
      `  - Lower Extremity Venous: no prep needed.\n` +
      `  - Echo TTE: no prep needed.\n\n` +
      `Always confirm with the technician's worklist for the specific study.`,
  },
  {
    id: "sop-no-email-on-file",
    kind: "sop",
    title: "SOP — Patient has no email on file",
    description: "What to do when the patient record has no email and we need to send marketing or confirmation.",
    body:
      `1. Ask the patient for an email address on the next call.\n` +
      `2. Use the email override field in the Email Composer to capture\n` +
      `   it; the backend will persist it to the patient record.\n` +
      `3. If the patient declines email, mark the record as "no email"\n` +
      `   in the patient profile and continue with phone-only outreach.`,
  },
  {
    id: "sop-dnc-and-cooldown",
    kind: "sop",
    title: "SOP — DNC / cooldown reminders",
    description: "Reminder of the canonical Do-Not-Contact and cooldown handling.",
    body:
      `DNC or active cooldown affects OUTREACH only — not clinical\n` +
      `qualification or Admin Review.\n\n` +
      `  - DNC: do not place outreach calls or send outreach emails.\n` +
      `  - Cooldown: skip outreach until the cooldown end date.\n` +
      `  - Both surface in the Patient Directory warning facts and in\n` +
      `    the canonical AdminReviewDuplicateGuard.\n` +
      `  - Never override DNC/cooldown without escalation.`,
  },
  {
    id: "faq-insurance-coverage",
    kind: "faq",
    title: "FAQ — Is this covered by insurance?",
    description: "Plain-English insurance answer for patient calls.",
    body:
      `These screenings are typically covered by Medicare and most\n` +
      `commercial insurance plans when the provider has flagged the\n` +
      `patient as eligible. Patients with high-deductible plans may\n` +
      `see a small charge; we verify coverage before the visit and let\n` +
      `the patient know before they show up.`,
  },
  {
    id: "faq-what-happens-day-of",
    kind: "faq",
    title: "FAQ — What happens on the day of the visit?",
    description: "Plain-English day-of-visit walkthrough.",
    body:
      `Patient checks in 10 minutes early at the front desk.\n` +
      `The technician walks them through what each test does.\n` +
      `Each test is non-invasive — no needles, no fasting unless\n` +
      `noted in the prep guidance. Total visit time is usually under\n` +
      `60 minutes for a single-test visit.\n\n` +
      `Results go to the patient's provider for review.`,
  },
];

export function listStaffResourcesByKind(kind: StaffResourceKind): ReadonlyArray<StaffResource> {
  return STAFF_RESOURCES.filter((r) => r.kind === kind);
}
