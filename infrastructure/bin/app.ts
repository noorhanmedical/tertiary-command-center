#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { PlexusStagingStack } from "../lib/plexus-staging-stack";

const app = new cdk.App();

// -----------------------------------------------------------------------------
// STAGING — fresh environment in account 668778694522 / us-east-1.
// This is the only stack currently wired for deployment. Production is NOT
// created yet (per AWS-PROD-001 staging-first directive).
//
// Deploy target resolves from CDK env (CDK_DEFAULT_*) or explicit context so
// nothing is hardcoded and the stack cannot be accidentally aimed at the old
// 374604322534 account.
// -----------------------------------------------------------------------------
const account =
  app.node.tryGetContext("account") ??
  process.env.CDK_DEPLOY_ACCOUNT ??
  process.env.CDK_DEFAULT_ACCOUNT;

const region =
  app.node.tryGetContext("region") ??
  process.env.CDK_DEPLOY_REGION ??
  process.env.CDK_DEFAULT_REGION ??
  "us-east-1";

new PlexusStagingStack(app, "PlexusStaging", {
  env: { account, region },
  description:
    "Plexus Command Center — STAGING (ECS Fargate + RDS + ALB + S3, us-east-1)",
  tags: {
    Project: "plexus",
    Environment: "staging",
    ManagedBy: "cdk",
  },
});
