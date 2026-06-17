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

export class PlexusStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // =========================================================================
    // VPC — use existing prod VPC (set up by DuploCloud)
    // =========================================================================
    const vpc = ec2.Vpc.fromLookup(this, "Vpc", {
      vpcId: "vpc-01f7c80e326dea29d",
    });

    // =========================================================================
    // Security Groups
    // =========================================================================
    const albSg = new ec2.SecurityGroup(this, "AlbSg", {
      vpc,
      description: "ALB - allows inbound HTTP/HTTPS from internet",
      allowAllOutbound: true,
    });
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), "HTTP");
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), "HTTPS");

    const appSg = new ec2.SecurityGroup(this, "AppSg", {
      vpc,
      description: "ECS tasks - allows inbound from ALB only",
      allowAllOutbound: true,
    });
    appSg.addIngressRule(albSg, ec2.Port.tcp(5000), "From ALB");

    const dbSg = new ec2.SecurityGroup(this, "DbSg", {
      vpc,
      description: "RDS - allows inbound from ECS only",
      allowAllOutbound: false,
    });
    dbSg.addIngressRule(appSg, ec2.Port.tcp(5432), "Postgres from ECS");

    // =========================================================================
    // RDS PostgreSQL — uses auto-generated credentials stored in Secrets Manager
    // The secret will contain: host, port, dbname, username, password
    // =========================================================================
    const database = new rds.DatabaseInstance(this, "Database", {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_15,
      }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.SMALL),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [dbSg],
      credentials: rds.Credentials.fromGeneratedSecret("plexus"),
      databaseName: "plexus",
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      storageEncrypted: true,
      multiAz: false,
      backupRetention: cdk.Duration.days(7),
      deletionProtection: false, // set to true after first successful deploy
      removalPolicy: cdk.RemovalPolicy.DESTROY, // allow clean stack deletion during dev
    });

    // =========================================================================
    // S3 Bucket — use existing
    // =========================================================================
    const documentsBucket = s3.Bucket.fromBucketName(this, "DocumentsBucket",
      "plexus-documents-prod-374604322534"
    );

    // =========================================================================
    // ECR Repository — use existing
    // =========================================================================
    const ecrRepo = ecr.Repository.fromRepositoryName(this, "EcrRepo",
      "plexus/command-center"
    );

    // =========================================================================
    // ECS Cluster + Fargate Service
    // =========================================================================
    const cluster = new ecs.Cluster(this, "Cluster", {
      vpc,
      clusterName: "plexus-prod",
    });

    // Session secret
    const sessionSecret = new secretsmanager.Secret(this, "SessionSecret", {
      secretName: "plexus/session-secret",
      generateSecretString: {
        excludePunctuation: true,
        passwordLength: 64,
      },
    });

    // Task definition
    const taskDef = new ecs.FargateTaskDefinition(this, "TaskDef", {
      memoryLimitMiB: 2048,
      cpu: 1024,
    });

    // Grant permissions
    documentsBucket.grantReadWrite(taskDef.taskRole);
    sessionSecret.grantRead(taskDef.taskRole);
    database.secret!.grantRead(taskDef.taskRole);

    // Bedrock access
    taskDef.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
        resources: ["*"],
      })
    );

    // Container — DATABASE_URL is constructed at runtime from the RDS secret
    // The app will need a small wrapper or we pass individual DB fields
    const container = taskDef.addContainer("App", {
      image: ecs.ContainerImage.fromEcrRepository(ecrRepo, "latest"),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: "plexus",
        logGroup: new logs.LogGroup(this, "AppLogs", {
          logGroupName: "/ecs/plexus-command-center",
          retention: logs.RetentionDays.ONE_MONTH,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        }),
      }),
      environment: {
        NODE_ENV: "development",
        DEPLOY_VERSION: "1781733963",
        NODE_TLS_REJECT_UNAUTHORIZED: "0",
        COOKIE_SECURE: "false",
        PGSSLMODE: "no-verify",
        PORT: "5000",
        STORAGE_PROVIDER: "s3",
        AWS_REGION: "us-east-1",
        S3_BUCKET_NAME: documentsBucket.bucketName,
        DATABASE_URL: "postgres://plexus:PlexusAdmin2026@plexuscommandcenter-databaseb269d8bb-xlpvrxyelcw8.colokwmoubvz.us-east-1.rds.amazonaws.com:5432/plexus",
        AI_INTEGRATIONS_OPENAI_API_KEY: "sk-placeholder-will-replace-with-bedrock",
        SESSION_SECRET: "plexus-session-secret-replace-me-later-with-proper-value",
      },
      secrets: {
        // Pass the full RDS secret — contains host, port, dbname, username, password
        DB_SECRET: ecs.Secret.fromSecretsManager(database.secret!),
      },
      portMappings: [{ containerPort: 5000 }],
      healthCheck: {
        command: ["CMD-SHELL", "node -e \"const h=require('http');h.get('http://localhost:5000/healthz',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))\""],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(10),
        retries: 5,
        startPeriod: cdk.Duration.seconds(120),
      },
      stopTimeout: cdk.Duration.seconds(30),
    });

    // Fargate Service — NO circuit breaker rollback (so the stack doesn't die if app crashes)
    const service = new ecs.FargateService(this, "Service", {
      cluster,
      taskDefinition: taskDef,
      // App container will start and connect to RDS
      desiredCount: 1,
      serviceName: "command-center",
      assignPublicIp: false,
      securityGroups: [appSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      circuitBreaker: { enable: true, rollback: false },
    });

    // =========================================================================
    // Application Load Balancer
    // =========================================================================
    const alb = new elbv2.ApplicationLoadBalancer(this, "Alb", {
      vpc,
      internetFacing: true,
      securityGroup: albSg,
      loadBalancerName: "plexus-alb",
    });

    // HTTP listener
    const httpListener = alb.addListener("HttpListener", {
      port: 80,
      open: true,
    });

    httpListener.addTargets("EcsTarget", {
      port: 5000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [service],
      healthCheck: {
        path: "/healthz",
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(10),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 5,
      },
      deregistrationDelay: cdk.Duration.seconds(30),
    });

    // =========================================================================
    // Outputs
    // =========================================================================
    new cdk.CfnOutput(this, "AlbUrl", {
      value: `http://${alb.loadBalancerDnsName}`,
      description: "Application URL (ALB DNS)",
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

    new cdk.CfnOutput(this, "DatabaseEndpoint", {
      value: database.dbInstanceEndpointAddress,
      description: "RDS endpoint",
    });

    new cdk.CfnOutput(this, "DocumentsBucketName", {
      value: documentsBucket.bucketName,
      description: "S3 bucket for documents",
    });

    new cdk.CfnOutput(this, "DbSecretArn", {
      value: database.secret!.secretArn,
      description: "RDS credentials secret ARN",
    });
  }
}
