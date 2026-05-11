// Patient Care Specialist Portal is the user-facing successor to the
// former Scheduler Portal. It hosts call lists, scheduling, patient
// outreach, callbacks, and appointment coordination.
//
// In this foundation batch the page is a thin wrapper around the existing
// OutreachPage implementation so existing data flows stay intact while
// future batches reshape internals (right-panel modes, calendar profile,
// canonical event hydration). Old routes (/scheduler-portal,
// /outreach-center, /outreach) redirect here.

import OutreachPage from "@/pages/outreach";

export default function PatientCareSpecialistPortalPage() {
  return <OutreachPage />;
}
