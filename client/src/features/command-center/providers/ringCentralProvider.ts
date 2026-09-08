import type {
  PhoneCallSession,
  PhoneCallSummary,
  PhoneProviderAdapter,
  PhoneProviderConfig,
  RecentCallsInput,
  SaveCallDispositionInput,
  StartCallInput,
} from "./phoneProviderTypes";

import { capabilitiesFor } from "@shared/phoneProvider";

export const ringCentralProvider: PhoneProviderAdapter = {
  id: "ringcentral",
  label: "RingCentral",
  supportsEmbeddedDialer: true,
  supportsRecordingStatus: true,
  supportsDispositionSync: true,
  supportsCallEvents: true,
  // RingCentral is the deeply-integrated provider (capability CEILING). These
  // become LIVE only behind valid server credentials + the adapter flag; the
  // client resolver fails closed to manual until then.
  capabilities: capabilitiesFor("ringcentral"),

  async initialize(_config: PhoneProviderConfig) {
    return;
  },

  async startCall(input: StartCallInput): Promise<PhoneCallSession> {
    // Client-side initiation delegates to the SERVER adapter (which owns the
    // provider credentials + telephony_session). This client stub still returns
    // a "pending" session so a mis-wired live flag can never fake a placed call;
    // the real integrated path calls POST /api/telephony/calls (server) and the
    // returned provider session id flows back through that response, not here.
    return {
      callId: `ringcentral-pending-${Date.now()}`,
      providerId: "ringcentral",
      phoneNumber: input.phoneNumber,
      patientUuid: input.patientUuid,
      patientName: input.patientName,
      status: "dialing",
      startedAt: new Date().toISOString(),
      recordingStatus: "processing",
    };
  },

  async endCall(_callId: string) {
    return;
  },

  async getActiveCall() {
    return null;
  },

  async getRecentCalls(_input?: RecentCallsInput): Promise<PhoneCallSummary[]> {
    return [];
  },

  async saveDisposition(_input: SaveCallDispositionInput) {
    return;
  },
};
