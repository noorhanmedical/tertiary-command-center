// Direct Messages feature-flag + Twilio exclusion static tests.
//
// Locks:
//   §1 Feature flag defaults OFF unless the env var is truthy.
//   §2 Route file imports the feature gate.
//   §3 Route file never references Twilio / SMS / phone patterns.
//   §4 Migration file is additive-only (no ALTER, DROP, TRUNCATE on
//      existing tables).
//   §5 Migration file only creates the direct_messages table + its
//      three indexes.
//   §6 Schema file marks direct_messages as INTERNAL only (no Twilio /
//      SMS / patient columns).
//   §7 Repository has no getAll patterns; every db.select has a
//      .where.
//
// Runnable via: npx tsx tests/unit/directMessagesFeatureGate.test.ts

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const flagsSrc = fs.readFileSync(path.join(ROOT, "server/lib/featureFlags.ts"), "utf8");
const routeSrc = fs.readFileSync(path.join(ROOT, "server/routes/directMessages.ts"), "utf8");
const serviceSrc = fs.readFileSync(path.join(ROOT, "server/services/directMessages/directMessagesService.ts"), "utf8");
const repoSrc = fs.readFileSync(path.join(ROOT, "server/repositories/directMessages.repo.ts"), "utf8");
const schemaSrc = fs.readFileSync(path.join(ROOT, "shared/schema/directMessages.ts"), "utf8");
const migSrc = fs.readFileSync(path.join(ROOT, "migrations/0043_add_direct_messages.sql"), "utf8");

let failures = 0;
function ok(cond: unknown, label: string): void {
  if (!cond) {
    failures++;
    console.error(`- ${label}`);
  }
}

// §1: flag defaults false
ok(
  /internalDirectMessages:\s*readBool\("FEATURE_INTERNAL_DIRECT_MESSAGES",\s*false\)/.test(
    flagsSrc,
  ),
  "§1 FEATURE_INTERNAL_DIRECT_MESSAGES default OFF",
);
ok(
  /portalAssistant:\s*readBool\("FEATURE_PORTAL_ASSISTANT",\s*false\)/.test(flagsSrc),
  "§1 FEATURE_PORTAL_ASSISTANT default OFF",
);
ok(
  /clinicalIntelligenceLive:\s*readBool\("FEATURE_CLINICAL_INTELLIGENCE_LIVE",\s*false\)/.test(
    flagsSrc,
  ),
  "§1 FEATURE_CLINICAL_INTELLIGENCE_LIVE default OFF",
);

// §2: route imports feature gate
ok(
  /isEnabled\s*\(\s*"internalDirectMessages"\s*\)/.test(routeSrc),
  "§2 route file calls isEnabled('internalDirectMessages')",
);

// §3: no Twilio/SMS/phone across DM stack
const SMS_PATTERNS = [/twilio/i, /\bsms\b/i, /patientSms/i, /patient_sms/i];
for (const [name, src] of [
  ["route", routeSrc],
  ["service", serviceSrc],
  ["repo", repoSrc],
  ["schema", schemaSrc],
  ["migration", migSrc],
]) {
  for (const pat of SMS_PATTERNS) {
    if (pat.test(src)) {
      // Any non-comment hit fails. Strip comments first.
      const code = src
        .split("\n")
        .filter((l) => !/^\s*(--|\/\/)/.test(l))
        .join("\n");
      if (pat.test(code)) {
        ok(false, `§3 ${name} contains forbidden pattern ${pat}`);
      }
    }
  }
}

// §4/§5: migration is additive-only, direct_messages only.
// Strip comments before the check (the rollback plan mentions DROP
// TABLE inside a comment — that's not executable).
const migCode = migSrc
  .split("\n")
  .filter((l) => !/^\s*--/.test(l))
  .join("\n");
ok(
  !/\bALTER\s+TABLE\b|\bDROP\s+TABLE\b|\bTRUNCATE\b/i.test(migCode),
  "§4 migration performs no ALTER/DROP/TRUNCATE",
);
ok(
  /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+direct_messages/i.test(migSrc),
  "§5 migration creates direct_messages",
);
// Only ONE CREATE TABLE
const createCount = (migSrc.match(/CREATE\s+TABLE/gi) ?? []).length;
ok(createCount === 1, `§5 migration only creates ONE table (found ${createCount})`);

// §6: schema explicitly internal-only (no patient / phone / vendor columns).
// Strip comments before the check.
const schemaCode = schemaSrc
  .split("\n")
  .filter((l) => !/^\s*(--|\/\/)/.test(l))
  .join("\n");
ok(
  !/patient_id|phone_number|vendor|recipient_phone/i.test(schemaCode),
  "§6 schema has no patient / phone / vendor columns",
);
ok(
  /sender_user_id[\s\S]*recipient_user_id/.test(schemaSrc),
  "§6 schema uses internal user ids for sender + recipient",
);

// §7: repo scope discipline.
// Every db.select has a .where (>= is acceptable — some functions have
// additional filters or chain multiple wheres like insert+where).
const selects = (repoSrc.match(/\.select\(/g) ?? []).length;
const wheres = (repoSrc.match(/\.where\(/g) ?? []).length;
ok(
  selects <= wheres,
  `§7 every db.select in repo has at least one .where (${selects}/${wheres})`,
);
ok(!/getAll[A-Z]/.test(repoSrc), "§7 repo has no getAll* pattern");

if (failures > 0) {
  console.error(`directMessagesFeatureGate.test.ts: ${failures} failure(s)`);
  process.exit(1);
}
console.log("directMessagesFeatureGate.test.ts: all tests passed");
