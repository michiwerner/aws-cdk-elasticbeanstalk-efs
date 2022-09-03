import * as path from "path";
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as elasticbeanstalk from 'aws-cdk-lib/aws-elasticbeanstalk';
import * as s3assets from 'aws-cdk-lib/aws-s3-assets';

export class WordpressStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    const ebServiceRole = new iam.Role(this, 'wordpress-elasticbeanstalk-service-role', {
      assumedBy: new iam.ServicePrincipal('elasticbeanstalk.amazonaws.com', {
        conditions: {
          StringEquals: {
            "sts:ExternalId": "elasticbeanstalk"
          }
        }
      }),
      managedPolicies: [
        iam.ManagedPolicy.fromManagedPolicyArn(this,'AWSElasticBeanstalkEnhancedHealth', 'arn:aws:iam::aws:policy/service-role/AWSElasticBeanstalkEnhancedHealth'),
        iam.ManagedPolicy.fromManagedPolicyArn(this, 'AWSElasticBeanstalkManagedUpdatesCustomerRolePolicy', 'arn:aws:iam::aws:policy/AWSElasticBeanstalkManagedUpdatesCustomerRolePolicy'),
      ]
    });
    const ebInstanceRole = new iam.Role(this, 'wordpress-elasticbeanstalk-ec2-role', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
          iam.ManagedPolicy.fromManagedPolicyArn(this,'AWSElasticBeanstalkWebTier', 'arn:aws:iam::aws:policy/AWSElasticBeanstalkWebTier'),
          iam.ManagedPolicy.fromManagedPolicyArn(this, 'AWSElasticBeanstalkWorkerTier', 'arn:aws:iam::aws:policy/AWSElasticBeanstalkWorkerTier'),
          iam.ManagedPolicy.fromManagedPolicyArn(this, 'AWSElasticBeanstalkMulticontainerDocker', 'arn:aws:iam::aws:policy/AWSElasticBeanstalkMulticontainerDocker'),
      ]
    });

    const ebInstanceProfile = new iam.CfnInstanceProfile(this, 'wordpress-elasticbeanstalk-instance-profile', {
      roles: [ebInstanceRole.roleId]
    });
    ebInstanceProfile.node.addDependency(ebInstanceRole);
    const vpc = new ec2.Vpc(this, 'wordpress-vpc', {
      cidr: '10.0.0.0/16',
      maxAzs: 2,
      subnetConfiguration: [
        {
          name: 'WordpressPublic',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
          mapPublicIpOnLaunch: true
        }
      ]
    });
    const publicSubnetIds = vpc.publicSubnets.map((value) => value.subnetId);
    const efsSecGroup = new ec2.SecurityGroup(this, 'wordpress-efs-sg', {
      vpc: vpc,
      allowAllOutbound: true
    });
    const ebSecGroup = new ec2.SecurityGroup(this, 'wordpress-eb-sg', {
      vpc: vpc,
      allowAllOutbound: true
    });
    efsSecGroup.addIngressRule(ebSecGroup, ec2.Port.tcp(2049));
    const efsFileSystem = new efs.FileSystem(this, 'wordpress-efs', {
      vpc: vpc,
      encrypted: true,
      enableAutomaticBackups: false,
      performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
      securityGroup: efsSecGroup
    });
    const efsAccessPointWPC = new efs.AccessPoint(this, 'wordpress-efs-ap-wpc', {
      fileSystem: efsFileSystem,
      path: '/wp-content',
      posixUser: {
        uid: '1000',
        gid: '1000'
      },
      createAcl: {
        ownerUid: '1000',
        ownerGid: '1000',
        permissions: '0770'
      }
    });
    const efsAccessPointSQLite = new efs.AccessPoint(this, 'wordpress-efs-ap-sqlite', {
      fileSystem: efsFileSystem,
      path: '/sqlite',
      posixUser: {
        uid: '1000',
        gid: '1000'
      },
      createAcl: {
        ownerUid: '1000',
        ownerGid: '1000',
        permissions: '0770'
      }
    });
    const ebApplication = new elasticbeanstalk.CfnApplication(this, 'wordpress-eb-application', {});
    const s3Asset = new s3assets.Asset(this, 'wordpress-eb-deployment-asset', {
      path: path.join(__dirname, '..', 'assets', 'ebdeployment')
    });
    s3Asset.grantRead(ebServiceRole);
    const ebDeployment = new elasticbeanstalk.CfnApplicationVersion(this, 'wordpress-eb-deployment', {
      applicationName: ebApplication.ref,
      sourceBundle: {
        s3Bucket: <string>s3Asset.s3BucketName,
        s3Key: <string>s3Asset.s3ObjectKey
      }
    });
    ebDeployment.node.addDependency(ebApplication);
    const ebEnvironment = new elasticbeanstalk.CfnEnvironment(this, 'wordpress-eb-environment', {
      applicationName: ebApplication.ref,
      environmentName: 'wordpress-env',
      solutionStackName: '64bit Amazon Linux 2 v3.4.19 running Docker',
      versionLabel: ebDeployment.ref,
      optionSettings: [
        {
          namespace: 'aws:elasticbeanstalk:environment',
          optionName: 'EnvironmentType',
          value: 'SingleInstance'
        },
        {
          namespace: 'aws:elasticbeanstalk:environment',
          optionName: 'ServiceRole',
          value: ebServiceRole.roleId
        },
        {
          namespace: 'aws:autoscaling:launchconfiguration',
          optionName: 'IamInstanceProfile',
          value: ebInstanceProfile.ref
        },
        {
          namespace: 'aws:autoscaling:launchconfiguration',
          optionName: 'RootVolumeType',
          value: 'standard'
        },
        {
          namespace: 'aws:autoscaling:launchconfiguration',
          optionName: 'RootVolumeSize',
          value: '10'
        },
        {
          namespace: 'aws:autoscaling:launchconfiguration',
          optionName: 'SecurityGroups',
          value: ebSecGroup.securityGroupId
        },
        {
          namespace: 'aws:ec2:vpc',
          optionName: 'VPCId',
          value: vpc.vpcId
        },
        {
          namespace: 'aws:ec2:vpc',
          optionName: 'Subnets',
          value: publicSubnetIds.join()
        },
        {
          namespace: 'aws:ec2:instances',
          optionName: 'EnableSpot',
          value: 'true'
        },
        {
          namespace: 'aws:ec2:instances',
          optionName: 'InstanceTypes',
          value: 't4g.nano'
        },
        {
          namespace: 'aws:ec2:instances',
          optionName: 'SupportedArchitectures',
          value: 'arm64'
        },
        {
          namespace: 'aws:elasticbeanstalk:healthreporting:system',
          optionName: 'SystemType',
          value: 'basic'
        },
      ]
    });
    ebEnvironment.node.addDependency(ebServiceRole);
    ebEnvironment.node.addDependency(ebInstanceRole);
    ebEnvironment.node.addDependency(ebInstanceProfile);
    ebEnvironment.node.addDependency(ebApplication);
    ebEnvironment.node.addDependency(ebDeployment);
  }
}
