import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as logs from "aws-cdk-lib/aws-logs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecrAssets from "aws-cdk-lib/aws-ecr-assets";
import { Construct } from "constructs";
import { RemovalPolicy } from "aws-cdk-lib";
import { ClinicIngestBucket } from "../athena-ingest/clinic-ingest-bucket";

/**
 * AthenaIngestStack — dev account (107554921331) infrastructure for the
 * athenaOne FHIR Bulk $export pipeline (practice 33071).
 *
 * Contains:
 *   - ClinicIngestBucket: isolated PHI landing bucket + KMS key + writer role
 *   - Export Lambda (athena_bulk_export_to_s3.py) that assumes the writer role
 *     capabilities directly (Lambda execution role IS the writer role) and
 *     reads the athena client secret from Secrets Manager.
 *
 * The athena client secret must already exist in Secrets Manager under
 * `athena/33071/client-secret` (stored out-of-band; never committed).
 */
export class AthenaIngestStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const CLINIC_ID = "33071";
    const EMR_VENDOR = "athena";
    const ATHENA_CLIENT_ID = "0oa13p8mqsvLEmQjl298";
    // Full ARN (with the random suffix Secrets Manager assigned) so the IAM
    // grant is EXACT. Importing by name yields a `-??????` wildcard ARN that
    // does not reliably match at invoke time.
    const SECRET_ARN =
      "arn:aws:secretsmanager:us-east-1:107554921331:secret:athena/33071/client-secret-9CCO6v";

    // -------------------------------------------------------------------------
    // Per-clinic isolated landing bucket (+ KMS key + scoped writer role)
    // -------------------------------------------------------------------------
    const clinic = new ClinicIngestBucket(this, "Clinic33071", {
      clinicId: CLINIC_ID,
      emrVendor: EMR_VENDOR,
    });

    // -------------------------------------------------------------------------
    // Reference the existing athena client secret (created out-of-band)
    // -------------------------------------------------------------------------
    const athenaSecret = secretsmanager.Secret.fromSecretCompleteArn(
      this,
      "AthenaClientSecret",
      SECRET_ARN,
    );

    // -------------------------------------------------------------------------
    // Export Lambda — streams NDJSON from athena $export into the clinic bucket.
    // Uses only boto3 + stdlib, so the bundled source needs no dependencies.
    // -------------------------------------------------------------------------
    const exportLogGroup = new logs.LogGroup(this, "AthenaBulkExportLogs", {
      logGroupName: `/aws/lambda/athena-bulk-export-${CLINIC_ID}`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const exportFn = new lambda.Function(this, "AthenaBulkExportFn", {
      functionName: `athena-bulk-export-${CLINIC_ID}`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "athena_bulk_export_to_s3.handler",
      code: lambda.Code.fromAsset("athena-ingest", {
        exclude: ["*.ts", "*.sh", "cohort_filter_and_parse.py"],
      }),
      // Bulk export can take a while; cap at the 15-min Lambda maximum.
      timeout: cdk.Duration.minutes(15),
      memorySize: 1024,
      // Use the scoped writer role from the construct as the execution role so
      // the function can write ONLY to this clinic's bucket + use its KMS key.
      role: clinic.writerRole,
      logGroup: exportLogGroup,
      environment: {
        ATHENA_CLIENT_ID: ATHENA_CLIENT_ID,
        ATHENA_SECRET_ARN: athenaSecret.secretArn,
        ATHENA_PRACTICE_ID: CLINIC_ID,
        INGEST_BUCKET: clinic.bucket.bucketName,
      },
    });

    // The writer role is created with only S3/KMS scoping and NO Lambda basic
    // execution perms (it was built as a plain role). Add the managed policy so
    // the function can write CloudWatch logs.
    clinic.writerRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        "service-role/AWSLambdaBasicExecutionRole",
      ),
    );

    // Allow the Lambda to read the athena client secret.
    athenaSecret.grantRead(exportFn);

    // -------------------------------------------------------------------------
    // Fargate one-shot task — runs the SAME export code with no 15-min ceiling
    // and an ECS task role (no MFA / session expiry). This is the durable,
    // laptop-independent runner for the full 6GB+ pull, and the thing Phase 4
    // will schedule via EventBridge.
    // -------------------------------------------------------------------------
    // Reuse the account's default VPC (public subnets, internet egress — the
    // task needs to reach athena's API + S3, and downloads no inbound).
    const vpc = ec2.Vpc.fromLookup(this, "DefaultVpc", { isDefault: true });

    const cluster = new ecs.Cluster(this, "AthenaIngestCluster", {
      clusterName: `athena-ingest-${CLINIC_ID}`,
      vpc,
    });

    // Dedicated task role (ECS tasks assume ecs-tasks principal — the Lambda
    // writerRole can't be reused directly). Grant the same scoped access.
    const taskRole = new iam.Role(this, "ExportTaskRole", {
      roleName: `fhir-export-task-${EMR_VENDOR}-${CLINIC_ID}`,
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      description: `athenaOne $export -> S3 Fargate task role for clinic ${CLINIC_ID}`,
    });
    clinic.bucket.grantWrite(taskRole);
    clinic.kmsKey.grantEncryptDecrypt(taskRole);
    athenaSecret.grantRead(taskRole);

    const taskLogGroup = new logs.LogGroup(this, "AthenaExportTaskLogs", {
      logGroupName: `/ecs/athena-bulk-export-${CLINIC_ID}`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const taskDef = new ecs.FargateTaskDefinition(this, "ExportTaskDef", {
      family: `athena-bulk-export-${CLINIC_ID}`,
      cpu: 1024, // 1 vCPU
      memoryLimitMiB: 4096, // 4 GB — streaming, no local staging
      taskRole,
      // Match the ARM64 image built by CDK on Apple Silicon (Graviton — also
      // cheaper). Without this, Fargate defaults to X86_64 and the arm64 image
      // fails with "exec format error".
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
      // executionRole is auto-created: pulls the ECR image + writes logs.
    });

    taskDef.addContainer("ExportContainer", {
      containerName: "athena-bulk-export",
      image: ecs.ContainerImage.fromAsset("athena-ingest", {
        // Pin to arm64 so the image matches the ARM64 Fargate runtime platform
        // regardless of the build host.
        platform: ecrAssets.Platform.LINUX_ARM64,
      }),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: "export",
        logGroup: taskLogGroup,
      }),
      environment: {
        ATHENA_CLIENT_ID: ATHENA_CLIENT_ID,
        ATHENA_SECRET_ARN: athenaSecret.secretArn,
        ATHENA_PRACTICE_ID: CLINIC_ID,
        INGEST_BUCKET: clinic.bucket.bucketName,
      },
    });

    // -------------------------------------------------------------------------
    // Outputs
    // -------------------------------------------------------------------------
    new cdk.CfnOutput(this, "IngestBucketName", {
      value: clinic.bucket.bucketName,
      description: "Isolated athenaOne PHI landing bucket for clinic 33071",
    });
    new cdk.CfnOutput(this, "ExportFunctionName", {
      value: exportFn.functionName,
      description: "athenaOne bulk $export Lambda",
    });
    new cdk.CfnOutput(this, "WriterRoleArn", {
      value: clinic.writerRole.roleArn,
      description: "Scoped writer / Lambda execution role",
    });
    new cdk.CfnOutput(this, "AthenaSecretArn", {
      value: athenaSecret.secretArn,
      description: "Secrets Manager ARN for the athena client secret",
    });
    new cdk.CfnOutput(this, "EcsClusterName", {
      value: cluster.clusterName,
      description: "ECS cluster for the Fargate export task",
    });
    new cdk.CfnOutput(this, "EcsTaskDefinitionArn", {
      value: taskDef.taskDefinitionArn,
      description: "Fargate task definition for the full export",
    });
    new cdk.CfnOutput(this, "EcsTaskContainerName", {
      value: "athena-bulk-export",
      description: "Container name (for run-task command overrides)",
    });
  }
}
