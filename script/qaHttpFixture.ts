// HTTP validation fixture for the multi-clinic Team Portal. Seeds disposable,
// tagged data + a loginable subject user, or cleans it up.
//   DATABASE_URL=... npx tsx script/qaHttpFixture.ts seed
//   DATABASE_URL=... npx tsx script/qaHttpFixture.ts cleanup
import { pool } from "../server/db";
import bcrypt from "bcryptjs";

const QA = "QAHTTP";
const ALPHA = `${QA} Alpha`; // PCS only
const BETA = `${QA} Beta`; // ACS only
const GAMMA = `${QA} Gamma`; // PCS + ACS
const DELTA = `${QA} Delta`; // unauthorized
const USERNAME = `${QA}_callista`;
const PASSWORD = "QaMultiClinicPass_123456";

async function q(text: string, params: unknown[] = []) {
  return (await pool.query(text, params)).rows as any[];
}

async function cleanup() {
  await q(`delete from patient_execution_cases where facility_id like $1`, [`${QA}%`]);
  await q(`delete from global_schedule_events where facility_id like $1`, [`${QA}%`]);
  await q(`delete from team_memberships where user_id in (select id from users where username like $1)`, [`${QA}%`]);
  await q(`delete from teams where facility_id like $1`, [`${QA}%`]);
  await q(`delete from outreach_schedulers where facility like $1 or name like $2`, [`${QA}%`, `${QA}%`]);
  await q(`delete from clinics where slug like $1`, [`qahttp-%`]);
  await q(`delete from users where username like $1`, [`${QA}%`]);
}

async function seed() {
  await cleanup();
  for (const [name, slug] of [
    [ALPHA, "qahttp-alpha"], [BETA, "qahttp-beta"], [GAMMA, "qahttp-gamma"], [DELTA, "qahttp-delta"],
  ] as const) {
    await q(`insert into clinics (name, slug, active) values ($1,$2,true)`, [name, slug]);
  }
  const hash = await bcrypt.hash(PASSWORD, 12);
  // Legacy clinic_id left null (multi-clinic member has no single tenant); role
  // liaison so requirePortalRole passes.
  const [subj] = await q(
    `insert into users (username, password, role, active, status) values ($1,$2,'liaison',true,'active') returning id`,
    [USERNAME, hash],
  );
  const [other] = await q(
    `insert into users (username, password, role, active, status) values ($1,$2,'technician',true,'active') returning id`,
    [`${QA}_other`, hash],
  );
  const subjectId = subj.id as string;
  const otherId = other.id as string;

  const team = async (name: string, type: string, facility: string, active = true) => {
    const [t] = await q(
      `insert into teams (name, slug, type, facility_id, active) values ($1,$2,$3,$4,$5) returning id`,
      [name, `qahttp-${name.replace(/\s+/g, "-").toLowerCase()}`, type, facility, active],
    );
    return t.id as number;
  };
  const member = async (teamId: number, userId: string, active = true) =>
    q(`insert into team_memberships (team_id, user_id, membership_role, primary_team, active) values ($1,$2,'member',false,$3)`, [teamId, userId, active]);
  await member(await team(`${QA} PCS Alpha`, "PCS", ALPHA), subjectId);
  await member(await team(`${QA} ACS Beta`, "ACS", BETA), subjectId);
  await member(await team(`${QA} PCS Gamma`, "PCS", GAMMA), subjectId);
  await member(await team(`${QA} ACS Gamma`, "ACS", GAMMA), subjectId);
  await member(await team(`${QA} ACS Alpha Inactive`, "ACS", ALPHA, false), subjectId, true);

  const roster = async (name: string, facility: string, userId: string | null) => {
    const [r] = await q(`insert into outreach_schedulers (name, facility, user_id, capacity_percent) values ($1,$2,$3,100) returning id`, [name, facility, userId]);
    return r.id as number;
  };
  const rA = await roster(`${QA} subj Alpha`, ALPHA, subjectId);
  const rB = await roster(`${QA} subj Beta`, BETA, subjectId);
  const rG = await roster(`${QA} subj Gamma`, GAMMA, subjectId);
  const rOtherA = await roster(`${QA} other Alpha`, ALPHA, otherId);
  const rOtherD = await roster(`${QA} other Delta`, DELTA, otherId);

  const d = new Date();
  const todayTs = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} 10:00:00`;
  const clinicIdByName = new Map<string, number>();
  for (const name of [ALPHA, BETA, GAMMA, DELTA]) {
    const [c] = await q(`select id from clinics where name=$1`, [name]);
    clinicIdByName.set(name, c.id as number);
  }
  const pec = async (name: string, facility: string, rosterId: number | null, engagementStatus = "new") => {
    const [row] = await q(
      `insert into patient_execution_cases (patient_name, source, facility_id, clinic_id, assigned_team_member_id, engagement_bucket, engagement_status, lifecycle_status, next_action_at)
       values ($1,'system_generated',$2,$3,$4,'outreach',$5,'active',$6) returning id`,
      [name, facility, clinicIdByName.get(facility) ?? null, rosterId, engagementStatus, todayTs],
    );
    return row.id as number;
  };
  const ecAlpha = await pec("John Doe", ALPHA, rA);
  const ecBeta = await pec("John Doe", BETA, rB);
  const ecGamma = await pec("Gamma Patient", GAMMA, rG);
  await pec("Other Member Case", ALPHA, rOtherA);
  const ecDelta = await pec("Delta Patient", DELTA, rOtherD);
  await pec("Completed Case", ALPHA, rA, "completed");

  const gse = async (name: string, facility: string, assignedUserId: string | null, service: string) =>
    q(`insert into global_schedule_events (patient_name, facility_id, event_type, service_type, status, starts_at, assigned_user_id)
       values ($1,$2,'ancillary_appointment',$3,'scheduled',$4,$5)`, [name, facility, service, todayTs, assignedUserId]);
  await gse("Beta S1 (subject)", BETA, subjectId, "Echocardiogram TTE");
  await gse("Beta S2 (other)", BETA, otherId, "BrainWave");
  await gse("Beta S3 (unassigned)", BETA, null, "Bilateral Carotid Duplex");
  await gse("Delta ancillary", DELTA, null, "BrainWave");

  console.log(JSON.stringify({ USERNAME, PASSWORD, ALPHA, BETA, GAMMA, DELTA, ec: { ecAlpha, ecBeta, ecGamma, ecDelta } }));
}

async function main() {
  const cmd = process.argv[2];
  if (cmd === "seed") await seed();
  else if (cmd === "cleanup") { await cleanup(); console.log("cleaned"); }
  else console.error("usage: seed|cleanup");
  await pool.end();
}
main().catch(async (e) => { console.error(e); try { await pool.end(); } catch {} process.exit(1); });
