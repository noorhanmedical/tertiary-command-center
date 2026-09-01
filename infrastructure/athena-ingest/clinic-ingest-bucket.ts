// clinic-ingest-bucket.ts
// Reusable CDK construct: one isolated PHI landing bucket per clinic.
// Isolation model: separate bucket + dedicated KMS key + scoped writer role
// per clinic_id. New clinics only — existing ECW groups stay in fhir-bulk-exp.
//
// Usage in a stack:
//   const athena33071 = new ClinicIngestBucket(this, 'Clinic33071', {
//     clinicId: '33071',
//     emrVendor: 'athena',
//   });
//   // athena33071.bucket, athena33071.kmsKey, athena33071.writerRole
//
// Account 107554921331 / us-east-1. No third-party infra layer.

import { Construct } from 'constructs';
import {
  aws_s3 as s3,
  aws_kms as kms,
  aws_iam as iam,
  RemovalPolicy,
  Duration,
  Tags,
} from 'aws-cdk-lib';

export interface ClinicIngestBucketProps {
  /** Clinic context/practice ID, e.g. '33071'. Used in bucket name + tags. */
  readonly clinicId: string;
  /** EMR vendor slug for the bucket name, e.g. 'athena' | 'ecw' | 'epic'. */
  readonly emrVendor: string;
  /** Optional: principal ARN that the export job assumes (Lambda role). */
  readonly writerPrincipalArn?: string;
  /** Retention in days before raw NDJSON transitions to Glacier. Default 90. */
  readonly glacierAfterDays?: number;
}

export class ClinicIngestBucket extends Construct {
  public readonly bucket: s3.Bucket;
  public readonly kmsKey: kms.Key;
  public readonly writerRole: iam.Role;

  constructor(scope: Construct, id: string, props: ClinicIngestBucketProps) {
    super(scope, id);

    const { clinicId, emrVendor, glacierAfterDays = 90 } = props;
    // Bucket names must be globally unique + lowercase. Account-suffixed.
    const bucketName = `fhir-bulk-exp-${emrVendor}-${clinicId}-107554921331`;

    // --- Dedicated KMS key per clinic (hard crypto boundary) ---
    this.kmsKey = new kms.Key(this, 'IngestKey', {
      description: `PHI ingest encryption key — clinic ${clinicId} (${emrVendor})`,
      enableKeyRotation: true,
      removalPolicy: RemovalPolicy.RETAIN, // never auto-destroy PHI keys
      alias: `alias/fhir-ingest-${emrVendor}-${clinicId}`,
    });

    // --- The isolated landing bucket ---
    this.bucket = new s3.Bucket(this, 'IngestBucket', {
      bucketName,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.kmsKey,
      enforceSSL: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      removalPolicy: RemovalPolicy.RETAIN, // HIPAA 6yr retention — never auto-delete
      serverAccessLogsPrefix: 'access-logs/',
      lifecycleRules: [
        {
          id: 'raw-ndjson-to-glacier',
          prefix: 'incoming/',
          transitions: [
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: Duration.days(glacierAfterDays),
            },
          ],
          // No expiration — retention is permanent (soft-archive policy).
        },
      ],
    });

    // --- Scoped writer role (only THIS clinic's bucket) ---
    this.writerRole = new iam.Role(this, 'ExportWriterRole', {
      roleName: `fhir-export-writer-${emrVendor}-${clinicId}`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: `athenaOne $export -> S3 writer for clinic ${clinicId}`,
    });

    // Writer can only touch this bucket + this key. No cross-clinic access.
    this.bucket.grantWrite(this.writerRole);
    this.kmsKey.grantEncryptDecrypt(this.writerRole);

    // Explicitly scope object writes to the clinic's incoming/ prefix.
    this.writerRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ScopedIngestWrite',
        actions: ['s3:PutObject', 's3:AbortMultipartUpload'],
        resources: [`${this.bucket.bucketArn}/incoming/*`],
      }),
    );

    // Optional: let an external principal (e.g. shared export Lambda) assume writer.
    if (props.writerPrincipalArn) {
      this.writerRole.assumeRolePolicy?.addStatements(
        new iam.PolicyStatement({
          actions: ['sts:AssumeRole'],
          principals: [new iam.ArnPrincipal(props.writerPrincipalArn)],
        }),
      );
    }

    // --- Compliance tags ---
    Tags.of(this.bucket).add('clinic_id', clinicId);
    Tags.of(this.bucket).add('emr_vendor', emrVendor);
    Tags.of(this.bucket).add('data_class', 'phi');
    Tags.of(this.bucket).add('isolation', 'per-clinic-bucket');
  }
}
