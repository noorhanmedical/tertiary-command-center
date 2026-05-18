# Technician Central Architecture

> Honest map of the technician surface. **This domain has the biggest
> gap on the platform** — calling it out honestly here so it can be
> resourced as its own batch.

## What exists today

- The `users.role` enum supports a `technician` role.
- The `outreach_schedulers` table has a `userId` FK, and the team-member
  workspace profile in `admin_settings` can mark a user as workspace
  type `technician` / `ancillaryCareSpecialist`.
- `global_schedule_events.eventType` includes `team_member_availability`,
  `pto_block`, `sick_day`, `unavailable_block` — i.e. availability is
  modeled as schedule events, not a separate table.
- `procedure_events.completedByUserId` records which tech completed
  a procedure.
- `ProcedureCompleteButton` in `PortalShell` writes to
  `POST /api/procedure-events/complete` for ACS users.
- `GET /api/ultrasound-tech/completed-procedures` returns a
  technician-scoped read of completed procedures.

## What is missing (named gaps)

1. **No `technician_availability` table.** Availability is currently
   inferred from `global_schedule_events` rows with availability-type
   `eventType`s; there's no first-class table for per-tech weekly
   patterns / preferences.
2. **No `technician_qualification` table.** A tech's qualified
   ancillary types (BrainWave / VitalWave / Ultrasound, etc.) are not
   modeled. Capability bits in the team-member workspace profile cover
   roles but not service-type qualifications.
3. **No global tech schedule page.** A read-only "tech-week" view that
   shows clinic/day/assigned tech without patient names doesn't exist.
4. **No multi-tech-per-clinic-per-day data model.** The current
   scheduler-assignment logic assumes one assignee per case; a clinic
   day with two techs is not directly representable.
5. **Scheduling doesn't refuse to book a tech who is on PTO.**
   `pto_requests` exists, but `POST /api/global-schedule-events/schedule-ancillary`
   doesn't currently consult it before accepting a new appointment for
   that `assignedUserId`.

## Recommended next-batch schema

```ts
// shared/schema/technicianAvailability.ts
export const technicianAvailability = pgTable("technician_availability", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  weekday: integer("weekday").notNull(), // 0-6
  startTime: text("start_time").notNull(), // HH:MM
  endTime: text("end_time").notNull(),     // HH:MM
  facilityId: text("facility_id"),         // null = all assigned facilities
  effectiveFrom: text("effective_from"),
  effectiveTo: text("effective_to"),
  isActive: boolean("is_active").notNull().default(true),
});

// shared/schema/technicianQualification.ts
export const technicianQualifications = pgTable("technician_qualifications", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  serviceType: text("service_type").notNull(), // e.g. "BrainWave"
  qualifiedAt: timestamp("qualified_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  notes: text("notes"),
});
```

## Recommended routes for the next batch

- `GET/POST /api/technician/availability` (weekly pattern + ad-hoc overrides via existing `global_schedule_events`).
- `GET/POST /api/technician/qualifications`.
- `GET /api/technician/schedule?facilityId=&date=` — clinic-day view without patient names for global tech ops.
- Schedule write routes should consult both availability + PTO + qualification before accepting a new event.

## Current behaviour (no fake claims)

- Booking a procedure for a tech ignores availability today; it relies on operator discipline + the Engagement Assignment Board's facility match.
- Tech qualification is enforced by operator review, not schema.
- The Technician Central page does not yet exist as a standalone surface.

## QA

- `npm run qa:full-canonical-spine` includes `global_schedule_events` reads (which is where availability currently lives as event rows).
- No technician-specific QA script yet — none of the canonical tables for technician availability/qualification exist.
