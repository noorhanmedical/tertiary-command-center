#!/usr/bin/env bash
# =============================================================================
# build-demo-seed-taskdef.sh
#
# Generates a ready-to-register ECS task definition for the investor-demo
# seed by copying the image, roles, secrets, and log config from the running
# `command-center` task definition — so you don't hand-edit placeholders.
#
# It overrides:
#   • family      → plexus-demo-seed
#   • command     → run the seed (or --cleanup) instead of the web server
#   • NODE_ENV    → development (the seed refuses to run under production)
#   • DEMO_PASSWORD (from the DEMO_PASSWORD env var, default PlexusDemo2026!)
#
# Requires: aws CLI + jq.
#
# Usage:
#   # Seed (default):
#   DEMO_PASSWORD='StrongPass1' ./deploy/build-demo-seed-taskdef.sh > taskdef.json
#   aws ecs register-task-definition --cli-input-json file://taskdef.json
#
#   # Cleanup variant:
#   MODE=cleanup ./deploy/build-demo-seed-taskdef.sh > taskdef.cleanup.json
#
# Then run it (see DEMO_INVESTOR.md for the run-task command).
# =============================================================================
set -euo pipefail

SOURCE_TASKDEF="${SOURCE_TASKDEF:-command-center}"
CONTAINER_NAME="${CONTAINER_NAME:-demo-seed}"
REGION="${AWS_REGION:-us-east-1}"
DEMO_PASSWORD="${DEMO_PASSWORD:-PlexusDemo2026!}"
MODE="${MODE:-seed}"

if ! command -v jq >/dev/null 2>&1; then
  echo "error: jq is required" >&2; exit 1
fi

if [ "$MODE" = "cleanup" ]; then
  SEED_CMD="E2E_SEED_APPLY=YES npx tsx script/seedInvestorDemo.ts --cleanup"
else
  SEED_CMD="E2E_SEED_APPLY=YES npx tsx script/seedInvestorDemo.ts"
fi

# Pull the source task definition.
src="$(aws ecs describe-task-definition \
  --task-definition "$SOURCE_TASKDEF" \
  --region "$REGION" \
  --query 'taskDefinition' --output json)"

# Take the first container as the template; keep only DATABASE_URL from its
# secrets (the seed only needs the DB); override name/command/env.
echo "$src" | jq \
  --arg cname "$CONTAINER_NAME" \
  --arg cmd "$SEED_CMD" \
  --arg pw "$DEMO_PASSWORD" \
  '
  .containerDefinitions[0] as $c
  | {
      family: "plexus-demo-seed",
      networkMode: (.networkMode // "awsvpc"),
      requiresCompatibilities: (.requiresCompatibilities // ["FARGATE"]),
      cpu: (.cpu // "512"),
      memory: (.memory // "1024"),
      executionRoleArn: .executionRoleArn,
      taskRoleArn: .taskRoleArn,
      containerDefinitions: [
        {
          name: $cname,
          image: $c.image,
          essential: true,
          command: ["sh","-c",$cmd],
          environment: [
            {name:"NODE_ENV", value:"development"},
            {name:"DEMO_PASSWORD", value:$pw}
          ],
          secrets: [ ($c.secrets // [])[] | select(.name=="DATABASE_URL") ],
          logConfiguration: $c.logConfiguration
        }
      ]
    }
  '
