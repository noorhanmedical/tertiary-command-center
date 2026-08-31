# Investor Demo — Runbook

This is the end-to-end guide for demoing Plexus Ancillary Screening to
investors using **100% synthetic patient data** flowing through the **real,
live application**.

There are two roles here:

- **Operator** — has AWS (or Replit) access. Runs the seed **once**.
- **Presenter** — the person actually demoing. Needs only a **URL and a login**.
  No code, no database, no AWS.

---

## What the demo contains

Running the seed creates:

- **1 demo login:** username `demo`, role `admin` (sees every screen).
- **24 synthetic patients** — fake names, demographics, phone/email, diagnoses.
  No real PHI. Spread across all lifecycle stages so every screen has data:

  | Stage      | Count | What the presenter sees |
  |------------|-------|--------------------------|
  | Intake     | 4     | Imported, not yet screened (Draft) |
  | Screened   | 5     | Qualified & committed, insurance + cooldown evaluated |
  | Scheduled  | 5     | Appointment booked in the future (mix of visit + outreach) |
  | Procedure  | 4     | Procedure complete, documents + notes generated |
  | Billed     | 6     | Full spine: completed billing package + invoice line item |

- **3 demo facilities:** Cedar Ridge Family Medicine, Lakeside Internal
  Medicine, Summit Cardiology Associates.
- **3 services:** BrainWave, VitalWave, Ultrasound.

Every row is tagged `is_test = true` and every batch name is prefixed
`DEMO — `. The seed is **strictly additive** — it never edits or deletes
existing (real) rows. It is **idempotent** — safe to re-run; it updates the
same demo rows instead of duplicating them.

---

## Operator: seed the data (do this ONCE)

The seed must run somewhere that can reach the RDS database (inside the VPC).
A laptop outside AWS cannot reach RDS. Pick the option that matches your access.

> **Prerequisite for the AWS options.** Deploy the latest image first (this
> branch adds the `script/` folder to the Docker image). Push to `main` triggers
> `.github/workflows/deploy.yml`, or build/push manually per `DEPLOY_AWS.md` §4.

### Option A — Dedicated seed task definition (recommended; simplest to run)

Register a purpose-built `plexus-demo-seed` task definition once. After that the
operator's command is short and repeatable. The task def mirrors the running
service (same image, secrets, roles) but runs the seed instead of the web
server, and sets `NODE_ENV=development` (the seed refuses to run under
`production` by design).

1. **Generate + register the task def** (needs `aws` + `jq`). This copies the
   image, roles, and `DATABASE_URL` secret from the live `command-center` task
   def so there are no placeholders to edit:

   ```bash
   DEMO_PASSWORD='CHOOSE_A_STRONG_DEMO_PASSWORD' \
     ./deploy/build-demo-seed-taskdef.sh > taskdef.json
   aws ecs register-task-definition --cli-input-json file://taskdef.json --region us-east-1
   ```

   (Prefer to edit by hand instead? Use the template at
   `deploy/ecs-task-def.demo-seed.json` and fill in the `<PLACEHOLDER>` values.)

2. **Run it** on the same subnets/security group as the service:

   ```bash
   aws ecs run-task \
     --cluster plexus-prod \
     --task-definition plexus-demo-seed \
     --launch-type FARGATE \
     --network-configuration "awsvpcConfiguration={subnets=[SUBNET_ID_1,SUBNET_ID_2],securityGroups=[SERVICE_SG_ID],assignPublicIp=DISABLED}" \
     --region us-east-1
   ```

3. Check the task's CloudWatch logs. Success ends with
   `[seed:investor-demo] OK — demo data seeded` and a stage summary.

### Option A2 — One-shot override (no new task def)

If you'd rather not register a task def, override the existing
`command-center` task def's command inline. Note the explicit
`NODE_ENV=development` override — without it the seed will abort under the
service's production setting.

```bash
aws ecs run-task \
  --cluster plexus-prod \
  --task-definition command-center \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[SUBNET_ID_1,SUBNET_ID_2],securityGroups=[SERVICE_SG_ID],assignPublicIp=DISABLED}" \
  --overrides '{"containerOverrides":[{"name":"command-center","command":["sh","-c","E2E_SEED_APPLY=YES npx tsx script/seedInvestorDemo.ts"],"environment":[{"name":"NODE_ENV","value":"development"},{"name":"DEMO_PASSWORD","value":"CHOOSE_A_STRONG_DEMO_PASSWORD"}]}]}' \
  --region us-east-1
```

`DATABASE_URL` and other secrets come from the task definition automatically.
`DEMO_PASSWORD` defaults to `PlexusDemo2026!` if omitted.

### Option B — From the Replit workspace (if that's where you work)

The Replit environment already has the repo, Node 20, `tsx`, and database
connectivity.

```bash
E2E_SEED_APPLY=YES DEMO_PASSWORD='CHOOSE_A_STRONG_DEMO_PASSWORD' npm run seed:investor-demo
```

### Option C — From your machine via a DB tunnel (advanced)

Only if you can open an SSM/SSH tunnel into the VPC. Point `DATABASE_URL` at the
tunnel's local endpoint, then:

```bash
E2E_SEED_APPLY=YES DEMO_PASSWORD='...' node --env-file=.env node_modules/.bin/tsx script/seedInvestorDemo.ts
```

> **Dry run first (any option).** Without `E2E_SEED_APPLY=YES` the script only
> prints the plan and writes nothing. Use it to preview:
> `npm run seed:investor-demo`

---

## Presenter: run the demo

You need two things from the operator: the **app URL** and the **demo password**.

1. Open the app URL in a browser.
2. Log in: username `demo`, password (from the operator).
3. Walk the stages — a suggested flow:
   - **Home / dashboard** — overall activity across the demo facilities.
   - **Patient Directory / Database** — the 24 patients; open a few charts.
   - **Intake / Plexus IQ** — show the 4 intake patients and AI qualification.
   - **Schedule / Calendar** — the 5 scheduled patients with future appointments.
   - **Procedures / Documents** — the 4 procedure-complete patients with
     generated notes and document readiness.
   - **Billing** — the 6 billed patients, completed packages, and invoices.

All names and demographics are fictional; the workflow, screening logic,
scheduling, and billing are the real product.

---

## After the demo (optional cleanup)

The demo data is harmless (synthetic, `is_test = true`, `DEMO — ` batches) and
can be left in place for future demos. When you want it gone, the seed script
has a built-in `--cleanup` mode. It removes **only** demo-tagged data: the
`DEMO — ` batches and their patients, the canonical spine rows for those
patients (execution cases, scheduling, insurance, cooldown, procedures, notes,
billing readiness, completed packages, documents), and the `demo` user. It does
**not** touch any non-demo row.

> Invoices and invoice line items are intentionally left in place — a facility's
> Draft invoice can be shared with non-demo work, so removing those is a manual
> review step if you ever need it.

**Preview what would be deleted (dry-run, no writes):**

```bash
# From Replit / inside the VPC:
npm run seed:investor-demo -- --cleanup
```

**Apply the cleanup:**

- Dedicated task def (Option A): register a cleanup variant and run it —
  ```bash
  MODE=cleanup ./deploy/build-demo-seed-taskdef.sh > taskdef.cleanup.json
  aws ecs register-task-definition --cli-input-json file://taskdef.cleanup.json --region us-east-1
  aws ecs run-task --cluster plexus-prod --task-definition plexus-demo-seed \
    --launch-type FARGATE \
    --network-configuration "awsvpcConfiguration={subnets=[SUBNET_ID_1,SUBNET_ID_2],securityGroups=[SERVICE_SG_ID],assignPublicIp=DISABLED}" \
    --region us-east-1
  ```
- One-shot override (Option A2): change the command to
  `E2E_SEED_APPLY=YES npx tsx script/seedInvestorDemo.ts --cleanup`
  (keep the `NODE_ENV=development` override).
- Replit / tunnel: `E2E_SEED_APPLY=YES npm run seed:investor-demo -- --cleanup`

---

## Security notes

- The `demo` account is a real **admin** login. Use a strong `DEMO_PASSWORD`
  and share it privately with the presenter. Deactivate or delete it after the
  demo if the URL is internet-facing.
- The repo's `.env` currently contains real-looking RDS credentials committed
  to source control. Rotate those and move them to Secrets Manager; the seed
  and the app both read `DATABASE_URL` from the environment, so nothing depends
  on that file staying in the repo.
