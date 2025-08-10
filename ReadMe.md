# **PayQAM Android POS Payment Service**

## **Overview**

The **PayQAM Android POS Payment Service** is a secure and scalable payment processing system designed to handle transactions seamlessly between the POS application and external payment providers. The system is built using AWS serverless architecture with features such as CloudFront, WAF, Lambda functions, API Gateway, SNS, and Salesforce integration.

## **Architecture Diagram**

The architecture illustrates the end-to-end flow of payment processing, incorporating security, scalability, and fault tolerance.

## <img width="1253" height="736" alt="image" src="https://github.com/user-attachments/assets/632f336d-d24e-4cd0-b4a6-2f64d7cb2816" />



## **Key Features**

- **Secure Transactions**: End-to-end encryption with AWS KMS and TLS.
- **Scalable Architecture**: Serverless design with AWS Lambda and SNS.
- **Salesforce Integration**: Automated transaction logging in Salesforce.
- **Monitoring & Logging**: Integrated with AWS CloudWatch for insights and alerts.
- **Error Handling**: Configured DLQs for reliable error tracking and retries.

## **Getting Started**

### **Prerequisites**

- AWS CLI installed and configured.
- Node.js and npm for local development.
- An active Salesforce account for API integration.

### **Setup Instructions**

1. Clone the repository:
   ```bash
   git clone https://github.com/your-org/payqam-payment-service.git
   ```
