/**
 * Catalog of marketing materials the scheduler portal can send to patients.
 * Content is generated on the fly as plain-text attachments so the feature
 * works without external assets in storage. Each entry mirrors the
 * client-side card list in the scheduler portal so the IDs line up.
 */
export interface MarketingMaterial {
  id: string;
  title: string;
  description: string;
  filename: string;
  contentType: string;
  content: string;
}

function plainText(title: string, lines: string[]): string {
  return [title, "=".repeat(title.length), "", ...lines, ""].join("\n");
}

export const MARKETING_MATERIALS: MarketingMaterial[] = [
  {
    id: "brainwave-brochure",
    title: "BrainWave Brochure",
    description: "Patient-facing overview of the BrainWave screening.",
    filename: "BrainWave-Brochure.txt",
    contentType: "text/plain",
    content: plainText("BrainWave Cognitive Screening", [
      "BrainWave is a quick, non-invasive screening that helps your provider",
      "evaluate cognitive function and screen for early changes in memory,",
      "attention, and processing speed.",
      "",
      "What to expect:",
      "  - 20-minute appointment",
      "  - No fasting or preparation required",
      "  - Results reviewed at your next provider visit",
    ]),
  },
  {
    id: "vitalwave-info",
    title: "VitalWave Info Sheet",
    description: "1-page summary of the VitalWave cardiac screening.",
    filename: "VitalWave-Info.txt",
    contentType: "text/plain",
    content: plainText("VitalWave Cardiovascular Screening", [
      "VitalWave is a non-invasive cardiovascular screening that measures",
      "arterial stiffness, blood pressure response, and heart rhythm.",
      "",
      "What to bring: insurance card, photo ID, and a list of medications.",
    ]),
  },
  {
    id: "screening-faq",
    title: "General Screening FAQ",
    description: "Answers to the most common patient questions.",
    filename: "Screening-FAQ.txt",
    contentType: "text/plain",
    content: plainText("Frequently Asked Questions", [
      "Q: Will my insurance cover this?",
      "A: Medicare and most PPO plans cover these preventive screenings.",
      "",
      "Q: How long will the visit take?",
      "A: Most visits take 30-60 minutes total.",
      "",
      "Q: Do I need to fast?",
      "A: Only if specifically instructed by your provider.",
    ]),
  },
  {
    id: "insurance-coverage",
    title: "Insurance Coverage Note",
    description: "Standard coverage note — Medicare + most PPOs.",
    filename: "Insurance-Coverage.txt",
    contentType: "text/plain",
    content: plainText("Insurance Coverage", [
      "These screenings are covered by Medicare Part B and most commercial",
      "PPO plans as preventive services. HMO plans may require a referral.",
      "Please contact your plan with the CPT codes provided by your scheduler",
      "if you have questions about coverage.",
    ]),
  },
  {
    id: "appointment-prep",
    title: "Visit Prep Checklist",
    description: "What to bring, fasting, ID, insurance card.",
    filename: "Visit-Prep-Checklist.txt",
    contentType: "text/plain",
    content: plainText("What to Bring", [
      "  [ ] Photo ID",
      "  [ ] Current insurance card",
      "  [ ] Medication list",
      "  [ ] Comfortable clothing",
      "  [ ] Any prior test results you've received",
    ]),
  },
  {
    id: "post-visit-care",
    title: "Post-Visit Care Guide",
    description: "Post-test care + follow-up scheduling guidance.",
    filename: "Post-Visit-Care.txt",
    contentType: "text/plain",
    content: plainText("After Your Visit", [
      "Most patients return to normal activity immediately. Your provider",
      "will share results within 1-2 weeks. If you experience any unusual",
      "symptoms, please contact the clinic directly.",
    ]),
  },
];

export function getMarketingMaterial(id: string): MarketingMaterial | undefined {
  return MARKETING_MATERIALS.find((m) => m.id === id);
}
