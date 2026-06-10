# Call-result preview parity — readiness + staging verification plan

**Status:** Docs-only (Batch H Step 4). No runtime change. No UI change. No flag flip.
**Date:** 2026-06-10.
**Purpose:** Gate the next runtime PR (route delegation to `recordCallResult`) on an explicit, source-pinned readiness checklist. No route delegation may ship until the §6 pass criteria have been observed in staging AND the §7 stop conditions are all clear.

---

## 1. Current preview flags

Two surface-isolated preview flags exist today. Both are **default OFF**, **preview-only**, **non-blocking**, **PHI-safe**.

| Flag | Surface | Helper module | Helper entry point |
|---|---|---|---|
| `USE_RECORD_CALL_RESULT_ENGAGEMENT_PREVIEW` | `POST /api/engagement-center/call-result` | `server/services/callResult/recordCallResultEngagementPreviewFlag.ts` | `runEngagementCallResultPreview(input, observed)` |
| `USE_RECORD_CALL_RESULT_OUTREACH_PREVIEW` | `POST /api/outreach/calls` | `server/services/callResult/recordCallResultOutreachPreviewFlag.ts` | `runOutreachCallResultPreview(input, observed)` |

Truthy values for both: `"1"`, `"true"`, `"yes"`. Anything else (including unset) keeps the preview OFF.

When OFF for a given route, the route behaves exactly as before — no new side effects, no new log lines, no response shape change.

When ON for a given route, the route still performs every existing write. After those writes it additionally:
1. Calls the dormant `recordCallResult` planner with a non-PHI input shape (`patientScreeningId`, `outcome`, optional `callbackAt`, `sourceSurface`).
2. Receives a `RecordCallResultOutcome` envelope (canonical side effects the planner would have driven).
3. Compares the planner envelope to the route's observed side effects.
4. Emits ONE structured `console.info` line with only outcome label, surface label, boolean parity flags, and a `parity=match|mismatch:<fields>` verdict. Never throws. Never blocks.

---

## 2. What preview mode proves

- The planner can map current route input into the canonical side-effect envelope without PHI surfacing.
- Route-observed side effects can be reduced to a comparable, opaque boolean envelope.
- Mismatches between planner and route can be surfaced without changing user-facing behavior or response shape.
- The surface-isolated helper design works: each helper is independently flagged so flips can be staged per surface.

---

## 3. What preview mode does NOT prove

- It does NOT prove that delegating either route's writes to `recordCallResult` is safe yet.
- It does NOT prove the route's existing DB writes can be replaced.
- It does NOT prove the route's response shape can change.
- It does NOT prove a Team Portal call-result write path can be enabled.
- It does NOT prove a production flag flip is safe.

Specifically: parity=match in staging means the planner *would have* described the same side effects. It does NOT mean the route can stop performing them.

---

## 4. Staging verification plan

Execute in order. Skip / pause if any §7 stop condition fires.

1. **Deploy current main to staging.** No flag changes. Confirm both routes return the same response shapes they returned before the deploy.
2. **Flags OFF baseline.** Run real engagement-center and outreach call-result writes for at least one business day. Confirm:
   - No new log lines tagged `[record-call-result-preview]` appear.
   - No new error/warn lines from either route.
   - No response-shape regressions reported by Team Portal or Engagement Center clients.
3. **Enable `USE_RECORD_CALL_RESULT_ENGAGEMENT_PREVIEW` in staging only.** Restart the staging API process.
4. **Observe engagement preview logs.** For each `POST /api/engagement-center/call-result` request in scope, confirm a single `[record-call-result-preview] surface=engagement_center_route ...` line appears. Tally per-outcome `parity=` verdicts.
5. **Enable `USE_RECORD_CALL_RESULT_OUTREACH_PREVIEW` in staging only.** Both flags now ON in staging.
6. **Observe outreach preview logs.** For each `POST /api/outreach/calls` request, confirm the `surface=outreach_call_route` parity line appears.
7. **Compare parity by route and outcome.** Build the matrix in §5. Collect mismatch counts. Collect skipped (non-canonical) outcome counts.
8. **Do NOT enable in production yet.** Production flag flips are a separately-approved PR after the §6 pass criteria are met.

---

## 5. Required observation window

At least **2 business days** of staging activity if available. The observation window MUST include each of:

- `scheduled`
- `callback`
- `no_answer`
- `voicemail`
- `wrong_number`
- `declined`
- `needs_records` (engagement-center route only — outreach schema does not accept it)
- `manager_review` (engagement-center route only)
- `insurance_prior_auth_issue` (engagement-center route only)
- `facility_specific_issue` (engagement-center route only)

If staging traffic cannot organically produce all canonical outcomes within the window, use **canned fixture simulation** via the Batch B parity fixture (`tests/fixtures/callResultCanonicalization.fixture.ts`) and run a one-off test harness against staging that exercises each outcome at least once. Document any outcomes that could only be exercised via simulation.

For each (route, outcome) pair, record:
- Sample count
- `parity=match` count
- `parity=mismatch:<fields>` distribution (which fields, how often)
- `(skipped)` count for non-canonical outcomes (outreach has a broader vocabulary — `wants_more_info`, `language_barrier`, `mailbox_full`, `hung_up`, `disconnected`, `busy`, `reached`, `refused_dnc`, `moved`, `deceased`, `not_interested`, `will_think_about_it`).

---

## 6. Pass criteria

Every item below must hold before any route delegation PR opens:

- No route crashes during the observation window (no new 5xx attributable to either preview path).
- No response shape changes detected by Engagement Center / Team Portal / Outreach Dashboard clients.
- No PHI in any preview log line (audit a random sample of `[record-call-result-preview]` lines).
- No new failed requests attributable to the preview helper (zero throws — the helper is best-effort, but a throw caught upstream still indicates a defect).
- `parity=match` for every expected outcome on the route that owns that side effect:
  - Engagement-center: `scheduled`, `declined`, `callback`, `no_answer`, `voicemail`, `wrong_number`, `needs_records`, `insurance_prior_auth_issue`, `manager_review`, `facility_specific_issue` — all match.
  - Outreach: `scheduled`, `declined`, `callback`, `no_answer`, `voicemail`, `wrong_number` — `assignmentCompleted` and `appointmentStatus` match. Expected mismatches on `journeyEventAppended`, `triageCaseRequired`, `followUpTaskRequired` are documented as the canonical features the route does not yet perform.
- All mismatches are fully explained in writing (route-side feature missing, route-side feature extra, or planner-side mapping bug).
- Skipped, unsupported outcomes are listed and either accepted as out-of-scope-for-now or mapped to the canonical set before delegation.
- All QA scripts pass on the same commit deployed to staging.

---

## 7. Stop conditions

If ANY of these fires during staging verification, stop and reopen the readiness analysis before proceeding:

- Any PHI appears in a `[record-call-result-preview]` log line (patient name, DOB, MRN, phone, screening id surfaced as such).
- Any response shape change is observed on either `POST /api/engagement-center/call-result` or `POST /api/outreach/calls`.
- Any route behavior changes while the corresponding flag is OFF (this would indicate a preview-helper side effect leaking).
- Any preview path throws or causes an upstream 5xx.
- Any mismatch on terminal assignment completion (`assignmentCompleted` planner vs route diverges for a `scheduled` or `declined` outcome).
- Any mismatch on Journey Event expectation for the engagement-center route (the planner says `journeyEventType: "call_result_logged"` for every outcome; the route must already be writing it).
- Any mismatch on callback / `nextActionAt` behavior for callback-style outcomes (planner sets future date; route must too for the engagement-center route).
- Any mismatch on task / triage requirement for the engagement-center route (planner says required; route must already create them).
- Any scheduler assignment write changes unexpectedly (an `assignmentCompleted` parity line tied to a real `scheduler_assignments` row mutation that did not happen before).

---

## 8. Next runtime PR after readiness passes

Once §6 pass criteria hold and no §7 stop condition is active:

- **Choose one route only.** Likely `POST /api/engagement-center/call-result` first because the canonical envelope already matches this route's documented side-effect set.
- **Delegate internally to `recordCallResult` behind an explicit route-delegation flag** (a new flag distinct from the preview flag — e.g. `USE_RECORD_CALL_RESULT_ENGAGEMENT_DELEGATE`, default OFF).
- **Preserve the existing response shape** byte-for-byte: same JSON keys, same nullability, same field types.
- **Preserve every existing side effect.** The delegation PR replaces the route's local logic with calls to a service adapter that imports `recordCallResult` and the relevant storage / journey-event helpers. Each side effect must be byte-equivalent under staging traffic.
- **Leave `POST /api/outreach/calls` unchanged** in the engagement delegation PR. The outreach delegation is a separate later PR after engagement delegation proves out.

Hard-stops carried into that future delegation PR:
- No flag default flip in the same PR as the delegation wiring.
- No migrations.
- No billing / qualification / PDF / Admin Review / Team Portal UI touched.
- No Team Portal call-result write enabled.

---

## 9. Non-promises

- No commitment to enable either preview flag in production.
- No commitment that the route-delegation PR ships in any timeframe.
- No commitment to remove either legacy route.
- No commitment to flip `ENGAGEMENT_TO_CALL_LIST_BRIDGE`, `USE_PORTAL_CALL_HISTORY_READ`, `USE_PORTAL_CALL_LIST_V2`, or `USE_PORTAL_CALL_RESULT_WRITE`.

End of readiness plan.
