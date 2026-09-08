// TEMPORARY demo data for viewing the PCS + ACS Team Portal with 10 fake
// patients. Everything is tagged for exact removal:
//   • users.username = 'demo_portal'
//   • outreach_schedulers.name = 'DEMO Portal Roster'
//   • teams.name LIKE 'DEMO %'  (facility-scoped Taylor)
//   • screening_batches.name = 'DEMO_PORTAL_BATCH'
//   • patient_execution_cases.source = 'demo_seed'
//   • global_schedule_events.source = 'demo_seed'
//
//   DATABASE_URL=postgres://localhost:5432/plexus npx tsx script/seedDemoPatients.ts seed
//   DATABASE_URL=postgres://localhost:5432/plexus npx tsx script/seedDemoPatients.ts cleanup
//
// NOT production. Local dev only.

import { pool } from "../server/db";
import bcrypt from "bcryptjs";

const FACILITY = "Taylor Family Practice";
const USERNAME = "demo_portal";
const EMAIL = "demo.portal@plexus.local";
const PASSWORD = "DemoPortal_123456";
const BATCH = "DEMO_PORTAL_BATCH";

async function q(text: string, params: unknown[] = []) {
  return (await pool.query(text, params)).rows as any[];
}

async function cleanup() {
  await q(`delete from global_schedule_events where source = 'demo_seed'`);
  await q(`delete from patient_execution_cases where source = 'demo_seed'`);
  await q(`delete from patient_screenings where batch_id in (select id from screening_batches where name = $1)`, [BATCH]);
  await q(`delete from screening_batches where name = $1`, [BATCH]);
  await q(`delete from team_memberships where user_id in (select id from users where username = $1)`, [USERNAME]);
  await q(`delete from teams where name like 'DEMO %'`);
  await q(`delete from outreach_schedulers where name = 'DEMO Portal Roster'`);
  await q(`delete from users where username = $1`, [USERNAME]);
}

const PATIENTS: Array<{ first: string; last: string; services: string[]; time: string; status: string; bucket: string }> = [
  { first: "Alice", last: "Adams", services: ["BrainWave"], time: "10:00", status: "new", bucket: "outreach" },
  { first: "Ben", last: "Brooks", services: ["VitalWave"], time: "10:30", status: "contacted", bucket: "outreach" },
  { first: "Carla", last: "Cruz", services: ["Echocardiogram TTE"], time: "11:00", status: "scheduling_needed", bucket: "scheduling_triage" },
  { first: "David", last: "Diaz", services: ["Bilateral Carotid Duplex", "Echocardiogram TTE"], time: "11:15", status: "scheduled", bucket: "visit" },
  { first: "Ella", last: "Evans", services: ["Renal Artery Doppler"], time: "13:00", status: "new", bucket: "outreach" },
  { first: "Frank", last: "Ford", services: ["BrainWave", "VitalWave"], time: "13:30", status: "contacted", bucket: "visit" },
  { first: "Gina", last: "Gray", services: ["Lower Extremity Venous Duplex"], time: "14:00", status: "new", bucket: "outreach" },
  { first: "Henry", last: "Hill", services: ["Abdominal Aortic Aneurysm Duplex"], time: "14:30", status: "scheduled", bucket: "visit" },
  { first: "Iris", last: "Ingram", services: ["Stress Echocardiogram"], time: "15:00", status: "contacted", bucket: "outreach" },
  { first: "Jack", last: "Jones", services: ["Upper Extremity Arterial Doppler"], time: "15:30", status: "new", bucket: "outreach" },
];

async function seed() {
  await cleanup();

  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const [clinic] = await q(`select id from clinics where name = $1`, [FACILITY]);
  const clinicId: number = clinic?.id ?? 1;

  // Login user (PCS + ACS at Taylor). role liaison passes requirePortalRole.
  const hash = await bcrypt.hash(PASSWORD, 12);
  const [u] = await q(
    `insert into users (username, email, password, role, active, status, clinic_id, display_name)
     values ($1,$2,$3,'liaison',true,'active',$4,'Demo Portal User') returning id`,
    [USERNAME, EMAIL, hash, clinicId],
  );
  const userId: string = u.id;

  const teamId = async (name: string, type: string) => {
    const [t] = await q(
      `insert into teams (name, slug, type, facility_id, active) values ($1,$2,$3,$4,true) returning id`,
      [name, `demo-${type.toLowerCase()}-taylor`, type, FACILITY],
    );
    return t.id as number;
  };
  const pcsTeam = await teamId("DEMO PCS Taylor", "PCS");
  const acsTeam = await teamId("DEMO ACS Taylor", "ACS");
  await q(`insert into team_memberships (team_id, user_id, membership_role, primary_team, active) values ($1,$2,'member',true,true)`, [pcsTeam, userId]);
  await q(`insert into team_memberships (team_id, user_id, membership_role, primary_team, active) values ($1,$2,'member',false,true)`, [acsTeam, userId]);

  // Roster row → call-list assignment + facility access.
  const [r] = await q(
    `insert into outreach_schedulers (name, facility, user_id, capacity_percent) values ('DEMO Portal Roster',$1,$2,100) returning id`,
    [FACILITY, userId],
  );
  const rosterId: number = r.id;

  // Screening batch to hold the demo screenings.
  const [b] = await q(
    `insert into screening_batches (name, patient_count, status, is_test) values ($1,$2,'active',false) returning id`,
    [BATCH, PATIENTS.length],
  );
  const batchId: number = b.id;

  const dob = (i: number) => `19${50 + i}-0${(i % 9) + 1}-1${i % 9}`; // stable fake DOBs

  let seq = 0;
  for (const p of PATIENTS) {
    seq++;
    const name = `Demo ${p.first} ${p.last}`;
    const patientDob = dob(seq);
    // 1) Screening (patient identity + chart).
    const [scr] = await q(
      `insert into patient_screenings (batch_id, name, dob, facility, patient_type, qualifying_tests, status, appointment_status)
       values ($1,$2,$3,$4,'visit',$5,'qualified','scheduled') returning id`,
      [batchId, name, patientDob, FACILITY, p.services],
    );
    const screeningId: number = scr.id;

    // 2) Execution case → PCS Call List (assigned to the demo roster).
    const [ec] = await q(
      `insert into patient_execution_cases
        (patient_name, patient_dob, source, facility_id, clinic_id, patient_screening_id, assigned_team_member_id,
         engagement_bucket, engagement_status, lifecycle_status, qualification_status, selected_services, next_action_at, priority_score)
       values ($1,$2,'demo_seed',$3,$4,$5,$6,$7,$8,'active','qualified',$9,$10,$11) returning id`,
      [
        name, patientDob, FACILITY, clinicId, screeningId, rosterId,
        p.bucket, p.status, p.services, `${dateStr} 09:00:00`, 100 - seq,
      ],
    );
    const executionCaseId: number = ec.id;

    // 3) Ancillary appointment(s) → ACS Ancillary Schedule (one per service;
    //    multi-service patients render as a grouped visit block).
    let minuteOffset = 0;
    for (const svc of p.services) {
      const [hh, mm] = p.time.split(":").map((n) => parseInt(n, 10));
      const startMin = mm + minuteOffset;
      const startsAt = `${dateStr} ${String(hh + Math.floor(startMin / 60)).padStart(2, "0")}:${String(startMin % 60).padStart(2, "0")}:00`;
      await q(
        `insert into global_schedule_events
          (patient_name, patient_dob, facility_id, clinic_id, execution_case_id, patient_screening_id,
           event_type, service_type, source, status, starts_at, assigned_user_id, assigned_role)
         values ($1,$2,$3,$4,$5,$6,'ancillary_appointment',$7,'demo_seed','scheduled',$8,$9,'technician')`,
        [name, patientDob, FACILITY, clinicId, executionCaseId, screeningId, svc, startsAt, userId],
      );
      minuteOffset += 10;
    }
  }

  console.log("Seeded 10 demo patients at", FACILITY);
  console.log(JSON.stringify({ login: { username: USERNAME, email: EMAIL, password: PASSWORD }, facility: FACILITY }, null, 2));
}

async function main() {
  const cmd = process.argv[2];
  if (cmd === "seed") await seed();
  else if (cmd === "cleanup") { await cleanup(); console.log("Demo data removed."); }
  else console.error("usage: seed | cleanup");
  await pool.end();
}
main().catch(async (e) => { console.error(e); try { await pool.end(); } catch {} process.exit(1); });
