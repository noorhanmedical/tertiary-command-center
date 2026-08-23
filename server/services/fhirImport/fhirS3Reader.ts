// FHIR Import Pipeline — S3 reader
//
// Reads NDJSON files from the fhir-bulk-exp S3 bucket (us-east-1,
// account 107554921331). The app runs in account 374604322534; cross-account
// access is handled either by a bucket policy grant or by assuming an IAM
// role (FHIR_IMPORT_S3_ROLE_ARN env var).
//
// Bucket layout expected:
//   s3://{bucket}/{groupId}/{timestamp}/{ResourceType}/json/*.ndjson
//
// PHI-safe: no patient data is logged. Only S3 keys, counts, and errors
// appear in log output.

import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  type ListObjectsV2CommandInput,
} from "@aws-sdk/client-s3";
import type { S3NdjsonFile } from "./types";

// ─── Config (from environment) ────────────────────────────────────────────

const FHIR_BUCKET = process.env.FHIR_IMPORT_S3_BUCKET ?? "fhir-bulk-exp";
const FHIR_REGION = process.env.FHIR_IMPORT_S3_REGION ?? "us-east-1";
const ROLE_ARN = process.env.FHIR_IMPORT_S3_ROLE_ARN ?? "";

// ─── S3 client factory ────────────────────────────────────────────────────

/**
 * Builds an S3Client for the FHIR bucket.
 *
 * Cross-account access strategy (in priority order):
 *
 * 1. FHIR_IMPORT_S3_ROLE_ARN is set → dynamically import @aws-sdk/client-sts
 *    and assume the role. @aws-sdk/client-sts is an optional peer — if it is
 *    not installed the runtime will throw a clear error pointing the operator
 *    to install it (`npm install @aws-sdk/client-sts`).
 *
 * 2. No role ARN → rely on the ECS task role / ambient AWS credentials
 *    (environment variables, instance profile, etc.). This works when the
 *    fhir-bulk-exp bucket policy already grants access to the app's task role.
 */
async function buildS3Client(): Promise<S3Client> {
  if (!ROLE_ARN) {
    return new S3Client({ region: FHIR_REGION });
  }

  // Lazy-import @aws-sdk/client-sts so the app boots fine even when the
  // package isn't installed (cross-account is optional).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let stsModule: any;
  try {
    // Dynamic require avoids a hard compile-time dependency on @aws-sdk/client-sts.
    // If the package is absent the catch block surfaces a clear install instruction.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    stsModule = require("@aws-sdk/client-sts");
  } catch {
    throw new Error(
      "[fhirS3Reader] FHIR_IMPORT_S3_ROLE_ARN is set but @aws-sdk/client-sts is not installed. " +
        "Run: npm install @aws-sdk/client-sts",
    );
  }

  const { STSClient, AssumeRoleCommand } = stsModule;
  const sts = new STSClient({ region: FHIR_REGION });
  const assumed = await sts.send(
    new AssumeRoleCommand({
      RoleArn: ROLE_ARN,
      RoleSessionName: "plexus-fhir-import",
      DurationSeconds: 3600,
    }),
  );

  const creds = assumed.Credentials;
  if (!creds?.AccessKeyId || !creds.SecretAccessKey || !creds.SessionToken) {
    throw new Error("[fhirS3Reader] AssumeRole succeeded but returned incomplete credentials");
  }

  return new S3Client({
    region: FHIR_REGION,
    credentials: {
      accessKeyId: creds.AccessKeyId,
      secretAccessKey: creds.SecretAccessKey,
      sessionToken: creds.SessionToken,
    },
  });
}

// ─── List export timestamps ───────────────────────────────────────────────

/**
 * Lists all export timestamp folders under `{bucket}/{groupId}/`.
 * Returns them sorted in lexicographic (chronological) order — newest last.
 */
export async function listExportTimestamps(groupId: string): Promise<string[]> {
  const client = await buildS3Client();
  const prefix = `${groupId}/`;
  const timestamps = new Set<string>();

  let continuationToken: string | undefined;
  do {
    const input: ListObjectsV2CommandInput = {
      Bucket: FHIR_BUCKET,
      Prefix: prefix,
      Delimiter: "/",
      ContinuationToken: continuationToken,
    };
    const response = await client.send(new ListObjectsV2Command(input));
    for (const cp of response.CommonPrefixes ?? []) {
      if (cp.Prefix) {
        // cp.Prefix = "{groupId}/{timestamp}/" — extract the timestamp segment
        const parts = cp.Prefix.split("/");
        if (parts.length >= 2) {
          timestamps.add(parts[1]);
        }
      }
    }
    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  return Array.from(timestamps).sort();
}

/**
 * Returns the most recent export timestamp for a group, or null if none exist.
 */
export async function getLatestExportTimestamp(groupId: string): Promise<string | null> {
  const timestamps = await listExportTimestamps(groupId);
  return timestamps.length > 0 ? timestamps[timestamps.length - 1] : null;
}

// ─── List NDJSON files ────────────────────────────────────────────────────

// Resource types the pipeline handles. We intentionally process Patient
// files first so all bundle slots are created before clinical files run.
const ORDERED_RESOURCE_TYPES = [
  "Patient",
  "Condition",
  "MedicationRequest",
  "Encounter",
  "DiagnosticReport",
] as const;

/**
 * Lists all .ndjson file keys under `{bucket}/{groupId}/{timestamp}/`,
 * ordered so Patient files come first.
 */
export async function listNdjsonFiles(
  groupId: string,
  timestamp: string,
): Promise<S3NdjsonFile[]> {
  const client = await buildS3Client();
  const prefix = `${groupId}/${timestamp}/`;
  const all: S3NdjsonFile[] = [];

  let continuationToken: string | undefined;
  do {
    const input: ListObjectsV2CommandInput = {
      Bucket: FHIR_BUCKET,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    };
    const response = await client.send(new ListObjectsV2Command(input));
    for (const obj of response.Contents ?? []) {
      const key = obj.Key;
      if (!key?.endsWith(".ndjson")) continue;

      // Infer resource type from key path: .../ResourceType/json/*.ndjson
      const keyParts = key.split("/");
      // Expected: groupId / timestamp / ResourceType / json / file.ndjson
      // keyParts indices:    0       /     1      /     2    /  3  /     4
      const resourceType = keyParts[2] ?? "Unknown";
      all.push({ key, resourceType });
    }
    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  // Sort: Patient files first, then the rest in the declared order
  const typeOrder = new Map(ORDERED_RESOURCE_TYPES.map((t, i) => [t, i]));
  all.sort((a, b) => {
    const oa = typeOrder.get(a.resourceType as (typeof ORDERED_RESOURCE_TYPES)[number]) ?? 99;
    const ob = typeOrder.get(b.resourceType as (typeof ORDERED_RESOURCE_TYPES)[number]) ?? 99;
    if (oa !== ob) return oa - ob;
    return a.key.localeCompare(b.key);
  });

  return all;
}

// ─── Download a single NDJSON file ───────────────────────────────────────

/**
 * Downloads one S3 object and returns its content as a UTF-8 string.
 * Throws on any S3 error so the orchestrator can catch and continue.
 */
export async function downloadNdjsonFile(key: string): Promise<string> {
  const client = await buildS3Client();
  const response = await client.send(
    new GetObjectCommand({ Bucket: FHIR_BUCKET, Key: key }),
  );

  if (!response.Body) {
    throw new Error(`[fhirS3Reader] Empty body for key: ${key}`);
  }

  // Body is a ReadableStream (Node.js); collect chunks into a Buffer.
  const chunks: Buffer[] = [];
  for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf-8");
}

// ─── Convenience: read all NDJSON files for an export ────────────────────

/**
 * Lists and downloads all NDJSON files for a given group + timestamp.
 * Returns them as `{ key, content }` tuples ordered with Patient files first.
 *
 * PHI-safe log: only the S3 key and file count are logged.
 */
export async function readAllNdjsonFiles(
  groupId: string,
  timestamp: string,
): Promise<Array<{ key: string; content: string }>> {
  const files = await listNdjsonFiles(groupId, timestamp);
  console.log(
    `[fhirS3Reader] found ${files.length} NDJSON file(s) under ${groupId}/${timestamp}/`,
  );

  const results: Array<{ key: string; content: string }> = [];
  for (const file of files) {
    try {
      const content = await downloadNdjsonFile(file.key);
      results.push({ key: file.key, content });
    } catch (err: any) {
      // Log and skip — the orchestrator accumulates per-file errors
      console.error(`[fhirS3Reader] failed to download ${file.key}: ${err?.message ?? err}`);
    }
  }

  return results;
}

// ─── Re-export config for other modules ──────────────────────────────────

export { FHIR_BUCKET, FHIR_REGION };
