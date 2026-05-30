import type {
  PhoneCallSession,
  PhoneCallSummary,
  PhoneProviderAdapter,
  PhoneProviderConfig,
  RecentCallsInput,
  SaveCallDispositionInput,
  StartCallInput,
} from "./phoneProviderTypes";

export const ringCentralProvider: PhoneProviderAdapter = {
  id: "ringcentral",
  label: "RingCentral",
  supportsEmbeddedDialer: true,
  supportsRecordingStatus: true,
  supportsDispositionSync: true,
  supportsCallEvents: true,

  async initialize(_config: PhoneProviderConfig) {
    return;
  },

  async startCall(input: StartCallInput): Promise<PhoneCallSession> {
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
