// READ-ONLY smoke: verify the new 'scheduled' + 'refused' cohort SQL executes
// against the live DB (no writes). Confirms the predicates + baseline-bypass
// compile and run. Usage: set -a; source .env; set +a; npx tsx script/qaCohortsSmoke.ts
import { pool } from "../server/db";
import { countCohort } from "../server/services/engagement/callListCohortService";
import { CALL_LIST_COHORT_KEYS } from "@shared/engagement/callListCohorts";

async function main() {
  const facility = process.env.QA_FACILITY || "Taylor Family Practice";
  const out: Record<string, number | string> = {};
  for (const cohort of CALL_LIST_COHORT_KEYS) {
    try {
      // eslint-disable-next-line no-await-in-loop
      out[cohort] = await countCohort({ cohort, facility });
    } catch (e) {
      out[cohort] = `ERROR: ${(e as Error).message}`;
    }
  }
  console.log(JSON.stringify({ facility, counts: out }, null, 2));
  await pool.end();
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
