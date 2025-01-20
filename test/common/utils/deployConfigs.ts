type StringJSON = { [key: string]: string };

export const getDeployConfigs = (
  configs: any,
  appSyncParameters: StringJSON
): StringJSON => {
  // Add required configs to be included here
  const requiredConfigs: string[] = [
    appSyncParameters.apiUrl,
    appSyncParameters.apiKey,
  ];

  if (Object.keys(configs).length === 0) {
    throw new Error('No CDK configs found from the cdk-outputs.json file');
  }

  const stackName: string = Object.keys(configs)[0];
  const stackConfigs: StringJSON = configs[stackName];
  const parsedConfig: StringJSON = {};

  requiredConfigs.forEach((configKey: string) => {
    const keyName: string | undefined = Object.keys(stackConfigs).find((key) =>
      key.includes(configKey)
    );
    if (keyName === undefined) {
      throw new Error(`${configKey} not found`);
    }
    parsedConfig[configKey] = stackConfigs[keyName];
  });
  return parsedConfig;
};
