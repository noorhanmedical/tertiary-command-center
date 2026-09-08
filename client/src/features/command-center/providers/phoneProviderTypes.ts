import type { PhoneProviderCapabilities } from "@shared/phoneProvider";

export type PhoneProviderId =
  | "ringcentral"
  | "doximity"
  | "dialpad"
  | "aircall"
  | "eightByEight"
  | "goto"
  | "manual";

/** Result of launching an EXTERNAL/assisted dialer (e.g. Doximity deep link).
 *  Plexus can only confirm it attempted the launch — never that a call was
 *  placed/connected (that requires an integrated provider). */
export type LaunchExternalResult = {
  launched: boolean;
  /** The href/deep-link opened (tel:/https), for the UI to fall back to. */
  href?: string | null;
  /** Honest note when verification is unavailable for this provider. */
  note?: string | null;
};

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
  /** Phase 6 — declarative capability set that drives Team Portal calling UX.
   *  Imported from the shared capability registry so client + server agree. */
  capabilities: PhoneProviderCapabilities;
  initialize(config: PhoneProviderConfig): Promise<void>;
  startCall(input: StartCallInput): Promise<PhoneCallSession>;
  endCall(callId: string): Promise<void>;
  getActiveCall(): Promise<PhoneCallSession | null>;
  getRecentCalls(input?: RecentCallsInput): Promise<PhoneCallSummary[]>;
  saveDisposition(input: SaveCallDispositionInput): Promise<void>;
  /** EXTERNAL-ASSISTED providers only (canLaunchExternalProvider): open the
   *  provider's dialer for this number. Optional — integrated/manual omit it. */
  launchExternal?(input: StartCallInput): Promise<LaunchExternalResult>;
}
