---
name: Engagement Center command UI boundaries
description: What the engagement assignment-board data spine can/cannot persist, for feature work on the Engagement Center
---

# Engagement Center data boundaries

The engagement assignment board read spine and its assign / cancel-many
write endpoints ride on `patient_execution_cases` + `patient_screenings`.
There is NO parallel call-list store.

**The assign endpoint persists only the team member, the assigned role
(scheduler | patientCareSpecialist | ancillaryCareSpecialist), and a free
-text reason.** The board row contract carries no priority and no editable
next-action field.

**Why:** Redesign work keeps wanting to add priority badges, due/next
-action editing, a full call-by-call journey timeline, and smart filters
(Callbacks/No Answer/Voicemail/Needs Scheduling/Missing PDF/Declined/Re
-Eligible). All of these are DERIVED, read-only — there is nowhere to save
them and the board exposes only a single last-activity summary, not an
event stream. Smart filters with no matching data honestly show 0.

**How to apply:** To make priority/next-action *editable* or to show a
real journey timeline, you must add storage on `patient_execution_cases`,
extend the board contract, and add/extend an endpoint — it cannot be faked
through the existing assign call. Notes typed in the case panel map to the
assign endpoint's reason.

**Bulk-action safety:** The worklist keeps multi-select state locally. It
MUST prune the selection (and guard bulk cancel/assign) against the
currently visible rows whenever search/filter changes — otherwise a stale
selection can cancel/assign hidden cases. This was a real review-blocking
regression.
