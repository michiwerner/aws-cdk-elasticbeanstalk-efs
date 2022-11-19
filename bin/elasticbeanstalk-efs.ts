#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ElasticbeanstalkEfsStack, ElasticbeanstalkEfsStackProps } from '../lib/elasticbeanstalk-efs-stack';

const stackProps: ElasticbeanstalkEfsStackProps = process.env.ENVIRONMENT_NAME === 'dev' ? {
  elasticbeanstalkServiceRoleName: 'dev-eb-efs-stack-eb-service-role',
  elasticbeanstalkInstanceRoleName: 'dev-eb-efs-stack-ec2-role',
  elasticbeanstalkInstanceProfileName: 'dev-eb-efs-stack-ec2-profile',
  elasticbeanstalkSecurityGroupName: 'dev-eb-efs-stack-eb-sg',
  efsSecurityGroupName: 'dev-eb-efs-stack-efs-sg',
  efsFileSystemName: 'dev-eb-efs-stack-efs',
  elasticbeanstalkEnvironmentName: 'dev-eb-efs-stack-env',
  elasticbeanstalkApplicationName: 'DevEbEfsStackApplication',
  vpcName: 'dev-eb-efs-stack-vpc',
  vpcSubnetNamesPrefix: 'DevEbEfsStackPublic'
} : {};

const app = new cdk.App();
new ElasticbeanstalkEfsStack(app, 'ElasticbeanstalkEfsStack', stackProps);