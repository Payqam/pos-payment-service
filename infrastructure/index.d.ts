#!/usr/bin/env node
import 'source-map-support/register';
export interface EnvConfig {
    CDK_ACCOUNT: string;
    CDK_REGION: string;
    LOG_LEVEL: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
}
