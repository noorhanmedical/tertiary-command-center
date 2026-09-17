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
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import { Construct } from "constructs";

/**
 * PlexusProductionStack
 * =============================================================================
 * PRODUCTION infrastructure for Plexus OS - Ancillaries. Fully separate from
 * staging (own VPC/ALB/ECS/RDS/S3/Secrets/IAM/OIDC). Prepared for review and
 * `cdk synth` ONLY — NOT deployed by this change.
 *
 * Production hardening vs staging:
 *   - HTTPS-only: ALB 443 with ACM cert + HTTP→HTTPS redirect (when a cert ARN
 *     / domain is supplied via context). COOKIE_SECURE=true always.
 *   - RDS: Multi-AZ, deletion protection ON, 21-day backups, final snapshot,
 *     storage autoscaling, encrypted.
 *   - ECS: desiredCount 2 (HA), circuit-breaker rollback, SHA-pinned image.
 *   - S3: Block Public Access, SSE, versioned, TLS-enforced, RETAIN.
 *   - CloudWatch alarms for ECS/ALB/RDS + health.
 *   - No drizzle push on startup; one-shot migration task gates deploys.
 *
 * Required context to deploy (not needed for synth):
 *   -c imageTag=<git-sha>        image to run (CI pins the SHA)
 *   -c prodDomainName=<fqdn>     e.g. app.example.com (enables HTTPS + DNS)
 *   -c prodCertArn=<acm-arn>     ACM cert in us-east-1 for the domain
 *   -c prodHostedZoneId=<id>     (optional) Route53 zone for an alias record
 */
export interface PlexusProductionStackProps extends cdk.StackProps {
  readonly imageTag?: string;
}

const PREFIX = "plexus-prod";

export class PlexusProductionStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: PlexusProductionStackProps) {
    super(scope, id, props);

    const imageTag =
      props?.imageTag ??
      (this.node.tryGetContext("imageTag") as string | undefined) ??
      "latest";
    const domainName = this.node.tryGetContext("prodDomainName") as
      | string
      | undefined;
    const certArn = this.node.tryGetContext("prodCertArn") as
      | string
      | undefined;
    const githubOrg =
      (this.node.tryGetContext("githubOrg") as string | undefined) ??
      "noorhanmedical";
    const githubRepo =
      (this.node.tryGetContext("githubRepo") as string | undefined) ??
      "plexus-os-ancillaries";

    // =========================================================================
    // VPC — production: 2 AZs, dedicated NAT per AZ for egress resilience.
    // =========================================================================
    const vpc = new ec2.Vpc(this, "Vpc", {
      vpcName: `${PREFIX}-vpc`,
      ipAddresses: ec2.IpAddresses.cidr("10.30.0.0/16"),
      maxAzs: 2,
      natGateways: 2, // one per AZ — production egress HA (staging used 1)
      subnetConfiguration: [
        { name: `${PREFIX}-public`, subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: `${PREFIX}-app`, subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 22 },
        { name: `${PREFIX}-db`, subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });

    // =========================================================================
    // Security groups (same fail-safe chain as staging)
    // =========================================================================
    const albSg = new ec2.SecurityGroup(this, "AlbSg", {
      vpc,
      securityGroupName: `${PREFIX}-alb-sg`,
      description: "Prod ALB - inbound HTTP/HTTPS from internet",
      allowAllOutbound: true,
    });
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), "HTTP (redirect)");
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), "HTTPS");

    const appSg = new ec2.SecurityGroup(this, "AppSg", {
      vpc,
      securityGroupName: `${PREFIX}-app-sg`,
      description: "Prod ECS tasks - inbound only from ALB",
      allowAllOutbound: true,
    });
    appSg.addIngressRule(albSg, ec2.Port.tcp(5000), "App port from ALB");

    const dbSg = new ec2.SecurityGroup(this, "DbSg", {
      vpc,
      securityGroupName: `${PREFIX}-db-sg`,
      description: "Prod RDS - inbound only from ECS tasks",
      allowAllOutbound: false,
    });
    dbSg.addIngressRule(appSg, ec2.Port.tcp(5432), "Postgres from ECS only");

    // =========================================================================
    // RDS PostgreSQL — production hardened.
    // =========================================================================
    const database = new rds.DatabaseInstance(this, "Database", {
      instanceIdentifier: `${PREFIX}-postgres`,
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_15,
      }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.MEDIUM, // larger than staging micro
      ),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [dbSg],
      credentials: rds.Credentials.fromGeneratedSecret("plexus", {
        secretName: `${PREFIX}/rds-credentials`,
      }),
      databaseName: "plexus",
      allocatedStorage: 50,
      maxAllocatedStorage: 200, // storage autoscaling
      storageEncrypted: true,
      multiAz: true, // HA — recommended for production
      publiclyAccessible: false,
      backupRetention: cdk.Duration.days(21), // 14-30 day window
      deletionProtection: true, // production safety
      removalPolicy: cdk.RemovalPolicy.SNAPSHOT, // final snapshot on delete
      cloudwatchLogsExports: ["postgresql"],
    });

    // =========================================================================
    // Secrets Manager
    // =========================================================================
    const sessionSecret = new secretsmanager.Secret(this, "SessionSecret", {
      secretName: `${PREFIX}/session-secret`,
      description: "Express session signing secret (production)",
      generateSecretString: { excludePunctuation: true, passwordLength: 64 },
    });
    const openAiSecret = new secretsmanager.Secret(this, "OpenAiKey", {
      secretName: `${PREFIX}/openai-api-key`,
      description: "OpenAI API key (production) - populate value out-of-band",
    });
    const dbSecret = database.secret!;
    const databaseUrlSecret = new secretsmanager.Secret(this, "DatabaseUrl", {
      secretName: `${PREFIX}/database-url`,
      description: "Composed Postgres connection string (production, TLS)",
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
    // S3 — production documents bucket
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
    // ECR (production repository)
    // =========================================================================
    const ecrRepo = new ecr.Repository(this, "EcrRepo", {
      repositoryName: `${PREFIX}/command-center`,
      imageScanOnPush: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [{ description: "Keep last 30 images", maxImageCount: 30 }],
    });

    // =========================================================================
    // CloudWatch log group
    // =========================================================================
    const logGroup = new logs.LogGroup(this, "AppLogs", {
      logGroupName: `/ecs/${PREFIX}-command-center`,
      retention: logs.RetentionDays.THREE_MONTHS,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // =========================================================================
    // IAM: execution + task roles + OIDC deploy role
    // =========================================================================
    const executionRole = new iam.Role(this, "ExecutionRole", {
      roleName: `${PREFIX}-ecs-execution-role`,
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AmazonECSTaskExecutionRolePolicy",
        ),
      ],
    });
    [dbSecret, sessionSecret, openAiSecret, databaseUrlSecret].forEach((s) =>
      s.grantRead(executionRole),
    );

    const taskRole = new iam.Role(this, "TaskRole", {
      roleName: `${PREFIX}-ecs-task-role`,
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    });
    documentsBucket.grantReadWrite(taskRole);

    // =========================================================================
    // ECS cluster + task definitions (app + one-shot migration)
    // =========================================================================
    const cluster = new ecs.Cluster(this, "Cluster", {
      vpc,
      clusterName: `${PREFIX}-cluster`,
      containerInsightsV2: ecs.ContainerInsights.ENABLED,
    });

    const image = ecs.ContainerImage.fromEcrRepository(ecrRepo, imageTag);

    const commonEnvironment: Record<string, string> = {
      NODE_ENV: "production",
      PORT: "5000",
      COOKIE_SECURE: "true", // production is HTTPS-only
      STORAGE_PROVIDER: "s3",
      AWS_REGION: this.region,
      S3_BUCKET_NAME: documentsBucket.bucketName,
      // No NODE_TLS_REJECT_UNAUTHORIZED / PGSSLMODE=no-verify. RDS CA is trusted
      // via NODE_EXTRA_CA_CERTS baked into the image (see Dockerfile).
    };
    const commonSecrets: Record<string, ecs.Secret> = {
      DATABASE_URL: ecs.Secret.fromSecretsManager(databaseUrlSecret),
      SESSION_SECRET: ecs.Secret.fromSecretsManager(sessionSecret),
      AI_INTEGRATIONS_OPENAI_API_KEY: ecs.Secret.fromSecretsManager(openAiSecret),
    };

    const appTaskDef = new ecs.FargateTaskDefinition(this, "AppTaskDef", {
      family: `${PREFIX}-app`,
      memoryLimitMiB: 4096,
      cpu: 2048,
      executionRole,
      taskRole,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.X86_64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });
    appTaskDef.addContainer("app", {
      containerName: "app",
      image,
      command: ["node", "dist/index.cjs"], // app only — never a schema push
      environment: commonEnvironment,
      secrets: commonSecrets,
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "app", logGroup }),
      portMappings: [{ containerPort: 5000 }],
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

    const migrationTaskDef = new ecs.FargateTaskDefinition(this, "MigrationTaskDef", {
      family: `${PREFIX}-migrate`,
      memoryLimitMiB: 2048,
      cpu: 1024,
      executionRole,
      taskRole,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.X86_64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });
    migrationTaskDef.addContainer("migrate", {
      containerName: "migrate",
      image,
      // Production migration = versioned drizzle migrate (NOT push). See the
      // canonical baseline in migrations/ + drizzle journal.
      command: ["sh", "-c", "HOME=/app/tmp npx drizzle-kit migrate"],
      environment: commonEnvironment,
      secrets: commonSecrets,
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "migrate", logGroup }),
    });

    const service = new ecs.FargateService(this, "Service", {
      cluster,
      serviceName: `${PREFIX}-service`,
      taskDefinition: appTaskDef,
      desiredCount: 2, // HA — production runs 2+ tasks
      assignPublicIp: false,
      securityGroups: [appSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      circuitBreaker: { enable: true, rollback: true },
      healthCheckGracePeriod: cdk.Duration.seconds(120),
    });

    // =========================================================================
    // ALB — HTTPS when a cert is supplied; otherwise HTTP (pre-domain synth).
    // =========================================================================
    const alb = new elbv2.ApplicationLoadBalancer(this, "Alb", {
      vpc,
      internetFacing: true,
      securityGroup: albSg,
      loadBalancerName: `${PREFIX}-alb`,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    });

    const targetGroup = new elbv2.ApplicationTargetGroup(this, "Tg", {
      vpc,
      port: 5000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      targets: [service],
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

    if (certArn) {
      // HTTPS-only production: 443 with the cert, 80 redirects to 443.
      alb.addListener("HttpsListener", {
        port: 443,
        protocol: elbv2.ApplicationProtocol.HTTPS,
        certificates: [acm.Certificate.fromCertificateArn(this, "Cert", certArn)],
        sslPolicy: elbv2.SslPolicy.RECOMMENDED_TLS,
        defaultTargetGroups: [targetGroup],
      });
      alb.addListener("HttpRedirect", {
        port: 80,
        protocol: elbv2.ApplicationProtocol.HTTP,
        defaultAction: elbv2.ListenerAction.redirect({
          protocol: "HTTPS",
          port: "443",
          permanent: true,
        }),
      });
    } else {
      // Pre-domain: HTTP only so the stack still synths. DO NOT run production
      // on plain HTTP with real PHI — supply prodCertArn + prodDomainName first.
      alb.addListener("HttpListener", {
        port: 80,
        protocol: elbv2.ApplicationProtocol.HTTP,
        defaultTargetGroups: [targetGroup],
      });
    }

    // =========================================================================
    // GitHub OIDC deploy role (new canonical repo, main only)
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
            "token.actions.githubusercontent.com:sub": `repo:${githubOrg}/${githubRepo}:ref:refs/heads/main`,
          },
        },
      ),
    });
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
    // CloudWatch alarms (no PHI in any alarm; metric-based only)
    // =========================================================================
    const alarms: cloudwatch.Alarm[] = [];
    const add = (a: cloudwatch.Alarm) => alarms.push(a);

    // ECS: CPU, memory, running < desired.
    add(
      service
        .metricCpuUtilization()
        .createAlarm(this, "EcsCpuHigh", {
          alarmName: `${PREFIX}-ecs-cpu-high`,
          threshold: 85,
          evaluationPeriods: 3,
          comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        }),
    );
    add(
      service
        .metricMemoryUtilization()
        .createAlarm(this, "EcsMemHigh", {
          alarmName: `${PREFIX}-ecs-mem-high`,
          threshold: 85,
          evaluationPeriods: 3,
          comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        }),
    );
    add(
      new cloudwatch.Metric({
        namespace: "ECS/ContainerInsights",
        metricName: "RunningTaskCount",
        dimensionsMap: {
          ClusterName: cluster.clusterName,
          ServiceName: service.serviceName,
        },
        statistic: "Minimum",
        period: cdk.Duration.minutes(1),
      }).createAlarm(this, "EcsRunningLow", {
        alarmName: `${PREFIX}-ecs-running-below-desired`,
        threshold: 2,
        evaluationPeriods: 3,
        comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.BREACHING,
      }),
    );

    // ALB: unhealthy hosts, 5xx, target latency.
    add(
      targetGroup
        .metrics.unhealthyHostCount()
        .createAlarm(this, "AlbUnhealthy", {
          alarmName: `${PREFIX}-alb-unhealthy-targets`,
          threshold: 1,
          evaluationPeriods: 3,
          comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        }),
    );
    add(
      targetGroup
        .metrics.httpCodeTarget(elbv2.HttpCodeTarget.TARGET_5XX_COUNT)
        .createAlarm(this, "Alb5xx", {
          alarmName: `${PREFIX}-alb-5xx`,
          threshold: 10,
          evaluationPeriods: 3,
          comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        }),
    );
    add(
      targetGroup
        .metrics.targetResponseTime()
        .createAlarm(this, "AlbLatency", {
          alarmName: `${PREFIX}-alb-latency-high`,
          threshold: 2, // seconds
          evaluationPeriods: 3,
          comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        }),
    );

    // RDS: CPU, connections, free storage, freeable memory.
    add(
      database
        .metricCPUUtilization()
        .createAlarm(this, "RdsCpuHigh", {
          alarmName: `${PREFIX}-rds-cpu-high`,
          threshold: 85,
          evaluationPeriods: 3,
          comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        }),
    );
    add(
      database
        .metricDatabaseConnections()
        .createAlarm(this, "RdsConnHigh", {
          alarmName: `${PREFIX}-rds-connections-high`,
          threshold: 150,
          evaluationPeriods: 3,
          comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        }),
    );
    add(
      database
        .metricFreeStorageSpace()
        .createAlarm(this, "RdsStorageLow", {
          alarmName: `${PREFIX}-rds-free-storage-low`,
          threshold: 5 * 1024 * 1024 * 1024, // 5 GiB
          evaluationPeriods: 1,
          comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
        }),
    );
    add(
      database
        .metricFreeableMemory()
        .createAlarm(this, "RdsMemLow", {
          alarmName: `${PREFIX}-rds-freeable-memory-low`,
          threshold: 256 * 1024 * 1024, // 256 MiB
          evaluationPeriods: 3,
          comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
        }),
    );

    // =========================================================================
    // Outputs
    // =========================================================================
    new cdk.CfnOutput(this, "AlbDns", { value: alb.loadBalancerDnsName });
    new cdk.CfnOutput(this, "EcrRepoUri", { value: ecrRepo.repositoryUri });
    new cdk.CfnOutput(this, "ClusterName", { value: cluster.clusterName });
    new cdk.CfnOutput(this, "ServiceName", { value: service.serviceName });
    new cdk.CfnOutput(this, "AppTaskDefFamily", { value: appTaskDef.family });
    new cdk.CfnOutput(this, "MigrationTaskDefFamily", { value: migrationTaskDef.family });
    new cdk.CfnOutput(this, "DocumentsBucketName", { value: documentsBucket.bucketName });
    new cdk.CfnOutput(this, "GitHubActionsRoleArn", { value: deployRole.roleArn });
    new cdk.CfnOutput(this, "AlarmCount", { value: String(alarms.length) });
    new cdk.CfnOutput(this, "HttpsEnabled", { value: String(!!certArn) });
    if (domainName) new cdk.CfnOutput(this, "ProdDomain", { value: domainName });
  }
}
