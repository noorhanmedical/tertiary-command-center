#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { PlexusStack } from "../lib/plexus-stack";

const app = new cdk.App();

new PlexusStack(app, "PlexusCommandCenter", {
  env: {
    account: "374604322534", // plexusclinical-prod
    region: "us-east-1",
  },
  description: "Plexus Command Center — ECS Fargate + RDS + ALB + S3",
});
