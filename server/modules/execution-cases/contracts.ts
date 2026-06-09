// Execution-case spine — read-only contracts (Batch 10 read-only foundation).
//
// `patient_execution_cases` is the canonical operational spine row per
// committed patient. Today it is created fire-and-forget by
// patientCommitService.ts (see backend-route-parity-inventory.md §1.9 and
// the original review §3.7). This module exposes typed READ helpers and
// a transition-matrix design doc; it does NOT introduce a transactional
// writer. The Batch-10 implementation that wraps the writes is a future
// PR with its own approval.
//
// See:
//   docs/architecture/execution-case-state-machine.md — full transition matrix
//   shared/schema/executionCase.ts:17-27           — the four state enums

import type {
  EngagementBucket,
  EngagementStatus,
  LifecycleStatus,
  QualificationStatus,
} from "@shared/schema";

export type ExecutionCaseStateSnapshot = {
  executionCaseId: number;
  engagementBucket: EngagementBucket | string;
  qualificationStatus: QualificationStatus | string;
  lifecycleStatus: LifecycleStatus | string;
  engagementStatus: EngagementStatus | string;
  assignedTeamMemberId: number | null;
  assignedRole: string | null;
  patientScreeningId: number | null;
  patientName: string | null;
  patientDob: string | null;
  facilityId: string | null;
  selectedServices: string[];
  nextActionAt: Date | null;
  createdAt: Date;
  updatedAt: Date | null;
};

/**
 * A typed "is transition X→Y currently legal?" predicate input.
 * Used by the future writer; read-only callers can use the same shape
 * to validate before invoking the existing repo writes.
 */
export type ExecutionCaseTransitionRequest = {
  executionCaseId: number;
  kind: "lifecycle" | "engagement" | "qualification" | "bucket";
  from: string;
  to: string;
};

export type ExecutionCaseTransitionLegality =
  | { kind: "legal" }
  | { kind: "illegal"; reason: string };

export type ListExecutionCasesByUserFilters = {
  facilityId?: string;
  engagementBucket?: EngagementBucket;
  lifecycleStatus?: LifecycleStatus;
  engagementStatus?: EngagementStatus;
  qualificationStatus?: QualificationStatus;
};
