// Static call scripts surfaced inside the Current Call card.
// Keys are matched case-insensitively against qualifying test names.

export type OutreachScript = {
  intro: string;
  whyThisMatters: string;
  objections: { objection: string; response: string }[];
};

const SCRIPTS: Record<string, OutreachScript> = {
  brainwave: {
    intro:
      "Hi {name}, this is {scheduler} from {clinic}. {provider} ordered a quick non-invasive brain blood-flow study called BrainWave. I'd like to get you on the schedule.",
    whyThisMatters:
      "It checks how well blood is reaching your brain — important given your history. It's painless, takes about an hour, and is fully covered by your insurance.",
    objections: [
      { objection: "I'm too busy", response: "Totally understand. We have early morning and late afternoon slots — what works best?" },
      { objection: "Is it covered?", response: "Yes — it's a standard covered diagnostic for your insurance. No surprise bills." },
      { objection: "I just had labs", response: "This isn't a blood test — it's a non-invasive ultrasound. Different information for the doctor." },
    ],
  },
  vitalwave: {
    intro:
      "Hi {name}, this is {scheduler} from {clinic}. {provider} would like you to come in for a VitalWave assessment — it's a 30-minute non-invasive heart-and-vessel screen.",
    whyThisMatters:
      "It catches early circulation issues before symptoms — given your history, the doctor wants this on the chart.",
    objections: [
      { objection: "I feel fine", response: "That's great. This is exactly when we want to look — we're catching things early, not reacting late." },
      { objection: "Already had an echo", response: "VitalWave looks at different territory — vascular, not just the heart muscle. Doctor specifically asked for both." },
    ],
  },
  "bilateral carotid duplex": {
    intro:
      "Hi {name}, this is {scheduler}. {provider} ordered a Carotid Duplex — it's a quick ultrasound of the arteries in your neck. Takes about 30 minutes.",
    whyThisMatters: "It's the best non-invasive way to check stroke risk. Painless, no prep, fully covered.",
    objections: [
      { objection: "Why my neck?", response: "The arteries in your neck feed your brain. Plaque there is the #1 reversible stroke risk." },
    ],
  },
  echocardiogram: {
    intro:
      "Hi {name}, this is {scheduler}. {provider} would like you to come in for an echocardiogram — an ultrasound of your heart. About 45 minutes.",
    whyThisMatters: "It shows how well your heart is pumping and whether the valves are working. No radiation, no IV, no prep.",
    objections: [
      { objection: "I had an EKG", response: "EKG is electrical only. The echo shows the actual structure and function — different test, both important." },
    ],
  },
  "renal artery doppler": {
    intro:
      "Hi {name}, this is {scheduler}. {provider} ordered a kidney-artery ultrasound — about 45 minutes, you'll need to fast for 8 hours beforehand.",
    whyThisMatters: "It checks blood flow to the kidneys — an important contributor to blood pressure and kidney function.",
    objections: [
      { objection: "Fasting is hard", response: "Just no food/drink after midnight before. Water and morning meds are fine. We have 8am slots." },
    ],
  },
  "lower extremity arterial doppler": {
    intro:
      "Hi {name}, this is {scheduler}. {provider} ordered a leg-artery ultrasound — checks circulation in your legs. About 45 minutes, no prep.",
    whyThisMatters: "It looks for narrowing in the leg arteries — important for healing, walking distance, and overall vascular health.",
    objections: [],
  },
  "abdominal aortic aneurysm duplex": {
    intro:
      "Hi {name}, this is {scheduler}. {provider} ordered an abdominal aorta ultrasound — quick, about 30 minutes, fast 8 hours beforehand.",
    whyThisMatters: "It's the screening test for an aortic aneurysm. Catching it early is the entire point — once found, it's manageable.",
    objections: [],
  },
  "lower extremity venous duplex": {
    intro:
      "Hi {name}, this is {scheduler}. {provider} ordered a leg-vein ultrasound — about 45 minutes, no prep.",
    whyThisMatters: "It rules out clots and checks the leg veins. Important if you've had swelling, pain, or are at risk for DVT.",
    objections: [],
  },
};

const DEFAULT_SCRIPT: OutreachScript = {
  intro:
    "Hi {name}, this is {scheduler} from {clinic}. {provider} ordered a follow-up diagnostic test for you and I'd like to get it scheduled.",
  whyThisMatters:
    "It's a quick non-invasive study that helps the doctor manage your care. Fully covered by your insurance.",
  objections: [
    { objection: "I'm too busy", response: "We have flexible slots — what time of day works for you?" },
    { objection: "Is it covered?", response: "Yes, it's a standard covered diagnostic for your plan." },
  ],
};

export function getScriptForTest(testName: string): OutreachScript {
  const norm = testName.trim().toLowerCase();
  for (const key of Object.keys(SCRIPTS)) {
    if (norm.includes(key)) return SCRIPTS[key];
  }
  return DEFAULT_SCRIPT;
}

export function fillScript(
  template: string,
  vars: { name?: string; scheduler?: string; clinic?: string; provider?: string },
): string {
  return template
    .replace(/\{name\}/g, vars.name || "there")
    .replace(/\{scheduler\}/g, vars.scheduler || "the scheduling team")
    .replace(/\{clinic\}/g, vars.clinic || "the clinic")
    .replace(/\{provider\}/g, vars.provider || "your provider");
}
