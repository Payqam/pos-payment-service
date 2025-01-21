"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CDKStack = void 0;
const cdk = require("aws-cdk-lib");
class CDKStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        // TODO: Add resources here
        new cdk.CfnOutput(this, 'env', {
            value: `${props.envName}${props.namespace}`,
        });
        new cdk.CfnOutput(this, 'region', {
            value: cdk.Aws.REGION,
        });
    }
}
exports.CDKStack = CDKStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2RrLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiY2RrLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLG1DQUFtQztBQVVuQyxNQUFhLFFBQVMsU0FBUSxHQUFHLENBQUMsS0FBSztJQUNyQyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQW9CO1FBQzVELEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRXhCLDJCQUEyQjtRQUUzQixJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLEtBQUssRUFBRTtZQUM3QixLQUFLLEVBQUUsR0FBRyxLQUFLLENBQUMsT0FBTyxHQUFHLEtBQUssQ0FBQyxTQUFTLEVBQUU7U0FDNUMsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxRQUFRLEVBQUU7WUFDaEMsS0FBSyxFQUFFLEdBQUcsQ0FBQyxHQUFHLENBQUMsTUFBTTtTQUN0QixDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUFkRCw0QkFjQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCB7IEVudkNvbmZpZyB9IGZyb20gJy4vaW5kZXgnO1xuXG5pbnRlcmZhY2UgQ0RLU3RhY2tQcm9wcyBleHRlbmRzIGNkay5TdGFja1Byb3BzIHtcbiAgZW52TmFtZTogc3RyaW5nO1xuICBuYW1lc3BhY2U6IHN0cmluZztcbiAgZW52Q29uZmlnczogRW52Q29uZmlnO1xufVxuXG5leHBvcnQgY2xhc3MgQ0RLU3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogQ0RLU3RhY2tQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuXG4gICAgLy8gVE9ETzogQWRkIHJlc291cmNlcyBoZXJlXG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnZW52Jywge1xuICAgICAgdmFsdWU6IGAke3Byb3BzLmVudk5hbWV9JHtwcm9wcy5uYW1lc3BhY2V9YCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdyZWdpb24nLCB7XG4gICAgICB2YWx1ZTogY2RrLkF3cy5SRUdJT04sXG4gICAgfSk7XG4gIH1cbn1cbiJdfQ==