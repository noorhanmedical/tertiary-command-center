// RingCentral adapter facade (Phase 1 Segment E Batch 6).
//
// Narrow facade around RingCentralClient that route/UI bridges import.
// DORMANT in Phase 1 — see ringCentralClient.ts and the contract doc.

import {
  DormantRingCentralClient,
  type InitiateCallInput,
  type InitiateCallResult,
  type RingCentralCallStatus,
  type RingCentralClient,
} from "./ringCentralClient";

export type { InitiateCallInput, InitiateCallResult, RingCentralCallStatus };

export interface RingCentralAdapter {
  initiateCall(input: InitiateCallInput): Promise<InitiateCallResult>;
  getCallStatus(ringCentralCallId: string): Promise<RingCentralCallStatus>;
}

export function isRingCentralAdapterEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env.USE_RINGCENTRAL_ADAPTER;
  return v === "1" || v === "true" || v === "yes";
}

export function createRingCentralAdapter(client: RingCentralClient = new DormantRingCentralClient()): RingCentralAdapter {
  return {
    initiateCall: (input) => client.initiateCall(input),
    getCallStatus: (id) => client.getCallStatus(id),
  };
}
