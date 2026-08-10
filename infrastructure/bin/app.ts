#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { PlexusStack } from "../lib/plexus-stack";
import { PlexusStagingStack } from "../lib/plexus-staging-stack";

const app = new cdk.App();

// Production stack
new PlexusStack(app, "PlexusCommandCenter", {
  env: {
    account: "374604322534", // plexusclinical-prod
    region: "us-east-1",
  },
  description: "Plexus Command Center — ECS Fargate + RDS + ALB + S3",
});

// Staging stack
new PlexusStagingStack(app, "PlexusCommandCenterStaging", {
  env: {
    account: "374604322534", // same account, isolated resources
    region: "us-east-1",
  },
  description: "Plexus Command Center STAGING — isolated test environment",
});
