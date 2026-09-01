// TestGuy Robot — canonical communication history.
// Run with `npm run seed:testguy-calls`. Requires DATABASE_URL.
//
// Seeds a real multi-channel outreach sequence through logCommunication so the
// canonical operational state (execution-case attempts / next action /
// engagement) and the Plexus Story events are DERIVED from the calls, not
// hand-set. Demonstrates: No Answer -> Voicemail -> SMS -> Connected+callback
// -> callback completed -> Carotid scheduled -> Echo emailed. Idempotent.

import { eq, and, ilike, or, desc } from "drizzle-orm";

const NAME_VARIANTS = ["testguy robot", "test guy robot"];

async function main() {
  if (!process.env.DATABASE_URL) { console.error("[seed:calls] DATABASE_URL not set"); process.exit(1); }
  const { db, pool } = await import("../server/db");
  const { patientScreenings } = await import("@shared/schema/screening");
  const { patientAncillaryCases } = await import("@shared/schema/ancillaryCases");
  const { patientJourneyEvents } = await import("@shared/schema/executionCase");
  const { logCommunication, resetCommunicationsForPatient } = await import("../server/repositories/communications.repo");

  let exitCode = 0;
  try {
    const [s] = await db.select().from(patientScreenings)
      .where(or(...NAME_VARIANTS.map((n) => ilike(patientScreenings.name, n))))
      .orderBy(desc(patientScreenings.id)).limit(1);
    if (!s) { console.error("[seed:calls] no TestGuy screening"); await pool.end(); process.exit(1); }

    const cases = await db.select().from(patientAncillaryCases)
      .where(eq(patientAncillaryCases.originatingScreeningId, s.id));
    const caseId = (svc: string) => cases.find((c) => c.serviceType === svc)?.id ?? null;

    // Idempotent: clear prior comms + reset attempt counters, and clear ONLY
    // prior communication_logged Story events (leaves base + lifecycle events).
    await resetCommunicationsForPatient(s.id);
    await db.delete(patientJourneyEvents).where(and(
      eq(patientJourneyEvents.patientScreeningId, s.id),
      eq(patientJourneyEvents.eventSource, "communications"),
    ));

    const base = {
      patientScreeningId: s.id,
      clinicId: s.clinicId ?? null,
      patientName: s.name,
      patientDob: s.dob ?? null,
    };
    const D = (d: string) => new Date(`${d}T15:00:00Z`);

    await logCommunication({ ...base, channel: "phone", direction: "outbound", outcome: "no_answer", staffName: "Maria Lopez", staffRole: "PCS", destination: "(602) 555-0142", startedAt: D("2026-06-20"), durationSeconds: 0, notes: "No answer; no voicemail left." });
    await logCommunication({ ...base, channel: "phone", direction: "outbound", outcome: "voicemail", staffName: "Maria Lopez", staffRole: "PCS", destination: "(602) 555-0142", startedAt: D("2026-06-22"), durationSeconds: 35, notes: "Left voicemail regarding recommended ancillary testing." });
    await logCommunication({ ...base, channel: "sms", direction: "outbound", outcome: "reached", staffName: "Automated", staffRole: "System", destination: "(602) 555-0142", startedAt: D("2026-06-25"), notes: "Appointment information SMS delivered." });
    await logCommunication({ ...base, channel: "phone", direction: "outbound", outcome: "reached", staffName: "Maria Lopez", staffRole: "PCS", destination: "(602) 555-0142", startedAt: D("2026-06-28"), durationSeconds: 240, callbackAt: D("2026-07-02"), nextAction: "Callback Jul 2 (afternoon)", notes: "Connected; patient requested a callback Thursday afternoon." });
    await logCommunication({ ...base, channel: "phone", direction: "outbound", outcome: "reached", staffName: "Maria Lopez", staffRole: "PCS", destination: "(602) 555-0142", startedAt: D("2026-07-02"), durationSeconds: 360, notes: "Callback completed; discussed Bilateral Carotid Duplex and Echocardiogram." });
    await logCommunication({ ...base, channel: "phone", direction: "outbound", outcome: "scheduled", staffName: "Maria Lopez", staffRole: "PCS", ancillaryCaseId: caseId("Bilateral Carotid Duplex"), serviceType: "Bilateral Carotid Duplex", startedAt: D("2026-07-02"), durationSeconds: 120, nextAction: "Confirm Echo scheduling", notes: "Bilateral Carotid Duplex scheduled for Aug 29." });
    await logCommunication({ ...base, channel: "email", direction: "outbound", outcome: "reached", staffName: "Maria Lopez", staffRole: "PCS", ancillaryCaseId: caseId("Echocardiogram TTE"), serviceType: "Echocardiogram TTE", destination: "testguy.robot@example.com", startedAt: D("2026-07-02"), nextAction: "Await Echo confirmation", notes: "Echocardiogram information emailed; awaiting patient confirmation." });

    console.log("[seed:calls] OK — seeded 7 canonical communications (with propagation + story events)");
  } catch (err: any) {
    console.error("[seed:calls] failed:", err);
    exitCode = 1;
  } finally {
    try { await pool.end(); } catch { /* noop */ }
  }
  process.exit(exitCode);
}

main().catch((err) => { console.error("[seed:calls] unexpected failure:", err); process.exit(1); });
