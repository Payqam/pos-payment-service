import { SNSClient, PublishCommand, PublishCommandInput } from '@aws-sdk/client-sns';

export class SNSClientWrapper {
    private static instance: SNSClientWrapper;
    private snsClient: SNSClient;

    private constructor() {
        this.snsClient = new SNSClient({
            region: process.env.AWS_REGION,
        });
    }

    /**
     * Returns the singleton instance of the SNSClientWrapper.
     */
    public static getInstance(): SNSClientWrapper {
        if (!SNSClientWrapper.instance) {
            SNSClientWrapper.instance = new SNSClientWrapper();
        }
        return SNSClientWrapper.instance;
    }

    /**
     * Publishes a message to an SNS topic.
     * @param input - The publish command input.
     * @returns Promise<string> - The message ID if successful.
     */
    public async publishMessage(input: PublishCommandInput): Promise<string> {
        const command = new PublishCommand(input);
        const response = await this.snsClient.send(command);
        return response.MessageId!;
    }
}
