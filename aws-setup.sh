#!/bin/bash

# AWS RDS Database Creation Script for Golf App
# Make sure you have AWS CLI configured with your credentials

echo "Creating RDS PostgreSQL database for Golf App..."

# Create DB subnet group (required for RDS)
aws rds create-db-subnet-group \
    --db-subnet-group-name ccm-golf-app-subnet-group \
    --db-subnet-group-description "Subnet group for CCM Golf App database" \
    --subnet-ids subnet-12345678 subnet-87654321 \
    --tags Key=Application,Value=CCMGolfApp

# Note: You'll need to replace the subnet-ids above with actual subnet IDs from your VPC
# To get your default VPC subnets, run:
# aws ec2 describe-subnets --filters "Name=vpc-id,Values=$(aws ec2 describe-vpcs --filters "Name=isDefault,Values=true" --query "Vpcs[0].VpcId" --output text)" --query "Subnets[*].SubnetId" --output text

# Create security group for RDS
aws ec2 create-security-group \
    --group-name ccm-golf-app-db-sg \
    --description "Security group for CCM Golf App RDS database" \
    --vpc-id $(aws ec2 describe-vpcs --filters "Name=isDefault,Values=true" --query "Vpcs[0].VpcId" --output text)

# Get the security group ID
SG_ID=$(aws ec2 describe-security-groups --group-names ccm-golf-app-db-sg --query "SecurityGroups[0].GroupId" --output text)

# Add inbound rule for PostgreSQL (port 5432)
aws ec2 authorize-security-group-ingress \
    --group-id $SG_ID \
    --protocol tcp \
    --port 5432 \
    --source-group $SG_ID

# Create the RDS instance
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
    --storage-encrypted \
    --deletion-protection \
    --tags Key=Application,Value=CCMGolfApp Key=Environment,Value=Production

echo "RDS instance creation initiated. This will take several minutes to complete."
echo "You can check the status with:"
echo "aws rds describe-db-instances --db-instance-identifier ccm-golf-app-db"