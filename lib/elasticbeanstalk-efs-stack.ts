import * as path from "path";
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as elasticbeanstalk from 'aws-cdk-lib/aws-elasticbeanstalk';
import * as s3assets from 'aws-cdk-lib/aws-s3-assets';

export interface ElasticbeanstalkEfsStackProps extends cdk.StackProps {
  elasticbeanstalkServiceRoleName?: string,
  elasticbeanstalkInstanceRoleName?: string,
  elasticbeanstalkInstanceProfileName?: string,
  vpcName?: string,
  vpcSubnetNamesPrefix?: string,
  elasticbeanstalkSecurityGroupName?: string,
  efsSecurityGroupName?: string,
  elasticbeanstalkEnvironmentName?: string
}

export class ElasticbeanstalkEfsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: ElasticbeanstalkEfsStackProps) {
    super(scope, id, props);
    const ebServiceRole = new iam.Role(this, 'elasticbeanstalk-efs-stack-service-role', {
      roleName: props?.elasticbeanstalkServiceRoleName || 'elasticbeanstalk-efs-stack-eb-service-role',
      assumedBy: new iam.ServicePrincipal('elasticbeanstalk.amazonaws.com', {
        conditions: {
          StringEquals: {
            "sts:ExternalId": "elasticbeanstalk"
          }
        }
      }),
      managedPolicies: [
        iam.ManagedPolicy.fromManagedPolicyArn(this, 'AWSElasticBeanstalkEnhancedHealth', 'arn:aws:iam::aws:policy/service-role/AWSElasticBeanstalkEnhancedHealth'),
        iam.ManagedPolicy.fromManagedPolicyArn(this, 'AWSElasticBeanstalkManagedUpdatesCustomerRolePolicy', 'arn:aws:iam::aws:policy/AWSElasticBeanstalkManagedUpdatesCustomerRolePolicy'),
      ]
    });
    const ebInstanceRole = new iam.Role(this, 'elasticbeanstalk-efs-stack-ec2-role', {
      roleName: props?.elasticbeanstalkInstanceRoleName || 'elasticbeanstalk-efs-stack-ec2-role',
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromManagedPolicyArn(this, 'AWSElasticBeanstalkWebTier', 'arn:aws:iam::aws:policy/AWSElasticBeanstalkWebTier'),
        iam.ManagedPolicy.fromManagedPolicyArn(this, 'AWSElasticBeanstalkWorkerTier', 'arn:aws:iam::aws:policy/AWSElasticBeanstalkWorkerTier'),
        iam.ManagedPolicy.fromManagedPolicyArn(this, 'AWSElasticBeanstalkMulticontainerDocker', 'arn:aws:iam::aws:policy/AWSElasticBeanstalkMulticontainerDocker'),
        iam.ManagedPolicy.fromManagedPolicyArn(this, 'AmazonSSMManagedInstanceCore', 'arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore')
      ]
    });

    const ebInstanceProfile = new iam.CfnInstanceProfile(this, 'elasticbeanstalk-efs-stack-instance-profile', {
      instanceProfileName: props?.elasticbeanstalkInstanceProfileName || 'elasticbeanstalk-efs-stack-instance-profile',
      roles: [ebInstanceRole.roleName]
    });
    ebInstanceProfile.node.addDependency(ebInstanceRole);
    const vpc = new ec2.Vpc(this, 'elasticbeanstalk-efs-stack-vpc', {
      vpcName: props?.vpcName || 'elasticbeanstalk-efs-stack-vpc',
      cidr: '10.0.0.0/16',
      maxAzs: 2,
      subnetConfiguration: [
        {
          name: props?.vpcSubnetNamesPrefix || 'ElasticbeanstalkEfsStackPublic',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
          mapPublicIpOnLaunch: true
        }
      ]
    });
    const publicSubnetIds = vpc.publicSubnets.map((value) => value.subnetId);
    const efsSecGroup = new ec2.SecurityGroup(this, 'elasticbeanstalk-efs-stack-efs-sg', {
      securityGroupName: props?.efsSecurityGroupName || 'elasticbeanstalk-efs-stack-efs-sg',
      vpc: vpc,
      allowAllOutbound: true
    });
    const ebSecGroup = new ec2.SecurityGroup(this, 'elasticbeanstalk-efs-stack-eb-sg', {
      securityGroupName: props?.elasticbeanstalkSecurityGroupName || 'elasticbeanstalk-efs-stack-eb-sg',
      vpc: vpc,
      allowAllOutbound: true
    });
    efsSecGroup.addIngressRule(ebSecGroup, ec2.Port.tcp(2049));
    const efsFileSystem = new efs.FileSystem(this, 'elasticbeanstalk-efs-stack-efs', {
      vpc: vpc,
      encrypted: true,
      enableAutomaticBackups: false,
      performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
      securityGroup: efsSecGroup,
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });
    // const efsAccessPointWPC = new efs.AccessPoint(this, 'elasticbeanstalk-efs-stack-efs-ap', {
    //   fileSystem: efsFileSystem,
    //   path: '/docker-volumes',
    //   posixUser: {
    //     uid: '1000',
    //     gid: '1000'
    //   },
    //   createAcl: {
    //     ownerUid: '1000',
    //     ownerGid: '1000',
    //     permissions: '0770'
    //   }
    // });
    const ebApplication = new elasticbeanstalk.CfnApplication(this, 'elasticbeanstalk-efs-stack-eb-application', {});
    const s3Asset = new s3assets.Asset(this, 'elasticbeanstalk-efs-stack-eb-deployment-asset', {
      path: path.join(__dirname, '..', 'assets', 'ebdeployment')
    });
    s3Asset.grantRead(ebServiceRole);
    const ebDeployment = new elasticbeanstalk.CfnApplicationVersion(this, 'elasticbeanstalk-efs-stack-eb-deployment', {
      applicationName: ebApplication.ref,
      sourceBundle: {
        s3Bucket: <string>s3Asset.s3BucketName,
        s3Key: <string>s3Asset.s3ObjectKey
      }
    });
    ebDeployment.node.addDependency(ebApplication);
    const ebEnvironment = new elasticbeanstalk.CfnEnvironment(this, 'elasticbeanstalk-efs-stack-environment', {
      applicationName: ebApplication.ref,
      environmentName: props?.elasticbeanstalkEnvironmentName || 'elasticbeanstalk-efs-stack-env',
      solutionStackName: '64bit Amazon Linux 2 v3.4.19 running Docker',
      versionLabel: ebDeployment.ref,
      optionSettings: [
        {
          namespace: 'aws:elasticbeanstalk:application:environment',
          optionName: 'FILE_SYSTEM_ID',
          value: efsFileSystem.fileSystemId
        },
        {
          namespace: 'aws:elasticbeanstalk:application:environment',
          optionName: 'MOUNT_DIRECTORY',
          value: '/mnt/docker-volumes'
        },
        {
          namespace: 'aws:elasticbeanstalk:environment',
          optionName: 'EnvironmentType',
          value: 'SingleInstance'
        },
        {
          namespace: 'aws:elasticbeanstalk:environment',
          optionName: 'ServiceRole',
          value: ebServiceRole.roleName
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
        {
          namespace: 'aws:elasticbeanstalk:environment:proxy',
          optionName: 'ProxyServer',
          value: 'none'
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
