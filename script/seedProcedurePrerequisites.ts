// Seed platform-default procedure_start hard blockers for BrainWave & VitalWave.
//
// Requires migration 0054 (ancillary_service_prerequisite_config) applied and a
// DATABASE_URL. Idempotent: skips a (clinic-default, service, requirement, stage)
// row that already exists. clinic_id IS NULL ⇒ platform default (a clinic row
// overrides it per requirement_code).
//
//   DATABASE_URL=... npx tsx script/seedProcedurePrerequisites.ts

import { db } from "../server/db";
import { and, eq, isNull } from "drizzle-orm";
import { ancillaryServicePrerequisiteConfig } from "@shared/schema/procedurePrerequisites";

const SERVICES = ["BrainWave", "VitalWave"];
const REQUIREMENTS = ["screening_form", "order_note_signature"];
const STAGE = "procedure_start";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log("SKIP — DATABASE_URL not set.");
    process.exit(0);
  }
  let created = 0;
  for (const serviceType of SERVICES) {
    for (const requirementCode of REQUIREMENTS) {
      const existing = await db
        .select({ id: ancillaryServicePrerequisiteConfig.id })
        .from(ancillaryServicePrerequisiteConfig)
        .where(
          and(
            isNull(ancillaryServicePrerequisiteConfig.clinicId),
            eq(ancillaryServicePrerequisiteConfig.serviceType, serviceType),
            eq(ancillaryServicePrerequisiteConfig.requirementCode, requirementCode),
            eq(ancillaryServicePrerequisiteConfig.blocksStage, STAGE),
          ),
        )
        .limit(1);
      if (existing.length > 0) {
        console.log(`exists: ${serviceType}/${requirementCode}@${STAGE}`);
        continue;
      }
      await db.insert(ancillaryServicePrerequisiteConfig).values({
        clinicId: null,
        serviceType,
        requirementCode,
        blockerCategory: "hard_procedure_blocker",
        blocksStage: STAGE,
        required: true,
        overrideAllowed: false,
        overrideAuditRequired: true,
        active: true,
      });
      created++;
      console.log(`seeded: ${serviceType}/${requirementCode}@${STAGE}`);
    }
  }
  console.log(`\nDone. ${created} default prerequisite row(s) created.`);
  process.exit(0);
}

main().catch((e) => { console.error("seed error:", e); process.exit(1); });
