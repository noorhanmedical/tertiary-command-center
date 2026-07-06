import assert from "node:assert/strict";
import { basketsForCase } from "../../server/services/engagement/basketRules";
import { mapOutcomeToDisposition } from "../../server/services/engagement/teamMetricsService";
import { BASKET_DEFS } from "../../shared/contracts/engagementBaskets";
import type { EngagementBasketKey } from "../../shared/contracts/engagementBaskets";

const startToday = new Date("2026-07-02T00:00:00.000Z");
const endToday = new Date("2026-07-02T23:59:59.999Z");

function caseArgs(overrides: Partial<Parameters<typeof basketsForCase>[0]> = {}) {
  return {
    isAssigned: false,
    isActive: true,
    engagementStatus: null as string | null,
    disposition: null as string | null,
    nextActionAt: null as Date | null,
    startToday,
    endToday,
    ...overrides,
  };
}

async function main() {
  // ── Voicemail / no-answer outcomes NEVER count as completed conversations ──
  const voicemailOutcomes = ["voicemail"];
  const noAnswerOutcomes = ["no_answer", "busy", "hung_up", "disconnected", "mailbox_full"];
  for (const outcome of [...voicemailOutcomes, ...noAnswerOutcomes]) {
    const disposition = mapOutcomeToDisposition(outcome);
    const keys = basketsForCase(caseArgs({ isAssigned: true, disposition }));
    assert.ok(
      !keys.includes("completedConversations"),
      `outcome "${outcome}" (disposition "${disposition}") must not land in completedConversations, got ${keys}`,
    );
  }
  for (const outcome of voicemailOutcomes) {
    const keys = basketsForCase(caseArgs({ disposition: mapOutcomeToDisposition(outcome) }));
    assert.ok(keys.includes("voicemailLeft"), `"${outcome}" should land in voicemailLeft`);
    assert.ok(!keys.includes("noAnswer"));
  }
  for (const outcome of noAnswerOutcomes) {
    const keys = basketsForCase(caseArgs({ disposition: mapOutcomeToDisposition(outcome) }));
    assert.ok(keys.includes("noAnswer"), `"${outcome}" should land in noAnswer`);
    assert.ok(!keys.includes("voicemailLeft"));
  }

  // A live conversation ("reached" → completed) IS a completed conversation.
  assert.equal(mapOutcomeToDisposition("reached"), "completed");
  assert.ok(
    basketsForCase(caseArgs({ disposition: "completed" })).includes("completedConversations"),
  );

  // ── Assigned + overdue → carryover (not assignedToday) ──
  const overdue = basketsForCase(
    caseArgs({ isAssigned: true, nextActionAt: new Date("2026-07-01T15:00:00Z") }),
  );
  assert.ok(overdue.includes("carryover"));
  assert.ok(!overdue.includes("assignedToday"));
  assert.ok(!overdue.includes("unassigned"));

  // ── Assigned + due today → assignedToday (not carryover) ──
  const dueToday = basketsForCase(
    caseArgs({ isAssigned: true, nextActionAt: new Date("2026-07-02T14:00:00Z") }),
  );
  assert.ok(dueToday.includes("assignedToday"));
  assert.ok(!dueToday.includes("carryover"));

  // Boundary: nextActionAt exactly at start of today counts as today, not carryover.
  const atMidnight = basketsForCase(
    caseArgs({ isAssigned: true, nextActionAt: new Date(startToday) }),
  );
  assert.ok(atMidnight.includes("assignedToday"));
  assert.ok(!atMidnight.includes("carryover"));

  // Assigned + due in the future → neither carryover nor assignedToday.
  const future = basketsForCase(
    caseArgs({ isAssigned: true, nextActionAt: new Date("2026-07-05T10:00:00Z") }),
  );
  assert.ok(!future.includes("carryover"));
  assert.ok(!future.includes("assignedToday"));

  // ── Unassigned active non-terminal → unassigned ──
  assert.ok(basketsForCase(caseArgs()).includes("unassigned"));
  // Terminal status removes it from unassigned/carryover/assignedToday.
  const terminalUnassigned = basketsForCase(caseArgs({ engagementStatus: "scheduled" }));
  assert.ok(!terminalUnassigned.includes("unassigned"));
  assert.ok(terminalUnassigned.includes("scheduled"));
  const terminalAssigned = basketsForCase(
    caseArgs({
      isAssigned: true,
      engagementStatus: "completed",
      nextActionAt: new Date("2026-07-01T15:00:00Z"),
    }),
  );
  assert.ok(!terminalAssigned.includes("carryover"));
  assert.ok(!terminalAssigned.includes("assignedToday"));
  // Inactive lifecycle also removes from work queues.
  const inactive = basketsForCase(caseArgs({ isActive: false }));
  assert.ok(!inactive.includes("unassigned"));

  // ── Scheduled: driven by status OR disposition ──
  assert.ok(basketsForCase(caseArgs({ engagementStatus: "scheduled" })).includes("scheduled"));
  assert.ok(basketsForCase(caseArgs({ disposition: "scheduled" })).includes("scheduled"));
  assert.equal(mapOutcomeToDisposition("scheduled"), "scheduled");
  assert.equal(mapOutcomeToDisposition("completed"), "scheduled");

  // ── Declined: driven by disposition ──
  for (const outcome of ["declined", "not_interested", "dnc", "deceased", "wrong_number"]) {
    assert.equal(mapOutcomeToDisposition(outcome), "declined");
  }
  assert.ok(basketsForCase(caseArgs({ disposition: "declined" })).includes("declined"));

  // ── Follow-up ──
  assert.equal(mapOutcomeToDisposition("callback"), "followUp");
  assert.ok(basketsForCase(caseArgs({ disposition: "followUp" })).includes("followUpNeeded"));

  // Unknown outcomes fall to "other" and land in no disposition basket.
  assert.equal(mapOutcomeToDisposition("something_weird"), "other");
  const other = basketsForCase(caseArgs({ disposition: "other" }));
  assert.deepEqual(other, ["unassigned"]);

  // A case can appear in multiple tiles (filters, not a partition).
  const multi = basketsForCase(
    caseArgs({
      isAssigned: true,
      disposition: "voicemail",
      nextActionAt: new Date("2026-07-01T09:00:00Z"),
    }),
  );
  assert.ok(multi.includes("carryover") && multi.includes("voicemailLeft"));

  // ── Counts equal the number of rows carrying each basket key ──
  const syntheticCases = [
    caseArgs(), // unassigned
    caseArgs(), // unassigned
    caseArgs({ isAssigned: true, nextActionAt: new Date("2026-06-30T12:00:00Z") }), // carryover
    caseArgs({ isAssigned: true, nextActionAt: new Date("2026-07-02T10:00:00Z"), disposition: mapOutcomeToDisposition("voicemail") }), // assignedToday + voicemailLeft
    caseArgs({ isAssigned: true, disposition: mapOutcomeToDisposition("reached") }), // completedConversations
    caseArgs({ engagementStatus: "scheduled", disposition: mapOutcomeToDisposition("scheduled") }), // scheduled
    caseArgs({ isAssigned: true, disposition: mapOutcomeToDisposition("no_answer"), nextActionAt: new Date("2026-07-01T08:00:00Z") }), // carryover + noAnswer
    caseArgs({ disposition: mapOutcomeToDisposition("callback") }), // unassigned + followUpNeeded
    caseArgs({ isAssigned: true, engagementStatus: "declined", disposition: mapOutcomeToDisposition("not_interested") }), // declined
  ];

  const counts: Record<EngagementBasketKey, number> = {
    unassigned: 0,
    assignedToday: 0,
    carryover: 0,
    completedConversations: 0,
    scheduled: 0,
    voicemailLeft: 0,
    noAnswer: 0,
    followUpNeeded: 0,
    declined: 0,
  };
  const rows = syntheticCases.map((c) => {
    const basketKeys = basketsForCase(c);
    for (const k of basketKeys) counts[k] += 1;
    return { basketKeys };
  });

  for (const def of BASKET_DEFS) {
    const rowCount = rows.filter((r) => r.basketKeys.includes(def.key)).length;
    assert.equal(
      counts[def.key],
      rowCount,
      `count for "${def.key}" (${counts[def.key]}) must equal rows carrying that key (${rowCount})`,
    );
  }
  // Spot-check the expected tallies so a bucketing regression can't hide
  // behind a self-consistent-but-wrong count.
  // unassigned = the two plain cases + the callback case; the scheduled-status
  // case is terminal and correctly excluded.
  assert.equal(counts.unassigned, 3);
  assert.equal(counts.carryover, 2);
  assert.equal(counts.assignedToday, 1);
  assert.equal(counts.completedConversations, 1);
  assert.equal(counts.scheduled, 1);
  assert.equal(counts.voicemailLeft, 1);
  assert.equal(counts.noAnswer, 1);
  assert.equal(counts.followUpNeeded, 1);
  assert.equal(counts.declined, 1);

  console.log("Engagement baskets test passed.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
