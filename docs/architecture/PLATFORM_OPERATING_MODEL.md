# Tertiary Command Center / Plexus IQ — Platform Operating Model

**Status:** Tier 1 governing document. This is the top-level operating model for the platform.

**What this is:** the *intended* operating system — the standard the platform is reconciled
to, not a description of the current implementation. Code is reconciled to this document,
never the reverse.

**How to use it:** Before designing, building, prompting, coding, or reviewing any feature,
read this document first. Check the change against the **First Principle** (§3) and the
**Operationally-Complete Standard** (§4). A change that violates either is not done, no
matter whether it "works."

This document is the **first thing Claude / Claude Code must read** before discussing,
designing, coding, or reviewing any feature. See §11 for how to use it operationally.

---

## 1. Documentation Authority & Hierarchy

This file is the **top-level governing product operating model** for the Tertiary Command
Center / Plexus IQ platform. It does not delete or replace older architecture docs in
isolation; it sits above them.

**Tier 1 — Governing product operating model:**

- `docs/architecture/PLATFORM_OPERATING_MODEL.md` (this file)

**Tier 2 — Supporting operating-model references, if present in the repo:**

- `docs/architecture/PLATFORM_OPERATING_SYSTEM.md`
- `docs/architecture/PATIENT_DIRECTORY_SOURCE_OF_TRUTH.md`
- `docs/architecture/OPERATIONAL_FLOW_MAP.md`
- `docs/architecture/QUEUE_AND_ASSIGNMENT_MODEL.md`
- `docs/architecture/CALL_WORKFLOW_MODEL.md`
- `docs/architecture/PLATFORM_HARDENING_BACKLOG.md`

If any of these six documents do not exist in this clone yet, do not create them as part
of editing this file. They are supporting references; this file is the standard.

**Tier 3 — Historical / supporting architecture references:**

- Older docs in `docs/architecture/`, including for example `canonical-spine.md`,
  `canonical-workflow-ownership-registry.md`, `background-jobs-design.md`,
  `admin-review-approval-commit-inventory.md`, `billing-invoice-hard-stop-map.md`,
  `call-list-canonicalization-summary.md`, and other pre-existing architecture files that
  describe code as it was implemented at a point in time.

**Conflict-resolution rule.** Where any other document, feature, or piece of code conflicts
with this file, **this file governs** unless Ali explicitly approves an update to this file.
Tier 2 and Tier 3 docs are supporting / reference / historical context — they are not
competing sources of truth. When a conflict is identified, surface it and ask, do not
silently choose the older doc.

**Editing rule.** Updates to this file must be deliberate, explicitly approved, and captured
in commit history. Sweeping changes that drift the operating model without explicit approval
are a defect.

---

## 2. Current Repo Reality From Reconciliation

This section keeps **target** (this document) and **current** (live code) cleanly separated.

This document is the target operating model. The repo on `main` today is **not** fully
aligned to it. Specifically:

- `patient_screenings` is currently the de-facto patient source of truth and the FK target
  for execution cases, notes, calls, documents, billing, cooldown, and readiness — i.e. the
  spine is per-batch, not per-person.
- A canonical Patient Directory module exists in code but is feature-gated and not yet
  active as the longitudinal patient spine. The user-facing `/patient-directory` route
  currently renders a per-batch roster aggregate, not the canonical longitudinal record.
- Notes, calls, billing rows, and documents fragment around screening-level identity in
  important areas. The same real patient appearing in multiple batches can have disjoint
  notes / calls / billing / readiness today.
- Multiple call-outcome vocabularies coexist (outreach enum, canonical planner, engagement
  triage extras). Routing is not yet one canonical model.
- Callback / no-answer / voicemail routing is not yet fully canonicalized. Callbacks today
  often live only as a hidden next-action field and do not always create a visible calendar
  event.
- Portal upload, consent signing, and document-library upload do not yet consistently flip
  document readiness, clear billing-readiness blockers, or write timeline / audit events.
- An Operational Queue / unified-work-surface concept exists in the backend but is not
  consumed by any UI today.
- The cooldown engine is partly built but is not enforced as a hard gate at the call and
  scheduling surfaces, and override is not yet an audited, deliberate action.

**Reconciliation policy.** The platform must be reconciled toward this operating model.
**Do not describe the repo as already conforming to this model unless the code proves it.**
For per-domain evidence of the current state, see `~/plexus-reconciliation.md` (the
reconciliation report) and the Tier 3 architecture docs.

---

## 3. First Principle — the patient is the spine

A patient enters the platform **once** and is **traceable forever.** The patient is the
permanent record. The batch, the call, the note, the document, the invoice are all just
events that happened to that patient.

A batch is a container and a moment. A call is one event. A document is one event. A
billing item is one event. Every one of them connects back to the patient.

**Patient Directory is the permanent patient home** — the convergence point where the full
longitudinal record lives: who the patient is, which facility and which batch / run they came
from, the dates they appeared, what they qualified for and why, what Admin Review decided,
who they were assigned to and who owns the next action, every call attempt and result, every
note, every document, report, consent, order note, procedure note, signature status, every
cooldown, every billing-readiness blocker, every invoice, payment, denial, remittance, and
the full timeline and audit trail.

**The system must never reduce a patient to a row inside a batch.** That is the root defect
this model exists to correct. The batch is the container; the patient is the constant that
persists across all batches, calls, and documents.

---

## 4. The Operationally-Complete Standard

"Works" is not the bar. A feature that runs but does not record itself, surface its own
failure, or hand off cleanly is **incomplete by definition.**

A workflow is **operationally complete** only when all of the following are true:

1. Patient identity is clear
2. Source of truth is clear
3. Owner is clear
4. Queue is clear
5. Status is clear
6. Next action is clear
7. Due date is clear where applicable
8. Admin can see it
9. The assigned user can see it
10. The timeline records it
11. The audit records it
12. The downstream handoff actually fires
13. The failure state is actionable
14. Retry / re-entry exists
15. A regression test proves it

Three governing rules sit on top of this standard:

**No Isolated Feature.** Nothing is built as a standalone page. Every feature attaches to
the patient spine, writes to the timeline, surfaces where the work happens, and hands off to
the next stage. If a feature cannot name its upstream source and its downstream consumer, it
is not designed yet.

**Never fake completion (the honesty rule).** If an artifact has no configured writer, or is
not present, the system says "needed" / "pending" / "writer not configured." It never shows
a false "ready." A fake "ready" is worse than an honest "blocked," because it silently
poisons everything downstream — billing, and with it, compliance.

**No silent drops.** Every handoff between stages must either succeed visibly or fail
visibly. A patient who is approved-but-unrouted, called-but-unlogged, or documented-but-
not-readiness-updated is a defect, not an edge case.

---

## 5. The Operational Flow

The platform is one connected system, not a set of pages. The flow below is a single patient
moving through it.

### 5.1 Intake — Plexus IQ

Plexus IQ is the intake and qualification engine: manual add, batch import, clinical
spreadsheet parsing, identity match-or-create, and the qualification logic that decides
which tests a patient qualifies for and why.

**Facility / date is a parent container; each upload or manual-add is a child run; the
patient is a canonical identity across runs.** A second upload on the same date creates a
**new child run** and qualifies **only the new patients.** Completed patients are never
silently re-qualified. (Worked example: 100 patients uploaded for June 16 in the morning,
50 more in the afternoon → the afternoon upload is a new child run qualifying the new 50,
not a re-run of all 150.) If the same date is re-uploaded, the system distinguishes new
vs. already-completed vs. needs-retry vs. missing-info patients and asks
append-vs-new-list rather than flattening the day.

The qualification console is an operational readout, not a debug bar: facility, date, run
name, total, completed, queued, processing, missing-info, technical-failed, skipped, ETA,
speed, current chunk, retry-failed, review-missing-info, open-failed-list.

**Three distinct failure categories — never collapse them into "failed":**

- **Missing clinical info** (Dx / Hx / Rx) → a clinical-info bucket with clear instructions.
- **Missing demographic info** (DOB / phone / insurance) → a downstream blocker.
- **Technical failure** → a true pipeline error.

### 5.2 Admin Review (inside Plexus IQ)

Admin Review is the **clinical / operational approval gate before Engagement.** It is the
last point at which a qualified patient is approved, rejected, or held for missing
information before they enter the operational workflow.

**Admin Review is not the same as physician signature.** Physician signature is a separate
document / readiness / billing artifact that appears later in the workflow (§7). Do not
conflate them. Admin Review approves the patient for the operational pipeline; physician
signature attests to a clinical document (order, procedure, billing) used in that pipeline.

A reviewer (which may be a physician or a designated operational reviewer) examines each
qualified patient and chooses one of three doors:

- **Approve** → moves the patient downstream to Engagement; assignment happens if rules
  exist; the destination is visible; the timeline records the approval; the audit records
  actor and time.
- **Needs-info** → goes to a central needs-info queue with the missing item clearly named;
  the patient does not disappear; Patient Directory shows the needs-info state.
- **Reject** → a clear rejected / closed state with a visible reason; timeline and audit
  record it.

The reviewer may add or remove qualifying tests, and may adjust the test window.

Admin Review must never silently approve someone and then fail the downstream handoff
without saying so. If the engagement / commit fan-out fails after approve, the failure is
surfaced to the reviewer and the patient appears in an "approved-but-unrouted" queue for
retry.

### 5.3 Engagement Center

The manager / admin assignment layer. An approved patient arrives here and gets an **owner**
and a **next action.** Unassigned and failed-handoff states are first-class and visible.
Engagement shows patient, facility, source, approved date, qualifying tests, current status,
assigned member (or unassigned), next action and due date, last call result, attempt count,
missing info, blockers, and whether the patient is visible in Team Portal. When a patient is
assigned, they appear in that user's Team Portal — or the system explains why they did not.

### 5.4 Team Portal (PCS / ACS)

Team Portal is one shared execution shell with two role modes — PCS and ACS. See §6 for the
full Team Portal Layout Law. Briefly:

- **PCS** focuses on outreach: assigned calls, callbacks, no-answer and voicemail
  follow-ups, ready-to-schedule patients, call results, scheduling handoff.
- **ACS** focuses on ancillary execution: scheduled procedures, confirmations, consent /
  screening / report / order-note / procedure-note / signature status, document upload,
  procedure completion, billing-readiness status.

Both modes have a call list, ancillary schedule, patient canvas, notes, the relevant
calendar, the patient timeline, and documents where relevant. Roles **perform**; the spine
**holds** (see §9).

### 5.5 Calls

See §5.10. A call result is a routing decision, not a label.

### 5.6 Scheduling & Calendar

The calendar shows real, time-based operational commitments: doctor visits, callback times,
scheduled calls, ancillary appointments, procedure events, no-show follow-ups, reschedules,
cancellations, confirmations. **Anything with a due time is visible where work happens** —
the assigned user's queue, the Team Portal calendar, the admin view, the patient timeline,
and the global schedule where appropriate. A callback time must never live only as a hidden
next-action field.

### 5.7 Documents — the readiness spine

See §7 for the full Order Notes / Procedure Notes / Reports / Signatures / Billing Documents
section.

### 5.8 Billing readiness → Invoice → Payment

Billing readiness reads the entire upstream and answers one question: *is everything
required present for this patient / test?* — report, consent, screening, order note,
procedure note, physician signature, procedure completion, insurance verification, pricing /
policy, and recipient billing rules, each where required. If blocked, it shows the
**blocker, the owner, and the queue** — billing sees the upstream reason, not a bare red X.
If ready, invoice readiness proceeds: snapshot → batch preview → draft → review / approval
→ delivery → sent / blocked → payment / partial / adjustment → denial / dispute /
remittance → reports. Every step writes back to the patient timeline.

### 5.9 Patient Directory — the permanent home

The convergence point. Opening a patient shows the full longitudinal record across all
batches, all calls, all documents, all billing, all cooldowns, the full timeline, and the
full audit. This is where "enter once, traceable forever" is realized.

### 5.10 Call Workflow (operational behavior)

A call result is a **routing decision, not a label.** There is one canonical routing model
that still preserves the raw outcome.

Every call result must produce:

- preserved raw outcome
- canonical routing outcome
- patient identity link
- execution case / work-item link
- owner
- queue
- next action
- `nextActionAt` / callback time if needed
- calendar event if appropriate
- timeline event
- audit event
- admin visibility
- assigned-user visibility
- Patient Directory visibility
- terminal or re-entry state

Behavior by outcome (product level; the repo today has multiple competing outcome
vocabularies — see §2):

- **No answer** → attempt logged and counted; next-action time set by policy; same owner
  unless an escalation threshold is reached; re-enters that owner's call list.
- **Voicemail / LVM** → same as no answer with a voicemail marker; same re-entry rules.
- **Callback requested** → a callback time is required; it appears on the assigned user's
  queue, the calendar, and the patient timeline; re-enters the list at the callback time;
  owner preserved unless reassigned.
- **Wrong / bad number** → routes to needs-info / admin review; blocker visible; patient
  does not disappear from the spine.
- **Declined / not interested** → closed / terminal; removed from the active call list;
  reporting and timeline preserved.
- **DNC** → protected terminal state; clear; audit and timeline required; subsequent
  contact attempts are gated.
- **Interested / wants more info** → resolves to a concrete next action (ready-to-schedule,
  callback, manager review, or info follow-up); never a vague status that just sits.
- **Scheduled** → calendar event created; patient moves into the scheduled workflow.
- **Unable to reach** → threshold-based escalation to manager / admin review.
- **No-show / reschedule** → when produced from a call (e.g. a confirmation call discovers
  a reschedule), a calendar transition fires and triage opens where appropriate.

Anti-patterns to avoid in this surface:

- Multiple competing outcome vocabularies producing fragmented routing.
- A callback time that exists only as `nextActionAt` and is not visible on the calendar.
- An outreach surface that records a call but skips the timeline / audit write.

---

## 6. Team Portal Layout Law

Team Portal is **one shared execution shell** with PCS and ACS role modes. PCS and ACS are
**not separate apps.**

**Layout law:**

- **Left panel = tools rail only.** Tools, shortcuts, launchers, utilities only. **No
  patient facts in the left rail.**
- **Center = patient canvas.** Patient facts, active workflow, active tool. This is where
  the reader sees who the patient is and what is being done with them.
- **Right panel = assigned work queue, call list, schedule, or due work.** The "what should
  I work on right now" surface.

**Both PCS and ACS** should have access to **Call List** and **Ancillary Schedule** where
operationally relevant. The role mode tunes the defaults and the capability set; it does
not amputate functionality the operator legitimately needs.

**The assigned user must always be able to answer, from the Team Portal:**

1. Why is this patient here?
2. What is my next action?
3. When is it due?
4. What happened before?
5. What happens after I act?

If any of those five answers is not visible, the workflow is not operationally complete (§4,
"No Isolated Feature").

---

## 7. Order Notes, Procedure Notes, Reports, Signatures, and Billing Documents

These are **operational document / readiness / billing artifacts**, not casual notes and
not role-owned. Each follows the same five-step shape:

> artifact created or marked present →
> attached to patient + execution case + test / procedure →
> document readiness flips the specific flag →
> billing readiness clears the matching blocker →
> timeline + audit record it.

The honesty rule (§4) applies throughout: if there is no writer for a given artifact, the
system says "needed" / "pending" / "writer not configured." Never a fake "present."

### Report

- A report is a **document artifact.**
- It attaches to patient + execution case + test / procedure.
- Report upload must update document readiness (`report` flag → present).
- Report upload must update ACS workflow status so the case can advance.
- Report upload must update billing readiness (clears the `missing_report` blocker).
- Report upload must write a Patient Directory timeline + audit event.

### Consent

- Consent is a **document artifact.**
- Consent signing must create a signed document attached to patient + execution case + test.
- Consent signing must update document readiness (`informed_consent` flag → present).
- Consent signing must update billing readiness if consent is required for that test
  (clears `missing_consent` blocker).
- Consent signing must write a Patient Directory timeline + audit event.

### Order note

- An order note is **not** an "ACS note." It is **not** a casual note.
- An order note is a **document / readiness / billing artifact.**
- An order note belongs to patient + execution case + test / procedure context.
- An order note may be uploaded, generated, or marked present by the appropriate role or
  system writer.
- A present order note must clear the `missing_order_note` billing-readiness blocker.
- If no writer exists for a given order-note path, the system shows
  "order note needed" or "writer not configured."
- **Never fake order-note completion.**

### Procedure note

- A procedure note is **not** an "ACS note." It is **not** a casual note.
- A procedure note is a **procedure / document / billing artifact.**
- A procedure note belongs to patient + procedure event + execution case + test type.
- A present procedure note must clear the `missing_procedure_note` billing-readiness
  blocker.
- If no writer exists for a given procedure-note path, the system shows
  "procedure note needed" or "writer not configured."
- **Never fake procedure-note completion.**

### Physician signature

- Physician signature is a **separate readiness artifact**, distinct from Admin Review
  approval (§5.2).
- "Signature pending" must remain honest if no writer exists.
- Signature must clear the `physician_signature_pending` billing-readiness blocker **only
  when actually present.**
- **Never fake signature completion.**

### Billing document / completed billing package

- A billing document is **not** an "ACS note." A completed billing package is **not** a
  casual note.
- A billing document is a **downstream billing handoff artifact.**
- A billing package is created only when the required upstream artifacts are present **or**
  explicitly and audibly overridden (override requires actor + reason + audit).
- A billing package must attach to patient + execution case + test / procedure + billing
  readiness.
- "Billing package ready" must write a Patient Directory timeline + audit event.

---

## 8. Cross-cutting engines

These are not stages. They run across every stage and must be modeled **once** and consumed
everywhere.

### Patient identity

A canonical identity carried across batches. The resolution rule must be more than a name +
DOB string match. The same person appearing in multiple batches resolves to **one** record.
This is the spine the entire model depends on.

### Cooldown / test-eligibility engine

Every ancillary test has a **per-patient, per-test, per-payer re-eligibility window** —
**Medicare 12 months, PPO 6 months** — measured from the last completed test of that type.

**Cooldown is not advisory.** Cooldown gates:

- qualification output where applicable
- call outreach
- scheduling
- billing compliance

Operating rules:

- **Completion arms the next window.** Report / completion has two downstream consequences:
  it clears the billing-readiness blocker **and** starts the cooldown clock. The same event
  that lets you bill is the event that locks the patient out of a repeat.
- **The cooldown gates calling and scheduling.** It fires upstream — when a PCS is about to
  call to schedule, and again at the moment of scheduling — so a patient is never placed on
  the calendar for a test they are locked out of. Default is **block** inside the window.
- **Per-test, independent clocks.** On a bundled clinic day (BrainWave, VitalWave, and any
  other ancillaries scheduled together), each test has its own clock. A patient can be
  eligible for one and cooling down on another. Eligible tests proceed; locked tests flag.
  **Never all-or-nothing.**
- **Hard ineligibility.** A separate flag marks patients who cannot get a given test
  regardless of the time window (contraindication, condition, declined).
- **Overrides are deliberate, marked, audited, and visible.** An override is a compliance
  decision (e.g., inside three months → must override), not a convenience. Every override
  must record actor + reason + time and write a timeline + audit event.
- **Compliance stakes.** Billing inside the window means denial and exposure, so the gate
  is mandatory, not advisory. The cooldown is visible in Patient Directory and readable by
  the call list and the scheduler.

### Documents Library — effective-dated templates

The single source of truth for all templates — order notes, procedure notes, consents,
marketing collateral — with the generation logic. Admin edits a template once; from that
timestamp **forward**, every newly generated artifact of that type uses the updated
version, with no code change.

The discipline that makes this safe is **versioning by effective date:** the template in
force at generation time is stamped onto the artifact; edits apply only going forward;
historical artifacts stay tied to the version that produced them, so a year later you can
still see exactly which template generated a given patient's note. The library is the
**upstream source;** every place that produces a document is a **downstream consumer** that
pulls the current version at the moment of generation.

### Communication & outreach

Patient communication is calls **plus** email and marketing touches. The marketing / email
action (for example, from the PCS / ACS workspace while on the phone) is a UI entry point,
but the requirement is that every email and piece of collateral sent is an **event on the
patient timeline** — what was sent, when, by whom, which template — tied to identity and
audited. The patient's communication history is one unified timeline of calls, voicemails,
emails, and marketing touches.

### Extensibility — adding a new ancillary by configuration

Adding an ancillary is **configuration, not code surgery.** Defining the vertical once
means specifying: its qualifying logic (Plexus IQ), its document set and templates
(Documents Library — order note, procedure note, consent, report type), its insurance
cooldown rules per payer, its scheduling behavior, and its billing-readiness blockers and
pricing. Once defined canonically, **every stage absorbs it automatically** —
qualification, scheduling, document readiness, billing readiness, the cooldown engine, the
timeline — so it behaves identically to the existing ancillaries from day one. If a new
vertical can be added declaratively and the whole pipeline picks it up, the platform is
one operating system. If it requires surgery across modules, it is still disconnected.

### Timeline & audit

Every event across every stage writes to the patient timeline and the audit log — actor,
time, context. The timeline is the patient's operational narrative; the audit is the
compliance record. **No stage is exempt.**

### Integration Honesty Rule

RingCentral, SMS, clearinghouse, EHR / EMR, payer-portal, payment-processor, and similar
integrations must remain **honestly dormant** unless explicitly configured, activated, and
tested. The UI must not imply a live integration when it is scaffolded.

If an integration is dormant:

- show "dormant" / "not configured" / "unavailable"
- do not fake delivery
- do not fake call completion
- do not fake messages sent
- do not fake clearinghouse transmission
- do not fake EHR sync

This is the "never fake completion" rule (§4) applied to external systems.

### Packet / PDF Output Rule

Clinician packets, Plexus packets, patient packets, billing packets, and other generated
documents must use **platform-controlled preview / generate flows.** Browser print
headers, browser footers, `about:blank`, local / replit URLs, and browser page-number
junk are **not acceptable document output.**

A generated packet must:

- carry the correct patient content
- have one patient per page when required
- avoid browser-generated header / footer artifacts
- use platform-controlled PDF generation where feasible
- be traceable to patient + packet type + generation time
- write a timeline + audit event if the packet is operationally significant (e.g.
  clinician packet, billing packet, completed billing package)

---

## 9. Ownership model — roles perform, the spine holds

ACS, PCS, admin, and billing are **workflow roles** — they describe *who performs* an
action. They are **not** owners of any artifact.

The artifacts (notes, order notes, procedure notes, reports, consents, signatures, billing
documents, completed billing packages, packets) belong to the **spine:**

- **patient identity** — the canonical patient (longitudinal record).
- **execution case / patient test** — operational case context.
- **document workflow** — report, order note, procedure note, billing document artifacts.
- **readiness workflow** — `missing` / `pending` / `present` / `approved` / `completed`
  status per document type.
- **billing workflow** — uses those artifacts to decide billing readiness, invoice
  readiness, and downstream billing handoffs.
- **Patient Directory timeline** — longitudinal history of every event.

The roles **may perform** actions:

- ACS may upload a report, complete a procedure, capture consent.
- PCS may schedule a patient, log a call, send marketing collateral.
- Admin may approve, reject, mark needs-info, edit settings.
- Billing may approve an invoice, send delivery, post payment.

But the **artifacts they touch are not theirs.**

**Quick notes, call notes, ACS notes, billing notes, reports, consents, order notes,
procedure notes, physician signatures, billing documents, and completed billing packages
are all spine artifacts**, not role objects.

Saying "ACS uploads the report" does not make the report an ACS object. The report
belongs to patient + test + case and is consumed by document readiness and billing.
Modeling any of these artifacts as role-owned is a defect.

**ACS does not own notes. PCS does not own notes. Billing does not own notes. Roles
perform; the spine holds.**

---

## 10. Anti-patterns — never reintroduce these

- **Patient-as-row.** Treating a patient as a screening row inside a batch instead of a
  longitudinal identity. The root disease.
- **Silent drops at the seams.** Handoffs that fire-and-forget or are flag-gated, so
  approved, called, or documented patients fall out of view without an error. The second
  root disease.
- **Fake completion.** Showing "ready" / "signed" / "present" when the artifact or its
  writer does not exist.
- **Isolated modules.** Building a page that does not write the timeline, has no owner, or
  names no downstream consumer.
- **Taxonomy drift.** Multiple competing vocabularies (for example, call outcomes)
  producing fragmented routing. There is one canonical routing model.
- **Requalifying completed work.** Re-running qualification over already-completed patients
  on a same-date re-upload instead of creating a child run for the new patients only.
- **Buried next-actions.** A callback or due action that lives only in a hidden field
  instead of being visible on the queue and the calendar.
- **Cooldown as advisory.** Allowing a call or schedule inside a payer's re-eligibility
  window without a deliberate, audited override.
- **Role-owned artifacts.** Treating reports, notes, signatures, or billing documents as
  belonging to ACS / PCS / billing instead of to the spine.
- **Faking integration liveness.** Showing "sent" / "delivered" / "synced" / "ready" when
  the integration is dormant.
- **Browser-print PDF output.** Letting `about:blank`, local URLs, browser header / footer
  artifacts, or page-number junk land on a generated packet.
- **Confusing Admin Review with physician signature.** They are separate concerns
  (§5.2 vs §7).
- **Negative-only guardrails.** "Do not touch X" without specifying the positive target
  end state.

---

## 11. How Claude / Claude Code Must Use This Document

This file is the **first document Claude / Claude Code must read** before giving advice,
writing prompts, designing, coding, or reviewing any feature.

Before answering or producing any plan, Claude must identify:

- **Which stage** of the operating model is affected (§5).
- **Upstream dependencies** — what produces the input.
- **Downstream handoffs** — what consumes the output, and where it must surface.
- **Source of truth** — which spine table / row owns this state.
- **Patient identity** — canonical patient, not screening row.
- **Owner / queue / next action.**
- **Admin visibility.**
- **Assigned-user visibility.**
- **Timeline / audit event.**
- **Failure / retry / re-entry behavior.**
- **Document / readiness / billing impact** if any document artifact is touched.
- **Integration liveness** — real vs. honestly dormant.

Claude must **not** answer as if a requested feature is isolated.

Claude must **not** create prompts that only list "do not" guardrails. Negative-only
guardrails leave open the wrong positive interpretation. Every prompt must specify the
**positive target end state.**

Example:

- **Wrong:** "Do not touch Phase 3."
- **Correct:** "Create a docs branch from `main`. Edit only
  `docs/architecture/PLATFORM_OPERATING_MODEL.md`. Do not modify schemas, routes, services,
  components, or migrations. Commit nothing without explicit approval."

When this document and an older Tier 2 or Tier 3 doc conflict, **this document governs.**
Flag the conflict to Ali; do not silently choose the older doc.

When the **current code** does not match this document, that is a reconciliation gap, not
a contradiction. Describe the gap honestly using §2 framing — target vs current.
