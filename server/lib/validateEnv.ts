type EnvCheck = { name: string; required: boolean; reason: string };

/** True when running under a Replit deployment (Replit injects one or more
 *  of these vars). Used to allow STORAGE_PROVIDER=local in Replit production
 *  until real S3 is configured — a temporary boot-only relaxation. */
function isReplitProduction(): boolean {
  if (process.env.NODE_ENV !== "production") return false;
  return (
    process.env.REPLIT_DEPLOYMENT === "1" ||
    !!process.env.REPL_ID ||
    !!process.env.REPL_SLUG ||
    !!process.env.REPL_OWNER
  );
}

function gather(): EnvCheck[] {
  const isProd = process.env.NODE_ENV === "production";
  const replitProd = isReplitProduction();
  const allowReplitLocal = replitProd && process.env.STORAGE_PROVIDER === "local";

  const checks: EnvCheck[] = [
    { name: "DATABASE_URL", required: true, reason: "Postgres connection string" },
    { name: "SESSION_SECRET", required: true, reason: "session cookie signing secret" },
  ];

  if (isProd) {
    // STORAGE_PROVIDER itself is always required in production — Replit or not.
    checks.push(
      { name: "STORAGE_PROVIDER", required: true, reason: "must be set to 's3' in production (or 'local' on Replit until S3 is configured)" },
    );

    // S3-specific env requirements only apply when STORAGE_PROVIDER=s3 OR
    // we are not in the Replit-local relaxation. This way Replit can start
    // with STORAGE_PROVIDER=local without supplying AWS_* + S3_BUCKET_NAME.
    if (!allowReplitLocal) {
      checks.push(
        { name: "AWS_REGION", required: true, reason: "S3 region" },
        { name: "AWS_ACCESS_KEY_ID", required: true, reason: "S3 credentials (or use IAM task role — leave unset and AWS SDK will pick it up)" },
        { name: "AWS_SECRET_ACCESS_KEY", required: true, reason: "S3 credentials (or use IAM task role — leave unset and AWS SDK will pick it up)" },
        { name: "S3_BUCKET_NAME", required: true, reason: "S3 bucket for documents" },
      );
    }
  }

  return checks;
}

export function validateEnv(): void {
  const checks = gather();
  const missing = checks.filter((c) => c.required && !process.env[c.name]);

  // In production, allow IAM-task-role credentials: if both AWS keys are missing
  // but STORAGE_PROVIDER=s3 and a bucket is set, treat that as intentional.
  const usingTaskRole =
    process.env.NODE_ENV === "production" &&
    process.env.STORAGE_PROVIDER === "s3" &&
    !!process.env.S3_BUCKET_NAME &&
    !!process.env.AWS_REGION &&
    !process.env.AWS_ACCESS_KEY_ID &&
    !process.env.AWS_SECRET_ACCESS_KEY;

  const filteredMissing = usingTaskRole
    ? missing.filter((c) => c.name !== "AWS_ACCESS_KEY_ID" && c.name !== "AWS_SECRET_ACCESS_KEY")
    : missing;

  if (filteredMissing.length > 0) {
    const lines = filteredMissing.map((c) => `  - ${c.name} (${c.reason})`);
    throw new Error(
      `Refusing to start — missing required environment variables:\n${lines.join("\n")}\n` +
      `See .env.example for the full list.`,
    );
  }

  if (process.env.NODE_ENV === "production" && process.env.STORAGE_PROVIDER !== "s3") {
    // Replit production may temporarily run with local file storage until
    // real S3 is wired up. Outside Replit, production must still use S3.
    if (isReplitProduction() && process.env.STORAGE_PROVIDER === "local") {
      console.warn(
        "[startup] Replit deployment using local file storage; configure S3 before AWS production.",
      );
    } else {
      throw new Error(
        `STORAGE_PROVIDER must be "s3" in production (got: ${process.env.STORAGE_PROVIDER ?? "<unset>"}).`,
      );
    }
  }

  if (usingTaskRole) {
    console.log("[startup] AWS credentials not set in env — relying on IAM task role for S3 access");
  }

  // In production with S3 selected, eagerly instantiate the S3 client so any
  // credential / region / bucket misconfiguration fails the boot rather than
  // the first document write. The default credential chain is used when no
  // static keys are present (ECS task role, EC2 instance profile, etc.).
  if (process.env.NODE_ENV === "production" && process.env.STORAGE_PROVIDER === "s3") {
    // Lazy import to avoid pulling AWS SDK in non-prod boot paths.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { S3FileStorage } = require("../integrations/s3FileStorage");
    try {
      new S3FileStorage();
      console.log("[startup] S3 file storage client constructed successfully");
    } catch (err: any) {
      throw new Error(`Refusing to start — S3 storage misconfigured: ${err.message}`);
    }
  }
}
