const NAME_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

const NICKNAME_TO_CANONICAL: Record<string, string> = {
  bill: "william", billy: "william", will: "william", willy: "william", liam: "william",
  bob: "robert", rob: "robert", robby: "robert", bobby: "robert", bert: "robert",
  rick: "richard", ricky: "richard", dick: "richard", rich: "richard", richie: "richard",
  jim: "james", jimmy: "james", jamie: "james",
  joe: "joseph", joey: "joseph",
  mike: "michael", mikey: "michael", mick: "michael",
  dave: "david", davy: "david",
  tom: "thomas", tommy: "thomas",
  tony: "anthony",
  chris: "christopher",
  matt: "matthew",
  pat: "patrick",
  steve: "steven", stephen: "steven",
  ed: "edward", eddie: "edward", ted: "edward",
  dan: "daniel", danny: "daniel",
  nick: "nicholas",
  alex: "alexander",
  ben: "benjamin", benny: "benjamin",
  sam: "samuel", sammy: "samuel",
  greg: "gregory",
  ron: "ronald", ronnie: "ronald",
  don: "donald", donnie: "donald",
  jerry: "gerald", gerry: "gerald",
  larry: "lawrence",
  ken: "kenneth", kenny: "kenneth",
  beth: "elizabeth", liz: "elizabeth", lizzy: "elizabeth", betty: "elizabeth", eliza: "elizabeth", betsy: "elizabeth",
  kate: "katherine", katie: "katherine", kathy: "katherine", cathy: "katherine", catherine: "katherine", kat: "katherine",
  meg: "margaret", maggie: "margaret", peggy: "margaret",
  sue: "susan", susie: "susan", suzy: "susan",
  patty: "patricia", trish: "patricia", pattie: "patricia",
  jen: "jennifer", jenny: "jennifer", jenn: "jennifer",
  becky: "rebecca",
  cindy: "cynthia",
  debbie: "deborah", deb: "deborah", debra: "deborah",
  barb: "barbara", barbie: "barbara",
  sandy: "sandra",
  vicky: "victoria", vickie: "victoria",
  tina: "christina", chrissy: "christina",
};

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

/**
 * Build a canonical name key that's robust to common variants:
 *   - "Smith, John A"  -> "john smith"
 *   - "John A. Smith Jr." -> "john smith"
 *   - "Bill Smith"     -> "william smith"  (nickname -> canonical)
 *   - "Mary-Jane Doe"  -> "mary jane doe"  (hyphen -> space, kept as middle/last)
 *
 * Strategy: take the first and last token after stripping suffixes; map known
 * nicknames on the first token. Single-token names pass through unchanged.
 */
export function canonicalNameKey(name: string | null | undefined): string {
  const normalized = normalizePatientName(name);
  if (!normalized) return "";
  const tokens = normalized.split(/\s+/).filter((t) => t && !NAME_SUFFIXES.has(t));
  if (tokens.length === 0) return "";
  if (tokens.length === 1) {
    return NICKNAME_TO_CANONICAL[tokens[0]] || tokens[0];
  }
  let first = tokens[0];
  const last = tokens[tokens.length - 1];
  first = NICKNAME_TO_CANONICAL[first] || first;
  return `${first} ${last}`;
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
  const n = canonicalNameKey(name);
  const d = normalizeDob(dob);
  return `${n}__${d}`;
}

export function splitPatientKey(key: string): { name: string; dob: string } {
  const idx = key.indexOf("__");
  if (idx < 0) return { name: key, dob: "" };
  return { name: key.slice(0, idx), dob: key.slice(idx + 2) };
}

export function encodePatientKey(key: string): string {
  return Buffer.from(key, "utf-8").toString("base64url");
}

export function decodePatientKey(encoded: string): string {
  return Buffer.from(encoded, "base64url").toString("utf-8");
}
