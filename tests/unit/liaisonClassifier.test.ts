// Liaison conflict classifier — pure logic regression (Reconciliation 2.5).
//   npx tsx tests/unit/liaisonClassifier.test.ts
// Exit 0 = pass; 1 = fail.

import {
  classifyLiaisonMemberships,
  type TeamMembershipRow,
  type LiaisonDecision,
} from "@shared/accessControl/liaisonClassifier";

const failures: string[] = [];
function expect(label: string, actual: LiaisonDecision, expected: LiaisonDecision) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) failures.push(`${label}: expected ${e}, got ${a}`);
}

const PCS = (primary = false): TeamMembershipRow => ({ teamType: "PCS", primaryTeam: primary });
const ACS = (primary = false): TeamMembershipRow => ({ teamType: "ACS", primaryTeam: primary });

// #23 PCS-only → pcs
expect("PCS-only", classifyLiaisonMemberships([PCS()]), { role: "pcs" });
// #24 ACS-only → acs
expect("ACS-only", classifyLiaisonMemberships([ACS()]), { role: "acs" });
// #25 both with clear authoritative primary → that primary team
expect("both, primary PCS", classifyLiaisonMemberships([PCS(true), ACS(false)]), { role: "pcs" });
expect("both, primary ACS", classifyLiaisonMemberships([PCS(false), ACS(true)]), { role: "acs" });
// #26 both with no authoritative primary → conflict + flag
expect("both, no primary", classifyLiaisonMemberships([PCS(false), ACS(false)]), { role: null, reason: "conflict" });
// dual primary is also a conflict
expect("both, dual primary", classifyLiaisonMemberships([PCS(true), ACS(true)]), { role: null, reason: "conflict" });
// #27 neither → none + flag
expect("neither", classifyLiaisonMemberships([]), { role: null, reason: "none" });
expect("unrelated team only", classifyLiaisonMemberships([{ teamType: "OTHER", primaryTeam: true }]), { role: null, reason: "none" });

// Order independence — decision must NOT depend on row order.
expect("order [ACS,PCS] no primary", classifyLiaisonMemberships([ACS(false), PCS(false)]), { role: null, reason: "conflict" });
expect("order [ACS(primary),PCS]", classifyLiaisonMemberships([ACS(true), PCS(false)]), { role: "acs" });

if (failures.length) {
  console.error("liaisonClassifier.test.ts: FAILURES");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("liaisonClassifier.test.ts: all tests passed");
