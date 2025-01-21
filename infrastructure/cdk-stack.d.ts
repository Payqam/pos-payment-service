import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { EnvConfig } from './index';
interface CDKStackProps extends cdk.StackProps {
    envName: string;
    namespace: string;
    envConfigs: EnvConfig;
}
export declare class CDKStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: CDKStackProps);
}
export {};
