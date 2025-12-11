# Deployment Guide

## AWS Lambda Deployment (Recommended for Production)

### 1. Prepare Lambda Package

```bash
# Install production dependencies
npm install --production

# Create deployment package
zip -r battery-notification-service.zip . -x "*.git*" "node_modules/aws-sdk/*"
```

### 2. Create Lambda Function

```bash
aws lambda create-function \
  --function-name battery-notification-service \
  --runtime nodejs18.x \
  --role arn:aws:iam::YOUR_ACCOUNT:role/lambda-execution-role \
  --handler index.handler \
  --zip-file fileb://battery-notification-service.zip \
  --timeout 900 \
  --memory-size 512
```

### 3. Set Environment Variables

```bash
aws lambda update-function-configuration \
  --function-name battery-notification-service \
  --environment Variables='{
    "AWS_REGION":"us-east-1",
    "DYNAMODB_TABLE_NAME":"locks",
    "PG_HOST":"your-rds-endpoint.amazonaws.com",
    "PG_DATABASE":"your_database",
    "PG_USER":"your_username",
    "PG_PASSWORD":"your_password",
    "FIREBASE_PROJECT_ID":"your-project-id",
    "NOTIFICATION_THRESHOLD_DAYS":"30",
    "BATCH_SIZE":"100"
  }'
```

### 4. Create CloudWatch Event Rule

```bash
# Create rule for weekly execution (Sundays at 9 AM UTC)
aws events put-rule \
  --name battery-notification-weekly \
  --schedule-expression "cron(0 9 ? * SUN *)" \
  --description "Weekly battery notification campaign"

# Add Lambda as target
aws events put-targets \
  --rule battery-notification-weekly \
  --targets "Id"="1","Arn"="arn:aws:lambda:us-east-1:YOUR_ACCOUNT:function:battery-notification-service"

# Grant permission for CloudWatch Events to invoke Lambda
aws lambda add-permission \
  --function-name battery-notification-service \
  --statement-id allow-cloudwatch \
  --action lambda:InvokeFunction \
  --principal events.amazonaws.com \
  --source-arn arn:aws:events:us-east-1:YOUR_ACCOUNT:rule/battery-notification-weekly
```

### 5. Lambda Handler Modification

Add this to your `index.js`:

```javascript
// Lambda handler wrapper
exports.handler = async (event, context) => {
  const service = new BatteryNotificationService();
  
  try {
    await service.run();
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Battery notification service completed successfully',
        campaignId: service.campaignId
      })
    };
  } catch (error) {
    console.error('Service failed:', error);
    throw error;
  }
};
```

## Docker Deployment

### 1. Create Dockerfile

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001
USER nodejs

CMD ["node", "index.js"]
```

### 2. Build and Run

```bash
# Build image
docker build -t battery-notification-service .

# Run with environment file
docker run --env-file .env battery-notification-service

# Or with docker-compose
```

### 3. Docker Compose Setup

```yaml
version: '3.8'
services:
  notification-service:
    build: .
    env_file: .env
    volumes:
      - ./firebase-service-account.json:/app/firebase-service-account.json:ro
    depends_on:
      - postgres
    
  click-tracking-api:
    build: .
    command: node click-tracking-api.js
    ports:
      - "3000:3000"
    env_file: .env
    depends_on:
      - postgres
    
  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: battery_notifications
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: password
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./database-schema.sql:/docker-entrypoint-initdb.d/init.sql
    ports:
      - "5432:5432"

volumes:
  postgres_data:
```

## EC2 Deployment

### 1. Server Setup

```bash
# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2 for process management
sudo npm install -g pm2

# Clone and setup project
git clone your-repo
cd battery-notification-service
npm install
```

### 2. PM2 Configuration

Create `ecosystem.config.js`:

```javascript
module.exports = {
  apps: [{
    name: 'battery-notification-service',
    script: 'index.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env_file: '.env',
    cron_restart: '0 9 * * 0', // Weekly on Sundays at 9 AM
    exec_mode: 'fork'
  }, {
    name: 'click-tracking-api',
    script: 'click-tracking-api.js',
    instances: 'max',
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env_file: '.env',
    exec_mode: 'cluster'
  }]
};
```

### 3. Start Services

```bash
# Start with PM2
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save

# Setup PM2 to start on boot
pm2 startup
```

## Kubernetes Deployment

### 1. Create ConfigMap and Secret

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: battery-notification-config
data:
  AWS_REGION: "us-east-1"
  DYNAMODB_TABLE_NAME: "locks"
  NOTIFICATION_THRESHOLD_DAYS: "30"
  BATCH_SIZE: "100"
---
apiVersion: v1
kind: Secret
metadata:
  name: battery-notification-secrets
type: Opaque
stringData:
  AWS_ACCESS_KEY_ID: "your_access_key"
  AWS_SECRET_ACCESS_KEY: "your_secret_key"
  PG_HOST: "your-rds-endpoint.amazonaws.com"
  PG_DATABASE: "your_database"
  PG_USER: "your_username"
  PG_PASSWORD: "your_password"
  FIREBASE_PROJECT_ID: "your-project-id"
```

### 2. Create CronJob

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: battery-notification-cronjob
spec:
  schedule: "0 9 * * 0"  # Weekly on Sundays at 9 AM
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: battery-notification-service
            image: your-registry/battery-notification-service:latest
            envFrom:
            - configMapRef:
                name: battery-notification-config
            - secretRef:
                name: battery-notification-secrets
            volumeMounts:
            - name: firebase-key
              mountPath: /app/firebase-service-account.json
              subPath: firebase-service-account.json
          volumes:
          - name: firebase-key
            secret:
              secretName: firebase-service-account-key
          restartPolicy: OnFailure
```

### 3. Deploy API Service

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: click-tracking-api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: click-tracking-api
  template:
    metadata:
      labels:
        app: click-tracking-api
    spec:
      containers:
      - name: click-tracking-api
        image: your-registry/battery-notification-service:latest
        command: ["node", "click-tracking-api.js"]
        ports:
        - containerPort: 3000
        envFrom:
        - configMapRef:
            name: battery-notification-config
        - secretRef:
            name: battery-notification-secrets
---
apiVersion: v1
kind: Service
metadata:
  name: click-tracking-api-service
spec:
  selector:
    app: click-tracking-api
  ports:
  - port: 80
    targetPort: 3000
  type: LoadBalancer
```

## Monitoring Setup

### 1. CloudWatch Logs (AWS)

```bash
# Create log group
aws logs create-log-group --log-group-name /aws/lambda/battery-notification-service

# Set retention policy
aws logs put-retention-policy \
  --log-group-name /aws/lambda/battery-notification-service \
  --retention-in-days 30
```

### 2. CloudWatch Alarms

```bash
# Create alarm for Lambda errors
aws cloudwatch put-metric-alarm \
  --alarm-name "BatteryNotificationErrors" \
  --alarm-description "Battery notification service errors" \
  --metric-name Errors \
  --namespace AWS/Lambda \
  --statistic Sum \
  --period 300 \
  --threshold 1 \
  --comparison-operator GreaterThanOrEqualToThreshold \
  --dimensions Name=FunctionName,Value=battery-notification-service \
  --evaluation-periods 1
```

### 3. Application Metrics

Add to your service:

```javascript
const AWS = require('aws-sdk');
const cloudwatch = new AWS.CloudWatch();

// Custom metrics
async function putMetric(metricName, value, unit = 'Count') {
  const params = {
    Namespace: 'BatteryNotificationService',
    MetricData: [{
      MetricName: metricName,
      Value: value,
      Unit: unit,
      Timestamp: new Date()
    }]
  };
  
  try {
    await cloudwatch.putMetricData(params).promise();
  } catch (error) {
    console.error('Failed to put metric:', error);
  }
}

// Usage in your service
await putMetric('NotificationsSent', totalSent);
await putMetric('ClickThroughRate', clickThroughRate, 'Percent');
```

## Security Hardening

### 1. IAM Roles and Policies

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:Scan",
        "dynamodb:Query"
      ],
      "Resource": "arn:aws:dynamodb:*:*:table/locks"
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:*:*:*"
    }
  ]
}
```

### 2. VPC Configuration

```yaml
# For Lambda in VPC
VpcConfig:
  SecurityGroupIds:
    - sg-12345678
  SubnetIds:
    - subnet-12345678
    - subnet-87654321
```

### 3. Secrets Management

```bash
# Store secrets in AWS Secrets Manager
aws secretsmanager create-secret \
  --name battery-notification-service/config \
  --description "Configuration for battery notification service" \
  --secret-string '{
    "PG_PASSWORD": "your_password",
    "AWS_SECRET_ACCESS_KEY": "your_secret_key",
    "FIREBASE_PRIVATE_KEY": "your_firebase_key"
  }'
```

## Backup and Recovery

### 1. Database Backups

```bash
# Automated RDS backups
aws rds modify-db-instance \
  --db-instance-identifier your-db-instance \
  --backup-retention-period 7 \
  --preferred-backup-window "03:00-04:00"
```

### 2. Configuration Backups

```bash
# Backup Lambda configuration
aws lambda get-function --function-name battery-notification-service > lambda-config-backup.json

# Backup environment variables
aws lambda get-function-configuration --function-name battery-notification-service > lambda-env-backup.json
```

This deployment guide covers multiple deployment scenarios and includes production-ready configurations for monitoring, security, and backup strategies.