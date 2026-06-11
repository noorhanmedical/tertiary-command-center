// Pure RingCentral client scaffold (Phase 1 Segment E Batch 6).
//
// This module is DORMANT in Phase 1: no route file imports it, no
// background job triggers it, and the live API is never called. It
// exposes a narrow, testable surface that a future approved batch can
// wire to a real RingCentral SDK behind the USE_RINGCENTRAL_ADAPTER
// server-side gate.
//
// Contract: docs/architecture/ringcentral-adapter-contract.md

export type RingCentralCallStatus = "queued" | "ringing" | "answered" | "failed";

export type InitiateCallInput = {
  fromUserExtension: string;
  toE164: string;
  patientScreeningId: number | null;
};

export type InitiateCallResult = {
  ringCentralCallId: string;
  status: RingCentralCallStatus;
};

export interface RingCentralClient {
  initiateCall(input: InitiateCallInput): Promise<InitiateCallResult>;
  getCallStatus(ringCentralCallId: string): Promise<RingCentralCallStatus>;
}

export class DormantRingCentralClient implements RingCentralClient {
  async initiateCall(_input: InitiateCallInput): Promise<InitiateCallResult> {
    throw new Error("RingCentral adapter is dormant in Phase 1 (USE_RINGCENTRAL_ADAPTER OFF)");
  }
  async getCallStatus(_ringCentralCallId: string): Promise<RingCentralCallStatus> {
    throw new Error("RingCentral adapter is dormant in Phase 1 (USE_RINGCENTRAL_ADAPTER OFF)");
  }
}
