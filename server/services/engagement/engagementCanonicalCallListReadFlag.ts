// Engagement canonical call-list READ endpoint flag (Batch 17 of
// Engagement completion run).
//
// DEFAULT: OFF. When OFF the GET /api/engagement-center/call-list
// endpoint returns 404. When ON the route consults the
// engagementCallListService (Batch 15) with deps bound to existing
// repositories.

const FLAG_ENV = "USE_ENGAGEMENT_CANONICAL_CALL_LIST_READ";

export function isEngagementCanonicalCallListReadEnabled(): boolean {
  const v = process.env[FLAG_ENV];
  return v === "1" || v === "true" || v === "yes";
}
