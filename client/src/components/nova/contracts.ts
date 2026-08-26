// Nova Foundation — canonical contracts.
//
// These types define the architectural backbone for the Nova AI assistant.
// Implementation of advanced capabilities (Focus Mode execution, Listening,
// Automations, full AI actions) is deferred — these contracts prevent
// future rewrites by establishing the shape now.

// ─── Appearance Profile ───────────────────────────────────────────────────

export type NovaShape =
  | "nebula"
  | "sphere"
  | "ring"
  | "star"
  | "crescent"
  | "spiral";

export type NovaPositionMode =
  | "anchored"  // stays near a defined anchor point with subtle drift
  | "free"      // user-dragged position, stays where placed
  | "auto"      // system chooses optimal position (future)
  | "follow";   // follows cursor at a distance (future)

export type NovaColorPreset =
  | "deep_space"   // dark purple / indigo / deep blue (DEFAULT)
  | "indigo"       // indigo dominant
  | "violet"       // violet dominant
  | "blue"         // deep blue
  | "calm"         // soft muted tones
  | "custom";      // user-defined palette

export const NOVA_COLOR_PRESETS: Record<NovaColorPreset, string[]> = {
  deep_space: ["#4B0082", "#3B0764", "#1E1B4B", "#312E81", "#4338CA", "#6366F1", "#818CF8"],
  indigo: ["#312E81", "#3730A3", "#4338CA", "#4F46E5", "#6366F1", "#818CF8", "#A5B4FC"],
  violet: ["#4C1D95", "#5B21B6", "#6D28D9", "#7C3AED", "#8B5CF6", "#A78BFA", "#C4B5FD"],
  blue: ["#1E3A5F", "#1E40AF", "#1D4ED8", "#2563EB", "#3B82F6", "#60A5FA", "#93C5FD"],
  calm: ["#475569", "#64748B", "#6B7280", "#9CA3AF", "#A78BFA", "#C4B5FD", "#E2E8F0"],
  custom: ["#4B0082", "#3B0764", "#1E1B4B", "#312E81", "#4338CA", "#6366F1", "#818CF8"],
};

export type NovaAppearanceProfile = {
  shape: NovaShape;
  /** Optional future prompt for AI-generated shape (deferred). */
  customShapePrompt?: string | null;
  colorPreset: NovaColorPreset;
  /** Custom colors override (used when preset === "custom"). */
  customColors?: string[] | null;
  /** Visual size in px. Range: 40–180. Default: 90. */
  size: number;
  /** Number of particles. Range: 20–80. Default: 40. */
  particleDensity: number;
  /** Base opacity when idle. Range: 0.2–1. Default: 0.5. */
  opacity: number;
  /** Glow intensity (drop-shadow blur). Range: 0–20. Default: 5. */
  glowIntensity: number;
  /** Movement speed multiplier. Range: 0.2–3. Default: 1. */
  movementSpeed: number;
  /** Movement intensity (amplitude). Range: 0–3. Default: 1. */
  movementIntensity: number;
  /** Hover brightness multiplier. Range: 1–2. Default: 1.6. */
  hoverIntensity: number;
  /** Hover growth scale (Nova blooms bigger). Range: 1.0–1.4. Default: 1.2. */
  hoverScale: number;
  /** Idle visibility (minimum opacity). Range: 0.1–1. Default: 0.45. */
  idleVisibility: number;
};

export const DEFAULT_NOVA_APPEARANCE: NovaAppearanceProfile = {
  shape: "nebula",
  colorPreset: "deep_space",
  size: 105,
  particleDensity: 45,
  opacity: 0.7,
  glowIntensity: 8,
  movementSpeed: 1,
  movementIntensity: 1,
  hoverIntensity: 1.5,
  hoverScale: 1.2,
  idleVisibility: 0.65,
};

// ─── Position State ───────────────────────────────────────────────────────

export type NovaPositionState = {
  mode: NovaPositionMode;
  /** Position relative to Playground container (0–1 normalized or px). */
  x: number;
  y: number;
  /** Anchor reference (when mode === "anchored"). */
  anchor?: "bottom-right" | "bottom-left" | "top-right" | "top-left";
};

export const DEFAULT_NOVA_POSITION: NovaPositionState = {
  mode: "anchored",
  x: 0,
  y: 0,
  anchor: "bottom-right",
};

// ─── Nova Context ─────────────────────────────────────────────────────────

export type NovaContext = {
  userId?: string | null;
  role?: string | null;
  facilityId?: string | null;
  viewAsTeamMemberId?: string | null;
  activeRoute?: string | null;
  playgroundTabId?: string | null;
  workspaceType?: string | null;
  patientId?: number | null;
  patientScreeningId?: number | null;
  executionCaseId?: number | null;
  ancillaryCaseId?: number | null;
  serviceEpisodeId?: number | null;
  serviceKey?: string | null;
  documentId?: number | null;
  appointmentId?: number | null;
  taskId?: number | null;
  conversationId?: string | null;
  selectedDate?: string | null;
};

// ─── Action Contracts ─────────────────────────────────────────────────────

export type NovaRiskLevel =
  | "read"
  | "low_write"
  | "medium"
  | "high"
  | "restricted";

export type NovaConfirmationPolicy =
  | "always_ask"
  | "ask_if_high_impact"
  | "ask_if_bulk"
  | "auto_allowed"
  | "disabled";

export type NovaActionDefinition = {
  id: string;
  name: string;
  description: string;
  /** Domain grouping (e.g. "clinical", "engagement", "scheduling", "tasks"). */
  domain: string;
  /** Permission required to execute this action. */
  requiredPermission?: string | null;
  /** Whether this action reads data or writes/mutates. */
  readOrWrite: "read" | "write";
  riskLevel: NovaRiskLevel;
  confirmationPolicy: NovaConfirmationPolicy;
  /** Context fields required for this action to be available. */
  contextRequirements?: Array<keyof NovaContext>;
  /** Reference to the execution function (deferred). */
  execute?: (ctx: NovaContext, input: Record<string, unknown>) => Promise<unknown>;
};

// ─── Audit Contract ───────────────────────────────────────────────────────

export type NovaAuditEvent = {
  userId: string;
  actionId: string;
  targetObjects?: Array<{ type: string; id: string | number }>;
  timestamp: string;
  confirmationState: "confirmed" | "auto_approved" | "skipped";
  success: boolean;
  resultSummary?: string | null;
  automationId?: string | null;
  metadata?: Record<string, unknown>;
};

// ─── Focus Mode Contract ──────────────────────────────────────────────────

export type NovaFocusModeStatus =
  | "idle"
  | "planning"
  | "executing"
  | "waiting_for_confirmation"
  | "paused"
  | "completed"
  | "cancelled"
  | "error";

export type NovaFocusModeState = {
  objective: string | null;
  status: NovaFocusModeStatus;
  steps?: Array<{
    id: string;
    description: string;
    status: "pending" | "active" | "completed" | "skipped" | "failed";
  }>;
  progress?: number; // 0–100
  waitingForConfirmation?: string | null;
  canPause: boolean;
  canCancel: boolean;
  canMinimize: boolean;
};

export const DEFAULT_FOCUS_MODE_STATE: NovaFocusModeState = {
  objective: null,
  status: "idle",
  canPause: false,
  canCancel: false,
  canMinimize: true,
};

// ─── Listening Mode Contract ──────────────────────────────────────────────

export type NovaListeningState = {
  enabled: boolean;
  active: boolean;
  source?: "microphone" | "system_audio" | null;
  startedAt?: string | null;
  elapsedSeconds?: number;
  policyState?: "allowed" | "needs_consent" | "denied" | null;
  transcriptionState?: "idle" | "listening" | "processing" | "paused" | null;
};

export const DEFAULT_LISTENING_STATE: NovaListeningState = {
  enabled: false,
  active: false,
};

// ─── Automation Contract ──────────────────────────────────────────────────

export type NovaAutomationTrigger =
  | "manual"
  | "schedule"
  | "event"
  | "condition";

export type NovaAutomationDefinition = {
  id: string;
  name: string;
  owner: string; // userId
  trigger: NovaAutomationTrigger;
  /** Cron expression or event type depending on trigger. */
  scheduleOrCondition?: string | null;
  /** Ordered list of action IDs to execute. */
  actionSequence: string[];
  confirmationPolicy: NovaConfirmationPolicy;
  /** Permissions required for this automation to run. */
  requiredPermissions?: string[];
  active: boolean;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
};

// ─── Feature Flags ────────────────────────────────────────────────────────

export type NovaFeatureFlags = {
  novaListening: boolean;
  novaFocusMode: boolean;
  novaAutomation: boolean;
  novaQualificationActions: boolean;
  novaEngagementActions: boolean;
  novaExternalMessaging: boolean;
};

export const DEFAULT_NOVA_FEATURE_FLAGS: NovaFeatureFlags = {
  novaListening: false,
  novaFocusMode: false,
  novaAutomation: false,
  novaQualificationActions: false,
  novaEngagementActions: false,
  novaExternalMessaging: false,
};

// ─── Persisted User Nova Preferences ──────────────────────────────────────

export type NovaUserPreferences = {
  appearance: NovaAppearanceProfile;
  position: NovaPositionState;
};

export const DEFAULT_NOVA_PREFERENCES: NovaUserPreferences = {
  appearance: DEFAULT_NOVA_APPEARANCE,
  position: DEFAULT_NOVA_POSITION,
};
