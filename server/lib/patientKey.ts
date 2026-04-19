export function normalizePatientName(name: string | null | undefined): string {
  if (!name) return "";
  let n = name.trim().toLowerCase();
  if (n.includes(",")) {
    const [last, first] = n.split(",", 2).map((s) => s.trim());
    n = `${first} ${last}`.trim();
  }
  n = n.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  return n;
}

export function normalizeDob(dob: string | null | undefined): string {
  if (!dob) return "";
  const s = String(dob).trim();
  if (!s) return "";
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (us) {
    let yr = us[3];
    if (yr.length === 2) yr = parseInt(yr, 10) > 30 ? `19${yr}` : `20${yr}`;
    return `${yr}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  }
  return s;
}

export function patientKey(name: string | null | undefined, dob: string | null | undefined): string {
  const n = normalizePatientName(name);
  const d = normalizeDob(dob);
  return `${n}__${d}`;
}

export function encodePatientKey(key: string): string {
  return Buffer.from(key, "utf-8").toString("base64url");
}

export function decodePatientKey(encoded: string): string {
  return Buffer.from(encoded, "base64url").toString("utf-8");
}
