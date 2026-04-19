import { parse } from "csv-parse/sync";
import { openai, withRetry } from "../services/aiClient";

export function csvToText(buffer: Buffer): string {
  try {
    const records = parse(buffer.toString("utf-8"), {
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
    }) as Record<string, string>[];
    if (records.length === 0) return buffer.toString("utf-8");
    const headers = Object.keys(records[0]);
    return [
      headers.join("\t"),
      ...records.map((r) => headers.map((h) => r[h] ?? "").join("\t")),
    ].join("\n");
  } catch {
    return buffer.toString("utf-8");
  }
}

export const CSV_COLUMN_ALIASES: Record<string, string> = {
  patientname: "patientName",
  patient: "patientName",
  name: "patientName",
  "patient name": "patientName",
  testname: "testName",
  test: "testName",
  "test name": "testName",
  service: "testName",
  dos: "dateOfService",
  "date of service": "dateOfService",
  date: "dateOfService",
  servicedate: "dateOfService",
  insurancetype: "insuranceType",
  insurance: "insuranceType",
  "insurance type": "insuranceType",
  payer: "insuranceType",
  dob: "dob",
  "date of birth": "dob",
  dateofbirth: "dob",
  birthdate: "dob",
  birthday: "dob",
  "birth date": "dob",
};

export function normalizeInsuranceType(raw: string): "medicare" | "ppo" {
  const s = raw.toLowerCase().trim();
  const isMedicareAdvantage =
    s.includes("medicare advantage") ||
    s.includes("hmo medicare") ||
    s.includes("ma plan") ||
    s.includes("mapd") ||
    s.includes("ma-pd");
  if (isMedicareAdvantage) return "ppo";
  if (s.includes("medicare")) return "medicare";
  return "ppo";
}

export function parseHistoryCsv(text: string): { patientName: string; dob?: string; testName: string; dateOfService: string; insuranceType: string }[] | null {
  try {
    const rows = parse(text, { skip_empty_lines: true, relax_column_count: true }) as string[][];
    if (rows.length < 2) return null;

    const headerRow = rows[0].map((h) => h.trim().toLowerCase());
    const colMap: Record<string, number> = {};
    for (let i = 0; i < headerRow.length; i++) {
      const normalized = CSV_COLUMN_ALIASES[headerRow[i]];
      if (normalized && !(normalized in colMap)) {
        colMap[normalized] = i;
      }
    }

    const required = ["patientName", "testName", "dateOfService"];
    if (!required.every((k) => k in colMap)) return null;

    const results: { patientName: string; dob?: string; testName: string; dateOfService: string; insuranceType: string }[] = [];
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const patientName = (row[colMap.patientName] || "").trim();
      const testName = (row[colMap.testName] || "").trim();
      const dateOfService = (row[colMap.dateOfService] || "").trim();
      if (!patientName || !testName || !dateOfService) continue;
      const rawInsurance = colMap.insuranceType !== undefined ? (row[colMap.insuranceType] || "") : "";
      const insuranceType = normalizeInsuranceType(rawInsurance);
      const dob = colMap.dob !== undefined ? ((row[colMap.dob] || "").trim() || undefined) : undefined;
      results.push({ patientName, dob, testName, dateOfService, insuranceType });
    }
    return results.length > 0 ? results : null;
  } catch {
    return null;
  }
}

export async function parseHistoryImport(text: string): Promise<{ patientName: string; dob?: string; testName: string; dateOfService: string; insuranceType: string }[]> {
  const response = await withRetry(
    () =>
      openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are a clinical data parser. You will receive raw text data from a patient test history spreadsheet/database. Extract patient records with:
- patientName: The patient's full name (Last, First format)
- dob: Date of birth in MM/DD/YYYY or YYYY-MM-DD format if available, otherwise null
- testName: The type of test performed. Look at the section header or context to determine the test type. Common tests: BrainWave, VitalWave, Bilateral Carotid Duplex, Echocardiogram TTE, Renal Artery Doppler, Lower Extremity Arterial Doppler, Upper Extremity Arterial Doppler, Abdominal Aortic Aneurysm Duplex, Stress Echocardiogram, Lower Extremity Venous Duplex, Upper Extremity Venous Duplex
- dateOfService: The date in YYYY-MM-DD format
- insuranceType: "medicare" or "ppo". Use "medicare" ONLY for straight/traditional/original Medicare. Medicare Advantage, HMO Medicare, MA plan, MAPD → use "ppo". Default to "ppo" when unclear.

The data is tab-separated and may have multiple columns. Focus on extracting the Date of Service (first column usually), Patient name (second column), DOB if present, and any insurance information available.

Return JSON: { "records": [ { "patientName": "...", "dob": "...", "testName": "...", "dateOfService": "...", "insuranceType": "..." } ] }

Skip rows that are headers, empty, or don't contain valid patient data (no date or no name).`,
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
    "parseHistoryImport"
  );

  try {
    const parsed = JSON.parse(response.choices[0]?.message?.content || '{"records":[]}');
    return parsed.records || [];
  } catch {
    console.error("Failed to parse history import response");
    return [];
  }
}
