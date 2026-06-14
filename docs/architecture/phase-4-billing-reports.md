# Phase 4 — Billing reports (PR 4.8)

## Reports

- **EOD**: today's readiness counts, blocker breakdown, invoices
  drafted/approved/sent, payments posted, denials opened, overdue
  invoices, delivery failures, per-facility + per-testType rollups.
- **Weekly**: invoices generated/sent, total billed, payments
  received, outstanding balance, denials, blocked aging days.
- **Monthly**: per-facility totals + per-testType totals (best-
  effort), unpaid invoice count, denial summary, schedule
  compliance (batches generated this month).
- **Facility**: convenience endpoint returning EOD + weekly +
  monthly for a single facility.

## Routes

- `GET /api/billing-reports/eod?date=&facilityId=`
- `GET /api/billing-reports/weekly?weekStart=&facilityId=`
- `GET /api/billing-reports/monthly?month=YYYY-MM&facilityId=`
- `GET /api/billing-reports/facility/:facilityId`

All admin/biller-gated.

## UI

`/billing/reports` (admin-gated). Three cards (EOD / Weekly /
Monthly) with stat tiles + per-facility / per-denial lists. No
fake numbers — when a source table has nothing for the period the
fields render `0` or `"—"` honestly.

## Honesty guarantees

- Service queries only — no inserts.
- Computations are pure aggregations from canonical tables.
- Per-testType totals are sometimes empty because the legacy
  `invoice_line_items.service` is plain text and not always
  testType-tagged. The monthly report shows `serviceTotals: {}`
  rather than inventing fake buckets.
