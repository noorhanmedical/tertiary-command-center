#!/bin/bash
# Script to enable new UI features by updating ECS task definition
# Run this with: bash enable-features.sh

set -e

CLUSTER="plexus-prod"
SERVICE="command-center"
REGION="us-east-1"
PROFILE="prod"

echo "🔍 Finding current task definition..."
TASK_DEF_ARN=$(aws ecs describe-services \
  --cluster $CLUSTER \
  --services $SERVICE \
  --region $REGION \
  --profile $PROFILE \
  --query 'services[0].taskDefinition' \
  --output text)

echo "✅ Current task definition: $TASK_DEF_ARN"

echo "📥 Downloading current task definition..."
TASK_DEF=$(aws ecs describe-task-definition \
  --task-definition $TASK_DEF_ARN \
  --region $REGION \
  --profile $PROFILE)

echo "🔧 Creating new task definition with feature flags..."

# Extract the current task definition and add new environment variables
NEW_TASK_DEF=$(echo $TASK_DEF | jq '.taskDefinition | 
  .containerDefinitions[0].environment += [
    {"name": "FEATURE_PCS_CANONICAL_VIEW", "value": "true"},
    {"name": "FEATURE_ACS_CANONICAL_VIEW", "value": "true"},
    {"name": "FEATURE_CLINICIAN_PORTAL_CANONICAL_DATA", "value": "true"},
    {"name": "FEATURE_ENGAGEMENT_MULTI_LIST_REPOSITORY", "value": "true"},
    {"name": "FEATURE_ENGAGEMENT_RECENT_LISTS", "value": "true"},
    {"name": "FEATURE_UNIFIED_ANCILLARY_DOCUMENTS", "value": "true"},
    {"name": "FEATURE_CANONICAL_APPOINTMENT", "value": "true"},
    {"name": "FEATURE_CANONICAL_ORDER_NOTE", "value": "true"},
    {"name": "FEATURE_ORDER_NOTE_AI", "value": "true"},
    {"name": "AI_INTEGRATIONS_OPENAI_API_KEY", "value": "'"$OPENAI_KEY"'"}
  ] |
  del(.taskDefinitionArn, .revision, .status, .requiresAttributes, .compatibilities, .registeredAt, .registeredBy)')

echo "📤 Registering new task definition..."
NEW_TASK_ARN=$(echo $NEW_TASK_DEF | \
  aws ecs register-task-definition \
    --cli-input-json file:///dev/stdin \
    --region $REGION \
    --profile $PROFILE \
    --query 'taskDefinition.taskDefinitionArn' \
    --output text)

echo "✅ New task definition: $NEW_TASK_ARN"

echo "🚀 Updating ECS service..."
aws ecs update-service \
  --cluster $CLUSTER \
  --service $SERVICE \
  --task-definition $NEW_TASK_ARN \
  --force-new-deployment \
  --region $REGION \
  --profile $PROFILE \
  --query 'service.serviceName' \
  --output text

echo ""
echo "✅ Service update initiated!"
echo "⏳ Deployment will take ~5-10 minutes"
echo "🌐 Check status: https://console.aws.amazon.com/ecs/v2/clusters/$CLUSTER/services/$SERVICE"
echo ""
echo "Monitor deployment:"
echo "  aws ecs describe-services --cluster $CLUSTER --services $SERVICE --region $REGION --profile $PROFILE"
