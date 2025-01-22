import { APIGatewayProxyHandler } from 'aws-lambda';
import {API} from "../../../configurations/api";

export const handler: APIGatewayProxyHandler = async (event) => {
    try {
        console.log('Received event:', JSON.stringify(event, null, 2));

        return {
            statusCode: 200,
            headers: API.DEFAULT_HEADERS,
            body: JSON.stringify({ message: 'Event logged successfully' }),
        };
    } catch (error) {
        console.error('Error logging event:', error);

        return {
            statusCode: 500,
            headers: API.DEFAULT_HEADERS,
            body: JSON.stringify({ error: 'Failed to log event' }),
        };
    }
};

