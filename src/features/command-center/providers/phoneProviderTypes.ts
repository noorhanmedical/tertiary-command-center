export type PhoneProviderId =
  | "ringcentral"
  | "dialpad"
  | "aircall"
  | "eightByEight"
  | "goto"
  | "manual";

export type PhoneProviderConfig = {
  providerId: PhoneProviderId;
  displayName: string;
  metadata?: Record<string, unknown>;
};

export type StartCallInput = {
  phoneNumber: string;
  patientUuid?: string;
  patientName?: string;
};

export type PhoneCallSession = {
  callId: string;
  providerId: PhoneProviderId;
  phoneNumber: string;
  patientUuid?: string;
  patientName?: string;
  status: "idle" | "dialing" | "active" | "ended" | "failed";
  startedAt?: string;
  endedAt?: string;
  recordingStatus?: "unsupported" | "off" | "on" | "processing" | "available";
};

export type PhoneCallSummary = {
  callId: string;
  providerId: PhoneProviderId;
  phoneNumber: string;
  patientUuid?: string;
  patientName?: string;
  status: string;
  createdAt: string;
};

export type RecentCallsInput = {
  patientUuid?: string;
  limit?: number;
};

export type SaveCallDispositionInput = {
  callId: string;
  disposition: string;
  notes?: string;
  patientUuid?: string;
};

export interface PhoneProviderAdapter {
  id: PhoneProviderId;
  label: string;
  supportsEmbeddedDialer: boolean;
  supportsRecordingStatus: boolean;
  supportsDispositionSync: boolean;
  supportsCallEvents: boolean;
  initialize(config: PhoneProviderConfig): Promise<void>;
  startCall(input: StartCallInput): Promise<PhoneCallSession>;
  endCall(callId: string): Promise<void>;
  getActiveCall(): Promise<PhoneCallSession | null>;
  getRecentCalls(input?: RecentCallsInput): Promise<PhoneCallSummary[]>;
  saveDisposition(input: SaveCallDispositionInput): Promise<void>;
}
