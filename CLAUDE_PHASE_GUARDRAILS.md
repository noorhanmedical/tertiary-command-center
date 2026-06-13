# CLAUDE_PHASE_GUARDRAILS.md

Working guardrails for AI-assisted work on this repository (Tertiary
Command Center / Plexus operating platform).

This file is the authoritative guard against drift. Read it before
starting any non-trivial work and after every context switch. If
guidance in this file conflicts with a transient instruction, **the
file wins** unless the user explicitly overrides it in the current
session.

---

## 1. What this repo is

This repo is the **Tertiary Command Center**, becoming the enterprise-
grade **Plexus operating platform**.

It is **not** a generic dashboard app.

Do **not** treat helper code as done unless it is visibly wired into
the actual workflow.

If something is scaffold, label it scaffold.
If something is live, prove it through actual route + component +
service wiring.

---

## 2. Forbidden inventions / renames

Do **not**:

- Invent new portals.
- Rename actual repo concepts.
- Create duplicate pages / routes.
- Create a generic "Team Portal" cockpit.
- Create Mission Control (Phase 7 only).
- Add billing dashboards inside Plexus IQ.
- Add operational dashboards inside Plexus IQ.
- Add productivity / financial / analytics dashboards inside Plexus IQ.
- Call the Patient Care Specialist Workspace patient-facing.
- Call the Ancillary Care Specialist Workspace patient-facing.

---

## 3. Canonical portal / shell concepts to preserve

These are the actual internal portals:

- Patient Care Specialist Workspace (`patient-care-specialist-portal.tsx`)
- Ancillary Care Specialist Workspace (`ancillary-care-specialist-portal.tsx`)

These are the canonical portal/shell concepts:

- `ClinicWorkflowPortal`
- `TeamPortalShell`
- `WorkspaceModeSwitcher`
- `PatientCommandCanvas`
- `SchedulePatientPlayground`
- `CallListPanel`
- `DispositionSheet`
- `CanonicalRowActions`

Known workspace modes:

- Clinic Schedule
- Ancillary Schedule
- Call List

Known feed helpers (live in `client/src/lib/workflow/teamMemberWorkspaceApi.ts`):

- `fetchWorkspaceCallList`
- `fetchWorkspaceClinicSchedule`
- `fetchWorkspaceAncillarySchedule`
- `fetchTeamMemberProfile`

Known feed routes:

- `/api/scheduler-portal/cases`
- `/api/technician-liaison/clinic-visits`
- `/api/technician-liaison/ancillary-schedule`

---

## 4. Phase order — current phase is Phase 1

```
Phase 1 — Core operating workflow completion        ← current
Phase 2 — Full operations runtime
Phase 3 — AI automation + exception intelligence
Phase 4 — Billing + invoicing runtime
Phase 5 — AWS staging / production activation
Phase 6 — External integrations
Phase 7 — Mission Control
Phase 8 — Enterprise scale / multi-clinic controls
```

Do **not** preemptively land Phase 2/3/4/5/6/7/8 work as a side effect
of Phase 1 changes.

---

## 5. Phase 1 goal

Complete and prove the real core operating workflow:

```
Batch Flow / Visit / Outreach
  → Plexus IQ
  → Admin Review
  → Patient Directory
  → Engagement Center
  → Patient Care Specialist Workspace
  → Ancillary Care Specialist Workspace
  → call result logging
  → scheduler handoff
  → packet/PDF flow
  → baseline documents/signing/billing/invoicing scaffolds
  → AWS readiness docs
  → smoke tests
```

---

## 6. Plexus IQ guardrails

Plexus IQ is **only** for:

- qualification
- clinical reasoning
- supporting evidence
- Admin Review support
- packet/PDF generation
- handoff support

Plexus IQ must **not** contain:

- Mission Control
- billing dashboard
- invoice dashboard
- productivity dashboard
- financial dashboard
- operational analytics dashboard

### Plexus IQ behavior protections

- Selected-run-only behavior — only the active run renders, never every
  same-day sibling at once.
- Same-day runs collapse under the date/worklist card.
- No giant Qualification Runs panel/tile.
- No Qualification Jobs tile.
- Outreach patients display A → Z.
- Visit patients display by appointment time.
- Packet checkbox popup opens before Plexus / Clinician packet
  generation.
- Completed-section preview uses the same ordered selected list.
- Saved PDF uses the same ordered selected list.
- No raw upload / DB order sneaks into preview / PDF.

### Rule-engine requirements

- Right-side Admin Review selected factors/buttons are truth.
- One factor may support multiple tests.
- One test may have multiple factors.
- No duplicate factor under the same test.
- Same factor may appear under multiple valid tests.
- Parent/child ultrasound targets preserved.
- Per-ancillary regenerate must **not** wipe other ancillaries.
- Regenerate-all must rebuild from selected truth.
- Manual selected factors must **not** be randomly deleted.
- Prior ancillary history warns before duplicate recommendation.
- DNC / cooldown affects outreach / send, **not** clinical
  qualification record.

### Ultrasound child targets

- Carotid Duplex
- Echocardiogram TTE
- Renal Artery Doppler
- Lower Extremity Arterial Doppler
- Upper Extremity Arterial Doppler
- Abdominal Aortic Aneurysm Duplex
- Stress Echocardiogram
- Lower Extremity Venous Duplex
- Upper Extremity Venous Duplex
- Other ultrasound studies

### Critical clinical mapping

**Hypertension must NOT qualify or support Lower Extremity Venous
Duplex by itself.**

Hypertension may support:

- Renal Artery Doppler
- Echocardiogram / TTE
- possibly VitalWave / vascular risk logic depending on rules

Lower Extremity Venous Duplex requires venous indications:

- leg swelling
- unilateral leg edema
- calf pain
- suspected DVT
- history of DVT / PE
- venous insufficiency
- symptomatic varicose veins
- leg redness/swelling with concern for clot
- post-op leg swelling
- immobility with leg symptoms

---

## 7. Patient Directory guardrails

- Exactly **one** Patient Directory UI, route, and sidebar entry.
- Do **not** create `/patient-directory/live`.
- Do **not** create "Patient Directory · Live".
- Do **not** create a second Patient Directory nav item.
- Existing Patient Directory UI must wire to live backend.
- Must surface duplicates, DNC, cooldown, prior ancillary warnings,
  engagement history, call history, Admin Review history,
  import/source history, audit trail.

---

## 8. Care-tech portal guardrails

- Patient Care Specialist Workspace and Ancillary Care Specialist
  Workspace are internal team-member workspaces — **not patient-
  facing**.
- Do not redesign their layout as part of a backend / wiring slice.
- Do not create a new generic Team Portal cockpit.

PCS must support:

- assigned call list
- open patient
- Patient Directory warning facts (DNC, cooldown, prior ancillary)
- call result logging surface
- call history where available
- scheduler handoff path

ACS must support:

- clinic schedule
- ancillary schedule
- ancillary/test workflow state
- report / order / procedure / signing / billing handoff visibility
  where available
- prior ancillary warning visibility where appropriate

---

## 9. Admin Review commit guardrails

The Admin Review approve/commit fan-out writes to multiple downstream
surfaces:

- Patient Directory facts/history
- Engagement handoff
- execution case / assigned work
- call list feed
- scheduler / ancillary handoff scaffold
- audit events

Required behavior:

- Wrap commit fan-out in **one** transaction where the DB supports it.
- Execution case creation must **never** silently fail.
- All required writes succeed together or fail together.
- Optional writes that fail must be explicitly logged / marked, not
  silently hidden.

---

## 10. Canonical call-result writeback

- Patient Care Specialist call results must write through the canonical
  endpoint by default.
- Legacy POST is kept **only** behind a transitional rollback flag.
- After save, refresh / invalidate:
  - call list
  - assigned work
  - Engagement status
  - call history
  - Patient Directory facts / history (where applicable)
- Prevent split-brain call-result writes.

---

## 11. PDF / print / packet protection

Do **not** modify:

- `client/src/lib/pdfGeneration.ts`
- `client/src/lib/pdfPacketGrouping.ts`
- `client/src/lib/patientPacketOrdering.ts`
- `client/src/components/PdfPatientSelectDialog.tsx`
- `client/src/components/qualification/PatientPdfActions.tsx`
- `client/src/print/*`
- Plexus PDF appearance
- Clinician PDF appearance
- Print CSS
- `openPatientPacketPrintPreview` callers/signature

Per-patient packet ordering: outreach alphabetical, visit by
appointment time. Same order in the popup, the on-screen preview,
and the saved PDF.

---

## 12. Scaffold honesty

Downstream modules must be honest about state.

Allowed labels:

- **Live**
- **Scaffold**
- **Dormant**
- **Flag-gated**
- **Read-only**
- **Requires activation**
- **Requires staging DB**

No fake-working states. No buttons that imply completion when the
workflow is stubbed. No claims that billing/signing/invoicing are
fully live if scaffold only. Document what is real and what remains
for Phase 2 / 4 / 5 / 6 / 7.

---

## 13. Safety protocol for risky changes

For migrations, transactional commit semantics, canonical call-result
writeback, or any change that could alter production semantics, each
change must include:

1. exact file paths inspected
2. exact current behavior
3. exact bug / gap
4. exact fix
5. QA proving the fix
6. rollback / flag behavior (if applicable)

Do **not** blindly change these without first documenting the current
behavior.

---

## 14. Working method

- Inspect → fix → test → self-review → continue.
- Slice by slice in order.
- Do **not** stop after one slice unless blocked by missing
  credentials, missing DB, or a decision that could change production
  semantics.
- If `DATABASE_URL` is unavailable, complete all source-level QA and
  make DB-only smoke checks **skip clearly** with an honest reason.
- If a test exposes a real issue, fix the issue, not the test.
- If something fails, fix it and continue.

---

## 15. Untracked-file hygiene

These local directories must never be committed:

- `tmp_recovery/` — broken / WIP file backups
- `artifacts/` — local mockup sandboxes
- `storage/` — local upload staging
- `.env`, `.env.*` — secrets (only `.env.example` is allowed)

These are enforced in `.gitignore`. If gitignore drifts, fix it as
part of the next hygiene slice.

---

## 16. Self-review checklist before PR

- No unrelated files changed.
- No duplicate routes / pages created.
- No generic portals invented.
- No Mission Control added prematurely.
- No dashboards added inside Plexus IQ.
- No `.env` or local artifacts committed.
- Protected layouts not rebuilt.
- Final report honest about live vs scaffold.
- QA green.
- Smokes green or honestly skipped with reason.
