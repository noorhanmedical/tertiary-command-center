// Contact restrictions + cooldown helpers (Batch B13).
//
// Pure module shared by client and server. Encodes the cooldown
// presets (30/60/90 days, 6/12 months, custom) and the
// before-outreach gate.

export type CooldownPreset =
  | "30d" | "60d" | "90d" | "6m" | "12m" | "custom";

export const COOLDOWN_PRESET_LABEL: Record<CooldownPreset, string> = {
  "30d": "30 days",
  "60d": "60 days",
  "90d": "90 days",
  "6m": "6 months",
  "12m": "12 months",
  "custom": "Custom",
};

export const COOLDOWN_PRESET_DAYS: Record<Exclude<CooldownPreset, "custom">, number> = {
  "30d": 30,
  "60d": 60,
  "90d": 90,
  "6m": 183,
  "12m": 365,
};

export function endsAtForPreset(now: Date, preset: Exclude<CooldownPreset, "custom">): Date {
  const d = new Date(now.getTime());
  d.setDate(d.getDate() + COOLDOWN_PRESET_DAYS[preset]);
  return d;
}

export type ContactRestrictionFacts = {
  doNotContact: boolean;
  doNotContactReason: string | null;
  doNotContactSetAt: string | null;
  cooldown: {
    active: boolean;
    endsAt: string | null;
    reason: string | null;
  } | null;
};

export type OutreachGateOutcome =
  | { allowed: true }
  | { allowed: false; reason: "dnc"; message: string }
  | { allowed: false; reason: "active_cooldown"; message: string };

export function gateOutreach(facts: ContactRestrictionFacts): OutreachGateOutcome {
  if (facts.doNotContact) {
    return {
      allowed: false,
      reason: "dnc",
      message: `Do Not Contact${facts.doNotContactReason ? ` — ${facts.doNotContactReason}` : ""}`,
    };
  }
  if (facts.cooldown && facts.cooldown.active) {
    return {
      allowed: false,
      reason: "active_cooldown",
      message: `Active cooldown until ${facts.cooldown.endsAt ?? "(no end date)"}${facts.cooldown.reason ? ` — ${facts.cooldown.reason}` : ""}`,
    };
  }
  return { allowed: true };
}

/** Returns true when an active cooldown is in effect (and therefore blocks outreach). */
export function isCooldownActive(endsAt: string | null, now: Date = new Date()): boolean {
  if (!endsAt) return false;
  const d = new Date(endsAt);
  if (Number.isNaN(d.getTime())) return false;
  return d.getTime() > now.getTime();
}
