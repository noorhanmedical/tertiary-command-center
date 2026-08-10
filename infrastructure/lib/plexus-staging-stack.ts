import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as logs from "aws-cdk-lib/aws-logs";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

export class PlexusStagingStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // =========================================================================
    // VPC — reuse existing prod VPC
    // =========================================================================
    const vpc = ec2.Vpc.fromLookup(this, "Vpc", {
      vpcId: "vpc-01f7c80e326dea29d",
    });

    // =========================================================================
    // Security Groups
    // =========================================================================
    const albSg = new ec2.SecurityGroup(this, "StagingAlbSg", {
      vpc,
      description: "Staging ALB - allows inbound HTTP/HTTPS from internet",
      allowAllOutbound: true,
    });
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), "HTTP");
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), "HTTPS");

    const appSg = new ec2.SecurityGroup(this, "StagingAppSg", {
      vpc,
      description: "Staging ECS tasks - allows inbound from staging ALB only",
      allowAllOutbound: true,
    });
    appSg.addIngressRule(albSg, ec2.Port.tcp(5000), "From Staging ALB");

    const dbSg = new ec2.SecurityGroup(this, "StagingDbSg", {
      vpc,
      description: "Staging RDS - allows inbound from staging ECS only",
      allowAllOutbound: false,
    });
    dbSg.addIngressRule(appSg, ec2.Port.tcp(5432), "Postgres from Staging ECS");

    // =========================================================================
    // RDS PostgreSQL — smaller instance for staging
    // =========================================================================
    const database = new rds.DatabaseInstance(this, "StagingDatabase", {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_15,
      }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [dbSg],
      credentials: rds.Credentials.fromGeneratedSecret("plexus_staging"),
      databaseName: "plexus_staging",
      allocatedStorage: 20,
      maxAllocatedStorage: 50,
      storageEncrypted: true,
      multiAz: false,
      backupRetention: cdk.Duration.days(7),
      deletionProtection: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // =========================================================================
    // S3 Bucket — staging documents (separate from prod)
    // =========================================================================
    const documentsBucket = new s3.Bucket(this, "StagingDocumentsBucket", {
      bucketName: `plexus-documents-staging-374604322534`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // =========================================================================
    // ECR Repository — reuse existing (use "staging" tag)
    // =========================================================================
    const ecrRepo = ecr.Repository.fromRepositoryName(this, "EcrRepo",
      "plexus/command-center"
    );

    // =========================================================================
    // ECS — reuse existing cluster, new service
    // =========================================================================
    const cluster = ecs.Cluster.fromClusterAttributes(this, "Cluster", {
      clusterName: "plexus-prod",
      vpc,
      securityGroups: [],
    });

    // Session secret for staging
    const sessionSecret = new secretsmanager.Secret(this, "StagingSessionSecret", {
      secretName: "plexus/staging-session-secret",
      generateSecretString: {
        excludePunctuation: true,
        passwordLength: 64,
      },
    });

    // Task definition — quarter size of prod (256 CPU, 512 MB)
    const taskDef = new ecs.FargateTaskDefinition(this, "StagingTaskDef", {
      memoryLimitMiB: 512,
      cpu: 256,
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

    // SES — allow sending email
    taskDef.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ["ses:SendEmail", "ses:SendRawEmail"],
        resources: ["*"],
      })
    );

    // OpenAI key — reuse same secret as prod
    const openAiSecret = secretsmanager.Secret.fromSecretNameV2(this, "OpenAiKey", "plexus/openai-api-key");

    // Container
    const container = taskDef.addContainer("App", {
      image: ecs.ContainerImage.fromEcrRepository(ecrRepo, "staging"),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: "plexus-staging",
        logGroup: new logs.LogGroup(this, "StagingAppLogs", {
          logGroupName: "/ecs/plexus-command-center-staging",
          retention: logs.RetentionDays.TWO_WEEKS,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        }),
      }),
      environment: {
        NODE_ENV: "staging",
        DEPLOY_VERSION: Date.now().toString(),
        NODE_TLS_REJECT_UNAUTHORIZED: "0",
        COOKIE_SECURE: "true",
        USE_PATIENT_DIRECTORY_ACTIVATION: "true",
        PGSSLMODE: "no-verify",
        PORT: "5000",
        STORAGE_PROVIDER: "s3",
        AWS_REGION: "us-east-1",
        S3_BUCKET_NAME: documentsBucket.bucketName,
        DATABASE_URL: `postgres://${database.dbInstanceEndpointAddress}:5432/plexus_staging`,
        SMTP_HOST: "email-smtp.us-east-1.amazonaws.com",
        SMTP_PORT: "587",
        SMTP_FROM: "noreply@plexusclinical.com",
      },
      secrets: {
        AI_INTEGRATIONS_OPENAI_API_KEY: ecs.Secret.fromSecretsManager(openAiSecret),
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

    // Fargate Service
    const service = new ecs.FargateService(this, "StagingService", {
      cluster,
      taskDefinition: taskDef,
      desiredCount: 1,
      serviceName: "command-center-staging",
      assignPublicIp: false,
      securityGroups: [appSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      circuitBreaker: { enable: true, rollback: false },
    });

    // =========================================================================
    // Application Load Balancer — separate ALB for staging
    // =========================================================================
    const alb = new elbv2.ApplicationLoadBalancer(this, "StagingAlb", {
      vpc,
      internetFacing: true,
      securityGroup: albSg,
      loadBalancerName: "plexus-staging-alb",
    });

    // HTTP listener — redirect to HTTPS
    alb.addListener("StagingHttpListener", {
      port: 80,
      defaultAction: elbv2.ListenerAction.redirect({
        protocol: "HTTPS",
        port: "443",
      }),
    });

    // HTTPS listener — needs an ACM cert for staging.plexusclinical.com
    // For now, request a new cert (user will add DNS validation to GoDaddy)
    const stagingCert = new acm.Certificate(this, "StagingCert", {
      domainName: "staging.plexusclinical.com",
      validation: acm.CertificateValidation.fromDns(),
    });

    const httpsListener = alb.addListener("StagingHttpsListener", {
      port: 443,
      certificates: [stagingCert],
      sslPolicy: elbv2.SslPolicy.TLS12,
      open: true,
    });

    httpsListener.addTargets("StagingEcsTarget", {
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
    new cdk.CfnOutput(this, "StagingAlbUrl", {
      value: `https://staging.plexusclinical.com`,
      description: "Staging application URL",
    });

    new cdk.CfnOutput(this, "StagingAlbDns", {
      value: alb.loadBalancerDnsName,
      description: "Staging ALB DNS — point staging.plexusclinical.com CNAME here",
    });

    new cdk.CfnOutput(this, "StagingServiceName", {
      value: service.serviceName,
      description: "Staging ECS service name",
    });

    new cdk.CfnOutput(this, "StagingDatabaseEndpoint", {
      value: database.dbInstanceEndpointAddress,
      description: "Staging RDS endpoint",
    });

    new cdk.CfnOutput(this, "StagingDbSecretArn", {
      value: database.secret!.secretArn,
      description: "Staging RDS credentials secret ARN",
    });

    new cdk.CfnOutput(this, "StagingCertValidation", {
      value: "Check AWS Console → ACM for DNS validation records to add to GoDaddy",
      description: "Staging SSL cert validation instructions",
    });
  }
}
