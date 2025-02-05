export function buildUpdateExpression<T extends object>(
  event: T,
  expressionAttributeValues: { [key: string]: unknown }
): {
  updateExpression: string;
  expressionAttributeNames: { [key: string]: string };
} {
  let updateExpression = 'set';
  const expressionAttributeNames: { [key: string]: string } = {};

  Object.keys(event).forEach((field) => {
    const attributeName = `#attr_${field}`;
    updateExpression += ` ${attributeName} = :${field},`;
    expressionAttributeValues[`:${field}`] = event[field as keyof T];
    expressionAttributeNames[attributeName] = field;
  });

  // Remove the trailing comma
  updateExpression = updateExpression.slice(0, -1);

  return {
    updateExpression,
    expressionAttributeNames,
  };
}
