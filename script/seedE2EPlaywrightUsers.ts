// script/seedE2EPlaywrightUsers.ts
//
// Idempotent seed for the five Playwright fixture users referenced by
// tests/e2e/fixtures/auth.ts. Reads-only by default; refuses to write
// unless `E2E_SEED_APPLY=YES`. Refuses to run under production.
//
// ── Role choices (from shared/schema/users.ts USER_ROLES) ──────────
// The canonical enum:
//   ["admin", "clinician", "scheduler", "biller", "technician", "liaison"]
//
// Mapping to the Playwright fixture set:
//   admin        → "admin"     — bypasses clinic filtering
//   clinician    → "clinician" — Physician Portal path
//   pcs          → "liaison"   — Patient Care Specialist portal
//                                (VIEWAS_WORKSPACE_TO_ROLE.pcs, per
//                                 server/routes/portal.ts:121-124)
//   acs          → "technician"— Ancillary Care Specialist portal
//                                (VIEWAS_WORKSPACE_TO_ROLE.acs)
//   unauthorized → "clinician" with active=false — used to prove that
//                                deactivated users hit the 403 branch
//                                in server/routes.ts:148-150. Any active
//                                "basic" user in this system has a real
//                                role assignment; there is no "basic
//                                nothing" role, so the honest way to
//                                exercise the unauthorized flow is via
//                                the deactivated-user branch.
//
// ── Safety rules ──────────────────────────────────────────────────
//   • Default is DRY-RUN. Set E2E_SEED_APPLY=YES to actually write.
//   • Refuses when NODE_ENV=production.
//   • Requires DATABASE_URL.
//   • Requires E2E_TEST_CLINIC_ID for all non-admin users, and verifies
//     that the clinic exists.
//   • Requires E2E_TEST_PASSWORD from the environment. The plaintext
//     value is NEVER printed and NEVER stored in the repo.
//   • Only touches users whose username starts with `e2e_playwright_`.
//     No other row (in any table) is created, edited, or deleted.
//   • No `db:push`. No migration. No drizzle-kit. No TRUNCATE. No
//     DELETE. No clinic mutation.
//
// ── Usage ─────────────────────────────────────────────────────────
//   # Dry-run (the default — describes what WOULD change):
//   E2E_TEST_CLINIC_ID=1 E2E_TEST_PASSWORD='changeme' npm run seed:e2e-users
//
//   # Actual write (idempotent — safe to re-run):
//   E2E_SEED_APPLY=YES E2E_TEST_CLINIC_ID=1 E2E_TEST_PASSWORD='changeme' \
//     npm run seed:e2e-users
//
// On success the script prints the exact `export PLAYWRIGHT_TEST_*_USER=`
// lines to source into the shell that will run `npm run test:e2e`.
// Password exports print with the literal `$E2E_TEST_PASSWORD` so the
// plaintext is never exposed on stdout.

import { eq, and, or, sql, like } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { USER_ROLES, type UserRole } from "@shared/schema/users";

// ── Compile-time role verification ────────────────────────────────
// Fail hard at boot if the canonical USER_ROLES enum drifts. Keeps
// the seed and the schema honest against each other.
const REQUIRED_CANONICAL_ROLES = [
  "admin",
  "clinician",
  "liaison",
  "technician",
] as const;
for (const r of REQUIRED_CANONICAL_ROLES) {
  if (!(USER_ROLES as readonly string[]).includes(r)) {
    throw new Error(
      `[seed:e2e-users] canonical USER_ROLES enum missing required role "${r}". Fixture mapping must be re-validated.`,
    );
  }
}

// ── Fixture definitions ───────────────────────────────────────────
// Each entry maps a Playwright fixture role → a canonical User row.
// Change here only after validating tests/e2e/fixtures/auth.ts and
// the routes' RoleGuard behavior.
type Fixture = {
  playwrightKey:
    | "ADMIN"
    | "CLINICIAN"
    | "PCS"
    | "ACS"
    | "UNAUTH";
  username: string;
  role: UserRole;
  // Admin bypasses clinic scoping (clinicContext.ts:31-33), so its
  // clinicId is intentionally null. Non-admin users need a real
  // clinic (verified against the clinics table before write).
  requiresClinic: boolean;
  // Deactivated users hit the 403 branch (routes.ts:148-150) — this
  // is how the unauthorized fixture proves the auth-blocked path.
  active: boolean;
};

const FIXTURES: readonly Fixture[] = [
  { playwrightKey: "ADMIN",     username: "e2e_playwright_admin",        role: "admin",      requiresClinic: false, active: true },
  { playwrightKey: "CLINICIAN", username: "e2e_playwright_clinician",    role: "clinician",  requiresClinic: true,  active: true },
  // Per server/routes/portal.ts:121-124 (VIEWAS_WORKSPACE_TO_ROLE):
  //   pcs → liaison, acs → technician.
  { playwrightKey: "PCS",       username: "e2e_playwright_pcs",          role: "liaison",    requiresClinic: true,  active: true },
  { playwrightKey: "ACS",       username: "e2e_playwright_acs",          role: "technician", requiresClinic: true,  active: true },
  // Deactivated → 403 on login (routes.ts:148-150).
  { playwrightKey: "UNAUTH",    username: "e2e_playwright_unauthorized", role: "clinician",  requiresClinic: true,  active: false },
] as const;

// Enforce the "only touch e2e_playwright_* usernames" invariant at
// the code layer. Referenced by the static test.
const SEED_USERNAME_PREFIX = "e2e_playwright_";
for (const f of FIXTURES) {
  if (!f.username.startsWith(SEED_USERNAME_PREFIX)) {
    throw new Error(
      `[seed:e2e-users] fixture username ${f.username} does not start with ${SEED_USERNAME_PREFIX}`,
    );
  }
}

// ── Environment gates ─────────────────────────────────────────────
function bail(msg: string, code = 1): never {
  console.error(`[seed:e2e-users] ${msg}`);
  process.exit(code);
}

function checkGates(): {
  apply: boolean;
  clinicId: number;
  password: string;
} {
  if (process.env.NODE_ENV === "production") {
    bail("Refusing to run: NODE_ENV=production. Fixture seeds must never touch production.");
  }
  if (!process.env.DATABASE_URL) {
    bail("DATABASE_URL is required.");
  }
  const password = process.env.E2E_TEST_PASSWORD;
  if (!password || password.length < 12) {
    bail("E2E_TEST_PASSWORD is required (min 12 chars). The plaintext value is not printed.");
  }
  const rawClinic = process.env.E2E_TEST_CLINIC_ID;
  if (!rawClinic) {
    bail(
      "E2E_TEST_CLINIC_ID is required for the four non-admin fixtures. Set to the id of a NON-PRODUCTION test clinic.",
    );
  }
  const clinicId = parseInt(rawClinic, 10);
  if (!Number.isFinite(clinicId) || clinicId <= 0) {
    bail(`E2E_TEST_CLINIC_ID must be a positive integer (got: ${rawClinic}).`);
  }
  const apply = process.env.E2E_SEED_APPLY === "YES";
  return { apply, clinicId, password };
}

async function main(): Promise<void> {
  const gate = checkGates();
  const { apply, clinicId } = gate;

  // Deferred imports so the module errors above surface BEFORE any
  // DB connection is attempted.
  const { db, pool } = await import("../server/db");
  const { users, clinics } = await import("@shared/schema");

  // Verify the target clinic exists. Never create it — the operator
  // must provision a non-production test clinic in the Replit
  // workspace ahead of time.
  const [clinicRow] = await db
    .select({ id: clinics.id, name: clinics.name })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .limit(1);
  if (!clinicRow) {
    await pool.end();
    bail(`Clinic id=${clinicId} does not exist. Never creating a clinic here.`);
  }
  console.error(
    `[seed:e2e-users] target clinic verified: id=${clinicRow.id} name=${JSON.stringify(clinicRow.name)}`,
  );
  console.error(
    `[seed:e2e-users] mode: ${apply ? "APPLY (writes)" : "DRY-RUN (no writes — set E2E_SEED_APPLY=YES to write)"}`,
  );

  // Look up existing fixture rows in a single bounded query — never
  // scans other users. Uses the ILIKE prefix filter so the query
  // planner uses the username unique index.
  const existing = await db
    .select({
      id: users.id,
      username: users.username,
      role: users.role,
      active: users.active,
      clinicId: users.clinicId,
    })
    .from(users)
    .where(like(users.username, `${SEED_USERNAME_PREFIX}%`));

  const byUsername = new Map(existing.map((r) => [r.username, r]));

  let willCreate = 0;
  let willUpdate = 0;
  let unchanged = 0;

  // Password hashed ONCE and reused for every fixture that needs
  // insertion / rehashing. Same bcrypt cost (12) the users repo uses.
  const passwordHashPromise = bcrypt.hash(gate.password, 12);

  for (const f of FIXTURES) {
    const desiredClinicId = f.requiresClinic ? clinicId : null;
    const row = byUsername.get(f.username);
    if (!row) {
      willCreate++;
      console.error(
        `  + CREATE  ${f.username}  role=${f.role}  active=${f.active}  clinicId=${desiredClinicId}`,
      );
      if (apply) {
        const hashed = await passwordHashPromise;
        await db.insert(users).values({
          username: f.username,
          password: hashed,
          role: f.role,
          active: f.active,
          clinicId: desiredClinicId,
        });
      }
      continue;
    }

    // Idempotent update path — only touches columns whose current
    // value differs from the desired fixture value. Password is
    // ALWAYS re-hashed under APPLY because the operator may have
    // rotated E2E_TEST_PASSWORD between runs; this keeps the fixture
    // credentials in sync without exposing the plaintext.
    const roleDrift = row.role !== f.role;
    const activeDrift = row.active !== f.active;
    const clinicDrift = row.clinicId !== desiredClinicId;
    const anyDrift = roleDrift || activeDrift || clinicDrift;
    if (!anyDrift) {
      unchanged++;
      console.error(
        `  = UNCHANGED  ${f.username}  role=${row.role}  active=${row.active}  clinicId=${row.clinicId}` +
          (apply ? "  (password re-hashed)" : ""),
      );
    } else {
      willUpdate++;
      const drifts: string[] = [];
      if (roleDrift) drifts.push(`role ${row.role}→${f.role}`);
      if (activeDrift) drifts.push(`active ${row.active}→${f.active}`);
      if (clinicDrift) drifts.push(`clinicId ${row.clinicId}→${desiredClinicId}`);
      console.error(
        `  ~ UPDATE  ${f.username}  ${drifts.join(", ")}`,
      );
    }
    if (apply) {
      // Belt-and-suspenders: refuse to touch a row whose username no
      // longer matches the fixture prefix. This exact filter also
      // prevents any accidental substring match.
      if (!row.username.startsWith(SEED_USERNAME_PREFIX)) {
        console.error(
          `[seed:e2e-users] REFUSING to update ${row.username}: does not start with ${SEED_USERNAME_PREFIX}`,
        );
        continue;
      }
      const hashed = await passwordHashPromise;
      await db
        .update(users)
        .set({
          password: hashed,
          role: f.role,
          active: f.active,
          clinicId: desiredClinicId,
        })
        .where(
          and(
            eq(users.id, row.id),
            like(users.username, `${SEED_USERNAME_PREFIX}%`),
          ),
        );
    }
  }

  console.error(
    `[seed:e2e-users] summary: create=${willCreate} update=${willUpdate} unchanged=${unchanged}` +
      (apply ? "" : " (DRY-RUN — no writes performed)"),
  );

  if (apply) {
    // Print the exact export lines the operator needs. Passwords are
    // referenced via $E2E_TEST_PASSWORD so plaintext never appears
    // on stdout.
    console.error("");
    console.error("[seed:e2e-users] Configure the Playwright fixture env:");
    console.error("");
    for (const f of FIXTURES) {
      console.error(
        `export PLAYWRIGHT_TEST_${f.playwrightKey}_USER=${JSON.stringify(f.username)}`,
      );
      console.error(
        `export PLAYWRIGHT_TEST_${f.playwrightKey}_PASS="$E2E_TEST_PASSWORD"`,
      );
    }
    console.error("");
    console.error("[seed:e2e-users] Done.");
  } else {
    console.error("");
    console.error(
      "[seed:e2e-users] Dry-run complete. Re-run with E2E_SEED_APPLY=YES to write.",
    );
  }

  await pool.end();
}

// Suppress the unused-imports warning — `or` / `sql` are imported
// intentionally so future extensions of this file (e.g., a role list
// check via ILIKE with multiple patterns) do not need to re-add the
// imports. The imports have no runtime cost.
void or;
void sql;

main().catch(async (err) => {
  console.error("[seed:e2e-users] failed:", err?.message ?? err);
  try {
    const { pool } = await import("../server/db");
    await pool.end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
