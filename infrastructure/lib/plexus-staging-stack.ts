import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as logs from "aws-cdk-lib/aws-logs";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

/**
 * PlexusStagingStack
 * =============================================================================
 * A fresh, self-contained STAGING environment for Plexus Command Center in AWS
 * account 668778694522 / us-east-1. Nothing here is shared with the old
 * 374604322534 production account or the existing us-west-2 S3 bucket.
 *
 * Topology:
 *   Internet ─▶ public ALB (public subnets)
 *            ─▶ ECS Fargate service (private subnets, egress via NAT)
 *            ─▶ RDS PostgreSQL (isolated private subnets, no NAT)
 *   ECS also reaches S3 (private bucket), Secrets Manager, CloudWatch.
 *
 * Security posture:
 *   - ECS + RDS are private; only the ALB is internet-facing.
 *   - RDS ingress is restricted to the ECS security group only.
 *   - S3 bucket: Block Public Access ON, SSE ON, TLS-only policy.
 *   - RDS: storage encrypted, automated backups.
 *   - All secrets (DB creds, session secret, OpenAI key, composed DATABASE_URL)
 *     live in Secrets Manager. No plaintext secrets in this file.
 *   - No static AWS credentials anywhere; ECS uses task roles, CI uses OIDC.
 *
 * Configuration knobs (CDK context, with staging-safe defaults):
 *   -c imageTag=<git-sha>   Container image tag to deploy (default "latest"
 *                           for the very first bootstrap only; CI always pins
 *                           an explicit Git SHA).
 *   -c githubOrg / githubRepo / githubBranch  Scope the OIDC deploy role.
 */
export interface PlexusStagingStackProps extends cdk.StackProps {
  /** Container image tag (Git SHA) to run. Defaults come from context. */
  readonly imageTag?: string;
}

const PREFIX = "plexus-staging";

export class PlexusStagingStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: PlexusStagingStackProps) {
    super(scope, id, props);

    const imageTag =
      props?.imageTag ??
      (this.node.tryGetContext("imageTag") as string | undefined) ??
      "latest";

    const githubOrg =
      (this.node.tryGetContext("githubOrg") as string | undefined) ??
      "noorhanmedical";
    const githubRepo =
      (this.node.tryGetContext("githubRepo") as string | undefined) ??
      "tertiary-command-center";
    // Staging deploys typically come from a staging branch. Kept configurable.
    const githubBranch =
      (this.node.tryGetContext("githubBranch") as string | undefined) ??
      "*";

    // =========================================================================
    // VPC — brand new, 2 AZs, three subnet tiers.
    //   Public   : ALB
    //   Private  : ECS tasks (egress via NAT for image pulls / OpenAI / S3)
    //   Isolated : RDS (no internet route at all)
    // Single NAT gateway keeps staging cost down (one AZ egress only).
    // =========================================================================
    const vpc = new ec2.Vpc(this, "Vpc", {
      vpcName: `${PREFIX}-vpc`,
      ipAddresses: ec2.IpAddresses.cidr("10.20.0.0/16"),
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          name: `${PREFIX}-public`,
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: `${PREFIX}-app`,
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 22,
        },
        {
          name: `${PREFIX}-db`,
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });

    // =========================================================================
    // Security Groups
    // =========================================================================
    const albSg = new ec2.SecurityGroup(this, "AlbSg", {
      vpc,
      securityGroupName: `${PREFIX}-alb-sg`,
      description: "Staging ALB - inbound HTTP/HTTPS from internet",
      allowAllOutbound: true,
    });
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), "HTTP");
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), "HTTPS");

    const appSg = new ec2.SecurityGroup(this, "AppSg", {
      vpc,
      securityGroupName: `${PREFIX}-app-sg`,
      description: "Staging ECS tasks - inbound only from ALB",
      allowAllOutbound: true,
    });
    appSg.addIngressRule(albSg, ec2.Port.tcp(5000), "App port from ALB");

    const dbSg = new ec2.SecurityGroup(this, "DbSg", {
      vpc,
      securityGroupName: `${PREFIX}-db-sg`,
      description: "Staging RDS - inbound only from ECS tasks",
      allowAllOutbound: false,
    });
    dbSg.addIngressRule(appSg, ec2.Port.tcp(5432), "Postgres from ECS only");

    // =========================================================================
    // RDS PostgreSQL — private, isolated subnets, encrypted, backed up.
    // Credentials auto-generated into Secrets Manager (never in code).
    // =========================================================================
    const dbCredentials = rds.Credentials.fromGeneratedSecret("plexus", {
      secretName: `${PREFIX}/rds-credentials`,
    });

    const database = new rds.DatabaseInstance(this, "Database", {
      instanceIdentifier: `${PREFIX}-postgres`,
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_15,
      }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.MICRO,
      ),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [dbSg],
      credentials: dbCredentials,
      databaseName: "plexus",
      allocatedStorage: 20,
      maxAllocatedStorage: 50,
      storageEncrypted: true,
      multiAz: false,
      publiclyAccessible: false,
      backupRetention: cdk.Duration.days(7),
      // Staging: allow clean teardown. Flip both to true for production.
      deletionProtection: false,
      removalPolicy: cdk.RemovalPolicy.SNAPSHOT,
    });

    // =========================================================================
    // Secrets Manager — session secret + OpenAI key + composed DATABASE_URL.
    // The app reads DATABASE_URL and SESSION_SECRET; we compose DATABASE_URL
    // from the RDS-generated secret so nothing is hardcoded.
    // =========================================================================
    const sessionSecret = new secretsmanager.Secret(this, "SessionSecret", {
      secretName: `${PREFIX}/session-secret`,
      description: "Express session signing secret (staging)",
      generateSecretString: {
        excludePunctuation: true,
        passwordLength: 64,
      },
    });

    // OpenAI key: created empty; a human/CI fills the value out-of-band via
    // `aws secretsmanager put-secret-value`. Never store the real key in code.
    const openAiSecret = new secretsmanager.Secret(this, "OpenAiKey", {
      secretName: `${PREFIX}/openai-api-key`,
      description: "OpenAI API key (staging) - populate value out-of-band",
    });

    // Composed DATABASE_URL. We build it from the RDS secret's fields so the
    // password never appears in plaintext. Uses sslmode=require (real TLS —
    // NOT no-verify). RDS Postgres presents an AWS-managed cert; the pg client
    // trusts the RDS CA bundle baked into the image / node.
    const dbSecret = database.secret!;
    const databaseUrlSecret = new secretsmanager.Secret(this, "DatabaseUrl", {
      secretName: `${PREFIX}/database-url`,
      description: "Composed Postgres connection string (staging)",
      secretStringValue: cdk.SecretValue.unsafePlainText(
        cdk.Fn.join("", [
          "postgres://",
          dbSecret.secretValueFromJson("username").unsafeUnwrap(),
          ":",
          dbSecret.secretValueFromJson("password").unsafeUnwrap(),
          "@",
          database.dbInstanceEndpointAddress,
          ":",
          database.dbInstanceEndpointPort,
          "/plexus?sslmode=require",
        ]),
      ),
    });

    // =========================================================================
    // S3 — private, encrypted document bucket (brand new, us-east-1).
    // =========================================================================
    const documentsBucket = new s3.Bucket(this, "DocumentsBucket", {
      bucketName: `${PREFIX}-documents-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // =========================================================================
    // ECR — brand new staging repository with image scanning.
    // =========================================================================
    const ecrRepo = new ecr.Repository(this, "EcrRepo", {
      repositoryName: `${PREFIX}/command-center`,
      imageScanOnPush: true,
      imageTagMutability: ecr.TagMutability.MUTABLE,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          description: "Keep last 20 images",
          maxImageCount: 20,
        },
      ],
    });

    // =========================================================================
    // CloudWatch log group
    // =========================================================================
    const logGroup = new logs.LogGroup(this, "AppLogs", {
      logGroupName: `/ecs/${PREFIX}-command-center`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // =========================================================================
    // IAM — separate execution role and task role.
    //   Execution role: pull image, write logs, fetch secrets at task launch.
    //   Task role     : runtime perms only (S3 doc bucket).
    // =========================================================================
    const executionRole = new iam.Role(this, "ExecutionRole", {
      roleName: `${PREFIX}-ecs-execution-role`,
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      description: "ECS task execution role (image pull, logs, secret fetch)",
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AmazonECSTaskExecutionRolePolicy",
        ),
      ],
    });
    // Allow the execution role to read exactly the secrets the task needs.
    [dbSecret, sessionSecret, openAiSecret, databaseUrlSecret].forEach((s) =>
      s.grantRead(executionRole),
    );

    const taskRole = new iam.Role(this, "TaskRole", {
      roleName: `${PREFIX}-ecs-task-role`,
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      description: "ECS application task role (runtime S3 access)",
    });
    // Least-privilege: only the staging documents bucket.
    documentsBucket.grantReadWrite(taskRole);

    // =========================================================================
    // ECS cluster
    // =========================================================================
    const cluster = new ecs.Cluster(this, "Cluster", {
      vpc,
      clusterName: `${PREFIX}-cluster`,
      containerInsightsV2: ecs.ContainerInsights.ENABLED,
    });

    const image = ecs.ContainerImage.fromEcrRepository(ecrRepo, imageTag);

    // Shared non-secret environment for both app and migration tasks.
    const commonEnvironment: Record<string, string> = {
      NODE_ENV: "production",
      PORT: "5000",
      COOKIE_SECURE: "true",
      STORAGE_PROVIDER: "s3",
      AWS_REGION: this.region,
      S3_BUCKET_NAME: documentsBucket.bucketName,
      // NOTE: intentionally NO NODE_TLS_REJECT_UNAUTHORIZED, NO PGSSLMODE=no-verify.
    };

    // Secret references (pulled by the execution role at launch, injected as env).
    const commonSecrets: Record<string, ecs.Secret> = {
      DATABASE_URL: ecs.Secret.fromSecretsManager(databaseUrlSecret),
      SESSION_SECRET: ecs.Secret.fromSecretsManager(sessionSecret),
      AI_INTEGRATIONS_OPENAI_API_KEY:
        ecs.Secret.fromSecretsManager(openAiSecret),
    };

    // ── Application task definition ──────────────────────────────────────────
    const appTaskDef = new ecs.FargateTaskDefinition(this, "AppTaskDef", {
      family: `${PREFIX}-app`,
      memoryLimitMiB: 2048,
      cpu: 1024,
      executionRole,
      taskRole,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.X86_64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });

    appTaskDef.addContainer("App", {
      containerName: "app",
      image,
      // Normal startup runs the app ONLY. No drizzle-kit push --force here.
      command: ["node", "dist/index.cjs"],
      environment: commonEnvironment,
      secrets: commonSecrets,
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: "app",
        logGroup,
      }),
      portMappings: [{ containerPort: 5000 }],
      // Container-level liveness. ALB target group also checks /healthz.
      healthCheck: {
        command: [
          "CMD-SHELL",
          "node -e \"require('http').get('http://localhost:5000/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))\"",
        ],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(60),
      },
      stopTimeout: cdk.Duration.seconds(30),
    });

    // ── One-time migration task definition ───────────────────────────────────
    // Run manually / by CI as a `runTask` before the service rolls out. It uses
    // the SAME image, network and secrets but overrides the command to run the
    // schema sync once, then exits. This is the ONLY place schema changes are
    // applied — never on normal app startup.
    const migrationTaskDef = new ecs.FargateTaskDefinition(
      this,
      "MigrationTaskDef",
      {
        family: `${PREFIX}-migrate`,
        memoryLimitMiB: 1024,
        cpu: 512,
        executionRole,
        taskRole,
        runtimePlatform: {
          cpuArchitecture: ecs.CpuArchitecture.X86_64,
          operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        },
      },
    );

    migrationTaskDef.addContainer("Migrate", {
      containerName: "migrate",
      image,
      // The image ships drizzle-kit + drizzle.config.ts + shared schema.
      // HOME is set so drizzle-kit can write its temp files as non-root.
      command: [
        "sh",
        "-c",
        "HOME=/app/tmp npx drizzle-kit push",
      ],
      environment: commonEnvironment,
      secrets: commonSecrets,
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: "migrate",
        logGroup,
      }),
    });

    // =========================================================================
    // ECS Fargate service — private subnets, no public IP.
    // =========================================================================
    // desiredCount is context-driven so the very first deploy can start at 0
    // (empty ECR → nothing to pull yet). After the SHA image is pushed and the
    // schema is bootstrapped, scale to 1 (`-c desiredCount=1`) or via the CLI.
    const desiredCount = Number(
      this.node.tryGetContext("desiredCount") ?? 1,
    );
    const service = new ecs.FargateService(this, "Service", {
      cluster,
      serviceName: `${PREFIX}-service`,
      taskDefinition: appTaskDef,
      desiredCount,
      assignPublicIp: false,
      securityGroups: [appSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      circuitBreaker: { enable: true, rollback: true },
      healthCheckGracePeriod: cdk.Duration.seconds(120),
    });

    // =========================================================================
    // Application Load Balancer (public). Staging uses HTTP on :80 against the
    // ALB DNS name until a real cert/DNS is attached. HTTPS listener is added
    // later when an ACM cert exists.
    // =========================================================================
    const alb = new elbv2.ApplicationLoadBalancer(this, "Alb", {
      vpc,
      internetFacing: true,
      securityGroup: albSg,
      loadBalancerName: `${PREFIX}-alb`,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    });

    const httpListener = alb.addListener("HttpListener", {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
    });

    httpListener.addTargets("EcsTarget", {
      port: 5000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [service],
      // /healthz is process liveness (no DB). We deliberately use it — not
      // /readyz — for the ALB target check so a brief RDS hiccup can't drain
      // every task and create a deployment death-loop. Readiness is surfaced
      // separately via /readyz for operators.
      healthCheck: {
        path: "/healthz",
        healthyHttpCodes: "200",
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 5,
      },
      deregistrationDelay: cdk.Duration.seconds(30),
    });

    // =========================================================================
    // GitHub Actions OIDC deploy role — no static keys in CI.
    // =========================================================================
    const githubProvider = new iam.OpenIdConnectProvider(this, "GitHubOidc", {
      url: "https://token.actions.githubusercontent.com",
      clientIds: ["sts.amazonaws.com"],
    });

    const deployRole = new iam.Role(this, "GitHubActionsDeployRole", {
      roleName: `${PREFIX}-github-deploy-role`,
      assumedBy: new iam.WebIdentityPrincipal(
        githubProvider.openIdConnectProviderArn,
        {
          StringEquals: {
            "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          },
          StringLike: {
            "token.actions.githubusercontent.com:sub": `repo:${githubOrg}/${githubRepo}:ref:refs/heads/${githubBranch}`,
          },
        },
      ),
      description: "GitHub Actions OIDC role for staging deploys",
    });

    // Least-privilege deploy permissions (scoped where the API allows it).
    ecrRepo.grantPullPush(deployRole);
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "EcrAuth",
        actions: ["ecr:GetAuthorizationToken"],
        resources: ["*"],
      }),
    );
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "EcsDeploy",
        actions: [
          "ecs:RegisterTaskDefinition",
          "ecs:DeregisterTaskDefinition",
          "ecs:DescribeTaskDefinition",
          "ecs:UpdateService",
          "ecs:DescribeServices",
          "ecs:DescribeTasks",
          "ecs:ListTasks",
          "ecs:RunTask",
          "ecs:StopTask",
        ],
        resources: ["*"],
      }),
    );
    // PassRole only for the two ECS roles this pipeline actually launches.
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "PassEcsRoles",
        actions: ["iam:PassRole"],
        resources: [executionRole.roleArn, taskRole.roleArn],
        conditions: {
          StringEquals: { "iam:PassedToService": "ecs-tasks.amazonaws.com" },
        },
      }),
    );

    // =========================================================================
    // Outputs
    // =========================================================================
    new cdk.CfnOutput(this, "AlbUrl", {
      value: `http://${alb.loadBalancerDnsName}`,
      description: "Staging application URL (ALB DNS, HTTP)",
    });
    new cdk.CfnOutput(this, "EcrRepoUri", {
      value: ecrRepo.repositoryUri,
      description: "ECR repository URI for docker push",
    });
    new cdk.CfnOutput(this, "ClusterName", {
      value: cluster.clusterName,
      description: "ECS cluster name",
    });
    new cdk.CfnOutput(this, "ServiceName", {
      value: service.serviceName,
      description: "ECS service name",
    });
    new cdk.CfnOutput(this, "AppTaskDefFamily", {
      value: appTaskDef.family,
      description: "Application task definition family",
    });
    new cdk.CfnOutput(this, "MigrationTaskDefFamily", {
      value: migrationTaskDef.family,
      description: "One-time migration task definition family",
    });
    new cdk.CfnOutput(this, "PrivateSubnetIds", {
      value: vpc
        .selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS })
        .subnetIds.join(","),
      description: "Private app subnet IDs (for CI runTask network config)",
    });
    new cdk.CfnOutput(this, "AppSecurityGroupId", {
      value: appSg.securityGroupId,
      description: "ECS app security group ID (for CI runTask network config)",
    });
    new cdk.CfnOutput(this, "DocumentsBucketName", {
      value: documentsBucket.bucketName,
      description: "S3 documents bucket (staging)",
    });
    new cdk.CfnOutput(this, "DatabaseUrlSecretArn", {
      value: databaseUrlSecret.secretArn,
      description: "Secrets Manager ARN of composed DATABASE_URL",
    });
    new cdk.CfnOutput(this, "GitHubActionsRoleArn", {
      value: deployRole.roleArn,
      description:
        "OIDC deploy role ARN — set as AWS_DEPLOY_ROLE_ARN GitHub secret",
    });
  }
}
