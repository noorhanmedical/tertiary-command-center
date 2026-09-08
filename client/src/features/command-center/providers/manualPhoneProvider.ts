import type {
  PhoneCallSession,
  PhoneCallSummary,
  PhoneProviderAdapter,
  PhoneProviderConfig,
  RecentCallsInput,
  SaveCallDispositionInput,
  StartCallInput,
} from "./phoneProviderTypes";

let activeCall: PhoneCallSession | null = null;
const recentCalls: PhoneCallSummary[] = [];

import { capabilitiesFor } from "@shared/phoneProvider";

export const manualPhoneProvider: PhoneProviderAdapter = {
  id: "manual",
  label: "Manual",
  supportsEmbeddedDialer: false,
  supportsRecordingStatus: false,
  supportsDispositionSync: false,
  supportsCallEvents: false,
  // Manual has NO telephony capabilities — Plexus cannot initiate, launch,
  // verify, or time the call. The employee dials on their own phone.
  capabilities: capabilitiesFor("manual"),

  async initialize(_config: PhoneProviderConfig) {
    return;
  },

  async startCall(input: StartCallInput) {
    activeCall = {
      callId: `manual-${Date.now()}`,
      providerId: "manual",
      phoneNumber: input.phoneNumber,
      patientUuid: input.patientUuid,
      patientName: input.patientName,
      status: "active",
      startedAt: new Date().toISOString(),
      recordingStatus: "unsupported",
    };

    recentCalls.unshift({
      callId: activeCall.callId,
      providerId: "manual",
      phoneNumber: input.phoneNumber,
      patientUuid: input.patientUuid,
      patientName: input.patientName,
      status: "active",
      createdAt: activeCall.startedAt ?? new Date().toISOString(),
    });

    return activeCall;
  },

  async endCall(callId: string) {
    if (activeCall?.callId === callId) {
      activeCall = { ...activeCall, status: "ended", endedAt: new Date().toISOString() };
    }
  },

  async getActiveCall() {
    return activeCall;
  },

  async getRecentCalls(input?: RecentCallsInput) {
    const limit = input?.limit ?? 10;
    return recentCalls.slice(0, limit);
  },

  async saveDisposition(_input: SaveCallDispositionInput) {
    return;
  },
};
