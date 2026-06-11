import assert from "node:assert/strict";
import {
  COOLDOWN_PRESET_DAYS,
  COOLDOWN_PRESET_LABEL,
  endsAtForPreset,
  gateOutreach,
  isCooldownActive,
} from "../../shared/contactRestrictions";

async function main() {
  assert.equal(COOLDOWN_PRESET_LABEL["30d"], "30 days");
  assert.equal(COOLDOWN_PRESET_DAYS["6m"], 183);

  const base = new Date("2026-06-11T12:00:00Z");
  const ends = endsAtForPreset(base, "30d");
  assert.equal(ends.toISOString().slice(0, 10), "2026-07-11");

  // DNC blocks.
  const g1 = gateOutreach({ doNotContact: true, doNotContactReason: "Patient request", doNotContactSetAt: null, cooldown: null });
  assert.equal(g1.allowed, false);
  if (g1.allowed === false) assert.equal(g1.reason, "dnc");

  // Active cooldown blocks.
  const g2 = gateOutreach({ doNotContact: false, doNotContactReason: null, doNotContactSetAt: null, cooldown: { active: true, endsAt: "2026-12-01", reason: "30-day rule" } });
  assert.equal(g2.allowed, false);
  if (g2.allowed === false) assert.equal(g2.reason, "active_cooldown");

  // No restrictions -> allowed.
  const g3 = gateOutreach({ doNotContact: false, doNotContactReason: null, doNotContactSetAt: null, cooldown: { active: false, endsAt: "2024-01-01", reason: null } });
  assert.equal(g3.allowed, true);

  // isCooldownActive
  assert.equal(isCooldownActive("2099-01-01"), true);
  assert.equal(isCooldownActive("2000-01-01"), false);
  assert.equal(isCooldownActive(null), false);

  console.log("Contact restrictions test passed.");
}

main().catch((e) => { console.error(e); process.exit(1); });
