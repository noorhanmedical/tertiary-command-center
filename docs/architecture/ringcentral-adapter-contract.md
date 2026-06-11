# RingCentral adapter contract

**Status:** Docs-only (Batch E5 of Phase 1 run).
**Companion:** `scripts/qa-ringcentral-adapter-contract.mjs`.

RingCentral is ONLY a telephony adapter in Phase 1. It owns no
workflow state, no qualification logic, no billing logic, no
assignment logic, and no UI surface. It exists to (a) initiate
outbound calls from Team Portal cockpit click-to-call, and (b)
provide a call identifier that can be threaded back through the
canonical call-result payload as `callMetadata.ringCentralCallId`.

## Scope

### IN scope (Phase 1)

- A pure server-side module that wraps RingCentral's outbound call
  initiation API and returns a `{ ringCentralCallId, status }` shape.
- An optional inbound webhook receiver that updates the call's
  terminal status (answered / no-answer / failed) on a per-call basis.
- Reading credentials from environment variables ONLY (never committed).

### OUT of scope (Phase 1)

- Recording / playback / transcription.
- IVR design.
- Voicemail drop.
- SMS / messaging.
- Contact directory sync.
- Dashboard / analytics.
- Any persistence of PHI inside this adapter.
- Any decision about call outcome (the canonical planner owns that).
- Auto-dialing or queue-jumping (Team Portal user clicks per-row).

## Module layout

```
server/services/ringCentral/
  ringCentralClient.ts        // pure module: initiate, getCallStatus
  ringCentralAdapter.ts       // narrow facade used by routes/UI bridge
  __tests__/ringCentralAdapter.test.ts
```

NO route file is added in Phase 1 batch E6 — the scaffold stays
dormant. A future approved batch wires `POST /api/telephony/calls`
inside an existing route file.

## Public surface (E6 scaffold target)

```ts
// ringCentralAdapter.ts
export type InitiateCallInput = {
  fromUserExtension: string;
  toE164: string;
  patientScreeningId: number | null;
};
export type InitiateCallResult = {
  ringCentralCallId: string;
  status: "queued" | "ringing" | "answered" | "failed";
};
export interface RingCentralAdapter {
  initiateCall(input: InitiateCallInput): Promise<InitiateCallResult>;
  getCallStatus(ringCentralCallId: string): Promise<InitiateCallResult["status"]>;
}
```

The adapter MUST be deterministic in its inputs and not reach into the
database or storage layer directly. Persistence of call attempts goes
through the canonical call-result planner.

## Env vars (full inventory)

| Variable | Purpose | Default | Secret? |
|---|---|---|---|
| `RINGCENTRAL_CLIENT_ID` | OAuth client id | unset | yes |
| `RINGCENTRAL_CLIENT_SECRET` | OAuth client secret | unset | yes |
| `RINGCENTRAL_JWT` | Service-account JWT | unset | yes |
| `RINGCENTRAL_SERVER_URL` | API base URL (sandbox / prod) | `https://platform.ringcentral.com` | no |
| `RINGCENTRAL_DEFAULT_FROM_EXT` | Fallback caller extension | unset | no |
| `USE_RINGCENTRAL_ADAPTER` | Server-side enablement gate | OFF | no |
| `VITE_USE_RINGCENTRAL_CLICK_TO_CALL` | UI click-to-call button gate | OFF | no |

All flags default OFF. Production flip requires explicit Ali approval.

## Boundaries with other modules

- RingCentral does NOT call `recordCallResult`. The UI threads the
  returned `ringCentralCallId` into the canonical payload's
  `callMetadata.ringCentralCallId`. The planner remains authoritative.
- RingCentral does NOT depend on Plexus IQ. Plexus IQ stays read-model.
- RingCentral does NOT depend on Admin Review.
- RingCentral does NOT depend on Engagement assignment.
- RingCentral does NOT touch `outreach_calls`, `patient_journey_events`,
  `patient_execution_cases`, or any workflow table directly.

## Related contracts

- [[team-portal-structured-call-result-selector]]
- [[team-portal-panel-playground-protection]]
- [[phase-1-plexus-iq-boundary-contract]]
- [[phase-1-admin-review-boundary-contract]]

End of contract.
