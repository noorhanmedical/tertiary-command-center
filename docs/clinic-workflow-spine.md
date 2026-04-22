# Clinic Workflow Spine

## Naming
- Replace "FYI" with **Upcoming Appointment Confirmation**
- Replace visible status "Deferred to Scheduler" with **Schedule Later**
- Replace scheduler queue name with **Remote Scheduler Follow-Up**

## Starting Assumption
The physician/prescreening already identified the opportunity before the live clinic workflow starts.
There is no extra physician gate in the clinic-day workflow.

## Core Principle
Use one shared **visit workflow card** for each patient on the clinic schedule.
Liaison and technician view the same card.
Remote scheduler works from the same workflow truth, but through scheduler-specific queues.

## Canonical Workflow

### 1. Schedule Upload
When a clinic-day schedule is uploaded:
- create a visit workflow card for each patient
- initial state = Prescreened Eligible

### 2. Liaison In-Clinic Conversion
Liaison actions:
- mark liaison engaged
- mark patient interested / not interested
- mark same-day ready OR schedule later
- complete patient screening form
- complete informed consent

### 3A. Same-Day Path
If:
- same-day requested = true
- screening form complete = true
- informed consent complete = true

Then:
- status becomes Ready for Technician
- patient appears in technician-ready queue automatically

### 3B. Schedule-Later Path
If patient cannot schedule same-day:
- visible status = Schedule Later
- automation creates Remote Scheduler Follow-Up task
- task is auto-assigned based on scheduler distribution presets

### 4. Remote Scheduler Workflow
Remote scheduler handles:
- schedule-later patients
- future scheduling
- callback queue
- auto-distributed assignments
- upcoming appointment confirmation calls

When a future appointment is booked:
- automatically create Upcoming Appointment Confirmation task

### 5. Technician Workflow
Technician sees the same visit workflow card with indicators:
- screening form complete
- informed consent complete
- ready for technician
- with technician
- testing complete

Technician actions:
- start test
- complete test
- flag issue / unable to complete

## Required Workflow Variables
- prescreenedEligible
- liaisonEngaged
- patientInterested
- sameDayRequested
- screeningFormComplete
- informedConsentComplete
- readyForTechnician
- withTechnician
- testCompleted
- scheduleLater
- scheduleLaterReason
- callbackWindow
- remoteSchedulerAssignedTo
- futureAppointmentBooked
- futureAppointmentDateTime
- upcomingAppointmentConfirmationNeeded
- upcomingAppointmentConfirmationComplete

## Automation Rules
1. Schedule upload creates visit cards automatically.
2. Same-day + screening complete + consent complete => Ready for Technician.
3. Schedule Later => create Remote Scheduler Follow-Up and auto-assign.
4. Future appointment booked => create Upcoming Appointment Confirmation task.
5. Technician queue only shows ready/in-progress patients.

## AI Integration
### Liaison AI
- conversion talking points
- qualification summary
- missing info detection
- suggest same-day vs schedule-later path

### Scheduler AI
- best callback time
- best scheduler assignment
- prioritization
- balancing and conversion support

### Technician AI
- readiness checks
- missing form/consent detection
- documentation and report drafting support

## AI Restrictions
AI should not directly decide final workflow states like:
- ready for technician
- schedule later
- booked
- completed

Those should be deterministic rule-based transitions.
