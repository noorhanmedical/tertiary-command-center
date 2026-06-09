// shared/contracts/ — type-only barrel.
//
// This folder collects stable shared shapes used across the codebase
// (engagement board row, journey event kinds, admin-review status union,
// reasoning blob shape). The types here are intentionally byte-identical
// mirrors of authoritative inline definitions in the codebase — each
// contract file cites its source path + line range.
//
// Rule: this folder contains TypeScript types and `as const` enums ONLY.
// No values, no functions, no runtime imports. Importing anything from
// shared/contracts/ must be a pure type import.
//
// Consumers are NOT updated by the batch that adds these contracts.
// Future batches may opt in to import from here.

export * from "./adminReviewStatus";
export * from "./reasoning";
export * from "./engagementBoard";
export * from "./journeyEvents";
