import { openai, withRetry } from "./aiClient";
import { storage } from "../storage";

export type QualificationMode = "permissive" | "standard" | "conservative";

const QUALIFICATION_THRESHOLD_INSTRUCTIONS: Record<QualificationMode, string> = {
  permissive: `QUALIFICATION THRESHOLD (PERMISSIVE MODE):
1. Be EXTREMELY LENIENT in qualifying patients. If there is ANY possible connection between the patient's conditions/symptoms/medications and a test, qualify them.
2. Err heavily on the side of qualifying. Even tangential or indirect connections count.
3. Common conditions like hypertension, diabetes, obesity, hyperlipidemia, anxiety, depression, pain, or being on multiple medications should qualify for MOST tests.
4. Age over 40 with ANY chronic condition qualifies for cardiovascular tests.
5. Any patient with mood disorders or neurological complaints qualifies for BrainWave.
6. Any patient with cardiovascular risk factors (HTN, DM, HLD, smoking, obesity, family history) qualifies for Bilateral Carotid Duplex, Echocardiogram, VitalWave, and most vascular ultrasounds.
7. Leg pain, swelling, or edema qualifies for lower extremity ultrasounds (both arterial and venous).
8. Medications often reveal diagnoses not listed (e.g., metformin = diabetes, amlodipine = hypertension, statins = hyperlipidemia, gabapentin = neuropathy).
9. Multiple risk factors compound qualification. Even minor risk factors together justify screening.
10. When in doubt, QUALIFY. Only exclude if the test is clearly inappropriate.`,

  standard: `QUALIFICATION THRESHOLD (STANDARD MODE):
1. Qualify patients when there is a DIRECT clinical connection between their documented conditions/symptoms/medications and the test indication. Indirect or speculative connections are NOT sufficient.
2. A diagnosis or symptom must be explicitly documented (or clearly implied by a medication) and must directly correspond to a recognized clinical indication for the test.
3. Do NOT qualify based on general risk factors alone (e.g., age + obesity alone is not enough without a specific indication). There must be a documented condition that the test is designed to evaluate.
4. Medications are acceptable evidence of a diagnosis only when the medication has a well-established primary indication (e.g., metformin → diabetes, amlodipine → hypertension, warfarin → AFib or DVT).
5. Multiple weak indicators do not substitute for one direct clinical connection.
6. When in doubt, DO NOT qualify — set confidence to "low" and omit the test from qualifyingTests.`,

  conservative: `QUALIFICATION THRESHOLD (CONSERVATIVE MODE):
1. Qualify patients ONLY when there is strong multi-factor evidence: the patient must have (a) a documented diagnosis or symptom that is a primary indication for the test, AND (b) at least one corroborating factor such as a relevant medication, a supporting comorbidity, or a relevant history finding.
2. Single-factor qualification is not sufficient — a lone diagnosis without supporting evidence does not qualify.
3. For cardiovascular tests (carotid, echo, renal, ABI), require at least two of: documented cardiovascular diagnosis, relevant medication (antihypertensive, statin, antiplatelet, anticoagulant), and a corroborating comorbidity (DM, CKD, PAD, CAD, stroke history).
4. For neurological tests (BrainWave), require documented neurological or psychiatric diagnosis PLUS supporting symptoms (e.g., headaches, memory complaints, mood disorder) or relevant medications (anticonvulsants, antidepressants, anxiolytics).
5. For lower extremity studies, require documented vascular or neuropathic indication PLUS at least one corroborating factor (medication, lab/exam finding, or comorbidity).
6. Set approvalRequired: true whenever the evidence is present but not unambiguous — err on the side of requiring physician sign-off for borderline cases.
7. When evidence is insufficient, exclude the test from qualifyingTests entirely. Do NOT add borderline cases just to be safe.`,
};

function buildScreeningSystemPrompt(mode: QualificationMode = "permissive"): string {
  const thresholdInstructions = QUALIFICATION_THRESHOLD_INSTRUCTIONS[mode];
  return `You are a clinical ancillary qualification specialist. Your job is to analyze patient clinical data and determine which ancillary diagnostic tests each patient qualifies for.

${thresholdInstructions}

UNDER-40 ULTRASOUND RULE (applies in all modes): For patients whose age is known and is under 40, each of the 6 ultrasound/Doppler studies (all qualifying tests EXCEPT BrainWave and VitalWave) requires a stricter dual-criteria check. If the patient has BOTH (a) documented risk factors or diagnoses in Dx/Hx AND (b) medications that treat those conditions, set approvalRequired: false — they are fully qualified. If the patient is under 40 and does NOT meet both criteria simultaneously, still include the ultrasound test in qualifyingTests but set approvalRequired: true, meaning physician approval from Dr. Ali Imran or Dr. Ayman Alhadheri is required before scheduling. BrainWave and VitalWave are never subject to this under-40 rule (always approvalRequired: false). Patients 40 and older always have approvalRequired: false for all tests (unless the conservative mode overrides above).

Available ancillary tests (ONLY qualify for these 7 tests - no others):
- BrainWave: EEG/neurocognitive testing for cognitive, neurological, mood disorders, headaches, migraines, dizziness, vertigo, syncope, seizures, memory issues, neuropathy, TBI, anxiety, depression, insomnia, brain fog, fatigue, numbness/tingling, stroke/TIA history, tremors, balance issues, tinnitus, chronic pain
- VitalWave: ANS/autonomic nervous system and ABI testing for cardiac risk, neuropathy, dysautonomia, hypertension, diabetes, hyperlipidemia, PAD, claudication, obesity, cardiovascular disease, age >50 with CV risk factors
- Bilateral Carotid Duplex (93880): Carotid artery duplex ultrasound for stroke risk, hypertension, atherosclerosis, carotid stenosis, diabetes with circulatory complications, headache with vascular features, dizziness, visual disturbances, TIA history
- Echocardiogram TTE (93306): Transthoracic echocardiogram for cardiac function, valve disease, heart failure, hypertension, chest pain, dyspnea, murmur, palpitations, AFib, arrhythmia, edema, cardiomyopathy, CAD, syncope, sleep apnea
- Renal Artery Doppler (93975): Renal artery duplex for renovascular hypertension, kidney disease, resistant hypertension, diabetes with CKD, atherosclerosis of renal artery
- Lower Extremity Arterial Doppler (93925): Lower extremity arterial duplex for PAD, claudication, arterial insufficiency, leg pain, diabetes with peripheral angiopathy, smoking with vascular risk, diminished pulses, non-healing wounds
- Lower Extremity Venous Duplex (93971): Lower extremity venous duplex for DVT, venous insufficiency, leg edema, varicose veins, limb swelling, post-phlebitic syndrome

For each test the patient qualifies for, provide:
- clinician_understanding: A detailed, technical, evidence-based explanation citing the patient's specific conditions/medications. Include clinical indications and explain the diagnostic value. Reference specific comorbidities and how they interact to increase risk. Do NOT include any ICD-10 codes in this text. 4-5 sentences.
- patient_talking_points: A warm, detailed explanation a non-clinical outreach caller can read to the patient on the phone explaining why their doctor recommends this test. Use their specific conditions in plain language, explain what the test looks for and why it matters for their health. Be reassuring and informative. Do NOT include any ICD-10 codes in this text. 4-5 sentences. Start with "Based on..." or "Your doctor noticed..."
- confidence: "high" | "medium" | "low" (how strong the clinical indication is)
- qualifying_factors: Array of specific conditions/symptoms/medications from the patient's data that support qualification
- icd10_codes: Array of relevant ICD-10 codes that support the qualification
- pearls: Array of 2-3 short memorable one-liners (plain language, 15 words or fewer each) that outreach staff can read aloud to the patient on the phone. Each pearl should be a punchy, reassuring statement about the test or why it matters for this specific patient. Examples: "This test checks blood flow — quick, painless, no needles.", "Your blood pressure history makes this an important screening.", "Helps your doctor catch problems early, before symptoms appear."

For each patient, respond with a JSON object:
{
  "patients": [
    {
      "name": "PATIENT NAME",
      "time": "appointment time if available",
      "age": number or null,
      "gender": "M/F or full",
      "diagnoses": "extracted diagnoses summary",
      "history": "relevant medical history summary",
      "medications": "medications list",
      "qualifyingTests": ["Test1", "Test2", ...],
      "reasoning": {
        "Test1": {
          "clinician_understanding": "...",
          "patient_talking_points": "...",
          "confidence": "high",
          "qualifying_factors": ["hypertension", "diabetes"],
          "icd10_codes": ["I10", "E11.9"],
          "pearls": ["Checks blood flow to prevent stroke risk.", "Quick, painless — no needles involved.", "Your doctor flagged this based on your blood pressure history."],
          "approvalRequired": false
        }
      }
    }
  ]
}

Return ALL qualifying tests in qualifyingTests array, ordered by confidence (high first). Include reasoning for EVERY qualifying test.`;
}

export interface ScreeningPatientInput {
  name: string;
  time?: string | null;
  age?: number | null;
  gender?: string | null;
  diagnoses?: string | null;
  history?: string | null;
  medications?: string | null;
  notes?: string | null;
}

const USER_PROMPT_SUFFIX: Record<QualificationMode, string> = {
  permissive: "Analyze the following patient and qualify them for ancillary tests. Be VERY LENIENT - try to qualify for as many tests as possible.",
  standard: "Analyze the following patient and qualify them for ancillary tests. Apply the STANDARD threshold: only qualify when there is a direct clinical connection between documented conditions and the test indication.",
  conservative: "Analyze the following patient and qualify them for ancillary tests. Apply the CONSERVATIVE threshold: only qualify when there is strong multi-factor evidence. Require physician approval (approvalRequired: true) for any borderline case.",
};

export async function screenSinglePatientWithAI(patient: ScreeningPatientInput, mode: QualificationMode = "permissive"): Promise<any | null> {
  const parts = [`Patient:`];
  if (patient.name) parts.push(`Name: ${patient.name}`);
  if (patient.time) parts.push(`Time: ${patient.time}`);
  if (patient.age) parts.push(`Age: ${patient.age}`);
  if (patient.gender) parts.push(`Gender: ${patient.gender}`);
  if (patient.diagnoses) parts.push(`Diagnoses: ${patient.diagnoses}`);
  if (patient.history) parts.push(`History/HPI: ${patient.history}`);
  if (patient.medications) parts.push(`Medications: ${patient.medications}`);
  if (patient.notes) parts.push(`Notes: ${patient.notes}`);
  const description = parts.join("\n");

  const systemPrompt = buildScreeningSystemPrompt(mode);
  const userPromptSuffix = USER_PROMPT_SUFFIX[mode];

  const response = await withRetry(
    () =>
      openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `${userPromptSuffix}\n\n${description}`,
          },
        ],
        temperature: 0.2,
        response_format: { type: "json_object" },
        max_completion_tokens: 16000,
      }),
    3,
    `screenPatient:${patient.name}`
  );

  const content = response.choices[0]?.message?.content || "{}";
  const finishReason = response.choices[0]?.finish_reason;

  const tryParse = (text: string): any | null => {
    try {
      const parsed = JSON.parse(text);
      if (parsed?.patients && Array.isArray(parsed.patients)) {
        return parsed.patients[0] || null;
      }
      return parsed;
    } catch {
      return null;
    }
  };

  if (finishReason === "length") {
    console.error(`AI response truncated for patient: ${patient.name}. Attempting partial recovery.`);
    const partial = tryParse(content);
    if (partial && partial.qualifyingTests && Array.isArray(partial.qualifyingTests) && partial.qualifyingTests.length > 0) {
      console.warn(`Partial recovery succeeded for patient: ${patient.name}. Recovered ${partial.qualifyingTests.length} qualifying tests.`);
      return partial;
    }
    const arrayMatch = content.match(/"qualifyingTests"\s*:\s*(\[[\s\S]*?\])/);
    if (arrayMatch) {
      try {
        const recoveredTests = JSON.parse(arrayMatch[1]);
        console.warn(`Regex partial recovery succeeded for patient: ${patient.name}. Recovered ${recoveredTests.length} qualifying tests.`);
        return { qualifyingTests: recoveredTests };
      } catch {
        // fall through to full parse attempt
      }
    }
    console.error(`Partial recovery failed for patient: ${patient.name}. Returning null.`);
    return null;
  }

  const result = tryParse(content);
  if (result === null) {
    console.error(`Failed to parse AI response for patient: ${patient.name}. First 300 chars: ${content.substring(0, 300)}`);
  }
  return result;
}

export async function checkCooldownsForPatients(
  patients: { name: string; qualifyingTests: string[] }[],
  visitDate?: string
): Promise<Record<string, { test: string; lastDate: string; insuranceType: string; cooldownMonths: number }[]>> {
  const allHistory = await storage.getAllTestHistory();
  if (allHistory.length === 0) return {};

  const cutoffDate = visitDate || new Date().toISOString().split("T")[0];
  const filteredHistory = allHistory.filter((h) => h.dateOfService < cutoffDate);
  if (filteredHistory.length === 0) return {};

  const historyText = filteredHistory.map((h, i) => `[${i}] ${h.patientName} | ${h.testName} | ${h.dateOfService} | ${h.insuranceType}`).join("\n");

  const patientsText = patients.map((p) => `${p.name}: [${p.qualifyingTests.join(", ")}]`).join("\n");

  // Phase 1: AI is used ONLY for fuzzy name matching and test name matching.
  // It returns which history record indices belong to each patient — no cooldown math.
  const response = await withRetry(
    () =>
      openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are a patient name matching assistant. You will be given:
1. A numbered list of historical patient test records: [index] name | test | date | insurance_type
2. A list of patients with their currently qualifying tests

Your ONLY job is to:
- Match patients by name using fuzzy matching (handle "Last, First" vs "First Last", nicknames, minor spelling differences)
- For each matched history record, determine which qualifying test(s) it corresponds to

Do NOT make any cooldown calculations, date comparisons, or decisions about whether a test is within a cooldown window. That will be done separately.

TEST NAME MATCHING:
- "BrainWave" in history matches "BrainWave" in qualifying tests
- "VitalWave" or "VitalScan" in history matches "VitalWave" in qualifying tests
- Any ultrasound test name should be matched to the specific qualifying test (e.g., "Bilateral Carotid Duplex", "Echocardiogram", "Renal Artery Doppler", etc.)
- "Ultrasound" in history could match any ultrasound qualifying test - list all that apply

Return a JSON object where keys are the EXACT patient names from the qualifying tests list, and values are arrays of matched history records:
{
  "Patient Name": [
    {
      "historyIndex": 0,
      "matchedQualifyingTest": "exact test name from qualifying tests"
    }
  ]
}

Only include patients who have at least one matched history record. If no matches found, return empty object {}.`,
          },
          {
            role: "user",
            content: `HISTORICAL TEST RECORDS:\n${historyText}\n\nPATIENTS TO CHECK:\n${patientsText}`,
          },
        ],
        temperature: 0.1,
        response_format: { type: "json_object" },
      }),
    3,
    "checkCooldowns"
  );

  try {
    const nameMatches: Record<string, { historyIndex: number; matchedQualifyingTest: string }[]> =
      JSON.parse(response.choices[0]?.message?.content || "{}");

    // Phase 2: Deterministic TypeScript date math for cooldown calculation.
    const result: Record<string, { test: string; lastDate: string; insuranceType: string; cooldownMonths: number }[]> = {};

    const cutoff = new Date(cutoffDate);

    for (const patientName of Object.keys(nameMatches)) {
      const matches = nameMatches[patientName];
      if (!Array.isArray(matches)) continue;

      const violations: { test: string; lastDate: string; insuranceType: string; cooldownMonths: number }[] = [];

      for (const match of matches) {
        const idx = match.historyIndex;
        if (typeof idx !== "number" || idx < 0 || idx >= filteredHistory.length) continue;

        const record = filteredHistory[idx];
        if (!record) continue;

        const lastDate = new Date(record.dateOfService);
        if (isNaN(lastDate.getTime())) continue;

        // Ensure the history record is strictly before the cutoff
        if (record.dateOfService >= cutoffDate) continue;

        const insuranceType = record.insuranceType === "medicare" ? "medicare" : "ppo";
        const cooldownMonths = insuranceType === "medicare" ? 12 : 6;

        // Deterministic date math: add cooldownMonths to lastDate and compare to cutoff
        const expiryDate = new Date(lastDate);
        expiryDate.setMonth(expiryDate.getMonth() + cooldownMonths);

        if (expiryDate > cutoff) {
          violations.push({
            test: match.matchedQualifyingTest,
            lastDate: record.dateOfService,
            insuranceType,
            cooldownMonths,
          });
        }
      }

      if (violations.length > 0) {
        result[patientName] = violations;
      }
    }

    return result;
  } catch {
    console.error("Failed to parse cooldown check response");
    return {};
  }
}

export async function enrichFromReferenceDb(patients: any[]): Promise<void> {
  const allRefs = await storage.getAllPatientReferences();
  if (allRefs.length === 0 || patients.length === 0) return;

  const patientNames = patients.filter((p) => p.name).map((p) => ({ id: p.id, name: p.name }));
  if (patientNames.length === 0) return;

  try {
    const response = await withRetry(
      () =>
        openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: `You are a patient name matcher. Match newly added patients to a reference database of known patients.
For each new patient, find the best match in the reference database using fuzzy name matching.
Handle variations like "Last, First" vs "First Last", nicknames (Bill/William, Bob/Robert), minor spelling differences, and missing middle names.
Only match if you're confident it's the same person. Return a JSON array of matches.

Each match: { "patientId": <number>, "referenceId": <number> }
If no match, omit that patient. Respond with ONLY a valid JSON array.`,
            },
            {
              role: "user",
              content: `New patients:\n${JSON.stringify(patientNames)}\n\nReference database:\n${JSON.stringify(allRefs.map((r) => ({ id: r.id, name: r.patientName })))}`,
            },
          ],
          temperature: 0,
        }),
      3,
      "enrichFromReferenceDb"
    );

    const content = response.choices[0]?.message?.content?.trim() || "[]";
    const cleaned = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const matches: { patientId: number; referenceId: number }[] = JSON.parse(cleaned);

    const refMap = new Map(allRefs.map((r) => [r.id, r]));

    for (const match of matches) {
      const ref = refMap.get(match.referenceId);
      if (!ref) continue;

      const patient = patients.find((p) => p.id === match.patientId);
      if (!patient) continue;

      const updates: any = {};
      if (!patient.diagnoses && ref.diagnoses) updates.diagnoses = ref.diagnoses;
      if (!patient.history && ref.history) updates.history = ref.history;
      if (!patient.medications && ref.medications) updates.medications = ref.medications;
      if (!patient.age && ref.age) updates.age = parseInt(ref.age) || null;
      if (!patient.gender && ref.gender) updates.gender = ref.gender;
      if (!patient.notes && ref.insurance) updates.notes = `Insurance: ${ref.insurance}`;

      if (Object.keys(updates).length > 0) {
        await storage.updatePatientScreening(match.patientId, updates);
      }
    }
  } catch (err: any) {
    console.error("Reference DB auto-fill failed:", err.message);
  }
}

export async function parseReferenceImportWithAI(text: string): Promise<any[]> {
  const response = await withRetry(
    () =>
      openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are a clinical data parser. Extract patient reference records from the provided data.
For each patient, extract:
- patientName: Full name (required)
- age: Age as string if present, or null
- gender: Gender if present (M/F/Male/Female), or null
- diagnoses: All diagnoses, conditions, Dx mentioned (combine into one string), or null
- history: Past medical history, Hx, PMH (combine into one string), or null
- medications: All medications, Rx listed (combine into one string), or null
- insurance: Insurance type/plan if present, or null
- notes: Any additional notes, or null

Parse common abbreviations: HTN=hypertension, DM=diabetes mellitus, COPD, CHF, CAD, A-fib, HLD=hyperlipidemia, CKD, OA=osteoarthritis, GERD, etc.

Return JSON: { "records": [ { "patientName": "...", "age": "...", "gender": "...", "diagnoses": "...", "history": "...", "medications": "...", "insurance": "...", "notes": "..." } ] }

Skip rows that are headers, empty, or don't contain valid patient data.`,
          },
          {
            role: "user",
            content: text.substring(0, 30000),
          },
        ],
        temperature: 0.1,
        response_format: { type: "json_object" },
        max_completion_tokens: 16000,
      }),
    3,
    "parseReferenceImport"
  );

  try {
    const parsed = JSON.parse(response.choices[0]?.message?.content || '{"records":[]}');
    return parsed.records || [];
  } catch {
    console.error("Failed to parse reference import response");
    return [];
  }
}

export async function analyzeTestWithAI(
  patient: { name: string; age?: number | null; gender?: string | null; diagnoses?: string | null; history?: string | null; medications?: string | null; notes?: string | null },
  testName: string
): Promise<any> {
  const systemPrompt = `You are a clinical ancillary qualification specialist. Generate clinical reasoning for a specific diagnostic test for this patient.

Return ONLY this JSON object:
{
  "clinician_understanding": "Technical 4-5 sentence evidence-based explanation citing the patient's specific conditions. Do NOT include ICD-10 codes in text.",
  "patient_talking_points": "Warm 4-5 sentence plain-language explanation for a non-clinical outreach caller. Start with 'Based on...' or 'Your doctor noticed...'. Do NOT include ICD-10 codes in text.",
  "confidence": "high",
  "qualifying_factors": ["condition1", "medication1"],
  "icd10_codes": ["I10", "E11.9"],
  "pearls": ["Short memorable pearl 1 (15 words or fewer).", "Short memorable pearl 2.", "Short memorable pearl 3."]
}

pearls: Array of 2-3 punchy one-liners outreach staff can read aloud to the patient — plain language, 15 words or fewer each, reassuring and specific to this patient's situation.`;

  const patientInfo = [
    `Name: ${patient.name}`,
    patient.age ? `Age: ${patient.age}` : null,
    patient.gender ? `Gender: ${patient.gender}` : null,
    patient.diagnoses ? `Diagnoses: ${patient.diagnoses}` : null,
    patient.history ? `History/HPI: ${patient.history}` : null,
    patient.medications ? `Medications: ${patient.medications}` : null,
    patient.notes ? `Notes: ${patient.notes}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const response = await withRetry(
    () =>
      openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Patient:\n${patientInfo}\n\nGenerate clinical reasoning for: ${testName}` },
        ],
        temperature: 0.2,
        response_format: { type: "json_object" },
        max_completion_tokens: 2000,
      }),
    3,
    `analyzeTest:${testName}`
  );

  return JSON.parse(response.choices[0]?.message?.content || "{}");
}

export async function extractPdfPatients(text: string): Promise<{ name: string; time?: string }[]> {
  const extractionPrompt = `Extract all patient names and appointment times from this document/image. Return a JSON object: { "patients": [{ "name": "Full Name", "time": "time if visible" }] }. Only include actual patient names, not doctor names or staff.`;

  const response = await withRetry(
    () =>
      openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: `${extractionPrompt}\n\nDocument text:\n${text}` }],
        response_format: { type: "json_object" },
      }),
    3,
    "extractPdfPatients"
  );

  try {
    const parsed = JSON.parse(response.choices[0]?.message?.content || "{}");
    if (parsed.patients && Array.isArray(parsed.patients)) {
      return parsed.patients.filter((p: any) => p.name).map((p: any) => ({ name: p.name, time: p.time || undefined }));
    }
  } catch {
    console.error("Failed to parse PDF AI extraction response");
  }
  return [];
}

export async function extractImagePatients(base64: string, mimeType: string): Promise<{ name: string; time?: string }[]> {
  const extractionPrompt = `Extract all patient names and appointment times from this document/image. Return a JSON object: { "patients": [{ "name": "Full Name", "time": "time if visible" }] }. Only include actual patient names, not doctor names or staff.`;
  const dataUrl = `data:${mimeType};base64,${base64}`;

  const response = await withRetry(
    () =>
      openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: extractionPrompt },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
        response_format: { type: "json_object" },
      }),
    3,
    "extractImagePatients"
  );

  try {
    const parsed = JSON.parse(response.choices[0]?.message?.content || "{}");
    if (parsed.patients && Array.isArray(parsed.patients)) {
      return parsed.patients.filter((p: any) => p.name).map((p: any) => ({ name: p.name, time: p.time || undefined }));
    }
  } catch {
    console.error("Failed to parse image AI extraction response");
  }
  return [];
}
