type EnvCheck = { name: string; required: boolean; reason: string };

function gather(): EnvCheck[] {
  const isProd = process.env.NODE_ENV === "production";
  const checks: EnvCheck[] = [
    { name: "DATABASE_URL", required: true, reason: "Postgres connection string" },
    { name: "SESSION_SECRET", required: true, reason: "session cookie signing secret" },
  ];

  if (isProd) {
    checks.push(
      { name: "STORAGE_PROVIDER", required: true, reason: "must be set to 's3' in production" },
      { name: "AWS_REGION", required: true, reason: "S3 region" },
      { name: "AWS_ACCESS_KEY_ID", required: true, reason: "S3 credentials (or use IAM task role — leave unset and AWS SDK will pick it up)" },
      { name: "AWS_SECRET_ACCESS_KEY", required: true, reason: "S3 credentials (or use IAM task role — leave unset and AWS SDK will pick it up)" },
      { name: "S3_BUCKET_NAME", required: true, reason: "S3 bucket for documents" },
    );
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
    throw new Error(
      `STORAGE_PROVIDER must be "s3" in production (got: ${process.env.STORAGE_PROVIDER ?? "<unset>"}).`,
    );
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
