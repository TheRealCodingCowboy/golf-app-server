# Create RDS Database - Step by Step AWS CLI Commands

## Step 1: Get your default VPC and subnet information
```bash
# Get your default VPC ID
aws ec2 describe-vpcs --filters "Name=isDefault,Values=true" --query "Vpcs[0].VpcId" --output text

# Get subnet IDs in your default VPC (you'll need at least 2 for RDS)
aws ec2 describe-subnets --filters "Name=vpc-id,Values=$(aws ec2 describe-vpcs --filters "Name=isDefault,Values=true" --query "Vpcs[0].VpcId" --output text)" --query "Subnets[*].SubnetId" --output text
```

## Step 2: Create a DB subnet group
```bash
# Replace SUBNET-ID-1 and SUBNET-ID-2 with actual subnet IDs from Step 1
aws rds create-db-subnet-group \
    --db-subnet-group-name ccm-golf-app-subnet-group \
    --db-subnet-group-description "Subnet group for CCM Golf App database" \
    --subnet-ids SUBNET-ID-1 SUBNET-ID-2
```

## Step 3: Create security group for database
```bash
# Get your default VPC ID
VPC_ID=$(aws ec2 describe-vpcs --filters "Name=isDefault,Values=true" --query "Vpcs[0].VpcId" --output text)

# Create security group
aws ec2 create-security-group \
    --group-name ccm-golf-app-db-sg \
    --description "Security group for CCM Golf App RDS database" \
    --vpc-id $VPC_ID
```

## Step 4: Add PostgreSQL port rule to security group
```bash
# Get security group ID
SG_ID=$(aws ec2 describe-security-groups --group-names ccm-golf-app-db-sg --query "SecurityGroups[0].GroupId" --output text)

# Allow PostgreSQL traffic (port 5432) from anywhere (you can restrict this later)
aws ec2 authorize-security-group-ingress \
    --group-id $SG_ID \
    --protocol tcp \
    --port 5432 \
    --cidr 0.0.0.0/0
```

## Step 5: Create the RDS instance
```bash
aws rds create-db-instance \
    --db-instance-identifier ccm-golf-app-db \
    --db-instance-class db.t3.micro \
    --engine postgres \
    --engine-version 15.4 \
    --master-username postgres \
    --master-user-password "Charpen2025!" \
    --allocated-storage 20 \
    --storage-type gp2 \
    --db-name ccmgolfapp \
    --vpc-security-group-ids $SG_ID \
    --db-subnet-group-name ccm-golf-app-subnet-group \
    --backup-retention-period 7 \
    --no-deletion-protection \
    --publicly-accessible
```

## Step 6: Check creation status
```bash
aws rds describe-db-instances --db-instance-identifier ccm-golf-app-db --query "DBInstances[0].DBInstanceStatus"
```

## Step 7: Get the database endpoint (once available)
```bash
aws rds describe-db-instances --db-instance-identifier ccm-golf-app-db --query "DBInstances[0].Endpoint.Address" --output text
```

---

**Note**: The database creation will take 5-10 minutes. You can monitor progress with the status command in Step 6.